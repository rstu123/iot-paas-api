module.exports = {
  apps: [{
    name: 'iot-api',
    script: 'src/index.js',
    cwd: '/opt/iot-paas-api',
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      SUPABASE_URL: 'https://foasfefvuuijmhlrdtko.supabase.co',
      SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYXNmZWZ2dXVpam1obHJkdGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTI2OTAsImV4cCI6MjA4NDg4ODY5MH0.tIpIQKXo9BKKLWFhg2U1MaVaV23oMH_YagxX01qGbU4',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYXNmZWZ2dXVpam1obHJkdGtvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxMjY5MCwiZXhwIjoyMDg0ODg4NjkwfQ.Y9nC_zc3t2xTcRuyxp5liYj2PXugI3zaUn7ChXmS9pU',
    },
  }]
};
