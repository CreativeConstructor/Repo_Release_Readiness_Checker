require('dotenv').config();
const app = require('./app');
const db = require('./db');

const port = process.env.PORT || 3000;

const server = app.listen(port, () => {
  console.log(`[Server] Release Readiness Checker listening on port ${port}`);
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    console.log('[Server] HTTP server closed.');
    try {
      await db.pool.end();
      console.log('[PostgreSQL] Database pool drained.');
      process.exit(0);
    } catch (err) {
      console.error('[PostgreSQL] Error during pool drain:', err);
      process.exit(1);
    }
  });

  // Force shutdown if cleanup takes longer than 10 seconds
  setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
