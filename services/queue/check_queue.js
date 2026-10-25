/**
 * Check Queue (BullMQ)
 *
 * Manages job enqueuing and status lookups for asynchronous repository analysis.
 * Uses one BullMQ job per repository analysis, delegating to the shared orchestrator.
 */

const { Queue } = require('bullmq');
const { getSharedRedisClient } = require('../../config/redis');
const AppError = require('../../utils/app_error');

const CHECK_QUEUE_NAME = 'repo-readiness-checks';

let checkQueue = null;

/**
 * Returns the singleton Queue instance.
 */
const getCheckQueue = () => {
  if (!checkQueue) {
    const connection = getSharedRedisClient();
    checkQueue = new Queue(CHECK_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000, // 1s, 2s, 4s
        },
        removeOnComplete: { count: 500, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
      },
    });
  }
  return checkQueue;
};

/**
 * Enqueues a repository release readiness analysis job.
 *
 * @param {Object} params
 * @param {number} params.userId - Authenticated user ID (stored in job data for ownership verification)
 * @param {string} params.repoUrl - Validated GitHub repository URL
 * @param {boolean} [params.force=false] - Whether to bypass commit-SHA cache
 * @returns {Promise<string>} Job ID
 */
const enqueueCheckJob = async ({ userId, repoUrl, force = false }) => {
  const queue = module.exports.getCheckQueue();
  const job = await queue.add('analyze-repo', {
    userId,
    repoUrl,
    force: Boolean(force),
    enqueuedAt: new Date().toISOString(),
  });

  return job.id;
};

/**
 * Retrieves the status and result of a check job with an enforced ownership check.
 *
 * @param {Object} params
 * @param {string} params.jobId
 * @param {number} params.userId
 * @returns {Promise<Object>} Job state and details
 */
const getJobStatus = async ({ jobId, userId }) => {
  const queue = module.exports.getCheckQueue();
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new AppError('Job not found', 404);
  }

  // Security: Enforce ownership check using stored job data
  if (job.data?.userId !== userId) {
    throw new AppError('Job not found', 404);
  }

  const state = await job.getState();

  return {
    jobId: job.id,
    status: state, // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
    progress: job.progress || 0,
    result: job.returnvalue || null,
    failedReason: job.failedReason || null,
    enqueuedAt: job.data.enqueuedAt || new Date(job.timestamp).toISOString(),
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
  };
};

/**
 * Closes the queue connection.
 */
const closeCheckQueue = async () => {
  if (checkQueue) {
    await checkQueue.close();
    checkQueue = null;
  }
};

module.exports = {
  CHECK_QUEUE_NAME,
  getCheckQueue,
  enqueueCheckJob,
  getJobStatus,
  closeCheckQueue,
};
