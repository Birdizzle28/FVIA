// scripts/auth.js
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_KEY = 'YOUR_ANON_KEY';

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const redirectIfNotLoggedIn = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) window.location.href = '/login.html';
};

const logout = async () => {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
};
