// scripts/supabase-client.js

const SUPABASE_URL = 'https://ddlbgkolnayqrxslzsxn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho';
window.VAPID_PUBLIC_KEY = "BD2IGcWhq7PWFauNfIAkQdh44nwKycEs2RMlHjk-ypuWsW4jdmoPy7_sDyHuYkMqKCMg1D0wZpc8QjRWKXfOCW0";

if (!window.supabase) {
  console.error('Supabase UMD bundle not loaded before supabase-client.js');
} else {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  window.supabase = window.supabaseClient;
}
