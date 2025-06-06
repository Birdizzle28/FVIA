
// Import Supabase client library and initialize the client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient('https://ddlbgkolnayqrxslzsxn.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');

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
      if (agentCheckError || !approvedAgent) {
        // If no matching record or already registered, show error
        showAlert("⚠️ Invalid agent ID or this agent is already registered.");
        return;
      }
      // 2️⃣ Register the user with Supabase Auth (triggers confirmation email if enabled)
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email,
        password: password
      });
      if (signUpError) {
        // Sign-up failed (e.g., email already in use)
        showAlert("❌ Sign-up failed: " + signUpError.message);
        return;
      }
      // If confirm email is enabled, supabase returns a user (no session) and sends a confirmation email [oai_citation:0‡supabase.com](https://supabase.com/docs/reference/javascript/auth-signup#:~:text=,redirect%20URLs%20in%20your%20project)
      alert("✅ Sign-up successful! Please check your email to confirm your address.");
      // 3️⃣ Mark this agent as registered in approved_agents and store their info
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
        // If this update fails, notify the user (the user account is created, but agent status not updated)
        showAlert("⚠️ Warning: Sign-up succeeded, but failed to update agent status. Please contact support. Error: " + updateError.message);
      }
      // Note: No profile is created in the agents table here. That will happen on first login after email confirmation.
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
        // If email is not confirmed, Supabase returns an error code "email_not_confirmed" [oai_citation:1‡supabase.com](https://supabase.com/docs/guides/auth/debugging/error-codes#:~:text=Email%20address%20already%20exists%20in,the%20system)
        if (signInError.message && signInError.message.toLowerCase().includes('confirm')) {
          showAlert("⚠️ Please verify your email address before logging in.");
        } else {
          showAlert("❌ Login failed: " + signInError.message);
        }
        return;
      }
      // Login successful – the user is authenticated at this point
      const user = signInData.user;
      // 5️⃣ On first login, check if an agent profile exists in 'agents' table for this user
      const { data: profileRecords, error: profileError } = await supabase
        .from('agents')
        .select('id')  // select by agent code will suffice, no need to retrieve all columns
        .eq('agent_id', approvedAgentIdForEmail(user.email));
        // Note: We'll define a helper to get approved agent ID for the email
      async function approvedAgentIdForEmail(userEmail) {
        const { data: approvedRec, error: approvedRecError } = await supabase
          .from('approved_agents')
          .select('agent_id, first_name, last_name')
          .eq('email', userEmail)
          .single();
        if (approvedRecError || !approvedRec) {
          return null;  // If not found, returns null (should not happen if sign-up flow was correct)
        }
        // Store the fetched approved agent record for later use (to avoid double fetch)
        loginForm._approvedAgentRec = approvedRec;
        return approvedRec.agent_id;
      }
      const agentIdForUser = await approvedAgentIdForEmail(user.email);
      if (profileError) {
        showAlert("⚠️ Error checking agent profile: " + profileError.message);
        // Even if there's an error reading the profile, proceed to dashboard to avoid blocking user login
        window.location.href = "dashboard.html";
        return;
      }
      if (!agentIdForUser) {
        // No approved agent record found for this email (unexpected if flow is correct)
        showAlert("⚠️ No approved agent record found for this account. Please contact support.");
        // Proceed to dashboard anyway
        window.location.href = "dashboard.html";
        return;
      }
      // If no profile exists yet for this agent (first login), insert a new profile
      if (!profileRecords || profileRecords.length === 0) {
        const approvedRec = loginForm._approvedAgentRec;  // retrieve the record we got earlier
        const { error: insertError } = await supabase.from('agents').insert({
          // Do not provide an 'id' here; it will auto-generate in the database
          agent_id: approvedRec.agent_id,
          first_name: approvedRec.first_name,
          last_name: approvedRec.last_name,
          email: user.email,
          full_name: `${approvedRec.first_name} ${approvedRec.last_name}`,
          is_active: true  // New agent profiles are active by default
        });
        if (insertError) {
          showAlert("❌ Failed to create agent profile: " + insertError.message);
          // (If profile creation fails, the user can still proceed, but some features might not work. Encourage contacting support.)
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
