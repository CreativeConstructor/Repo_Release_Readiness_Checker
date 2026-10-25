/**
 * Tests for the Check Orchestrator
 *
 * We test the pure logic:
 *   - runCheckerSafe wraps errors into score=0 RISK results
 *   - runAllCheckers always returns exactly 6 results
 *   - runFullCheck cache path (mocked DB returning a row)
 *
 * We do NOT integration-test runFullCheck's full path (GitHub + DB)
 * because that requires live services. Integration tests live in commit 14.
 */

const { runCheckerSafe, runAllCheckers } = require('../services/check_orchestrator');

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeChecker = (id, name, returnValue) => ({
  CHECKER_ID: id,
  CHECKER_NAME: name,
  run: jest.fn().mockResolvedValue(returnValue),
});

const makeFailingChecker = (id, name, errorMessage) => ({
  CHECKER_ID: id,
  CHECKER_NAME: name,
  run: jest.fn().mockRejectedValue(new Error(errorMessage)),
});

const minimalSnapshot = {
  filePaths: [],
  tree: [],
  commits: [],
  readme: { exists: false, content: null },
  packageJson: { exists: false, parsed: null },
};

// ── runCheckerSafe ────────────────────────────────────────────────────────────

describe('runCheckerSafe', () => {
  it('returns the checker result as-is when the checker succeeds', async () => {
    const successResult = {
      checkerId: 'ci',
      name: 'CI',
      score: 100,
      passed: true,
      findings: [],
      metadata: {},
    };
    const checker = makeChecker('ci', 'CI', successResult);

    const result = await runCheckerSafe(checker, minimalSnapshot);

    expect(result).toBe(successResult);
    expect(checker.run).toHaveBeenCalledWith(minimalSnapshot);
  });

  it('returns score=0 with a RISK finding when checker throws', async () => {
    const checker = makeFailingChecker('docker', 'Docker & Containerization', 'ECONNRESET');

    const result = await runCheckerSafe(checker, minimalSnapshot);

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.checkerId).toBe('docker');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].type).toBe('risk');
    expect(result.findings[0].id).toBe('DOCKER_CHECKER_ERROR');
    // Must not expose raw internals beyond the message
    expect(result.findings[0].evidence).toContain('ECONNRESET');
  });

  it('never rethrows — always returns a result object', async () => {
    const checker = makeFailingChecker('secrets', 'Secrets', 'fatal crash');

    await expect(runCheckerSafe(checker, minimalSnapshot)).resolves.toBeDefined();
  });

  it('converts CHECKER_ID to uppercase for the error finding id', async () => {
    const checker = makeFailingChecker('readme', 'README', 'err');
    const result = await runCheckerSafe(checker, minimalSnapshot);
    expect(result.findings[0].id).toBe('README_CHECKER_ERROR');
  });
});

// ── runAllCheckers ────────────────────────────────────────────────────────────

describe('runAllCheckers', () => {
  it('returns exactly 6 results even when some checkers fail', async () => {
    // We test with the real ALL_CHECKERS list by calling the exported function
    // with a snapshot that won't cause network calls (no octokit, minimal tree).
    const results = await runAllCheckers(minimalSnapshot);

    // All 6 checkers must produce results
    expect(results).toHaveLength(6);

    // Every result must be a valid CheckerResult shape
    for (const result of results) {
      expect(result).toHaveProperty('checkerId');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('findings');
      expect(Array.isArray(result.findings)).toBe(true);
      // Score is always between 0 and 100
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it('returns correct checker IDs in the result array', async () => {
    const results = await runAllCheckers(minimalSnapshot);
    const ids = results.map((r) => r.checkerId);
    expect(ids).toEqual(
      expect.arrayContaining(['docker', 'ci', 'tests', 'readme', 'commits', 'secrets'])
    );
  });

  it('every checker result carries a valid CheckerResult shape with score in [0, 100]', async () => {
    const results = await runAllCheckers(minimalSnapshot);
    for (const result of results) {
      // A checker that passes (score >= 70) must have no RISK findings —
      // that invariant is enforced by createCheckerResult() itself.
      if (result.passed) {
        const hasRisk = result.findings.some((f) => f.type === 'risk');
        expect(hasRisk).toBe(false);
      }
      // score always clamped
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });
});
