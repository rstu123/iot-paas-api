const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('../config');

// Import routes
const projectsRouter = require('./routes/projects');
const devicesRouter = require('./routes/devices');
const provisionRouter = require('./routes/provision');
const mqttRouter = require('./routes/mqtt');
const firmwareRouter = require('./routes/firmware');
const mqttService = require('./services/mqtt');
const batchRouter = require('./routes/batch');
const subscriptionRouter = require('./routes/subscription');
const adminRouter = require('./routes/admin');

// Create Express app
const app = express();

// ===================
// Middleware
// ===================

// Security headers
app.use(helmet());

// CORS - configure for your frontend domain in production
app.use(cors({
  origin: [
    'https://iot-paas-dashboard.vercel.app',
    'https://iot-paas.io.vn',
    'https://www.iot-paas.io.vn',
    'http://localhost:3000',
    'http://localhost:5173',
    'null',
  ],
  credentials: true,
}));
// Request logging
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// Parse JSON bodies
app.use(express.json());

// ===================
// Routes
// ===================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// API routes
app.use('/api/projects', projectsRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/provision', provisionRouter);
app.use('/api/mqtt', mqttRouter);
app.use('/api/devices', firmwareRouter);
app.use('/api/batch', batchRouter);
app.use('/api/subscription', subscriptionRouter);
app.use('/api/admin', adminRouter);

// ===================
// Error Handling
// ===================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: config.nodeEnv === 'production' 
      ? 'An unexpected error occurred' 
      : err.message,
  });
});

// ===================
// Start Server
// ===================

const PORT = config.port;

mqttService.connect();

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║           IoT PaaS Platform API                   ║
╠═══════════════════════════════════════════════════╣
║  Status:      Running                             ║
║  Port:        ${PORT}                                ║
║  Environment: ${config.nodeEnv.padEnd(11)}                        ║
╠═══════════════════════════════════════════════════╣
║  Endpoints:                                       ║
║  • GET  /health                                   ║
║  • GET  /api/projects                             ║
║  • POST /api/projects                             ║
║  • GET  /api/devices                              ║
║  • POST /api/devices                              ║
║  • POST /api/provision
║  • POST /api/devices/:id/firmware             ║
║  • GET  /api/devices/:id/firmware             ║                            ║
╚═══════════════════════════════════════════════════╝
  `);
});

module.exports = app;
