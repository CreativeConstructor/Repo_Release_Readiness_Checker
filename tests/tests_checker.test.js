const testsChecker = require('../checkers/tests_checker');

describe('Tests Checker (Test Signals)', () => {
  test('returns full score when test files, runner config, test script, and test deps all present', () => {
    const snapshot = {
      filePaths: [
        'src/index.js',
        'tests/auth.test.js',
        'tests/health.test.js',
        '__tests__/unit.test.js',
        'jest.config.js',
        'package.json',
      ],
      packageJson: {
        parsed: {
          scripts: { test: 'jest --runInBand' },
          devDependencies: { jest: '^30.0.0', supertest: '^7.0.0' },
        },
      },
    };

    const result = testsChecker.run(snapshot);
    expect(result.checkerId).toBe('tests');
    expect(result.score).toBe(100); // 40 + 25 + 20 + 15
    expect(result.passed).toBe(true);

    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain('TEST_FILES_FOUND');
    expect(ids).toContain('TEST_RUNNER_CONFIG_FOUND');
    expect(ids).toContain('TEST_SCRIPT_PRESENT');
    expect(ids).toContain('TEST_DEPENDENCIES_FOUND');
    expect(result.metadata.testFileCount).toBe(3);
    expect(result.metadata.detectedRunner).toBe('Jest');
  });

  test('returns 0 and risk finding when no test files exist and no package.json', () => {
    const snapshot = {
      filePaths: ['src/index.js', 'README.md'],
      packageJson: { parsed: null }, // no package.json, so no script bonus
    };

    const result = testsChecker.run(snapshot);
    expect(result.score).toBe(0); // no test files, no runner, no package.json
    expect(result.passed).toBe(false);

    const risk = result.findings.find((f) => f.id === 'TEST_FILES_MISSING');
    expect(risk).toBeDefined();
    expect(risk.type).toBe('risk');
  });

  test('detects default npm test placeholder as missing test script', () => {
    const snapshot = {
      filePaths: ['src/app.test.js', 'jest.config.js'],
      packageJson: {
        parsed: {
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
          devDependencies: { jest: '^30.0.0' },
        },
      },
    };

    const result = testsChecker.run(snapshot);
    const warning = result.findings.find((f) => f.id === 'TEST_SCRIPT_MISSING_OR_DEFAULT');
    expect(warning).toBeDefined();
    expect(warning.type).toBe('warning');
  });

  test('recognizes Vitest config alongside TypeScript spec files', () => {
    const snapshot = {
      filePaths: ['src/utils.spec.ts', 'vitest.config.ts', 'src/main.ts'],
      packageJson: {
        parsed: {
          scripts: { test: 'vitest run' },
          devDependencies: { vitest: '^2.0.0' },
        },
      },
    };

    const result = testsChecker.run(snapshot);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.metadata.detectedRunner).toBe('Vitest');
  });

  test('handles snapshot without package.json gracefully', () => {
    const snapshot = {
      filePaths: ['tests/unit_test.py', 'pytest.ini'],
      packageJson: { parsed: null },
    };

    const result = testsChecker.run(snapshot);
    expect(result.score).toBeGreaterThan(0);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain('TEST_FILES_FOUND');
    expect(ids).toContain('TEST_RUNNER_CONFIG_FOUND');
  });
});
