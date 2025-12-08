// scripts/auth.js
const redirectIfNotLoggedIn = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) window.location.href = '/login.html';
};

const logout = async () => {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
};
