/**
 * Deterministic rule-based report used when Gemini is unavailable
 * or returns invalid / ungrounded output.
 *
 * Same shape as a validated Gemini report so callers do not need
 * special-case rendering. Never invents scores — uses the scorer result.
 */

const SEVERITY_BY_FINDING_TYPE = {
  risk: 'high',
  warning: 'medium',
  info: 'low',
  success: 'low',
};

const PRIORITY_BY_FINDING_TYPE = {
  risk: 'high',
  warning: 'medium',
  info: 'low',
  success: 'low',
};

/**
 * Builds a human-readable summary from score + verdict + top risks.
 */
const buildSummary = (scoringResult, riskFindings) => {
  const score = scoringResult?.ruleScore ?? 0;
  const verdict = scoringResult?.verdict ?? 'not_ready';
  const riskCount = riskFindings.length;

  if (verdict === 'ready') {
    return `Release readiness score is ${score}/100 (ready). No critical blockers were detected across the rule-based checkers.`;
  }

  if (verdict === 'needs_work') {
    return `Release readiness score is ${score}/100 (needs work). ${riskCount} risk signal(s) should be addressed before release.`;
  }

  return `Release readiness score is ${score}/100 (not ready). ${riskCount} risk signal(s) indicate significant gaps that should be fixed before release.`;
};

/**
 * @param {Object} params
 * @param {Array<Object>} params.checkerResults
 * @param {{ ruleScore: number, verdict: string }} params.scoringResult
 * @returns {{ summary: string, risks: Array, recommendations: Array }}
 */
const buildFallbackReport = ({ checkerResults = [], scoringResult }) => {
  const allFindings = [];
  for (const result of checkerResults) {
    if (!result || !Array.isArray(result.findings)) continue;
    for (const finding of result.findings) {
      if (finding && finding.id) {
        allFindings.push({
          ...finding,
          checkerId: result.checkerId,
        });
      }
    }
  }

  const riskFindings = allFindings.filter((f) => f.type === 'risk');
  const actionable = allFindings.filter((f) => f.type === 'risk' || f.type === 'warning');

  const risks = riskFindings.slice(0, 10).map((finding) => ({
    title: finding.title,
    severity: SEVERITY_BY_FINDING_TYPE[finding.type] || 'medium',
    explanation: finding.description,
    relatedFindingIds: [finding.id],
    evidenceFilePaths: finding.filePath ? [finding.filePath] : [],
  }));

  const recommendations = actionable.slice(0, 10).map((finding) => ({
    title: `Address: ${finding.title}`,
    priority: PRIORITY_BY_FINDING_TYPE[finding.type] || 'medium',
    action: finding.description,
    relatedFindingIds: [finding.id],
    evidenceFilePaths: finding.filePath ? [finding.filePath] : [],
  }));

  // If there were no risks/warnings, still give a positive recommendation set
  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Maintain current release hygiene',
      priority: 'low',
      action:
        'Keep tests, CI, secret hygiene, and documentation current as the repository evolves.',
      relatedFindingIds: [],
      evidenceFilePaths: [],
    });
  }

  return {
    summary: buildSummary(scoringResult, riskFindings),
    risks,
    recommendations,
  };
};

module.exports = {
  buildFallbackReport,
  buildSummary,
};
