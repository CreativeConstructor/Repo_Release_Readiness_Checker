/**
 * Check Store
 *
 * Centralized data-access layer for repository check records.
 * Uses raw parameterized SQL (pg) for maximum transparency, performance,
 * and security against SQL injection.
 */

const db = require('../db');

/**
 * Finds a cached completed check for a given user, repository URL, and commit SHA.
 *
 * @param {Object} params
 * @param {number} params.userId
 * @param {string} params.repoUrl
 * @param {string} params.headSha
 * @returns {Promise<Object|null>}
 */
const findCachedCheck = async ({ userId, repoUrl, headSha }) => {
  const result = await db.query(
    `SELECT id, repo_name, head_sha, rule_score, verdict, report, checker_results, created_at
     FROM Checks
     WHERE user_id = $1
       AND repo_url = $2
       AND head_sha = $3
       AND status = 'completed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, repoUrl, headSha]
  );

  return result.rows[0] || null;
};

/**
 * Persists a completed repository check analysis.
 *
 * @param {Object} params
 * @returns {Promise<{ id: number, created_at: string }>}
 */
const createCheck = async ({
  userId,
  repoUrl,
  repoName,
  headSha,
  ruleScore,
  verdict,
  report,
  checkerResults,
  cached = false,
  status = 'completed',
}) => {
  const result = await db.query(
    `INSERT INTO Checks (
      user_id, repo_url, repo_name, head_sha,
      rule_score, verdict, report, checker_results,
      cached, status, created_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7::jsonb, $8::jsonb,
      $9, $10, NOW()
    )
    RETURNING id, created_at`,
    [
      userId,
      repoUrl,
      repoName,
      headSha,
      ruleScore,
      verdict,
      JSON.stringify(report),
      JSON.stringify(checkerResults),
      cached,
      status,
    ]
  );

  return result.rows[0];
};

/**
 * Retrieves a single check by ID with an enforced ownership check.
 *
 * @param {Object} params
 * @param {number} params.checkId
 * @param {number} params.userId
 * @returns {Promise<Object|null>}
 */
const getCheckById = async ({ checkId, userId }) => {
  const result = await db.query(
    `SELECT id, user_id, repo_url, repo_name, head_sha,
            rule_score, verdict, cached, status,
            report, checker_results, error_msg, created_at
     FROM Checks
     WHERE id = $1 AND user_id = $2`,
    [checkId, userId]
  );

  return result.rows[0] || null;
};

/**
 * Retrieves paginated check history for a user with optional verdict and repository filters.
 *
 * @param {Object} params
 * @param {number} params.userId - Authenticated user ID
 * @param {number} [params.page=1] - 1-based page number
 * @param {number} [params.limit=10] - Items per page (max 50)
 * @param {string} [params.verdict] - Optional verdict filter ('ready', 'needs_work', 'not_ready')
 * @param {string} [params.repo] - Optional substring filter for repo name or URL
 * @returns {Promise<{ checks: Array, pagination: { total: number, page: number, limit: number, totalPages: number } }>}
 */
const getChecksHistory = async ({ userId, page = 1, limit = 10, verdict, repo }) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (safePage - 1) * safeLimit;

  const conditions = ['user_id = $1'];
  const values = [userId];
  let paramIdx = 2;

  if (verdict && ['ready', 'needs_work', 'not_ready'].includes(verdict)) {
    conditions.push(`verdict = $${paramIdx}`);
    values.push(verdict);
    paramIdx++;
  }

  if (repo && typeof repo === 'string' && repo.trim().length > 0) {
    conditions.push(`(repo_name ILIKE $${paramIdx} OR repo_url ILIKE $${paramIdx})`);
    values.push(`%${repo.trim()}%`);
    paramIdx++;
  }

  const whereClause = conditions.join(' AND ');

  // Query 1: Total count for pagination metadata
  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM Checks WHERE ${whereClause}`,
    values
  );
  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.ceil(total / safeLimit) || 1;

  // Query 2: Paginated rows (omit bulky report/checker_results JSONB for lightweight summary list)
  const dataValues = [...values, safeLimit, offset];
  const listResult = await db.query(
    `SELECT id, repo_url, repo_name, head_sha,
            rule_score, verdict, cached, status, created_at
     FROM Checks
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    dataValues
  );

  return {
    checks: listResult.rows.map((row) => ({
      id: row.id,
      repoUrl: row.repo_url,
      repoName: row.repo_name,
      headSha: row.head_sha,
      ruleScore: row.rule_score,
      verdict: row.verdict,
      cached: row.cached,
      status: row.status,
      createdAt: row.created_at,
    })),
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
    },
  };
};

module.exports = {
  findCachedCheck,
  createCheck,
  getCheckById,
  getChecksHistory,
};
