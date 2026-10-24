const { FindingType, createFinding, createCheckerResult, findFiles } = require('./helpers');

const CHECKER_ID = 'ci';
const CHECKER_NAME = 'Continuous Integration (CI)';

/**
 * Known CI configuration patterns mapped to provider names.
 */
const CI_PATTERNS = [
  { provider: 'GitHub Actions', pattern: /^\.github\/workflows\/.*\.(ya?ml)$/i },
  { provider: 'GitLab CI', pattern: /(^|\/)\.gitlab-ci\.ya?ml$/i },
  { provider: 'CircleCI', pattern: /(^|\/)\.circleci\/config\.ya?ml$/i },
  { provider: 'Azure Pipelines', pattern: /(^|\/)azure-pipelines\.ya?ml$/i },
  { provider: 'Jenkins', pattern: /(^|\/)Jenkinsfile(\.[a-zA-Z0-9_-]+)?$/i },
  { provider: 'Travis CI', pattern: /(^|\/)\.travis\.ya?ml$/i },
  { provider: 'Bitbucket Pipelines', pattern: /(^|\/)bitbucket-pipelines\.ya?ml$/i },
];

/**
 * Analyzes repository for Continuous Integration (CI) configuration.
 *
 * @param {Object} snapshot - Repository snapshot from snapshot_service
 * @returns {Object} Standardized CheckerResult
 */
const run = (snapshot = {}) => {
  const filePaths = snapshot.filePaths || [];
  const findings = [];
  const detectedWorkflows = [];
  const detectedProviders = new Set();

  for (const { provider, pattern } of CI_PATTERNS) {
    const matched = findFiles(filePaths, pattern);
    if (matched.length > 0) {
      detectedProviders.add(provider);
      detectedWorkflows.push(...matched);
    }
  }

  let score;

  if (detectedWorkflows.length > 0) {
    const providersList = Array.from(detectedProviders).join(', ');
    const preview = detectedWorkflows.slice(0, 3).join(', ');
    const extraCount = detectedWorkflows.length - 3;
    const workflowSummary = extraCount > 0 ? `${preview} (+${extraCount} more)` : preview;

    findings.push(
      createFinding({
        id: 'CI_WORKFLOW_PRESENT',
        type: FindingType.SUCCESS,
        title: `Automated CI Configured (${providersList})`,
        description: `Repository defines automated Continuous Integration workflows via ${providersList}. Incoming code changes and pull requests can be automatically built, linted, and tested before release.`,
        evidence: `Discovered ${detectedWorkflows.length} CI workflow configuration(s): ${workflowSummary}`,
        filePath: detectedWorkflows[0],
      })
    );
    score = 100;
  } else {
    findings.push(
      createFinding({
        id: 'CI_WORKFLOW_MISSING',
        type: FindingType.RISK,
        title: 'Continuous Integration (CI) Missing',
        description:
          'No automated Continuous Integration (CI) workflows were found in .github/workflows or other recognized CI configuration paths. Releases risk deploying regressions or syntax failures without automated gating.',
        evidence: 'No CI workflow files found in repository tree',
      })
    );
    score = 0;
  }

  return createCheckerResult({
    checkerId: CHECKER_ID,
    name: CHECKER_NAME,
    score,
    findings,
    metadata: {
      hasCI: detectedWorkflows.length > 0,
      providers: Array.from(detectedProviders),
      workflowFiles: detectedWorkflows,
    },
  });
};

module.exports = {
  CHECKER_ID,
  CHECKER_NAME,
  CI_PATTERNS,
  run,
};
