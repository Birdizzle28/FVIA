// scripts/auth.js
const SUPABASE_URL = 'https://ddlbgkolnayqrxslzsxn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho';

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const redirectIfNotLoggedIn = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) window.location.href = '/login.html';
};

const logout = async () => {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
};
