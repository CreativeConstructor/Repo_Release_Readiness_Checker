const readmeChecker = require('../checkers/readme_checker');

describe('README Checker', () => {
  test('returns 0 and risk finding when README is completely absent', () => {
    const snapshot = { readme: { exists: false, content: null } };
    const result = readmeChecker.run(snapshot);

    expect(result.checkerId).toBe('readme');
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);

    const risk = result.findings.find((f) => f.id === 'README_MISSING');
    expect(risk).toBeDefined();
    expect(risk.type).toBe('risk');
  });

  test('returns warning when README exists but is less than 100 characters', () => {
    const snapshot = {
      readme: { exists: true, filename: 'README.md', content: '# My Project\nA short stub.' },
    };

    const result = readmeChecker.run(snapshot);
    expect(result.score).toBeGreaterThan(0);

    const warning = result.findings.find((f) => f.id === 'README_TOO_SHORT');
    expect(warning).toBeDefined();
    expect(warning.type).toBe('warning');
  });

  test('awards full sections when comprehensive README with install, usage, and overview is provided', () => {
    const fullReadme = `
# My Awesome Project

## Overview
A release readiness checker for GitHub repositories.

## Installation
\`\`\`bash
npm install
cp .env.example .env
npm start
\`\`\`

## Usage
POST to /api/check with { "repoUrl": "https://github.com/owner/repo" }
and receive a structured readiness report.

## Testing
Run \`npm test\` to execute the full test suite.

## License
MIT
    `.trim();

    const snapshot = {
      readme: {
        exists: true,
        filename: 'README.md',
        content: fullReadme,
      },
    };

    const result = readmeChecker.run(snapshot);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.passed).toBe(true);

    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain('README_PRESENT');
    expect(ids).toContain('README_SECTIONS_FOUND');
    expect(result.metadata.detectedSections).toContain('Installation & Setup');
    expect(result.metadata.detectedSections).toContain('Usage & API Examples');
    expect(result.metadata.detectedSections).toContain('Overview & Architecture');
  });

  test('flags warning for missing critical sections in a short README', () => {
    const thinReadme = `
# My Project
Just some brief description that is long enough to pass the length check but misses key sections.
No installation instructions or usage examples are included in this version of the README file.
    `.trim();

    const snapshot = {
      readme: { exists: true, filename: 'README.md', content: thinReadme },
    };

    const result = readmeChecker.run(snapshot);
    const warning = result.findings.find((f) => f.id === 'README_CRITICAL_SECTIONS_MISSING');
    expect(warning).toBeDefined();
    expect(warning.type).toBe('warning');
    expect(warning.evidence).toContain('Installation & Setup');
  });

  test('handles snapshot with empty-string readme.content', () => {
    const snapshot = { readme: { exists: true, content: '   ' } };
    const result = readmeChecker.run(snapshot);
    expect(result.score).toBe(0);
    const risk = result.findings.find((f) => f.id === 'README_MISSING');
    expect(risk).toBeDefined();
  });
});
