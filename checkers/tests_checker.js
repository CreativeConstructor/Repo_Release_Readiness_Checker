const {
  FindingType,
  createFinding,
  createCheckerResult,
  findFiles,
  findFile,
} = require('./helpers');

const CHECKER_ID = 'tests';
const CHECKER_NAME = 'Test Signals';

/**
 * Common test file patterns across JavaScript, TypeScript, Python, Go, Java, Ruby, and Rust.
 */
const TEST_FILE_PATTERNS = [
  /(^|\/)__tests__\/.*\.[jt]sx?$/i,
  /\.(test|spec)\.[jt]sx?$/i,
  /(^|\/)tests?\/.*_test\.py$/i,
  /(^|\/)tests?\/test_.*\.py$/i,
  /(^|\/)tests?\/.*\.[jt]sx?$/i,
  /_test\.go$/i,
  /Test[a-zA-Z0-9_]*\.java$/i,
  /(^|\/)spec\/.*_spec\.rb$/i,
  /(^|\/)tests?\/.*\.rs$/i,
];

/**
 * Common test runner and configuration files.
 */
const TEST_RUNNER_CONFIGS = [
  { name: 'Jest', pattern: /(^|\/)jest\.config\.(js|ts|json|mjs|cjs)$/i },
  { name: 'Vitest', pattern: /(^|\/)vitest\.config\.(js|ts|mjs)$/i },
  { name: 'Mocha', pattern: /(^|\/)\.mocharc\.(js|json|ya?ml)$/i },
  { name: 'Pytest', pattern: /(^|\/)(pytest\.ini|setup\.cfg|pyproject\.toml)$/i },
  { name: 'Playwright', pattern: /(^|\/)playwright\.config\.[jt]s$/i },
  { name: 'Cypress', pattern: /(^|\/)cypress\.config\.[jt]s$/i },
  { name: 'Karma', pattern: /(^|\/)karma\.conf\.js$/i },
  { name: 'PHPUnit', pattern: /(^|\/)phpunit\.xml(\.dist)?$/i },
];

/**
 * Known test packages and test runners in package.json dependencies.
 */
const TEST_DEPENDENCIES = [
  'jest',
  'mocha',
  'chai',
  'vitest',
  'supertest',
  'cypress',
  'playwright',
  'ava',
  'tape',
  'jasmine',
  '@testing-library/react',
  '@testing-library/vue',
  '@testing-library/node',
  'sinon',
  'c8',
  'nyc',
];

/**
 * Analyzes repository test signals.
 *
 * NOTE: This checker evaluates structural signals of testing readiness
 * (test files, runner configs, package scripts, and test dependencies).
 * It explicitly does NOT measure line/branch coverage, which requires
 * dynamic test suite execution.
 *
 * @param {Object} snapshot - Repository snapshot from snapshot_service
 * @returns {Object} Standardized CheckerResult
 */
const run = (snapshot = {}) => {
  const filePaths = snapshot.filePaths || [];
  const findings = [];
  let score = 0;

  // 1. Scan for test files
  const matchedTestFiles = [];
  for (const pattern of TEST_FILE_PATTERNS) {
    const matched = findFiles(filePaths, pattern);
    for (const file of matched) {
      if (!matchedTestFiles.includes(file)) {
        matchedTestFiles.push(file);
      }
    }
  }

  if (matchedTestFiles.length > 0) {
    const preview = matchedTestFiles.slice(0, 3).join(', ');
    const extra = matchedTestFiles.length - 3;
    const summary = extra > 0 ? `${preview} (+${extra} more)` : preview;

    findings.push(
      createFinding({
        id: 'TEST_FILES_FOUND',
        type: FindingType.SUCCESS,
        title: 'Test Files Detected',
        description: `Found ${matchedTestFiles.length} automated test file(s) adhering to standard testing naming conventions.`,
        evidence: `Discovered ${matchedTestFiles.length} test file(s): ${summary}`,
        filePath: matchedTestFiles[0],
      })
    );
    score += 40;
  } else {
    findings.push(
      createFinding({
        id: 'TEST_FILES_MISSING',
        type: FindingType.RISK,
        title: 'No Test Files Detected',
        description:
          'No test files matching standard testing conventions (*.test.*, *.spec.*, __tests__/) were found. Releasing without automated unit or integration tests introduces severe regression risk.',
        evidence: 'No matching test files found in repository tree',
      })
    );
  }

  // 2. Scan for test runner configuration
  let detectedRunner = null;
  let detectedRunnerFile = null;

  for (const { name, pattern } of TEST_RUNNER_CONFIGS) {
    const configFile = findFile(filePaths, pattern);
    if (configFile) {
      detectedRunner = name;
      detectedRunnerFile = configFile;
      break;
    }
  }

  if (detectedRunner) {
    findings.push(
      createFinding({
        id: 'TEST_RUNNER_CONFIG_FOUND',
        type: FindingType.SUCCESS,
        title: `Test Runner Configured (${detectedRunner})`,
        description: `Dedicated ${detectedRunner} configuration detected (${detectedRunnerFile}) for test execution and environment setup.`,
        evidence: `Located test configuration at ${detectedRunnerFile}`,
        filePath: detectedRunnerFile,
      })
    );
    score += 25;
  } else if (matchedTestFiles.length > 0) {
    findings.push(
      createFinding({
        id: 'TEST_RUNNER_CONFIG_MISSING',
        type: FindingType.INFO,
        title: 'Standalone Test Runner Config Not Found',
        description:
          'No dedicated test runner config (e.g. jest.config.js, vitest.config.ts) was found. The test framework may be configured inline within package.json or using framework defaults.',
        evidence: 'No standalone test runner configuration file in tree',
      })
    );
  }

  // 3. Inspect package.json test script (if present)
  const packageJson = snapshot.packageJson?.parsed;
  if (packageJson) {
    const scripts = packageJson.scripts || {};
    const testScript = scripts.test;

    const isDefaultNpmTest =
      typeof testScript === 'string' &&
      testScript.includes('echo') &&
      testScript.includes('no test specified');

    if (testScript && !isDefaultNpmTest) {
      findings.push(
        createFinding({
          id: 'TEST_SCRIPT_PRESENT',
          type: FindingType.SUCCESS,
          title: 'NPM Test Script Defined',
          description: `package.json defines a runnable test script: "${testScript}".`,
          evidence: `package.json scripts.test: "${testScript}"`,
          filePath: 'package.json',
        })
      );
      score += 20;
    } else {
      findings.push(
        createFinding({
          id: 'TEST_SCRIPT_MISSING_OR_DEFAULT',
          type: FindingType.WARNING,
          title: 'NPM Test Script Missing or Default',
          description:
            'package.json does not define an active "test" script, or it retains the default unconfigured npm placeholder ("no test specified"). CI and automated pipelines cannot invoke tests via "npm test".',
          evidence: `package.json scripts.test: ${testScript ? `"${testScript}"` : 'undefined'}`,
          filePath: 'package.json',
        })
      );
    }

    // 4. Inspect test dependencies in package.json
    const allDeps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    const foundTestDeps = TEST_DEPENDENCIES.filter((dep) => Boolean(allDeps[dep]));

    if (foundTestDeps.length > 0) {
      findings.push(
        createFinding({
          id: 'TEST_DEPENDENCIES_FOUND',
          type: FindingType.SUCCESS,
          title: 'Testing Libraries Installed',
          description: `Testing dependencies detected: ${foundTestDeps.join(', ')}.`,
          evidence: `Found test dependencies: ${foundTestDeps.join(', ')}`,
          filePath: 'package.json',
        })
      );
      score += 15;
    }
  }

  return createCheckerResult({
    checkerId: CHECKER_ID,
    name: CHECKER_NAME,
    score,
    findings,
    metadata: {
      testFileCount: matchedTestFiles.length,
      sampleTestFiles: matchedTestFiles.slice(0, 10),
      detectedRunner,
      detectedRunnerFile,
      hasTestScript: Boolean(packageJson?.scripts?.test),
    },
  });
};

module.exports = {
  CHECKER_ID,
  CHECKER_NAME,
  TEST_FILE_PATTERNS,
  TEST_RUNNER_CONFIGS,
  TEST_DEPENDENCIES,
  run,
};
