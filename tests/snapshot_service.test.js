const {
  fetchRepositorySnapshot,
  isUsableGitHubToken,
  fetchPackageJson,
  fetchDockerfile,
  fetchGitignore,
} = require('../services/github/snapshot_service');
const AppError = require('../utils/app_error');

describe('GitHub token configuration', () => {
  test('ignores blank and template tokens while accepting a configured token', () => {
    expect(isUsableGitHubToken('')).toBe(false);
    expect(isUsableGitHubToken('ghp_your_github_personal_access_token_here')).toBe(false);
    expect(isUsableGitHubToken('  ')).toBe(false);
    expect(isUsableGitHubToken('ghp_exampleconfiguredtoken')).toBe(true);
  });
});

describe('GitHub Snapshot Service (fetchRepositorySnapshot)', () => {
  let mockOctokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        repos: {
          get: jest.fn(),
          getCommit: jest.fn(),
          listCommits: jest.fn(),
          getReadme: jest.fn(),
          getContent: jest.fn(),
        },
        git: {
          getTree: jest.fn(),
        },
      },
    };
  });

  test('fetches full snapshot including tree, commits, README, package.json, gitignore, and octokit', async () => {
    // 1. repos.get
    mockOctokit.rest.repos.get.mockResolvedValueOnce({
      data: { default_branch: 'main' },
    });

    // 2. repos.getCommit
    mockOctokit.rest.repos.getCommit.mockResolvedValueOnce({
      data: { sha: 'abcdef1234567890abcdef1234567890abcdef12' },
    });

    // 3. git.getTree
    mockOctokit.rest.git.getTree.mockResolvedValueOnce({
      data: {
        truncated: false,
        tree: [
          { path: 'package.json', type: 'blob', size: 120, sha: 'sha1', mode: '100644' },
          { path: 'README.md', type: 'blob', size: 50, sha: 'sha2', mode: '100644' },
          { path: 'src/index.js', type: 'blob', size: 400, sha: 'sha3', mode: '100644' },
          { path: '.gitignore', type: 'blob', size: 20, sha: 'sha4', mode: '100644' },
        ],
      },
    });

    // 4. repos.listCommits
    mockOctokit.rest.repos.listCommits.mockResolvedValueOnce({
      data: [
        {
          sha: 'abcdef1234567890abcdef1234567890abcdef12',
          commit: {
            message: 'feat: add release readiness checks',
            author: { name: 'Alice', email: 'alice@example.com', date: '2026-01-01T00:00:00Z' },
          },
          html_url: 'https://github.com/acme/project/commit/abcdef',
        },
      ],
    });

    // 5. repos.getReadme
    const readmeRaw = '# My Project\nA great tool';
    mockOctokit.rest.repos.getReadme.mockResolvedValueOnce({
      data: {
        name: 'README.md',
        path: 'README.md',
        size: readmeRaw.length,
        content: Buffer.from(readmeRaw).toString('base64'),
      },
    });

    // 6. repos.getContent — package.json and .gitignore (parallel)
    const pkgJsonRaw = JSON.stringify({ name: 'my-project', scripts: { test: 'jest' } });
    const gitignoreRaw = 'node_modules/\n.env\n';
    mockOctokit.rest.repos.getContent.mockImplementation(async ({ path }) => {
      if (path === 'package.json') {
        return { data: { content: Buffer.from(pkgJsonRaw).toString('base64') } };
      }
      if (path === '.gitignore') {
        return { data: { content: Buffer.from(gitignoreRaw).toString('base64') } };
      }
      throw Object.assign(new Error('Unexpected path'), { status: 404 });
    });

    const snapshot = await fetchRepositorySnapshot({
      owner: 'acme',
      repo: 'project',
      octokitClient: mockOctokit,
    });

    expect(snapshot.owner).toBe('acme');
    expect(snapshot.repo).toBe('project');
    expect(snapshot.fullName).toBe('acme/project');
    expect(snapshot.defaultBranch).toBe('main');
    expect(snapshot.headSha).toBe('abcdef1234567890abcdef1234567890abcdef12');
    expect(snapshot.filePaths).toEqual(['package.json', 'README.md', 'src/index.js', '.gitignore']);
    expect(snapshot.commits).toHaveLength(1);
    expect(snapshot.commits[0].message).toBe('feat: add release readiness checks');
    expect(snapshot.readme.exists).toBe(true);
    expect(snapshot.readme.content).toBe(readmeRaw);
    expect(snapshot.packageJson.exists).toBe(true);
    expect(snapshot.packageJson.parsed).toEqual({ name: 'my-project', scripts: { test: 'jest' } });
    expect(snapshot.gitignore.exists).toBe(true);
    expect(snapshot.gitignore.content).toBe(gitignoreRaw);
    expect(snapshot.octokit).toBe(mockOctokit);
    expect(mockOctokit.rest.git.getTree).toHaveBeenCalledWith(
      expect.objectContaining({ tree_sha: snapshot.headSha })
    );
    expect(mockOctokit.rest.repos.listCommits).toHaveBeenCalledWith(
      expect.objectContaining({ sha: snapshot.headSha })
    );
    expect(mockOctokit.rest.repos.getReadme).toHaveBeenCalledWith(
      expect.objectContaining({ ref: snapshot.headSha })
    );
    for (const [options] of mockOctokit.rest.repos.getContent.mock.calls) {
      expect(options.ref).toBe(snapshot.headSha);
    }
  });

  test('handles missing README (404) gracefully without throwing', async () => {
    mockOctokit.rest.repos.get.mockResolvedValueOnce({ data: { default_branch: 'main' } });
    mockOctokit.rest.repos.getCommit.mockResolvedValueOnce({ data: { sha: 'sha123' } });
    mockOctokit.rest.git.getTree.mockResolvedValueOnce({ data: { tree: [] } });
    mockOctokit.rest.repos.listCommits.mockResolvedValueOnce({ data: [] });

    const err404 = new Error('Not Found');
    err404.status = 404;
    mockOctokit.rest.repos.getReadme.mockRejectedValueOnce(err404);

    const snapshot = await fetchRepositorySnapshot({
      owner: 'acme',
      repo: 'project',
      octokitClient: mockOctokit,
    });

    expect(snapshot.readme.exists).toBe(false);
    expect(snapshot.readme.content).toBeNull();
  });

  test('handles missing package.json when absent from tree without extra API call', async () => {
    mockOctokit.rest.repos.get.mockResolvedValueOnce({ data: { default_branch: 'main' } });
    mockOctokit.rest.repos.getCommit.mockResolvedValueOnce({ data: { sha: 'sha123' } });
    mockOctokit.rest.git.getTree.mockResolvedValueOnce({
      data: { tree: [{ path: 'main.py', type: 'blob' }] },
    });
    mockOctokit.rest.repos.listCommits.mockResolvedValueOnce({ data: [] });
    mockOctokit.rest.repos.getReadme.mockResolvedValueOnce({
      data: { name: 'README.md', content: Buffer.from('hi').toString('base64') },
    });

    const snapshot = await fetchRepositorySnapshot({
      owner: 'python-dev',
      repo: 'script',
      octokitClient: mockOctokit,
    });

    expect(snapshot.packageJson.exists).toBe(false);
    expect(snapshot.packageJson.parsed).toBeNull();
    expect(mockOctokit.rest.repos.getContent).not.toHaveBeenCalled();
  });

  test('captures package.json JSON parsing errors without failing entire snapshot', async () => {
    const brokenJson = '{ "name": "broken", invalid: json ';
    mockOctokit.rest.repos.getContent.mockResolvedValueOnce({
      data: { content: Buffer.from(brokenJson).toString('base64') },
    });

    const res = await fetchPackageJson(mockOctokit, 'acme', 'repo', ['package.json']);
    expect(res.exists).toBe(true);
    expect(res.parsed).toBeNull();
    expect(res.parseError).toContain('Invalid JSON');
  });

  test('fetches and decodes Dockerfile when present in file paths', async () => {
    const dockerfileText = 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\n';
    mockOctokit.rest.repos.getContent.mockResolvedValueOnce({
      data: { content: Buffer.from(dockerfileText).toString('base64') },
    });

    const res = await fetchDockerfile(mockOctokit, 'acme', 'repo', ['src/index.js', 'Dockerfile']);
    expect(res.exists).toBe(true);
    expect(res.path).toBe('Dockerfile');
    expect(res.content).toBe(dockerfileText);
  });

  test('fetches .gitignore when present and skips API call when absent', async () => {
    const gitignoreText = 'node_modules/\n.env\n';
    mockOctokit.rest.repos.getContent.mockResolvedValueOnce({
      data: { content: Buffer.from(gitignoreText).toString('base64') },
    });

    const found = await fetchGitignore(mockOctokit, 'acme', 'repo', ['.gitignore', 'src/app.js']);
    expect(found.exists).toBe(true);
    expect(found.path).toBe('.gitignore');
    expect(found.content).toBe(gitignoreText);

    mockOctokit.rest.repos.getContent.mockClear();
    const missing = await fetchGitignore(mockOctokit, 'acme', 'repo', ['src/app.js']);
    expect(missing.exists).toBe(false);
    expect(missing.content).toBeNull();
    expect(mockOctokit.rest.repos.getContent).not.toHaveBeenCalled();
  });

  test('maps repository not found 404 error through mapGitHubError', async () => {
    const err404 = new Error('Not Found');
    err404.status = 404;
    mockOctokit.rest.repos.get.mockRejectedValue(err404);

    await expect(
      fetchRepositorySnapshot({
        owner: 'acme',
        repo: 'nonexistent',
        octokitClient: mockOctokit,
      })
    ).rejects.toThrow(AppError);

    await expect(
      fetchRepositorySnapshot({
        owner: 'acme',
        repo: 'nonexistent',
        octokitClient: mockOctokit,
      })
    ).rejects.toThrow(/not found/i);
  });
});
