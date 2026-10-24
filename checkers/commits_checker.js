const { FindingType, createFinding, createCheckerResult } = require('./helpers');

const CHECKER_ID = 'commits';
const CHECKER_NAME = 'Commit Health';

/**
 * Messages exactly matching these patterns are treated as generic.
 * All comparisons are case-insensitive after trimming.
 */
const GENERIC_MESSAGE_PATTERNS = [
  /^update$/i,
  /^updates?\.?$/i,
  /^fix$/i,
  /^fixed?\.?$/i,
  /^changes?\.?$/i,
  /^work\s*in\s*progress\.?$/i,
  /^wip\.?$/i,
  /^test\.?$/i,
  /^testing\.?$/i,
  /^misc\.?$/i,
  /^done\.?$/i,
  /^stuff\.?$/i,
  /^temp\.?$/i,
  /^tmp\.?$/i,
  /^asdf\.?$/i,
  /^commit\.?$/i,
  /^edited?\.?$/i,
  /^changes made\.?$/i,
  /^some fixes?\.?$/i,
  /^minor\s*(fix|change|update|edit)?\.?$/i,
  /^refactor\.?$/i,
  /^cleanup\.?$/i,
  /^cleanup?\.?$/i,
];

const MIN_MESSAGE_LENGTH = 10;
const STALE_DAYS_THRESHOLD = 30;
const GENERIC_THRESHOLD = 0.4; // 40%+ generic = risk

/**
 * Parses the first line (subject) from a full commit message.
 */
const getSubjectLine = (message) => {
  if (!message || typeof message !== 'string') return '';
  return message.split('\n')[0].trim();
};

/**
 * Checks whether a commit message subject is generic/uninformative.
 */
const isGenericMessage = (subject) => {
  if (!subject) return true;
  const cleaned = subject.trim();
  return GENERIC_MESSAGE_PATTERNS.some((pattern) => pattern.test(cleaned));
};

/**
 * Analyzes the quality, freshness, and hygiene of recent commit messages.
 *
 * Checks:
 * 1. Repository commit activity (not stale)
 * 2. Generic / uninformative commit messages (>= 40% of sample = risk)
 * 3. Very short commit messages (< 10 chars subject line)
 * 4. Structured commit references (issue, PR, ticket ID in messages)
 *
 * @param {Object} snapshot - Repository snapshot from snapshot_service
 * @returns {Object} Standardized CheckerResult
 */
const run = (snapshot = {}) => {
  const commits = snapshot.commits || [];
  const findings = [];
  let score = 100; // Start at 100, deduct for problems

  if (commits.length === 0) {
    findings.push(
      createFinding({
        id: 'COMMITS_NO_HISTORY',
        type: FindingType.WARNING,
        title: 'No Commit History Available',
        description: 'No commit data was available for analysis. Cannot assess commit health.',
        evidence: 'Snapshot returned 0 commits',
      })
    );
    return createCheckerResult({
      checkerId: CHECKER_ID,
      name: CHECKER_NAME,
      score: 50,
      findings,
      metadata: { commitCount: 0 },
    });
  }

  // 1. Staleness check — is the repo actively maintained?
  const latestCommit = commits[0];
  const latestDate = latestCommit?.author?.date ? new Date(latestCommit.author.date) : null;

  let daysSinceLastCommit = null;

  if (latestDate && !isNaN(latestDate.getTime())) {
    daysSinceLastCommit = Math.floor((Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceLastCommit > STALE_DAYS_THRESHOLD) {
      findings.push(
        createFinding({
          id: 'COMMITS_REPOSITORY_STALE',
          type: FindingType.RISK,
          title: `Repository Appears Stale (${daysSinceLastCommit} days since last commit)`,
          description: `No commits have been recorded in the last ${daysSinceLastCommit} days. A stale repository may indicate abandoned maintenance, unresolved security vulnerabilities, or unreleased critical patches.`,
          evidence: `Last commit was "${getSubjectLine(latestCommit.message)}" by ${latestCommit.author?.name || 'unknown'} on ${latestDate.toISOString().split('T')[0]}`,
        })
      );
      score -= 35;
    } else {
      findings.push(
        createFinding({
          id: 'COMMITS_REPOSITORY_ACTIVE',
          type: FindingType.SUCCESS,
          title: 'Repository Is Actively Maintained',
          description: `Latest commit was ${daysSinceLastCommit} day(s) ago, indicating active development.`,
          evidence: `Most recent commit: "${getSubjectLine(latestCommit.message)}" (${daysSinceLastCommit}d ago)`,
        })
      );
    }
  }

  // 2. Generic message analysis
  const subjects = commits.map((c) => getSubjectLine(c.message));
  const genericCommits = subjects.filter(isGenericMessage);
  const tooShortCommits = subjects.filter(
    (s) => !isGenericMessage(s) && s.length > 0 && s.length < MIN_MESSAGE_LENGTH
  );

  const genericRatio = genericCommits.length / commits.length;

  if (genericRatio >= GENERIC_THRESHOLD) {
    const genericExamples = genericCommits
      .slice(0, 3)
      .map((m) => `"${m}"`)
      .join(', ');
    findings.push(
      createFinding({
        id: 'COMMITS_GENERIC_MESSAGES',
        type: FindingType.RISK,
        title: `High Rate of Generic Commit Messages (${Math.round(genericRatio * 100)}%)`,
        description: `${genericCommits.length} of the ${commits.length} sampled commits have uninformative subject lines. Poor commit messages make it impossible to trace regressions, understand change intent, or perform meaningful code archaeology.`,
        evidence: `Generic messages include: ${genericExamples}`,
      })
    );
    score -= 25;
  } else if (genericCommits.length > 0) {
    findings.push(
      createFinding({
        id: 'COMMITS_SOME_GENERIC_MESSAGES',
        type: FindingType.WARNING,
        title: `Some Generic Commit Messages Detected (${genericCommits.length}/${commits.length})`,
        description: `${genericCommits.length} commit message(s) appear generic. While below the risk threshold, descriptive commit messages improve traceability.`,
        evidence: `Generic examples: ${genericCommits
          .slice(0, 2)
          .map((m) => `"${m}"`)
          .join(', ')}`,
      })
    );
    score -= 10;
  } else {
    findings.push(
      createFinding({
        id: 'COMMITS_DESCRIPTIVE_MESSAGES',
        type: FindingType.SUCCESS,
        title: 'Commit Messages Are Descriptive',
        description:
          'All sampled commit messages have informative subject lines, supporting traceability and audit logging.',
        evidence: `${commits.length} commits analyzed — no generic messages detected`,
      })
    );
  }

  // 3. Very short messages
  if (tooShortCommits.length > 0) {
    findings.push(
      createFinding({
        id: 'COMMITS_TOO_SHORT',
        type: FindingType.WARNING,
        title: `Short Commit Messages Detected (${tooShortCommits.length} commits)`,
        description: `${tooShortCommits.length} commit subject line(s) are shorter than ${MIN_MESSAGE_LENGTH} characters. Short messages rarely convey sufficient context.`,
        evidence: `Examples: ${tooShortCommits
          .slice(0, 3)
          .map((m) => `"${m}"`)
          .join(', ')}`,
      })
    );
    score -= 10;
  }

  // 4. Issue / PR reference check
  const issueRefPattern =
    /(#\d+|close[sd]?\s+#\d+|fix(e[sd])?\s+#\d+|ref(?:erence[sd]?)?\s+#\d+|[A-Z]+-\d+)/i;
  const commitsWithRefs = commits.filter((c) => issueRefPattern.test(c.message));
  const refRatio = commitsWithRefs.length / commits.length;

  if (refRatio >= 0.3) {
    findings.push(
      createFinding({
        id: 'COMMITS_ISSUE_REFERENCES',
        type: FindingType.SUCCESS,
        title: 'Commit Messages Reference Issues or Tickets',
        description: `${commitsWithRefs.length} of ${commits.length} commits reference issue trackers or ticket IDs, enabling automated changelog generation and release linking.`,
        evidence: `${Math.round(refRatio * 100)}% of commits contain issue/ticket references`,
      })
    );
  }

  return createCheckerResult({
    checkerId: CHECKER_ID,
    name: CHECKER_NAME,
    score,
    findings,
    metadata: {
      commitCount: commits.length,
      genericCount: genericCommits.length,
      tooShortCount: tooShortCommits.length,
      daysSinceLastCommit,
      refRatio: Math.round(refRatio * 100),
    },
  });
};

module.exports = {
  CHECKER_ID,
  CHECKER_NAME,
  GENERIC_MESSAGE_PATTERNS,
  getSubjectLine,
  isGenericMessage,
  run,
};
