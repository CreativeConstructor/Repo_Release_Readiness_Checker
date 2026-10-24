const ciChecker = require('../checkers/ci_checker');

describe('CI Checker', () => {
  test('returns 100 and passed = true when GitHub Actions workflows are present', () => {
    const snapshot = {
      filePaths: [
        '.github/workflows/ci.yml',
        '.github/workflows/release.yaml',
        'src/index.js',
        'package.json',
      ],
    };

    const result = ciChecker.run(snapshot);
    expect(result.checkerId).toBe('ci');
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);

    const successFinding = result.findings.find((f) => f.id === 'CI_WORKFLOW_PRESENT');
    expect(successFinding).toBeDefined();
    expect(successFinding.type).toBe('success');
    expect(successFinding.evidence).toContain('.github/workflows/ci.yml');
    expect(result.metadata.providers).toContain('GitHub Actions');
    expect(result.metadata.workflowFiles).toHaveLength(2);
  });

  test('recognizes alternative CI systems like GitLab CI and CircleCI', () => {
    const gitlabSnapshot = {
      filePaths: ['.gitlab-ci.yml', 'README.md'],
    };
    const gitlabResult = ciChecker.run(gitlabSnapshot);
    expect(gitlabResult.score).toBe(100);
    expect(gitlabResult.passed).toBe(true);
    expect(gitlabResult.metadata.providers).toContain('GitLab CI');

    const circleSnapshot = {
      filePaths: ['.circleci/config.yml', 'main.py'],
    };
    const circleResult = ciChecker.run(circleSnapshot);
    expect(circleResult.score).toBe(100);
    expect(circleResult.metadata.providers).toContain('CircleCI');
  });

  test('returns 0 and passed = false when no CI workflows exist', () => {
    const snapshot = {
      filePaths: ['src/index.js', 'package.json', 'README.md', 'Dockerfile'],
    };

    const result = ciChecker.run(snapshot);
    expect(result.checkerId).toBe('ci');
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);

    const missingFinding = result.findings.find((f) => f.id === 'CI_WORKFLOW_MISSING');
    expect(missingFinding).toBeDefined();
    expect(missingFinding.type).toBe('risk');
    expect(result.metadata.hasCI).toBe(false);
  });
});
