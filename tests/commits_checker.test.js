const { getSubjectLine, isGenericMessage, run } = require('../checkers/commits_checker');

// ─── Helper unit tests ────────────────────────────────────────────────────────

describe('Commits Checker – helpers', () => {
  describe('getSubjectLine', () => {
    test('returns only the first line of a multi-line commit message', () => {
      expect(getSubjectLine('feat: add auth\n\nDetailed body here')).toBe('feat: add auth');
      expect(getSubjectLine('fix: patch')).toBe('fix: patch');
      expect(getSubjectLine('')).toBe('');
    });
  });

  describe('isGenericMessage', () => {
    test('identifies known generic patterns', () => {
      expect(isGenericMessage('fix')).toBe(true);
      expect(isGenericMessage('WIP')).toBe(true);
      expect(isGenericMessage('update')).toBe(true);
      expect(isGenericMessage('minor fix')).toBe(true);
      expect(isGenericMessage('temp')).toBe(true);
      expect(isGenericMessage('changes made')).toBe(true);
    });

    test('does NOT flag meaningful, descriptive messages', () => {
      expect(isGenericMessage('feat(auth): implement JWT refresh tokens')).toBe(false);
      expect(isGenericMessage('fix(db): resolve pool connection timeout under load')).toBe(false);
      expect(isGenericMessage('chore: upgrade bcrypt to v6.0.0')).toBe(false);
    });
  });
});

// ─── Checker integration tests ────────────────────────────────────────────────

const makeCommit = (message, daysAgo = 1) => {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    sha: 'abc123',
    message,
    author: { name: 'Dev', email: 'dev@example.com', date },
    url: 'https://github.com',
  };
};

describe('Commits Checker – run()', () => {
  test('returns high score when commits are recent, descriptive, and issue-referenced', () => {
    const snapshot = {
      commits: [
        makeCommit('feat(auth): implement JWT refresh token rotation (#12)', 1),
        makeCommit('fix(db): resolve pool timeout on high load (#13)', 2),
        makeCommit('chore: upgrade dependencies and fix security advisories (#14)', 3),
        makeCommit('test: add integration tests for /api/check endpoint (#15)', 4),
      ],
    };

    const result = run(snapshot);
    expect(result.checkerId).toBe('commits');
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);

    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain('COMMITS_REPOSITORY_ACTIVE');
    expect(ids).toContain('COMMITS_DESCRIPTIVE_MESSAGES');
    expect(ids).toContain('COMMITS_ISSUE_REFERENCES');
  });

  test('flags COMMITS_REPOSITORY_STALE when most recent commit is >30 days old', () => {
    const snapshot = {
      commits: [makeCommit('feat: initial setup', 45)],
    };

    const result = run(snapshot);
    expect(result.passed).toBe(false);

    const risk = result.findings.find((f) => f.id === 'COMMITS_REPOSITORY_STALE');
    expect(risk).toBeDefined();
    expect(risk.type).toBe('risk');
    expect(risk.evidence).toContain('feat: initial setup');
  });

  test('flags COMMITS_GENERIC_MESSAGES risk when >=40% of commits are generic', () => {
    const snapshot = {
      commits: [
        makeCommit('fix', 1),
        makeCommit('update', 2),
        makeCommit('wip', 3),
        makeCommit('feat: add proper implementation', 4),
        makeCommit('test: add coverage', 5),
      ],
    };

    const result = run(snapshot);
    const risk = result.findings.find((f) => f.id === 'COMMITS_GENERIC_MESSAGES');
    expect(risk).toBeDefined();
    expect(risk.type).toBe('risk');
    expect(risk.evidence).toContain('"fix"');
  });

  test('flags WARNING (not RISK) when some but <40% messages are generic', () => {
    const snapshot = {
      commits: [
        makeCommit('fix', 1),
        makeCommit('feat: proper descriptive commit message here', 2),
        makeCommit('chore: update lockfile after dependency audit', 3),
        makeCommit('docs: revise architecture section of README', 4),
        makeCommit('test: cover edge cases in retry utility', 5),
      ],
    };

    const result = run(snapshot);
    const warning = result.findings.find((f) => f.id === 'COMMITS_SOME_GENERIC_MESSAGES');
    const risk = result.findings.find((f) => f.id === 'COMMITS_GENERIC_MESSAGES');
    expect(warning).toBeDefined();
    expect(warning.type).toBe('warning');
    expect(risk).toBeUndefined();
  });

  test('flags very short commit messages (< 10 characters)', () => {
    const snapshot = {
      commits: [
        makeCommit('abc', 1), // 3 chars, too short
        makeCommit('feat: add a proper descriptive message to avoid detection', 2),
      ],
    };

    const result = run(snapshot);
    const warning = result.findings.find((f) => f.id === 'COMMITS_TOO_SHORT');
    expect(warning).toBeDefined();
    expect(warning.type).toBe('warning');
    expect(warning.evidence).toContain('"abc"');
  });

  test('returns 50 score and warning when no commit history is available', () => {
    const snapshot = { commits: [] };
    const result = run(snapshot);
    expect(result.score).toBe(50);
    const warning = result.findings.find((f) => f.id === 'COMMITS_NO_HISTORY');
    expect(warning).toBeDefined();
  });
});
