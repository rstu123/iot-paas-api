const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('../config');

// Import routes
const projectsRouter = require('./routes/projects');
const devicesRouter = require('./routes/devices');
const provisionRouter = require('./routes/provision');

// Create Express app
const app = express();

// ===================
// Middleware
// ===================

// Security headers
app.use(helmet());

// CORS - configure for your frontend domain in production
app.use(cors({
  origin: config.nodeEnv === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://localhost:5173'],
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
║  • POST /api/provision                            ║
╚═══════════════════════════════════════════════════╝
  `);
});

module.exports = app;
