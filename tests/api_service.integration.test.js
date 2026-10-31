const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const runServiceIntegration = process.env.RUN_SERVICE_INTEGRATION === 'true';
const describeServiceIntegration = runServiceIntegration ? describe : describe.skip;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret-at-least-32-characters';

jest.mock('../services/github/snapshot_service', () => ({
  createOctokitClient: jest.fn(),
  fetchHeadInfo: jest.fn(),
  fetchRepositorySnapshot: jest.fn(),
}));

jest.mock('../services/ai/generate_report', () => ({
  generateReport: jest.fn(),
}));

const app = require('../app');
const db = require('../db');
const githubSnapshot = require('../services/github/snapshot_service');
const aiReport = require('../services/ai/generate_report');
const checkOrchestrator = require('../services/check_orchestrator');
const checkQueue = require('../services/queue/check_queue');
const { createCheckWorker } = require('../workers/check_worker');
const { createWorkerRedisClient, closeSharedRedisClient } = require('../config/redis');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describeServiceIntegration('API + PostgreSQL + Redis integration', () => {
  let createdUsers = [];

  beforeAll(async () => {
    const schema = fs.readFileSync(path.join(__dirname, '../database/init.sql'), 'utf8');
    await db.pool.query(schema);
  });

  beforeEach(() => {
    const octokit = {};
    const headInfo = { defaultBranch: 'main', headSha: 'integration-commit-sha' };
    const snapshot = {
      owner: 'integration-owner',
      repo: 'integration-repo',
      fullName: 'integration-owner/integration-repo',
      defaultBranch: 'main',
      headSha: headInfo.headSha,
      tree: [],
      filePaths: [],
      treeTruncated: false,
      commits: [],
      readme: { exists: false, filename: null, path: null, size: 0, content: null },
      packageJson: { exists: false, parsed: null, raw: null, parseError: null },
      dockerfile: { exists: false, path: null, content: null },
      gitignore: { exists: false, path: null, content: null },
    };

    githubSnapshot.createOctokitClient.mockResolvedValue(octokit);
    githubSnapshot.fetchHeadInfo.mockResolvedValue(headInfo);
    githubSnapshot.fetchRepositorySnapshot.mockResolvedValue(snapshot);
    aiReport.generateReport.mockImplementation(async ({ scoringResult }) => ({
      summary: 'Integration report generated from mocked Gemini output.',
      risks: [],
      recommendations: [
        {
          title: 'Review readiness signals',
          priority: 'low',
          action: 'Review the six checker results before release.',
          relatedFindingIds: [],
          evidenceFilePaths: [],
        },
      ],
      ruleScore: scoringResult.ruleScore,
      verdict: scoringResult.verdict,
      source: 'gemini',
    }));
  });

  afterEach(async () => {
    await Promise.all(
      createdUsers.map((username) => db.query('DELETE FROM Users WHERE username = $1', [username]))
    );
    createdUsers = [];
  });

  afterAll(async () => {
    await checkQueue.closeCheckQueue();
    await closeSharedRedisClient();
    await db.pool.end();
  });

  const createAuthenticatedUser = async () => {
    const username = `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createdUsers.push(username);

    const register = await request(app)
      .post('/api/auth/register')
      .send({ username, password: 'integration-password-123' });
    expect(register.status).toBe(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username, password: 'integration-password-123' });
    expect(login.status).toBe(200);

    return {
      username,
      userId: login.body.data.user.id,
      token: login.body.data.token,
    };
  };

  it('registers, authenticates, analyzes, persists JSONB, and reuses the same-SHA cache', async () => {
    const user = await createAuthenticatedUser();
    const first = await request(app)
      .post('/api/check')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ repoUrl: 'https://github.com/integration-owner/integration-repo' });

    expect(first.status).toBe(200);
    expect(first.body.data.checkerResults).toHaveLength(6);
    expect(first.body.data.headSha).toBe('integration-commit-sha');
    expect(first.body.data.report.summary).toContain('mocked Gemini');
    expect(githubSnapshot.fetchRepositorySnapshot).toHaveBeenCalledTimes(1);
    expect(aiReport.generateReport).toHaveBeenCalledTimes(1);

    const persisted = await db.query(
      'SELECT report, checker_results FROM Checks WHERE id = $1 AND user_id = $2',
      [first.body.data.checkId, user.userId]
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].report.summary).toContain('mocked Gemini');
    expect(persisted.rows[0].checker_results).toHaveLength(6);

    const second = await request(app)
      .post('/api/check')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ repoUrl: 'https://github.com/integration-owner/integration-repo' });

    expect(second.status).toBe(200);
    expect(second.body.data.cached).toBe(true);
    expect(second.body.data.checkId).toBe(first.body.data.checkId);
    expect(githubSnapshot.fetchRepositorySnapshot).toHaveBeenCalledTimes(1);
  });

  it('retries an async job after a worker failure and exposes completion only to its owner', async () => {
    const user = await createAuthenticatedUser();
    const otherUserToken = jwt.sign({ id: user.userId + 1000 }, process.env.JWT_SECRET);
    const analysis = {
      cached: false,
      checkId: 9001,
      repoName: 'integration-owner/integration-repo',
      headSha: 'integration-commit-sha',
      ruleScore: 75,
      verdict: 'needs_work',
      report: { summary: 'Retried worker analysis completed.' },
      checkerResults: [],
    };
    const runSpy = jest
      .spyOn(checkOrchestrator, 'runFullCheck')
      .mockRejectedValueOnce(new Error('simulated transient worker failure'))
      .mockResolvedValueOnce(analysis);
    const workerConnection = createWorkerRedisClient();
    const worker = createCheckWorker({ connection: workerConnection, concurrency: 1 });

    try {
      await worker.waitUntilReady();
      const enqueued = await request(app)
        .post('/api/check/async')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ repoUrl: 'https://github.com/integration-owner/integration-repo' });

      expect(enqueued.status).toBe(202);

      const deadline = Date.now() + 20000;
      let completed;
      while (Date.now() < deadline) {
        const status = await request(app)
          .get(enqueued.body.data.statusUrl)
          .set('Authorization', `Bearer ${user.token}`);

        if (status.body.data?.status === 'completed') {
          completed = status;
          break;
        }
        if (status.body.data?.status === 'failed') {
          throw new Error(`Job failed after retry: ${status.body.data.failedReason}`);
        }
        await wait(200);
      }

      expect(completed).toBeDefined();
      expect(completed.body.data.result.ruleScore).toBe(75);
      expect(runSpy).toHaveBeenCalledTimes(2);

      const unauthorized = await request(app)
        .get(enqueued.body.data.statusUrl)
        .set('Authorization', `Bearer ${otherUserToken}`);
      expect(unauthorized.status).toBe(404);
    } finally {
      await worker.close();
      workerConnection.disconnect();
      runSpy.mockRestore();
    }
  }, 30000);
});
