require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  
  // MQTT config for Week 2
  emqx: {
    apiUrl: process.env.EMQX_API_URL,
    apiKey: process.env.EMQX_API_KEY,
    apiSecret: process.env.EMQX_API_SECRET,
  },
};
