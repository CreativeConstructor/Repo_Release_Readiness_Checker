/**
 * Check Controller
 *
 * Handles release-readiness HTTP check endpoints:
 *   - runCheck:   synchronous repository check (POST /api/check)
 *   - getHistory: user's paginated check history with filters (GET /api/check/history)
 *   - getCheck:   detailed single report by ID with ownership enforcement (GET /api/check/:id)
 */

const checkOrchestrator = require('../services/check_orchestrator');
const checkStore = require('../services/check_store');
const AppError = require('../utils/app_error');
const { sendSuccess, sendError } = require('../utils/api_response');

/**
 * POST /api/check
 *
 * Body:
 *   repoUrl  {string}  required — GitHub repository URL
 *   force    {boolean} optional — bypass the commit-SHA cache (default: false)
 * Query:
 *   force    {string}  optional — ?force=true
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
 * GET /api/check/history
 *
 * Query parameters:
 *   page     {number} optional — 1-based page number (default: 1)
 *   limit    {number} optional — items per page (default: 10, max: 50)
 *   verdict  {string} optional — 'ready', 'needs_work', 'not_ready'
 *   repo     {string} optional — substring match for repository name or URL
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
 *
 * Path parameter:
 *   id {number} required — Check ID
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
  getHistory,
  getCheck,
};
