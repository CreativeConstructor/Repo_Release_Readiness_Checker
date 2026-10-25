/**
 * Check Routes
 *
 * All routes under /api/check require authentication.
 *
 * Routes:
 *   POST /api/check            - Run synchronous repository readiness check
 *   POST /api/check/async      - Enqueue asynchronous check job via BullMQ
 *   GET  /api/check/jobs/:jobId - Poll status of an enqueued check job
 *   GET  /api/check/history    - Paginated check history with filters
 *   GET  /api/check/:id        - Get full check report by ID with ownership enforcement
 */

const { Router } = require('express');
const { body, query, param } = require('express-validator');

const authenticateToken = require('../middlewares/token_check');
const validate = require('../middlewares/validate');
const {
  runCheck,
  runCheckAsync,
  getJob,
  getHistory,
  getCheck,
} = require('../controllers/check_controller');

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

const getJobValidation = [param('jobId').trim().notEmpty().withMessage('jobId is required')];

const getCheckValidation = [
  param('id').isInt({ min: 1 }).withMessage('id parameter must be a positive integer').toInt(),
];

/**
 * POST /api/check
 * Run a synchronous release-readiness analysis.
 */
router.post('/', validate(checkValidation), runCheck);

/**
 * POST /api/check/async
 * Enqueue an asynchronous release-readiness analysis job.
 */
router.post('/async', validate(checkValidation), runCheckAsync);

/**
 * GET /api/check/jobs/:jobId
 * Poll the status of an enqueued background job.
 */
router.get('/jobs/:jobId', validate(getJobValidation), getJob);

/**
 * GET /api/check/history
 * Retrieve user's paginated check history with optional filters.
 */
router.get('/history', validate(historyValidation), getHistory);

/**
 * GET /api/check/:id
 * Retrieve detailed check report with ownership check.
 */
router.get('/:id', validate(getCheckValidation), getCheck);

module.exports = router;
