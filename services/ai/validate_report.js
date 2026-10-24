/**
 * Server-side validation for Gemini report JSON.
 *
 * Two layers:
 *  1. Shape / type checks (required fields, enums, arrays)
 *  2. Evidence grounding — finding IDs and file paths must come from
 *     real checker results (AI must not invent unsupported claims)
 *
 * On failure, returns { ok: false, reason }.
 * On success, returns { ok: true, report } with sanitized arrays.
 */

const SEVERITIES = new Set(['high', 'medium', 'low']);
const PRIORITIES = new Set(['high', 'medium', 'low']);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Builds lookup sets from checker findings for evidence grounding.
 *
 * @param {Array<Object>} checkerResults
 * @returns {{ findingIds: Set<string>, filePaths: Set<string> }}
 */
const buildEvidenceIndex = (checkerResults = []) => {
  const findingIds = new Set();
  const filePaths = new Set();

  for (const result of checkerResults) {
    if (!result || !Array.isArray(result.findings)) continue;
    for (const finding of result.findings) {
      if (finding?.id) findingIds.add(finding.id);
      if (finding?.filePath) filePaths.add(finding.filePath);
      // Also index paths mentioned in evidence strings when they look like paths
      if (typeof finding?.evidence === 'string') {
        // No free-form parsing — only explicit filePath fields are trusted
      }
    }
  }

  return { findingIds, filePaths };
};

/**
 * Keeps only finding IDs that exist in the checker results.
 */
const filterFindingIds = (ids, findingIds) => {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id) => typeof id === 'string' && findingIds.has(id)))];
};

/**
 * Keeps only file paths that appear on real findings.
 * Empty list is allowed (some findings are repo-wide).
 */
const filterFilePaths = (paths, filePaths) => {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.filter((p) => typeof p === 'string' && filePaths.has(p)))];
};

/**
 * Validates and sanitizes one risk item. Returns null if unusable.
 */
const sanitizeRisk = (item, evidence) => {
  if (!item || typeof item !== 'object') return null;
  if (!isNonEmptyString(item.title) || !isNonEmptyString(item.explanation)) return null;
  if (!SEVERITIES.has(item.severity)) return null;

  const relatedFindingIds = filterFindingIds(item.relatedFindingIds, evidence.findingIds);
  const evidenceFilePaths = filterFilePaths(item.evidenceFilePaths, evidence.filePaths);

  // Risks that cite findings must keep at least one grounded finding id
  if (Array.isArray(item.relatedFindingIds) && item.relatedFindingIds.length > 0) {
    if (relatedFindingIds.length === 0) return null;
  }

  // Drop any invented file paths; if AI only cited fake paths, reject the item
  if (Array.isArray(item.evidenceFilePaths) && item.evidenceFilePaths.length > 0) {
    if (evidenceFilePaths.length === 0) return null;
  }

  return {
    title: item.title.trim(),
    severity: item.severity,
    explanation: item.explanation.trim(),
    relatedFindingIds,
    evidenceFilePaths,
  };
};

/**
 * Validates and sanitizes one recommendation item. Returns null if unusable.
 */
const sanitizeRecommendation = (item, evidence) => {
  if (!item || typeof item !== 'object') return null;
  if (!isNonEmptyString(item.title) || !isNonEmptyString(item.action)) return null;
  if (!PRIORITIES.has(item.priority)) return null;

  const relatedFindingIds = filterFindingIds(item.relatedFindingIds, evidence.findingIds);
  const evidenceFilePaths = filterFilePaths(item.evidenceFilePaths, evidence.filePaths);

  if (Array.isArray(item.relatedFindingIds) && item.relatedFindingIds.length > 0) {
    if (relatedFindingIds.length === 0) return null;
  }

  if (Array.isArray(item.evidenceFilePaths) && item.evidenceFilePaths.length > 0) {
    if (evidenceFilePaths.length === 0) return null;
  }

  return {
    title: item.title.trim(),
    priority: item.priority,
    action: item.action.trim(),
    relatedFindingIds,
    evidenceFilePaths,
  };
};

/**
 * Validates a parsed Gemini JSON object against schema + evidence.
 *
 * @param {unknown} raw
 * @param {Array<Object>} checkerResults
 * @returns {{ ok: true, report: Object } | { ok: false, reason: string }}
 */
const validateReport = (raw, checkerResults = []) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'Report must be a JSON object' };
  }

  // Reject AI attempts to set authoritative score/verdict fields
  if ('ruleScore' in raw || 'score' in raw || 'verdict' in raw) {
    // Strip rather than hard-fail — Gemini sometimes echoes context.
    // Authoritative values are always attached by generateReport from the scorer.
  }

  if (!isNonEmptyString(raw.summary)) {
    return { ok: false, reason: 'Missing or invalid summary' };
  }

  if (!Array.isArray(raw.risks) || !Array.isArray(raw.recommendations)) {
    return { ok: false, reason: 'risks and recommendations must be arrays' };
  }

  if (raw.recommendations.length === 0) {
    return { ok: false, reason: 'recommendations must contain at least one item' };
  }

  const evidence = buildEvidenceIndex(checkerResults);

  const risks = [];
  for (const item of raw.risks) {
    const sanitized = sanitizeRisk(item, evidence);
    if (sanitized) risks.push(sanitized);
  }

  // If the model invented every risk, reject the whole report
  if (raw.risks.length > 0 && risks.length === 0) {
    return { ok: false, reason: 'All risks failed evidence grounding' };
  }

  const recommendations = [];
  for (const item of raw.recommendations) {
    const sanitized = sanitizeRecommendation(item, evidence);
    if (sanitized) recommendations.push(sanitized);
  }

  if (recommendations.length === 0) {
    return { ok: false, reason: 'All recommendations failed evidence grounding' };
  }

  return {
    ok: true,
    report: {
      summary: raw.summary.trim(),
      risks,
      recommendations,
    },
  };
};

module.exports = {
  validateReport,
  buildEvidenceIndex,
  SEVERITIES,
  PRIORITIES,
};
