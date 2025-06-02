console.log("Agent ID entered:", agentId)
console.log("Checking Supabase for match...")
const { data, error } = await supabase
  .from('approved_agents')
  .select('*')
  .eq('agent_id', agentId)
  .eq('is_registered', false)
  .single()

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Replace with your actual Supabase info
const supabaseUrl = 'https://ddlbgkolnayqrxslzsxn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
const supabase = createClient(supabaseUrl, supabaseKey)

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const agentId = document.getElementById('agent-id').value.trim()
  const email = document.getElementById('email').value.trim()
  const password = document.getElementById('password').value
  const message = document.getElementById('message')

  message.textContent = 'Checking agent ID...'

  // Step 1: Validate agent ID
  const { data, error } = await supabase
    .from('approved_agents')
    .select('*')
    .eq('agent_id', agentId)
    .eq('is_registered', false)
    .single()

  if (error || !data) {
    message.textContent = 'Invalid or already used Agent ID.'
    return
  }

  // Step 2: Create user
  const { error: signUpError } = await supabase.auth.signUp({
    email,
    password
  })

  if (signUpError) {
    message.textContent = 'Error signing up: ' + signUpError.message
    return
  }

  // Step 3: Mark agent ID as used
  const { error: updateError } = await supabase
    .from('approved_agents')
    .update({ is_registered: true })
    .eq('agent_id', agentId)

  if (updateError) {
    message.textContent = 'Signup complete, but failed to mark Agent ID. Contact admin.'
    return
  }

  message.style.color = 'green'
  message.textContent = 'Sign-up successful! Please check your email to confirm.'
})
