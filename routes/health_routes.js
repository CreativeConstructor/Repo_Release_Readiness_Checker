const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendSuccess, sendError } = require('../utils/api_response');

// Liveness probe: verifies Express event loop is responding
router.get('/', (req, res) => {
  return sendSuccess(res, {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe: verifies PostgreSQL pool can acquire a connection and execute query
router.get('/db', async (req, res) => {
  try {
    const health = await db.healthCheck();
    return sendSuccess(res, {
      status: 'healthy',
      database: 'connected',
      latencyMs: health.latencyMs,
    });
  } catch (error) {
    console.error('[Health] Database readiness check failed:', error.message);
    return sendError(res, 'Database connection failed', 503, { database: 'disconnected' });
  }
});

module.exports = router;
