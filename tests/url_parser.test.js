const { parseGitHubUrl } = require('../services/github/url_parser');
const AppError = require('../utils/app_error');

describe('GitHub URL Parser (parseGitHubUrl)', () => {
  test('parses standard HTTPS GitHub repository URLs', () => {
    const result = parseGitHubUrl('https://github.com/facebook/react');
    expect(result).toEqual({
      owner: 'facebook',
      repo: 'react',
      fullName: 'facebook/react',
      normalizedUrl: 'https://github.com/facebook/react',
    });
  });

  test('strips trailing .git suffix and trailing slashes', () => {
    const result = parseGitHubUrl('https://github.com/expressjs/express.git/');
    expect(result).toEqual({
      owner: 'expressjs',
      repo: 'express',
      fullName: 'expressjs/express',
      normalizedUrl: 'https://github.com/expressjs/express',
    });
  });

  test('handles URLs without protocol scheme or with www prefix', () => {
    const result1 = parseGitHubUrl('github.com/torvalds/linux');
    expect(result1.fullName).toBe('torvalds/linux');

    const result2 = parseGitHubUrl('https://www.github.com/torvalds/linux');
    expect(result2.fullName).toBe('torvalds/linux');
  });

  test('rejects non-GitHub domains with 400 Bad Request', () => {
    expect(() => parseGitHubUrl('https://gitlab.com/owner/repo')).toThrow(AppError);
    expect(() => parseGitHubUrl('https://gitlab.com/owner/repo')).toThrow(
      'Only GitHub repositories (github.com) are supported'
    );

    expect(() => parseGitHubUrl('https://bitbucket.org/owner/repo')).toThrow(AppError);
  });

  test('rejects invalid or incomplete repository URLs', () => {
    expect(() => parseGitHubUrl('')).toThrow('Repository URL must be a non-empty string');
    expect(() => parseGitHubUrl(null)).toThrow('Repository URL must be a non-empty string');
    expect(() => parseGitHubUrl('https://github.com/')).toThrow(/Invalid GitHub repository URL/);
    expect(() => parseGitHubUrl('https://github.com/onlyOwner')).toThrow(
      /Invalid GitHub repository URL/
    );
  });

  test('rejects illegal characters in owner or repository name', () => {
    // Owner with invalid leading hyphen or special characters
    expect(() => parseGitHubUrl('https://github.com/-invalidOwner/repo')).toThrow(
      /Invalid GitHub owner/
    );
    expect(() => parseGitHubUrl('https://github.com/owner$name/repo')).toThrow(
      /Invalid GitHub owner/
    );
  });
});
