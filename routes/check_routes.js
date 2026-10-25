/**
 * Check Routes
 *
 * All routes under /api/check require authentication.
 * Routes:
 *   POST /api/check         - Run synchronous repository readiness check
 *   GET  /api/check/history - Paginated history with optional verdict/repo filters
 *   GET  /api/check/:id     - Get full check report by ID with ownership enforcement
 */

const { Router } = require('express');
const { body, query, param } = require('express-validator');

const authenticateToken = require('../middlewares/token_check');
const validate = require('../middlewares/validate');
const { runCheck, getHistory, getCheck } = require('../controllers/check_controller');

const router = Router();

// All check endpoints require a valid JWT
router.use(authenticateToken);

const checkValidation = [
  body('repoUrl')
    .trim()
    .notEmpty()
    .withMessage('repoUrl is required')
    .isURL({ protocols: ['https'], require_protocol: true })
    .withMessage('repoUrl must be a valid HTTPS URL'),
  body('force').optional().isBoolean().withMessage('force must be a boolean'),
  query('force').optional().isBoolean().withMessage('force query param must be a boolean'),
];

const historyValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('limit must be an integer between 1 and 50')
    .toInt(),
  query('verdict')
    .optional()
    .isIn(['ready', 'needs_work', 'not_ready'])
    .withMessage('verdict must be one of: ready, needs_work, not_ready'),
  query('repo').optional().trim(),
];

const getCheckValidation = [
  param('id').isInt({ min: 1 }).withMessage('id parameter must be a positive integer').toInt(),
];

/**
 * POST /api/check
 * Run a synchronous release-readiness analysis.
 */
router.post('/', validate(checkValidation), runCheck);

/**
 * GET /api/check/history
 * Retrieve user's paginated check history with optional filters.
 * Note: Must be declared before /:id to prevent route shadowing.
 */
router.get('/history', validate(historyValidation), getHistory);

/**
 * GET /api/check/:id
 * Retrieve detailed check report with ownership check.
 */
router.get('/:id', validate(getCheckValidation), getCheck);

module.exports = router;
