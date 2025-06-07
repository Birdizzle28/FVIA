  import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

  const supabase = createClient(
    'https://ddlbgkolnayqrxslzsxn.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
  );

  const status = document.getElementById('status');
  status.textContent = '⏳ Reading token...';

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    status.textContent = '❌ No token found in URL.';
  } else {
    status.textContent = '🔐 Verifying your email...';

    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: 'email'
    });

    if (error) {
      status.textContent = '❌ Verification failed: ' + error.message;
    } else {
      const user = data.user;
      const email = user.email;
      status.textContent = '✅ Verified! Setting up your profile...';

      // Check if already in agents
      const { data: exists } = await supabase
        .from('agents')
        .select('id')
        .eq('id', user.id)
        .single();

      if (!exists) {
        // Lookup in approved_agents
        const { data: approved } = await supabase
          .from('approved_agents')
          .select('agent_id, first_name, last_name')
          .eq('email', email)
          .single();

        if (approved) {
          // Insert into agents
          await supabase.from('agents').insert({
            id: user.id,
            agent_id: approved.agent_id,
            first_name: approved.first_name,
            last_name: approved.last_name,
            full_name: `${approved.first_name} ${approved.last_name}`,
            email: email,
            is_active: true,
            is_admin: false
          });

          // Update approved_agents
          await supabase
            .from('approved_agents')
            .update({ is_registered: true })
            .eq('email', email);

          status.textContent = '🎉 Account set up! Redirecting...';
          setTimeout(() => window.location.href = 'login.html', 3000);
        } else {
          status.textContent = '❌ Approved agent not found.';
        }
      } else {
        status.textContent = '🔁 Already registered. Redirecting...';
        setTimeout(() => window.location.href = 'login.html', 3000);
      }
    }
  }
