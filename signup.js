import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

const path = window.location.pathname;
const isSignupPage = path.includes('signup.html');
const isConfirmedPage = path.includes('confirmed.html');

// SIGN-UP PAGE HANDLER
if (isSignupPage) {
  const signupForm = document.getElementById('signup-form');
  const message = document.getElementById('message');

  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const agentId = document.getElementById('agent-id').value.trim();
    const firstName = document.getElementById('first-name').value.trim();
    const lastName = document.getElementById('last-name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!agentId || !firstName || !lastName || !email || !password) {
      message.textContent = '⚠️ Please fill in all fields.';
      return;
    }

    const { data: approved, error: checkError } = await supabase
      .from('approved_agents')
      .select('*')
      .eq('agent_id', agentId)
      .eq('is_registered', false)
      .single();

    if (checkError || !approved) {
      message.textContent = '⚠️ Invalid agent ID or already registered.';
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'https://fv-ia.com/confirmed.html'
      }
    });

    if (error) {
      message.textContent = '❌ Signup failed: ' + error.message;
      return;
    }

    await supabase
      .from('approved_agents')
      .update({ is_registered: true })
      .eq('agent_id', agentId);

    message.textContent = '✅ Signup successful! Check your email.';
  });
}

// CONFIRMATION PAGE HANDLER
if (isConfirmedPage) {
  const status = document.getElementById('status');
  status.textContent = '⏳ Reading token...';

  (async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      status.textContent = '❌ No confirmation token found.';
      return;
    }

    status.textContent = '🔐 Verifying email...';

    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: 'email'
    });

    if (error) {
      status.textContent = '❌ Verification failed: ' + error.message;
      return;
    }

    const user = data.user;
    const email = user.email;

    const { data: exists } = await supabase
      .from('agents')
      .select('id')
      .eq('id', user.id)
      .single();

    if (exists) {
      status.textContent = '🔁 Agent already exists. Redirecting...';
      setTimeout(() => window.location.href = 'login.html', 3000);
      return;
    }

    const { data: approved } = await supabase
      .from('approved_agents')
      .select('agent_id, first_name, last_name')
      .eq('email', email)
      .single();

    if (!approved) {
      status.textContent = '❌ Approved agent not found.';
      return;
    }

    const { error: insertErr } = await supabase.from('agents').insert({
      id: user.id,
      agent_id: approved.agent_id,
      first_name: approved.first_name,
      last_name: approved.last_name,
      full_name: `${approved.first_name} ${approved.last_name}`,
      email: email,
      is_active: true,
      is_admin: false
    });

    if (insertErr) {
      status.textContent = '❌ Failed to insert agent.';
      return;
    }

    await supabase
      .from('approved_agents')
      .update({ is_registered: true })
      .eq('email', email);

    status.textContent = '🎉 Agent profile created. Redirecting to login...';
    setTimeout(() => window.location.href = 'login.html', 3000);
  })();
}
