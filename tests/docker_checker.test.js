const dockerChecker = require('../checkers/docker_checker');

describe('Docker Checker', () => {
  test('returns 100 and passed = true when Dockerfile, .dockerignore, and compose exist', () => {
    const snapshot = {
      filePaths: ['Dockerfile', '.dockerignore', 'docker-compose.yml', 'src/app.js'],
      dockerfile: {
        exists: true,
        content:
          'FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nCMD ["npm", "start"]',
      },
    };

    const result = dockerChecker.run(snapshot);
    expect(result.checkerId).toBe('docker');
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);

    const findingIds = result.findings.map((f) => f.id);
    expect(findingIds).toContain('DOCKERFILE_PRESENT');
    expect(findingIds).toContain('DOCKERIGNORE_PRESENT');
    expect(findingIds).toContain('DOCKER_COMPOSE_PRESENT');
    expect(findingIds).not.toContain('DOCKER_COPY_WITHOUT_IGNORE');
  });

  test('returns score 0 and passed = false when Dockerfile is missing', () => {
    const snapshot = {
      filePaths: ['src/app.js', 'package.json'],
    };

    const result = dockerChecker.run(snapshot);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);

    const missingFinding = result.findings.find((f) => f.id === 'DOCKERFILE_MISSING');
    expect(missingFinding).toBeDefined();
    expect(missingFinding.type).toBe('risk');
  });

  test('flags WARNING when .dockerignore is missing but no blind COPY is used', () => {
    const snapshot = {
      filePaths: ['Dockerfile', 'docker-compose.yaml'],
      dockerfile: {
        exists: true,
        content: 'FROM node:20-alpine\nWORKDIR /app\nCOPY package.json .\nCOPY src/ ./src/',
      },
    };

    const result = dockerChecker.run(snapshot);
    expect(result.score).toBe(70);
    expect(result.passed).toBe(true); // 70 is passing threshold since no critical RISK is present

    const warning = result.findings.find((f) => f.id === 'DOCKERIGNORE_MISSING');
    expect(warning).toBeDefined();
    expect(warning.type).toBe('warning');
  });

  test('CRITICAL RISK: triggers DOCKER_COPY_WITHOUT_IGNORE and caps score at 25 when "COPY . ." lacks .dockerignore', () => {
    const snapshot = {
      filePaths: ['Dockerfile', 'package.json'],
      dockerfile: {
        exists: true,
        content:
          'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]',
      },
    };

    const result = dockerChecker.run(snapshot);
    expect(result.score).toBeLessThanOrEqual(25);
    expect(result.passed).toBe(false);

    const risk = result.findings.find((f) => f.id === 'DOCKER_COPY_WITHOUT_IGNORE');
    expect(risk).toBeDefined();
    expect(risk.type).toBe('risk');
    expect(risk.evidence).toContain('COPY . .');
  });

  test('CRITICAL RISK: detects "COPY . /app" without .dockerignore', () => {
    const snapshot = {
      filePaths: ['Dockerfile'],
      dockerfileContent: 'FROM alpine\nCOPY . /app\nCMD ["sh"]',
    };

    const result = dockerChecker.run(snapshot);
    expect(result.score).toBeLessThanOrEqual(25);
    expect(result.passed).toBe(false);

    const risk = result.findings.find((f) => f.id === 'DOCKER_COPY_WITHOUT_IGNORE');
    expect(risk).toBeDefined();
    expect(risk.evidence).toContain('COPY . /app');
  });

  test('does not trigger blind copy risk when matching line is commented out', () => {
    const snapshot = {
      filePaths: ['Dockerfile'],
      dockerfile: {
        exists: true,
        content: '# COPY . .\nCOPY package.json ./\nCMD ["node"]',
      },
    };

    const result = dockerChecker.run(snapshot);
    const risk = result.findings.find((f) => f.id === 'DOCKER_COPY_WITHOUT_IGNORE');
    expect(risk).toBeUndefined();
  });
});
