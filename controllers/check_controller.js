/**
 * Check Controller
 *
 * Handles the synchronous release-readiness check endpoint.
 * All business logic lives in the orchestrator — this controller
 * only validates input, delegates, and formats the HTTP response.
 */

const checkOrchestrator = require('../services/check_orchestrator');
const { sendSuccess, sendError } = require('../utils/api_response');

/**
 * POST /api/check
 *
 * Body:
 *   repoUrl  {string}  required — GitHub repository URL
 *   force    {boolean} optional — bypass the commit-SHA cache (default: false)
 *
 * Response 200:
 *   { success: true, data: { cached, checkId, repoName, headSha, ruleScore,
 *                             verdict, checkerBreakdown, report, createdAt } }
 */
const runCheck = async (req, res, next) => {
  try {
    const userId = req.user.id; // set by authenticateToken middleware
    const repoUrl = req.body.repoUrl?.trim();
    const force = req.body.force === true;

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

module.exports = { runCheck };
