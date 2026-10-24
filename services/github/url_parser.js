const AppError = require('../../utils/app_error');

/**
 * Validates and extracts owner and repository name from a GitHub repository URL.
 * Only github.com URLs are accepted.
 *
 * Accepted examples:
 *  - https://github.com/owner/repo
 *  - http://github.com/owner/repo.git
 *  - https://www.github.com/owner/repo/
 *  - github.com/owner/repo
 *
 * @param {string} rawUrl
 * @returns {{ owner: string, repo: string, fullName: string, normalizedUrl: string }}
 * @throws {AppError} 400 Bad Request if URL is invalid or not github.com
 */
const parseGitHubUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new AppError('Repository URL must be a non-empty string', 400);
  }

  const trimmed = rawUrl.trim();
  let parsedUrl;

  try {
    // Add protocol if missing to allow standard URL parsing
    const urlWithProtocol =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;

    parsedUrl = new URL(urlWithProtocol);
  } catch {
    throw new AppError('Invalid URL format provided', 400);
  }

  // Validate hostname strictly matches github.com (or www.github.com)
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== 'github.com' && hostname !== 'www.github.com') {
    throw new AppError('Only GitHub repositories (github.com) are supported', 400);
  }

  // Split path segments, filtering out empty slashes
  const segments = parsedUrl.pathname
    .split('/')
    .map((seg) => seg.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    throw new AppError(
      'Invalid GitHub repository URL. Must be in format https://github.com/owner/repo',
      400
    );
  }

  const owner = segments[0];
  let repo = segments[1];

  // Strip trailing .git suffix if present
  if (repo.toLowerCase().endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  // Validate GitHub owner format (alphanumeric and single hyphens, 1-39 chars)
  const ownerRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
  if (!ownerRegex.test(owner)) {
    throw new AppError(`Invalid GitHub owner/organization name: "${owner}"`, 400);
  }

  // Validate GitHub repository name format (1-100 chars, alphanumeric, ., _, -)
  const repoRegex = /^[a-zA-Z0-9_.-]{1,100}$/;
  if (!repoRegex.test(repo)) {
    throw new AppError(`Invalid GitHub repository name: "${repo}"`, 400);
  }

  const fullName = `${owner}/${repo}`;
  const normalizedUrl = `https://github.com/${fullName}`;

  return {
    owner,
    repo,
    fullName,
    normalizedUrl,
  };
};

module.exports = {
  parseGitHubUrl,
};
