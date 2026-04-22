require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: process.env.SUPABASE_JWT_SECRET,
  },
  
  // MQTT config for Week 2
  emqx: {
    apiUrl: process.env.EMQX_API_URL,
    apiKey: process.env.EMQX_API_KEY,
    apiSecret: process.env.EMQX_API_SECRET,
  },
  mqtt: {
    host: process.env.MQTT_HOST || '103.90.225.183',
    port: parseInt(process.env.MQTT_PORT) || 1883,
    platformUser: process.env.MQTT_PLATFORM_USER || 'platform-api',
    platformPassword: process.env.MQTT_PLATFORM_PASSWORD || 'secret-password-4203-yeah',
  },
};
