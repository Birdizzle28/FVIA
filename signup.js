import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://ddlbgkolnayqrxslzsxn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho' // Replace if needed
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

  // Validate password
  const passwordPattern = /^(?=.*[A-Z])(?=.*\d).{6,}$/
  if (!passwordPattern.test(password)) {
    message.textContent = 'Password must have at least 1 capital letter, 1 number, and be 6+ characters.'
    return
  }

  if (password !== confirmPassword) {
    message.textContent = 'Passwords do not match.'
    return
  }

  // Check if agent ID is valid and not used
  const { data: approvedAgent, error: approvalError } = await supabase
    .from('approved_agents')
    .select('*')
    .eq('agent_id', agentId)
    .eq('is_registered', false)
    .single()

  if (approvalError || !approvedAgent) {
    message.textContent = 'Invalid agent ID or this agent is already registered.'
    return
  }

  // Sign up user
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
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

  // Update approved_agents record
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
    message.textContent = 'Signup complete, but failed to store agent name. Contact admin.'
    return
  }

  // Get session
  const userId = signUpData?.user?.id

  if (!userId) {
    message.textContent = 'Signup complete, but user ID not available yet. Please check your email to confirm.';
    return
  }

  // Insert into agents
  const profile = {
    id: userId,
    agent_id: agentId,
    email,
    full_name: `${firstName} ${lastName}`,
    is_active: true,
    is_admin: false
  }

  const { error: profileError } = await supabase.from('agents').insert(profile)

  if (profileError) {
    message.textContent = 'Signup complete, but failed to save agent profile. Contact admin.'
    return
  }

  message.style.color = 'green'
  message.textContent = 'Sign-up successful! Please check your email to confirm.'
})
