const { createClient } = require('@supabase/supabase-js');
const config = require('../../config');

// Admin client - bypasses RLS, use for provisioning and admin tasks
const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Create a client that uses the user's JWT for RLS
// Call this with the token from the Authorization header
function createUserClient(accessToken) {
  return createClient(
    config.supabase.url,
    config.supabase.anonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

module.exports = {
  supabaseAdmin,
  createUserClient,
};
