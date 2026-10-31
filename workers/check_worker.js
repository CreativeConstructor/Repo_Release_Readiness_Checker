require('dotenv').config();

/**
 * Check Worker (BullMQ)
 *
 * Dedicated background worker that processes repository release readiness checks.
 * Reuses the exact same analysis orchestrator (checkOrchestrator.runFullCheck)
 * as the synchronous endpoint.
 *
 * Connection rule:
 * BullMQ Workers REQUIRE a dedicated connection with maxRetriesPerRequest: null.
 */

const { Worker } = require('bullmq');
const { CHECK_QUEUE_NAME } = require('../services/queue/check_queue');
const { createWorkerRedisClient } = require('../config/redis');
const checkOrchestrator = require('../services/check_orchestrator');

/**
 * Job processing function.
 *
 * @param {import('bullmq').Job} job
 */
const processCheckJob = async (job) => {
  const { userId, repoUrl, force } = job.data;

  if (process.env.NODE_ENV !== 'test') {
    console.log(
      `[Worker] Starting analysis job ${job.id} for repo: ${repoUrl} (User ID: ${userId})`
    );
  }

  // Invoke the single shared analysis service
  const result = await checkOrchestrator.runFullCheck({
    userId,
    repoUrl,
    force,
  });

  if (process.env.NODE_ENV !== 'test') {
    console.log(
      `[Worker] Completed job ${job.id} - Score: ${result.ruleScore}, Verdict: ${result.verdict}`
    );
  }

  return result;
};

/**
 * Creates and configures a BullMQ worker instance.
 *
 * @param {Object} [options]
 * @param {import('ioredis').Redis} [options.connection] - Injected Redis client
 * @param {number} [options.concurrency] - Concurrency limit (default: 5)
 * @returns {import('bullmq').Worker}
 */
const createCheckWorker = (options = {}) => {
  const connection = options.connection || createWorkerRedisClient();
  const concurrency = options.concurrency || parseInt(process.env.BULLMQ_CONCURRENCY || '5', 10);

  const worker = new Worker(CHECK_QUEUE_NAME, processCheckJob, {
    connection,
    concurrency,
  });

  worker.on('failed', (job, err) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[Worker] Job ${job?.id} failed with error:`, err.message);
    }
  });

  worker.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Worker Error]:', err.message);
    }
  });

  return worker;
};

// Start standalone worker process when executed directly
if (require.main === module) {
  console.log('[Worker Process] Initializing BullMQ Worker...');
  const worker = createCheckWorker();

  const shutdown = async () => {
    console.log('[Worker Process] Gracefully shutting down worker...');
    await worker.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  processCheckJob,
  createCheckWorker,
};
