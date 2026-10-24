/**
 * Deterministic Weighted Rule Scorer
 *
 * Combines the 6 checker results into a single release-readiness score
 * and verdict using fixed weights. The output is fully deterministic —
 * given the same checker results, this always returns the same score.
 *
 * Weights (must sum to 1.0):
 *   secrets  25%  — Committed secrets are a hard blocker
 *   tests    20%  — Untested code has unknown risk in production
 *   ci       20%  — CI/CD gates automation and deployment safety
 *   docker   15%  — Containerisation enables reproducible deploys
 *   readme   10%  — Documentation signals maintainability
 *   commits  10%  — Commit hygiene signals team discipline
 *
 * Verdict thresholds:
 *   ready       >= 80  — Safe to release
 *   needs_work  50-79  — Improvable; not recommended for release
 *   not_ready   < 50   — Significant gaps; do not release
 */

const CHECKER_WEIGHTS = {
  secrets: 0.25,
  tests: 0.20,
  ci: 0.20,
  docker: 0.15,
  readme: 0.10,
  commits: 0.10,
};

/** All six checker IDs we expect. */
const REQUIRED_CHECKER_IDS = Object.keys(CHECKER_WEIGHTS);

const VERDICT = {
  READY: 'ready',
  NEEDS_WORK: 'needs_work',
  NOT_READY: 'not_ready',
};

/**
 * Derives a string verdict from a numeric score.
 *
 * @param {number} score - 0 to 100
 * @returns {'ready' | 'needs_work' | 'not_ready'}
 */
const getVerdict = (score) => {
  if (score >= 80) return VERDICT.READY;
  if (score >= 50) return VERDICT.NEEDS_WORK;
  return VERDICT.NOT_READY;
};

/**
 * Computes the weighted release-readiness score from an array of checker results.
 *
 * Rules:
 *  - Any checker not present in the results list is treated as score=0 (penalised).
 *  - Any checker that threw (failed checker) should have been converted to a score=0
 *    result by the orchestrator before being passed here. We never silently pass
 *    a missing checker.
 *  - Score is rounded to the nearest integer.
 *
 * @param {Array<Object>} checkerResults - Array of CheckerResult objects from each checker
 * @returns {{
 *   ruleScore: number,
 *   verdict: string,
 *   checkerBreakdown: Array<{
 *     checkerId: string,
 *     name: string,
 *     score: number,
 *     weight: number,
 *     weightedScore: number,
 *     passed: boolean
 *   }>
 * }}
 */
const computeScore = (checkerResults = []) => {
  if (!Array.isArray(checkerResults)) {
    throw new Error('computeScore: checkerResults must be an array');
  }

  // Index results by checkerId for O(1) lookup
  const resultMap = {};
  for (const result of checkerResults) {
    if (result && result.checkerId) {
      resultMap[result.checkerId] = result;
    }
  }

  let weightedTotal = 0;
  const checkerBreakdown = [];

  for (const checkerId of REQUIRED_CHECKER_IDS) {
    const weight = CHECKER_WEIGHTS[checkerId];
    const result = resultMap[checkerId];

    // Missing checker treated as 0 — never silently pass
    const rawScore = result ? result.score : 0;
    const weightedScore = rawScore * weight;

    weightedTotal += weightedScore;

    checkerBreakdown.push({
      checkerId,
      name: result?.name || checkerId,
      score: rawScore,
      weight,
      weightedScore: Math.round(weightedScore * 10) / 10, // 1 decimal place
      passed: result?.passed ?? false,
    });
  }

  const ruleScore = Math.round(weightedTotal);
  const verdict = getVerdict(ruleScore);

  return {
    ruleScore,
    verdict,
    checkerBreakdown,
  };
};

module.exports = {
  CHECKER_WEIGHTS,
  REQUIRED_CHECKER_IDS,
  VERDICT,
  getVerdict,
  computeScore,
};
