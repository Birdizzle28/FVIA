// Import Supabase client library and initialize the client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient('https://ddlbgkolnayqrxslzsxn.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho');

// Helper: Show alert and log error (for consistent user feedback)
function showAlert(message) {
  alert(message);
  console.error(message);
}

// Signup form handler
const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      // Gather and trim input values from the signup form
      const agentId = document.getElementById('agent-id').value.trim();
      const firstName = document.getElementById('first-name').value.trim();
      const lastName = document.getElementById('last-name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      // Basic validation: ensure all fields are filled
      if (!agentId || !firstName || !lastName || !email || !password) {
        showAlert("⚠️ Please fill in all fields.");
        return;
      }
      // 1️⃣ Verify that the provided agentId exists in approved_agents and is not yet registered
      const { data: approvedAgent, error: agentCheckError } = await supabase
        .from('approved_agents')
        .select('*')
        .eq('agent_id', agentId)
        .eq('is_registered', false)
        .single();

      message.textContent = JSON.stringify({ agentCheckError, approvedAgent }, null, 2);
      if (agentCheckError || !approvedAgent) {
        // If no matching record or already registered, show error
        showAlert("⚠️ Invalid agent ID or this agent is already registered.");
        return;
      }
      // 2️⃣ Register the user with Supabase Auth (triggers confirmation email if enabled)
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          emailRedirectTo: 'https://fv-ia.com/confirmed.html'
        }
      });
      if (signUpError) {
        // Sign-up failed (e.g., email already in use)
        showAlert("❌ Sign-up failed: " + signUpError.message);
        return;
      }
      // FIX: If email confirmation is disabled, create profile immediately using session
      if (signUpData.session) {
        // ✅ Email confirmation not required: user is signed in, create agent profile now
        const user = signUpData.user;
        const { error: profileInsertError } = await supabase.from('agents').insert({
          id: user.id,
          agent_id: agentId,
          first_name: firstName,
          last_name: lastName,
          email: email,
          full_name: `${firstName} ${lastName}`,
          is_active: true,
          is_admin: false
        });
        if (profileInsertError) {
          showAlert("❌ Failed to create agent profile: " + profileInsertError.message);
        } else {
          console.log("✅ Agent profile created for", email);
        }
        // Mark this agent as registered in approved_agents
        const { error: updateError } = await supabase
          .from('approved_agents')
          .update({
            is_registered: true,
            first_name: firstName,
            last_name: lastName,
            email: email
          })
          .eq('agent_id', agentId);
        if (updateError) {
          showAlert("⚠️ Warning: Sign-up succeeded, but failed to update agent status. Please contact support. Error: " + updateError.message);
        }
        window.location.href = "dashboard.html";
        return;
      } else {
        // If confirm email is enabled, Supabase returns a user (no session) and sends a confirmation email [oai_citation:0†supabase.com](https://supabase.com/docs/reference/javascript/auth-signup#:~:text=,redirect%20URLs%20in%20your%20project)
        alert("✅ Sign-up successful! Please check your email to confirm your address.");
        // Mark this agent as registered in approved_agents (profile will be created on first login after confirmation)
        const { error: updateError } = await supabase
          .from('approved_agents')
          .update({
            is_registered: true,
            first_name: firstName,
            last_name: lastName,
            email: email
          })
          .eq('agent_id', agentId);
        if (updateError) {
          showAlert("⚠️ Warning: Sign-up succeeded, but failed to update agent status. Please contact support. Error: " + updateError.message);
        }
        // No agent profile inserted here; it will be created upon first login after email confirmation
      }
    } catch (err) {
      showAlert("❌ Unexpected error during sign-up: " + err.message);
    }
  });
}

// Login form handler
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      // Gather and trim input values from the login form
      const email = document.getElementById('login-email')?.value.trim() || document.getElementById('email')?.value.trim();
      const password = document.getElementById('login-password')?.value || document.getElementById('password')?.value;
      if (!email || !password) {
        showAlert("⚠️ Please enter both email and password.");
        return;
      }
      // 4️⃣ Sign in the user with Supabase Auth
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        // If email is not confirmed, Supabase returns an error code "email_not_confirmed" [oai_citation:1†supabase.com](https://supabase.com/docs/guides/auth/debugging/error-codes#:~:text=Email%20address%20already%20exists%20in,the%20system)
        if (signInError.message && signInError.message.toLowerCase().includes('confirm')) {
          showAlert("⚠️ Please verify your email address before logging in.");
        } else {
          showAlert("❌ Login failed: " + signInError.message);
        }
        return;
      }
      // Login successful – the user is authenticated at this point
      const user = signInData.user;
      // 5️⃣ Ensure an agent profile exists for this user (insert into 'agents' if missing)
      const { data: profileRecord, error: profileError } = await supabase
        .from('agents')
        .select('id')
        .eq('id', user.id)
        .single();
      if (profileError) {
        showAlert("⚠️ Error checking agent profile: " + profileError.message);
        // Proceed to dashboard even if profile check fails
        window.location.href = "dashboard.html";
        return;
      }
      if (!profileRecord) {
        // No profile found for this user, create one now
        const { data: approvedRec, error: approvedRecErr } = await supabase
          .from('approved_agents')
          .select('agent_id, first_name, last_name')
          .eq('email', user.email)
          .single();
        if (approvedRecErr || !approvedRec) {
          showAlert("⚠️ No approved agent record found for this account. Please contact support.");
          window.location.href = "dashboard.html";
          return;
        }
        const { error: insertError } = await supabase.from('agents').insert({
          id: user.id,  // FIX: use auth user ID to satisfy RLS policy [oai_citation:1‡makerkit.dev](https://makerkit.dev/docs/remix-supabase/organizations/row-level-security#:~:text=create%20policy%20,to%20authenticated%20users)
          agent_id: approvedRec.agent_id,
          first_name: approvedRec.first_name,
          last_name: approvedRec.last_name,
          email: user.email,
          full_name: `${approvedRec.first_name} ${approvedRec.last_name}`,
          is_active: true,
          is_admin: false  // new agents are not admins by default
        });
        if (insertError) {
          showAlert("❌ Failed to create agent profile: " + insertError.message);
          // (If profile creation fails, user can proceed but certain features may not work)
        } else {
          console.log("✅ Agent profile created for", user.email);
        }
      }
      // 6️⃣ Redirect to dashboard or main page after successful login (and profile check)
      window.location.href = "dashboard.html";
    } catch (err) {
      showAlert("❌ Unexpected error during login: " + err.message);
    }
  });
}

// ✅ Email confirmation landing logic for confirmed.html
const onConfirmedPage = window.location.pathname.includes('confirmed.html');

if (onConfirmedPage) {
  const statusBox = document.getElementById('status');
  if (statusBox) statusBox.textContent = '⏳ Finishing setup...';

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      const user = session.user;
      const email = user.email;

      try {
        // 1. Check if agent profile already exists
        const { data: existing } = await supabase
          .from('agents')
          .select('id')
          .eq('id', user.id)
          .single();

        if (!existing) {
          // 2. Fetch approved agent info
          const { data: approved, error: fetchErr } = await supabase
            .from('approved_agents')
            .select('agent_id, first_name, last_name')
            .eq('email', email)
            .single();

          if (fetchErr || !approved) {
            if (statusBox) statusBox.textContent = '⚠️ Approved agent record not found.';
            return;
          }

          // 3. Insert into agents table
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
            if (statusBox) statusBox.textContent = '❌ Failed to create agent profile.';
            console.error(insertErr);
            return;
          }
        }

        // 4. Update approved_agents to mark registered
        const { error: updateErr } = await supabase
          .from('approved_agents')
          .update({ is_registered: true })
          .eq('email', email);

        if (updateErr) {
          console.warn('Could not update approved_agents:', updateErr);
        }

        // 5. Redirect to login
        if (statusBox) statusBox.textContent = '✅ All set! Redirecting to login...';
        setTimeout(() => {
          window.location.href = 'login.html';
        }, 3000);
      } catch (err) {
        if (statusBox) statusBox.textContent = '❌ Something went wrong.';
        console.error(err);
      }
    }
  });

  // fallback: force reload if session exists but onAuthStateChange missed it
  const { data: session } = await supabase.auth.getSession();
  if (session && session.session) {
    window.location.reload();
  }
}
