const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const AppError = require('./utils/app_error');
const errorHandler = require('./middlewares/error_handler');
const { generalLimiter, authLimiter } = require('./middlewares/rate_limiter');

const healthRoutes = require('./routes/health_routes');
const authRoutes = require('./routes/auth_routes');
const checkRoutes = require('./routes/check_routes');

const app = express();

// 1. Security Headers
app.use(helmet());

// 2. Cross-Origin Resource Sharing
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || '*',
    credentials: true,
  })
);

// 3. Request Logging (skip during unit/integration tests to keep test output clean)
if (process.env.NODE_ENV !== 'test') {
  const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
  app.use(morgan(logFormat));
}

// 4. Body Parsing with payload size limit
app.use(express.json({ limit: '1mb' }));

// 5. Health Probes (unmetered by rate limits)
app.use('/health', healthRoutes);

// 6. Rate Limiting Middleware
// Strict brute-force protection on authentication routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/auth', authLimiter, authRoutes); // Backwards compatibility alias

// General rate limiter on all /api endpoints
app.use('/api', generalLimiter);

// Release-readiness check endpoint
app.use('/api/check', checkRoutes);

// Static frontend UI assets (index: false prevents hijacking JSON root requests)
app.use(express.static(path.join(__dirname, 'frontend'), { index: false }));
app.use('/ui', express.static(path.join(__dirname, 'frontend')));

// Baseline root response
app.get('/', (req, res) => {
  const acceptHeader = req.get('Accept') || '';
  const explicitlyAcceptsHtml = acceptHeader
    .split(',')
    .some((mediaType) => mediaType.split(';')[0].trim().toLowerCase() === 'text/html');

  if (explicitlyAcceptsHtml && req.accepts('html') && !req.xhr) {
    return res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
  }
  res.json({
    name: 'Repository Release Readiness Checker API',
    status: 'running',
    health: '/health',
  });
});

// 7. Catch-all 404 Handler
app.use((req, res, next) => {
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404));
});

// 8. Centralized Error Handler (must be registered last)
app.use(errorHandler);

module.exports = app;
