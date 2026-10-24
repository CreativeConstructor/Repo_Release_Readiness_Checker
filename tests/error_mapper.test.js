const { mapGitHubError } = require('../services/github/error_mapper');
const AppError = require('../utils/app_error');

describe('GitHub Error Mapper (mapGitHubError)', () => {
  test('maps 404 to user-friendly Not Found AppError', () => {
    const error404 = new Error('Not Found');
    error404.status = 404;

    const mapped = mapGitHubError(error404, { owner: 'acme', repo: 'secret-project' });
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.statusCode).toBe(404);
    expect(mapped.message).toContain('"acme/secret-project" not found');
  });

  test('maps 401 to Authentication Failed AppError', () => {
    const error401 = new Error('Bad credentials');
    error401.status = 401;

    const mapped = mapGitHubError(error401);
    expect(mapped.statusCode).toBe(401);
    expect(mapped.message).toContain('GitHub authentication failed');
  });

  test('maps 403 with rate limit exhaustion header to 429 AppError', () => {
    const rateLimitError = new Error('API rate limit exceeded');
    rateLimitError.status = 403;
    rateLimitError.response = {
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1800000000',
      },
    };

    const mapped = mapGitHubError(rateLimitError);
    expect(mapped.statusCode).toBe(429);
    expect(mapped.message).toContain('rate limit exceeded');
  });

  test('maps 403 without rate limit header to 403 Forbidden', () => {
    const forbiddenErr = new Error('Resource not accessible');
    forbiddenErr.status = 403;

    const mapped = mapGitHubError(forbiddenErr, { owner: 'org', repo: 'locked' });
    expect(mapped.statusCode).toBe(403);
    expect(mapped.message).toContain('forbidden');
  });

  test('maps network connection errors (ENOTFOUND, ECONNRESET) to 503', () => {
    const netErr = new Error('getaddrinfo ENOTFOUND api.github.com');
    netErr.code = 'ENOTFOUND';

    const mapped = mapGitHubError(netErr);
    expect(mapped.statusCode).toBe(503);
    expect(mapped.message).toContain('network connection');
  });

  test('maps 5xx server errors to 502 Bad Gateway', () => {
    const error500 = new Error('GitHub Server Outage');
    error500.status = 500;

    const mapped = mapGitHubError(error500);
    expect(mapped.statusCode).toBe(502);
    expect(mapped.message).toContain('service downtime');
  });

  test('returns existing AppError without double wrapping', () => {
    const appErr = new AppError('Custom error', 400);
    const mapped = mapGitHubError(appErr);
    expect(mapped).toBe(appErr);
  });
});
