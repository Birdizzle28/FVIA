import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Your Supabase credentials
const supabaseUrl = 'https://ddlbgkolnayqrxslzsxn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
const supabase = createClient(supabaseUrl, supabaseKey)

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const email = document.getElementById('email').value.trim()
  const password = document.getElementById('password').value
  const message = document.getElementById('login-message')

  message.textContent = 'Logging in...'

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    message.textContent = 'Login failed: ' + error.message
    return
  }

  // If login successful
  message.style.color = 'green'
  message.textContent = 'Login successful! Redirecting...'

  // Redirect to dashboard (we'll build this page next)
  setTimeout(() => {
    window.location.href = 'dashboard.html'
  }, 1500)
})
// Toggle password visibility (eye icon)
document.querySelectorAll('.toggle-password').forEach(icon => {
  icon.addEventListener('click', () => {
    const input = document.querySelector(icon.getAttribute('toggle'))
    const type = input.getAttribute('type') === 'password' ? 'text' : 'password'
    input.setAttribute('type', type)
    icon.classList.toggle('fa-eye-slash')
  })
})
