const {
  computeScore,
  getVerdict,
  CHECKER_WEIGHTS,
  REQUIRED_CHECKER_IDS,
  VERDICT,
} = require('../checkers/scorer');

const makeResult = (checkerId, score, passed = score >= 70) => ({
  checkerId,
  name: checkerId,
  score,
  passed,
  findings: [],
  metadata: {},
});

describe('Deterministic Scorer', () => {
  test('weights are centralized and sum to 1.0', () => {
    const sum = Object.values(CHECKER_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
    expect(REQUIRED_CHECKER_IDS).toEqual(['secrets', 'tests', 'ci', 'docker', 'readme', 'commits']);
  });

  test('computes a representative weighted score', () => {
    const results = [
      makeResult('secrets', 100),
      makeResult('tests', 80),
      makeResult('ci', 100),
      makeResult('docker', 70),
      makeResult('readme', 90),
      makeResult('commits', 60),
    ];

    // 100*0.25 + 80*0.20 + 100*0.20 + 70*0.15 + 90*0.10 + 60*0.10
    // = 25 + 16 + 20 + 10.5 + 9 + 6 = 86.5 → 87
    const scored = computeScore(results);
    expect(scored.ruleScore).toBe(87);
    expect(scored.verdict).toBe(VERDICT.READY);
    expect(scored.checkerBreakdown).toHaveLength(6);
    expect(scored.checkerBreakdown.find((b) => b.checkerId === 'secrets').weightedScore).toBe(25);
  });

  test('verdict boundaries: ready >= 80, needs_work 50-79, not_ready < 50', () => {
    expect(getVerdict(100)).toBe('ready');
    expect(getVerdict(80)).toBe('ready');
    expect(getVerdict(79)).toBe('needs_work');
    expect(getVerdict(50)).toBe('needs_work');
    expect(getVerdict(49)).toBe('not_ready');
    expect(getVerdict(0)).toBe('not_ready');
  });

  test('ruleScore is always between 0 and 100', () => {
    const allZero = REQUIRED_CHECKER_IDS.map((id) => makeResult(id, 0, false));
    expect(computeScore(allZero).ruleScore).toBe(0);

    const allMax = REQUIRED_CHECKER_IDS.map((id) => makeResult(id, 100, true));
    expect(computeScore(allMax).ruleScore).toBe(100);
  });

  test('identical inputs produce identical deterministic output', () => {
    const results = [
      makeResult('secrets', 40, false),
      makeResult('tests', 60, false),
      makeResult('ci', 0, false),
      makeResult('docker', 100),
      makeResult('readme', 50, false),
      makeResult('commits', 80),
    ];

    const a = computeScore(results);
    const b = computeScore(results);
    expect(a).toEqual(b);
  });

  test('missing checkers are treated as score 0 (never silently pass)', () => {
    const scored = computeScore([makeResult('tests', 100)]);

    expect(scored.ruleScore).toBe(20); // only tests weight
    expect(scored.verdict).toBe(VERDICT.NOT_READY);

    for (const id of REQUIRED_CHECKER_IDS) {
      if (id === 'tests') continue;
      const row = scored.checkerBreakdown.find((b) => b.checkerId === id);
      expect(row.score).toBe(0);
      expect(row.passed).toBe(false);
    }
  });

  test('empty array yields score 0 and not_ready', () => {
    const scored = computeScore([]);
    expect(scored.ruleScore).toBe(0);
    expect(scored.verdict).toBe(VERDICT.NOT_READY);
    expect(scored.checkerBreakdown).toHaveLength(6);
  });

  test('throws on non-array input', () => {
    expect(() => computeScore(null)).toThrow(/must be an array/i);
    expect(() => computeScore({})).toThrow(/must be an array/i);
  });

  test('ignores malformed entries without checkerId', () => {
    const scored = computeScore([
      null,
      { score: 100 },
      makeResult('secrets', 100),
      makeResult('tests', 100),
      makeResult('ci', 100),
      makeResult('docker', 100),
      makeResult('readme', 100),
      makeResult('commits', 100),
    ]);

    expect(scored.ruleScore).toBe(100);
    expect(scored.verdict).toBe(VERDICT.READY);
  });

  test('failed checker (score 0) reduces the weighted total explicitly', () => {
    const withFailure = computeScore([
      makeResult('secrets', 0, false),
      makeResult('tests', 100),
      makeResult('ci', 100),
      makeResult('docker', 100),
      makeResult('readme', 100),
      makeResult('commits', 100),
    ]);

    // Missing 25% from secrets → 75
    expect(withFailure.ruleScore).toBe(75);
    expect(withFailure.verdict).toBe(VERDICT.NEEDS_WORK);
    expect(withFailure.checkerBreakdown.find((b) => b.checkerId === 'secrets').passed).toBe(false);
  });
});
