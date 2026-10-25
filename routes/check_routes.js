/**
 * Check Routes
 *
 * All routes under /api/check require authentication.
 * Validation is applied before the controller runs.
 */

const { Router } = require('express');
const { body } = require('express-validator');

const authenticateToken = require('../middlewares/token_check');
const validate = require('../middlewares/validate');
const { runCheck } = require('../controllers/check_controller');

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
];

/**
 * POST /api/check
 * Run a synchronous release-readiness analysis.
 */
router.post('/', validate(checkValidation), runCheck);

module.exports = router;
