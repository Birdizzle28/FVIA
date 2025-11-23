// netlify/functions/runPayoutBatch.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

export async function handler(event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use GET or POST to run a payout batch.',
    };
  }

  const qp = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST' && event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      body = {};
    }
  }

  const mode         = (qp.mode || body.mode || 'preview').toLowerCase(); // 'preview' or 'commit'
  const payout_type  = (qp.payout_type || body.payout_type || 'weekly').toLowerCase(); // 'weekly' or 'monthly'
  const cutoff_date  = qp.cutoff_date || body.cutoff_date || null; // e.g. '2025-11-21'

  // If no cutoff_date provided, default to "now"
  const cutoff = cutoff_date ? new Date(cutoff_date) : new Date();
  const cutoffISO = cutoff.toISOString();

  try {
    // 1) Load all unsettled ledger rows up to cutoff
    const { data: rows, error: rowsErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount, currency, created_at')
      .eq('is_settled', false)
      .lte('created_at', cutoffISO);

    if (rowsErr) {
      console.error('Error loading unsettled ledger rows:', rowsErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load unsettled rows', details: rowsErr }),
      };
    }

    if (!rows || rows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No unsettled ledger rows to pay out.',
          mode,
          payout_type,
          cutoff: cutoffISO
        }),
      };
    }

    // 2) Group by agent
    const byAgent = new Map(); // agent_id => { amount, currency }
    for (const row of rows) {
      if (!row.agent_id) continue;
      const key = row.agent_id;
      const current = byAgent.get(key) || { amount: 0, currency: row.currency || 'USD' };
      current.amount += Number(row.amount) || 0;
      byAgent.set(key, current);
    }

    const agentTotals = Array.from(byAgent.entries()).map(([agent_id, info]) => ({
      agent_id,
      amount: Math.round(info.amount * 100) / 100,
      currency: info.currency || 'USD'
    }));

    // 3) Load good_standing snapshot for those agents from the view
    const agentIds = agentTotals.map(a => a.agent_id);

    const { data: standings, error: standErr } = await supabase
      .from('agent_commission_overview')
      .select('agent_id, good_standing, standing_reasons')
      .in('agent_id', agentIds);

    if (standErr) {
      console.error('Error loading standings:', standErr);
    }

    const standingByAgent = new Map();
    if (standings) {
      standings.forEach(s => {
        standingByAgent.set(s.agent_id, {
          good_standing: s.good_standing,
          standing_reasons: s.standing_reasons || []
        });
      });
    }

    // Build preview payload
    const preview = agentTotals.map(a => {
      const standing = standingByAgent.get(a.agent_id) || {
        good_standing: true,
        standing_reasons: []
      };
      return {
        agent_id: a.agent_id,
        amount: a.amount,
        currency: a.currency,
        good_standing: standing.good_standing,
        standing_reasons: standing.standing_reasons
      };
    });

    // If in preview mode, do NOT change the DB
    if (mode === 'preview') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          mode: 'preview',
          payout_type,
          cutoff: cutoffISO,
          agents: preview
        }, null, 2),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // 4) In commit mode, create a payout batch + items, mark rows as settled
    const totalAmount = preview.reduce((sum, p) => sum + p.amount, 0);

    // Create payout batch
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        payout_date: cutoffISO,
        payout_type,
        period_start: null, // you can refine later
        period_end: null,   // you can refine later
        total_amount: totalAmount,
        notes: `Auto-run payout batch (${payout_type}) up to ${cutoffISO}`
      })
      .select('id')
      .single();

    if (batchErr || !batchRows) {
      console.error('Error creating payout batch:', batchErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create payout batch', details: batchErr }),
      };
    }

    const batchId = batchRows.id;

    // Create items for each agent
    const itemsToInsert = preview.map(p => ({
      payout_batch_id: batchId,
      agent_id: p.agent_id,
      amount: p.amount,
      currency: p.currency,
      standing_snapshot: {
        good_standing: p.good_standing,
        standing_reasons: p.standing_reasons
      }
    }));

    const { error: itemsErr } = await supabase
      .from('payout_batch_items')
      .insert(itemsToInsert);

    if (itemsErr) {
      console.error('Error inserting payout_batch_items:', itemsErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to insert payout_batch_items', details: itemsErr }),
      };
    }

    // Mark commission_ledger rows as settled
    const ledgerIds = rows.map(r => r.id);

    const { error: updErr } = await supabase
      .from('commission_ledger')
      .update({
        is_settled: true,
        payout_batch_id: batchId
      })
      .in('id', ledgerIds);

    if (updErr) {
      console.error('Error updating commission_ledger as settled:', updErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to mark ledger rows as settled', details: updErr }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        mode: 'commit',
        payout_type,
        cutoff: cutoffISO,
        payout_batch_id: batchId,
        total_amount: totalAmount,
        agents: preview
      }, null, 2),
      headers: { 'Content-Type': 'application/json' }
    };
  } catch (err) {
    console.error('Unexpected error in runPayoutBatch:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
