const secretsChecker = require('../checkers/secrets_checker');

describe('Secrets Checker', () => {
  const makeBlob = (path, sha, size = 100) => ({
    path,
    type: 'blob',
    sha,
    size,
    mode: '100644',
  });

  const makeOctokit = (blobContentsBySha = {}) => ({
    rest: {
      git: {
        getBlob: jest.fn(async ({ file_sha }) => {
          const text = blobContentsBySha[file_sha];
          if (text === undefined) {
            const err = new Error('Not Found');
            err.status = 404;
            throw err;
          }
          const buffer = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf-8');
          return {
            data: {
              content: buffer.toString('base64'),
              encoding: 'base64',
            },
          };
        }),
      },
    },
  });

  test('returns contract-compatible result with no issues when tree is clean', async () => {
    const result = await secretsChecker.run({
      filePaths: ['.gitignore', 'src/index.js'],
      tree: [makeBlob('src/index.js', 'sha1', 40)],
      owner: 'acme',
      repo: 'safe-repo',
      gitignore: { content: 'node_modules/\n.env\n' },
      octokit: makeOctokit({ sha1: 'console.log("hello");\n' }),
    });

    expect(result.checkerId).toBe('secrets');
    expect(result.name).toBe('Secrets & Sensitive Data');
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.passed).toBe(true);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.findings.some((f) => f.id === 'SECRETS_ENV_GITIGNORED')).toBe(true);
    expect(result.findings.some((f) => f.id === 'SECRETS_TOKEN_DETECTED')).toBe(false);
    expect(result.metadata.contentScanEnabled).toBe(true);
    expect(result.metadata.filesScanned).toBe(1);
  });

  test('flags risky file paths without reading their content', async () => {
    const result = await secretsChecker.run({
      filePaths: ['.env', 'credentials.json', 'src/app.js'],
      tree: [],
      owner: 'acme',
      repo: 'leaky',
      // No octokit — path scan must still work
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(70);

    const risky = result.findings.filter((f) => f.id === 'SECRETS_RISKY_FILE_PRESENT');
    expect(risky.length).toBeGreaterThanOrEqual(2);
    expect(risky.some((f) => f.filePath === '.env')).toBe(true);
    expect(risky.some((f) => f.filePath === 'credentials.json')).toBe(true);
    expect(result.metadata.riskyPathsFound).toEqual(
      expect.arrayContaining(['.env', 'credentials.json'])
    );
  });

  test('reports missing .gitignore as a risk', async () => {
    const result = await secretsChecker.run({
      filePaths: ['src/index.js'],
      tree: [],
    });

    const finding = result.findings.find((f) => f.id === 'SECRETS_NO_GITIGNORE');
    expect(finding).toBeDefined();
    expect(finding.type).toBe('risk');
    expect(result.passed).toBe(false);
  });

  test('reports when .gitignore exists but does not exclude .env', async () => {
    const result = await secretsChecker.run({
      filePaths: ['.gitignore', 'src/index.js'],
      tree: [],
      gitignore: { content: 'node_modules/\ndist/\n' },
    });

    const finding = result.findings.find((f) => f.id === 'SECRETS_ENV_NOT_GITIGNORED');
    expect(finding).toBeDefined();
    expect(finding.type).toBe('risk');
    expect(finding.filePath).toBe('.gitignore');
  });

  test('accepts common .env gitignore patterns', () => {
    expect(secretsChecker.checkEnvInGitignore({ gitignore: { content: '.env\n' } })).toBe(true);
    expect(secretsChecker.checkEnvInGitignore({ gitignore: { content: '.env*\n' } })).toBe(true);
    expect(secretsChecker.checkEnvInGitignore({ gitignore: { content: '*.env\n' } })).toBe(true);
    expect(secretsChecker.checkEnvInGitignore({ gitignore: { content: '**/.env\n' } })).toBe(true);
    expect(secretsChecker.checkEnvInGitignore({ gitignore: { content: 'node_modules\n' } })).toBe(
      false
    );
    expect(secretsChecker.checkEnvInGitignore({})).toBeNull();
  });

  test('detects credential patterns and never exposes raw secret values', async () => {
    const githubToken = 'ghp_' + 'A'.repeat(36);
    const awsKey = 'AKIA' + 'B'.repeat(16);
    const fileBody = `TOKEN=${githubToken}\nAWS_KEY=${awsKey}\n`;

    const result = await secretsChecker.run({
      filePaths: ['.gitignore', 'config/keys.js'],
      tree: [makeBlob('config/keys.js', 'secret-sha', fileBody.length)],
      owner: 'acme',
      repo: 'leaky',
      gitignore: { content: '.env\n' },
      octokit: makeOctokit({ 'secret-sha': fileBody }),
    });

    const tokenFindings = result.findings.filter((f) => f.id === 'SECRETS_TOKEN_DETECTED');
    expect(tokenFindings.length).toBeGreaterThanOrEqual(2);
    expect(result.passed).toBe(false);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(githubToken);
    expect(serialized).not.toContain(awsKey);
    for (const finding of tokenFindings) {
      expect(finding.evidence).toMatch(/value redacted/i);
      expect(finding.evidence).not.toContain(githubToken);
      expect(finding.evidence).not.toContain(awsKey);
    }
  });

  test('scanForSecrets returns only id/label, never matched text', () => {
    const token = 'ghp_' + 'C'.repeat(36);
    const hits = secretsChecker.scanForSecrets(`export TOKEN=${token}`);
    expect(hits.some((h) => h.id === 'GITHUB_PAT')).toBe(true);
    expect(JSON.stringify(hits)).not.toContain(token);
  });

  test('skips oversized files without calling the blob API', async () => {
    const octokit = makeOctokit({});
    const oversized = secretsChecker.MAX_FILE_SIZE_BYTES + 1;

    await secretsChecker.run({
      filePaths: ['.gitignore', 'big.txt'],
      tree: [makeBlob('big.txt', 'big-sha', oversized)],
      owner: 'acme',
      repo: 'repo',
      gitignore: { content: '.env\n' },
      octokit,
    });

    expect(octokit.rest.git.getBlob).not.toHaveBeenCalled();
  });

  test('skips binary files (null-byte detection)', async () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
    expect(secretsChecker.isBinary(binary)).toBe(true);

    const octokit = makeOctokit({ 'bin-sha': binary });
    const result = await secretsChecker.run({
      filePaths: ['.gitignore', 'image.bin'],
      tree: [makeBlob('image.bin', 'bin-sha', binary.length)],
      owner: 'acme',
      repo: 'repo',
      gitignore: { content: '.env\n' },
      octokit,
    });

    expect(octokit.rest.git.getBlob).toHaveBeenCalledTimes(1);
    expect(result.metadata.filesScanned).toBe(0);
    expect(result.findings.some((f) => f.id === 'SECRETS_TOKEN_DETECTED')).toBe(false);
  });

  test('caps content scanning at MAX_FILES_TO_SCAN (50)', async () => {
    const blobMap = {};
    const tree = [];
    for (let i = 0; i < 55; i++) {
      const sha = `sha-${i}`;
      blobMap[sha] = `line ${i}\n`;
      tree.push(makeBlob(`file-${i}.txt`, sha, 10));
    }

    const octokit = makeOctokit(blobMap);
    const result = await secretsChecker.run({
      filePaths: ['.gitignore', ...tree.map((t) => t.path)],
      tree,
      owner: 'acme',
      repo: 'repo',
      gitignore: { content: '.env\n' },
      octokit,
    });

    expect(octokit.rest.git.getBlob).toHaveBeenCalledTimes(secretsChecker.MAX_FILES_TO_SCAN);
    expect(result.metadata.filesScanned).toBe(secretsChecker.MAX_FILES_TO_SCAN);
  });

  test('continues safely when blob API fails for a file', async () => {
    const octokit = {
      rest: {
        git: {
          getBlob: jest.fn(async ({ file_sha }) => {
            if (file_sha === 'bad-sha') {
              const err = new Error('Server Error');
              err.status = 500;
              throw err;
            }
            return {
              data: {
                content: Buffer.from('safe content\n').toString('base64'),
                encoding: 'base64',
              },
            };
          }),
        },
      },
    };

    const result = await secretsChecker.run({
      filePaths: ['.gitignore', 'bad.js', 'good.js'],
      tree: [makeBlob('bad.js', 'bad-sha', 20), makeBlob('good.js', 'good-sha', 20)],
      owner: 'acme',
      repo: 'repo',
      gitignore: { content: '.env\n' },
      octokit,
    });

    expect(result.checkerId).toBe('secrets');
    expect(result.metadata.filesScanned).toBe(1);
    expect(result.findings.some((f) => f.id === 'SECRETS_TOKEN_DETECTED')).toBe(false);
  });

  test('skips content scan when octokit is absent (path checks still run)', async () => {
    const result = await secretsChecker.run({
      filePaths: ['.env'],
      tree: [makeBlob('.env', 'env-sha', 30)],
      owner: 'acme',
      repo: 'repo',
    });

    expect(result.metadata.contentScanEnabled).toBe(false);
    expect(result.metadata.filesScanned).toBe(0);
    expect(result.findings.some((f) => f.id === 'SECRETS_RISKY_FILE_PRESENT')).toBe(true);
  });
});
