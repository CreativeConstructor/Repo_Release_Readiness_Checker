/**
 * Check Orchestrator
 *
 * The single source of truth for running a full release-readiness analysis.
 * Both the synchronous endpoint (POST /api/check) and the async BullMQ worker
 * call this function — they share identical logic, only the delivery mechanism
 * differs.
 *
 * Flow:
 *  1.  Parse and validate the GitHub URL
 *  2.  Fetch only the HEAD SHA (fast, cheap)
 *  3.  Cache lookup: if this user already analyzed this SHA, return cached result
 *  4.  Fetch the full repository snapshot
 *  5.  Run all 6 checkers concurrently via Promise.allSettled()
 *       - Failed checkers → score 0 + RISK finding (never silently pass)
 *  6.  Compute deterministic weighted rule score + verdict
 *  7.  Generate AI report (Gemini with rule-based fallback)
 *  8.  Persist to PostgreSQL (JSONB)
 *  9.  Return the full result
 */

const { parseGitHubUrl } = require('../services/github/url_parser');
const {
  createOctokitClient,
  fetchHeadInfo,
  fetchRepositorySnapshot,
} = require('../services/github/snapshot_service');
const { mapGitHubError } = require('../services/github/error_mapper');
const { computeScore } = require('../checkers/scorer');
const { generateReport } = require('../services/ai/generate_report');
const { createCheckerResult, FindingType, createFinding } = require('../checkers/helpers');
const { findCachedCheck, createCheck } = require('./check_store');

// All 6 checkers — imported here so the orchestrator owns the runner list
const dockerChecker = require('../checkers/docker_checker');
const ciChecker = require('../checkers/ci_checker');
const testsChecker = require('../checkers/tests_checker');
const readmeChecker = require('../checkers/readme_checker');
const commitsChecker = require('../checkers/commits_checker');
const secretsChecker = require('../checkers/secrets_checker');

const ALL_CHECKERS = [
  dockerChecker,
  ciChecker,
  testsChecker,
  readmeChecker,
  commitsChecker,
  secretsChecker,
];

/**
 * Runs a single checker safely. On error, returns a score=0 result with a
 * RISK finding explaining that the checker itself failed.
 * Never returns a passing result when the checker threw.
 *
 * @param {Object} checker - { CHECKER_ID, CHECKER_NAME, run }
 * @param {Object} snapshot
 * @returns {Promise<Object>} CheckerResult
 */
const runCheckerSafe = async (checker, snapshot) => {
  try {
    // Checkers may be sync or async — await handles both
    return await checker.run(snapshot);
  } catch (err) {
    // Build a degraded result that makes the failure visible in the report
    return createCheckerResult({
      checkerId: checker.CHECKER_ID,
      name: checker.CHECKER_NAME,
      score: 0,
      findings: [
        createFinding({
          id: `${checker.CHECKER_ID.toUpperCase()}_CHECKER_ERROR`,
          type: FindingType.RISK,
          title: `${checker.CHECKER_NAME} checker encountered an internal error`,
          description: `The checker could not complete its analysis. This is treated as a failing score (0) to avoid false positives. Error: ${err?.message || 'Unknown error'}`,
          evidence: `Checker "${checker.CHECKER_ID}" threw during run(): ${err?.message || 'unknown'}`,
        }),
      ],
      metadata: { error: err?.message || 'unknown', failed: true },
    });
  }
};

/**
 * Runs all 6 checkers concurrently via Promise.allSettled().
 * Promise.allSettled() guarantees every checker finishes regardless of failures.
 * runCheckerSafe() handles individual errors, so allSettled() promises never reject.
 *
 * @param {Object} snapshot
 * @returns {Promise<Array<Object>>} Array of 6 CheckerResults
 */
const runAllCheckers = async (snapshot) => {
  const settled = await Promise.allSettled(
    ALL_CHECKERS.map((checker) => runCheckerSafe(checker, snapshot))
  );

  // allSettled + runCheckerSafe = every item is fulfilled; map values directly
  return settled.map((outcome) => outcome.value);
};

/**
 * Core orchestration function.
 *
 * @param {Object} params
 * @param {number}  params.userId   - Authenticated user ID from JWT
 * @param {string}  params.repoUrl  - Raw GitHub repository URL from request body
 * @param {boolean} [params.force=false] - Bypass cache when true
 * @returns {Promise<Object>} Full analysis result
 */
const runFullCheck = async ({ userId, repoUrl, force = false }) => {
  // ── Step 1: Parse URL ────────────────────────────────────────────────────
  // parseGitHubUrl throws AppError(400) on invalid URLs — propagate as-is
  const { owner, repo } = parseGitHubUrl(repoUrl);
  const repoName = `${owner}/${repo}`;
  const normalizedUrl = `https://github.com/${owner}/${repo}`;

  // ── Step 2: Fetch HEAD SHA only (cheap — 1 API call) ────────────────────
  let octokit;
  let headSha;

  try {
    octokit = await createOctokitClient();
    const headInfo = await fetchHeadInfo(octokit, owner, repo);
    headSha = headInfo.headSha;
  } catch (err) {
    throw mapGitHubError(err, { owner, repo });
  }

  // ── Step 3: Cache lookup (user-scoped: SHA + user_id + repo) ─────────────
  // Private-repo results never leak: cache is per-user, not global.
  if (!force) {
    const cachedRow = await findCachedCheck({
      userId,
      repoUrl: normalizedUrl,
      headSha,
    });

    if (cachedRow) {
      return {
        cached: true,
        checkId: cachedRow.id,
        repoName,
        headSha,
        ruleScore: cachedRow.rule_score,
        verdict: cachedRow.verdict,
        report: cachedRow.report,
        checkerResults: cachedRow.checker_results,
        createdAt: cachedRow.created_at,
      };
    }
  }

  // ── Step 4: Full snapshot ────────────────────────────────────────────────
  let snapshot;
  try {
    snapshot = await fetchRepositorySnapshot({ owner, repo, octokitClient: octokit });
  } catch (err) {
    throw mapGitHubError(err, { owner, repo });
  }

  // Inject the authenticated Octokit client into the snapshot so the secrets
  // checker can fetch blob content without creating a second client.
  snapshot.octokit = octokit;

  // ── Step 5: Run all 6 checkers concurrently ──────────────────────────────
  const checkerResults = await runAllCheckers(snapshot);

  // ── Step 6: Deterministic weighted score ─────────────────────────────────
  const scoringResult = computeScore(checkerResults);

  // ── Step 7: AI report (Gemini with rule-based fallback) ──────────────────
  const report = await generateReport({ checkerResults, scoringResult });

  // ── Step 8: Persist ───────────────────────────────────────────────────────
  const saved = await createCheck({
    userId,
    repoUrl: normalizedUrl,
    repoName,
    headSha,
    ruleScore: scoringResult.ruleScore,
    verdict: scoringResult.verdict,
    report,
    checkerResults,
    cached: false,
  });

  // ── Step 9: Return ────────────────────────────────────────────────────────
  return {
    cached: false,
    checkId: saved.id,
    repoName,
    headSha,
    ruleScore: scoringResult.ruleScore,
    verdict: scoringResult.verdict,
    checkerBreakdown: scoringResult.checkerBreakdown,
    report,
    checkerResults,
    createdAt: saved.created_at,
  };
};

module.exports = {
  runFullCheck,
  runAllCheckers,
  runCheckerSafe,
};
