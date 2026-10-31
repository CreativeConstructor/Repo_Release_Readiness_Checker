jest.mock('../services/github/snapshot_service', () => ({
  createOctokitClient: jest.fn(),
  fetchHeadInfo: jest.fn(),
  fetchRepositorySnapshot: jest.fn(),
}));

jest.mock('../services/check_store', () => ({
  findCachedCheck: jest.fn(),
  createCheck: jest.fn(),
}));

jest.mock('../checkers/scorer', () => ({
  computeScore: jest.fn(() => ({ ruleScore: 75, verdict: 'needs_work', checkerBreakdown: [] })),
}));

jest.mock('../services/ai/generate_report', () => ({
  generateReport: jest.fn(async () => ({ summary: 'test report' })),
}));

const github = require('../services/github/snapshot_service');
const store = require('../services/check_store');
const { runFullCheck } = require('../services/check_orchestrator');

describe('runFullCheck revision consistency', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pins the snapshot to the HEAD SHA used for cache lookup and persistence', async () => {
    const octokit = {};
    const headInfo = { defaultBranch: 'main', headSha: 'commit-a' };
    const snapshot = {
      owner: 'octocat',
      repo: 'hello-world',
      filePaths: [],
      tree: [],
      commits: [],
      readme: { exists: false, content: null },
      packageJson: { exists: false, parsed: null },
      dockerfile: { exists: false, content: null },
      gitignore: { exists: false, content: null },
    };

    github.createOctokitClient.mockResolvedValue(octokit);
    github.fetchHeadInfo.mockResolvedValue(headInfo);
    github.fetchRepositorySnapshot.mockResolvedValue(snapshot);
    store.findCachedCheck.mockResolvedValue(null);
    store.createCheck.mockResolvedValue({ id: 17, created_at: 'now' });

    const result = await runFullCheck({
      userId: 3,
      repoUrl: 'https://github.com/octocat/hello-world',
      force: true,
    });

    expect(github.fetchRepositorySnapshot).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
      octokitClient: octokit,
      headInfo,
    });
    expect(store.createCheck).toHaveBeenCalledWith(
      expect.objectContaining({ headSha: 'commit-a' })
    );
    expect(result.headSha).toBe('commit-a');
  });
});
