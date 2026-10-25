/**
 * Check Controller
 *
 * Handles release-readiness HTTP check endpoints:
 *   - runCheck:      synchronous repository check (POST /api/check)
 *   - runCheckAsync: asynchronous check enqueuing via BullMQ (POST /api/check/async)
 *   - getJob:        check job status & result by jobId (GET /api/check/jobs/:jobId)
 *   - getHistory:    user's paginated check history with filters (GET /api/check/history)
 *   - getCheck:      detailed single report by ID with ownership enforcement (GET /api/check/:id)
 */

const checkOrchestrator = require('../services/check_orchestrator');
const checkStore = require('../services/check_store');
const checkQueue = require('../services/queue/check_queue');
const AppError = require('../utils/app_error');
const { sendSuccess, sendError } = require('../utils/api_response');

/**
 * POST /api/check
 * Synchronous repository check.
 */
const runCheck = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const repoUrl = req.body.repoUrl?.trim();
    const force = req.body.force === true || req.query.force === 'true';

    if (!repoUrl) {
      return sendError(res, 'repoUrl is required', 400);
    }

    const result = await checkOrchestrator.runFullCheck({ userId, repoUrl, force });

    return sendSuccess(
      res,
      result,
      200,
      result.cached ? 'Cached result returned' : 'Analysis complete'
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/check/async
 * Asynchronous repository check enqueued via BullMQ.
 * Returns 202 Accepted with jobId.
 */
const runCheckAsync = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const repoUrl = req.body.repoUrl?.trim();
    const force = req.body.force === true || req.query.force === 'true';

    if (!repoUrl) {
      return sendError(res, 'repoUrl is required', 400);
    }

    const jobId = await checkQueue.enqueueCheckJob({ userId, repoUrl, force });

    return sendSuccess(
      res,
      {
        jobId,
        statusUrl: `/api/check/jobs/${jobId}`,
      },
      202,
      'Check job enqueued successfully'
    );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/check/jobs/:jobId
 * Retrieves job status with ownership enforcement.
 */
const getJob = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.params;

    const status = await checkQueue.getJobStatus({ jobId, userId });

    return sendSuccess(res, status, 200, 'Job status retrieved');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/check/history
 * Query parameters: page, limit, verdict, repo
 */
const getHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page, limit, verdict, repo } = req.query;

    const data = await checkStore.getChecksHistory({
      userId,
      page,
      limit,
      verdict,
      repo,
    });

    return sendSuccess(res, data, 200, 'Check history retrieved');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/check/:id
 * Path parameter: id (check ID)
 */
const getCheck = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const checkId = parseInt(req.params.id, 10);

    if (isNaN(checkId) || checkId <= 0) {
      return next(new AppError('Invalid check ID', 400));
    }

    const check = await checkStore.getCheckById({ checkId, userId });

    if (!check) {
      return next(new AppError('Check report not found', 404));
    }

    return sendSuccess(res, check, 200, 'Check report retrieved');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  runCheck,
  runCheckAsync,
  getJob,
  getHistory,
  getCheck,
};
