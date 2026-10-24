const AppError = require('../../utils/app_error');

/**
 * Maps Octokit and GitHub API errors to structured AppError instances.
 *
 * @param {Error} error
 * @param {Object} context - Optional context like { owner, repo }
 * @returns {AppError}
 */
const mapGitHubError = (error, context = {}) => {
  // If already an operational AppError, return as-is
  if (error instanceof AppError) {
    return error;
  }

  const repoContext =
    context.owner && context.repo ? ` for "${context.owner}/${context.repo}"` : '';
  const status = error.status || error.statusCode || (error.response && error.response.status);

  // Network connection errors
  if (
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNREFUSED'
  ) {
    return new AppError('Unable to connect to GitHub. Please check your network connection.', 503);
  }

  if (status === 404) {
    return new AppError(
      `GitHub repository${repoContext} not found. Ensure the repository exists and is public.`,
      404
    );
  }

  if (status === 401) {
    return new AppError('GitHub authentication failed. Please verify the GITHUB_TOKEN.', 401);
  }

  if (status === 403) {
    // Check if rate limited
    const rateLimitRemaining =
      error.response && error.response.headers && error.response.headers['x-ratelimit-remaining'];

    if (rateLimitRemaining === '0') {
      const resetTime = error.response.headers['x-ratelimit-reset']
        ? new Date(parseInt(error.response.headers['x-ratelimit-reset'], 10) * 1000).toISOString()
        : 'shortly';
      return new AppError(
        `GitHub API rate limit exceeded. Limit resets at ${resetTime}. Configure a GITHUB_TOKEN to increase limits.`,
        429
      );
    }

    return new AppError(`Access to GitHub repository${repoContext} is forbidden.`, 403);
  }

  if (status === 429) {
    return new AppError('GitHub API rate limit exceeded. Please try again later.', 429);
  }

  if (status >= 500 && status <= 599) {
    return new AppError(
      'GitHub is currently experiencing service downtime. Please try again later.',
      502
    );
  }

  return new AppError(
    error.message || 'An error occurred while communicating with GitHub',
    status || 500
  );
};

module.exports = {
  mapGitHubError,
};
