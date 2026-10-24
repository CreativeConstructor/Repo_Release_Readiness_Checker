/**
 * Determines whether an error is transient and eligible for retry.
 * Retries:
 *  - Network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, ECONNREFUSED)
 *  - HTTP 429 (Rate Limited / Too Many Requests)
 *  - HTTP 5xx (500, 502, 503, 504)
 * Strict rule: NEVER retry other 4xx errors (400, 401, 403, 404, 422).
 *
 * @param {Error} error
 * @returns {boolean}
 */
const isTransientError = (error) => {
  if (!error) return false;

  // Check network error codes
  const networkCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'];
  if (error.code && networkCodes.includes(error.code)) {
    return true;
  }

  // Check HTTP status codes (Octokit errors store status in `error.status`)
  const status = error.status || error.statusCode || (error.response && error.response.status);
  if (status) {
    if (status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false; // Any other 4xx is NOT retryable
  }

  // Fallback: check message for socket or timeout hints
  const message = (error.message || '').toLowerCase();
  if (
    message.includes('timeout') ||
    message.includes('socket hang up') ||
    message.includes('network error')
  ) {
    return true;
  }

  return false;
};

/**
 * Calculates exponential backoff delay with full jitter:
 * delay = min(maxDelayMs, baseDelayMs * (factor ^ attempt) + random(0, jitterMs))
 */
const calculateDelay = (attempt, baseDelayMs, factor, maxDelayMs, jitterMs) => {
  const exponential = baseDelayMs * Math.pow(factor, attempt);
  const jitter = Math.random() * jitterMs;
  return Math.min(maxDelayMs, Math.round(exponential + jitter));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes an asynchronous function with bounded retries, exponential backoff, and jitter.
 *
 * @param {Function} fn - Async operation to execute: `async (attempt) => result`
 * @param {Object} options
 * @param {number} [options.retries=3] - Maximum retry attempts
 * @param {number} [options.baseDelayMs=200] - Initial delay in milliseconds
 * @param {number} [options.maxDelayMs=5000] - Maximum delay ceiling
 * @param {number} [options.factor=2] - Exponential growth factor
 * @param {number} [options.jitterMs=100] - Maximum random jitter added
 * @param {Function} [options.shouldRetry=isTransientError] - Predicate to decide if error is retryable
 * @param {Function} [options.onRetry] - Callback invoked before each retry: `(err, attempt, delay) => {}`
 * @returns {Promise<*>}
 */
const withRetry = async (fn, options = {}) => {
  const {
    retries = 3,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    factor = 2,
    jitterMs = 100,
    shouldRetry = isTransientError,
    onRetry,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // If we exhausted retries or the error is not transient, throw immediately
      if (attempt === retries || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = calculateDelay(attempt, baseDelayMs, factor, maxDelayMs, jitterMs);

      if (typeof onRetry === 'function') {
        try {
          onRetry(error, attempt + 1, delayMs);
        } catch {
          // Prevent onRetry callback errors from swallowing the primary error
        }
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
};

module.exports = {
  withRetry,
  isTransientError,
  calculateDelay,
};
