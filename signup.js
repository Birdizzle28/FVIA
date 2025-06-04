import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://ddlbgkolnayqrxslzsxn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
const supabase = createClient(supabaseUrl, supabaseKey)

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const firstName = document.getElementById('first-name').value.trim()
  const lastName = document.getElementById('last-name').value.trim()
  const agentId = document.getElementById('agent-id').value.trim()
  const email = document.getElementById('email').value.trim()
  const password = document.getElementById('password').value
  const confirmPassword = document.getElementById('confirm-password').value
  const message = document.getElementById('message')

  message.style.color = 'red'

  const passwordPattern = /^(?=.*[A-Z])(?=.*\d).{6,}$/
  if (!passwordPattern.test(password)) {
    message.textContent = 'Password must have at least 1 capital letter, 1 number, and be 6+ characters.'
    return
  }

  if (password !== confirmPassword) {
    message.textContent = 'Passwords do not match.'
    return
  }

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

  const { data: signupData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: 'https://fv-ia.com/confirmed.html'
    }
  })

  if (signUpError) {
    message.textContent = 'Error signing up: ' + signUpError.message
    return
  }

  const { error: updateError } = await supabase
    .from('approved_agents')
    .update({
      is_registered: true,
      email,
      first_name: firstName,
      last_name: lastName
    })
    .eq('agent_id', agentId)

  if (updateError) {
    message.textContent = 'Signup complete, but failed to store name. Contact admin.'
    return
  }

  const { data: userSession } = await supabase.auth.getSession();

  const agentProfile = {
    id: userSession.session.user.id,
    email,
    agent_id: agentId,
    full_name: `${firstName} ${lastName}`,
    is_active: true,
    is_admin: false
  };

  const { error: insertAgentError } = await supabase.from('agents').insert(agentProfile);

  if (insertAgentError) {
    message.textContent = 'Signup complete, but failed to save agent profile. Contact admin.';
    return;
  }

  message.style.color = 'green';
  message.textContent = 'Sign-up successful! Please check your email to confirm.';
}); // ✅ THIS closes the signup form event listener — key fix

// ✅ TOGGLE PASSWORD VISIBILITY — this was misplaced before
document.querySelectorAll('.toggle-password').forEach(icon => {
  icon.addEventListener('click', () => {
    const input = document.querySelector(icon.getAttribute('toggle'))
    const type = input.getAttribute('type') === 'password' ? 'text' : 'password'
    input.setAttribute('type', type)
    icon.classList.toggle('fa-eye-slash')
  })
})
