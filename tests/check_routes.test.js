const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const checkOrchestrator = require('../services/check_orchestrator');
const checkStore = require('../services/check_store');

describe('Check Endpoints (/api/check)', () => {
  const JWT_SECRET = 'test-secret-at-least-32-characters-for-jwt';
  let validToken;

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    validToken = jwt.sign({ id: 1, username: 'testuser' }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── POST /api/check ──────────────────────────────────────────────────────────

  describe('POST /api/check', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ repoUrl: 'https://github.com/owner/repo' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when repoUrl is missing', async () => {
      const res = await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${validToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Validation failed');
    });

    it('returns 400 when repoUrl is not a valid HTTPS URL', async () => {
      const res = await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ repoUrl: 'http://insecure.com/repo' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.details.some((d) => d.field === 'repoUrl')).toBe(true);
    });

    it('returns 400 when force is not a boolean', async () => {
      const res = await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ repoUrl: 'https://github.com/owner/repo', force: 'not-a-bool' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.details.some((d) => d.field === 'force')).toBe(true);
    });

    it('returns 200 and analysis results when request is valid and analysis succeeds', async () => {
      const mockResult = {
        cached: false,
        checkId: 101,
        repoName: 'owner/repo',
        headSha: 'abc123def456',
        ruleScore: 85,
        verdict: 'ready',
        checkerBreakdown: [],
        report: {
          summary: 'Repository is release-ready.',
          risks: [],
          recommendations: [],
        },
        checkerResults: [],
        createdAt: new Date().toISOString(),
      };

      jest.spyOn(checkOrchestrator, 'runFullCheck').mockResolvedValueOnce(mockResult);

      const res = await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ repoUrl: 'https://github.com/owner/repo' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Analysis complete');
      expect(res.body.data.checkId).toBe(101);
      expect(res.body.data.ruleScore).toBe(85);
      expect(res.body.data.verdict).toBe('ready');
    });

    it('returns 200 with cached notice when cached result is returned', async () => {
      const mockCachedResult = {
        cached: true,
        checkId: 50,
        repoName: 'owner/repo',
        headSha: 'abc123def456',
        ruleScore: 90,
        verdict: 'ready',
        report: { summary: 'Cached report' },
        checkerResults: [],
        createdAt: new Date().toISOString(),
      };

      jest.spyOn(checkOrchestrator, 'runFullCheck').mockResolvedValueOnce(mockCachedResult);

      const res = await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ repoUrl: 'https://github.com/owner/repo' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Cached result returned');
      expect(res.body.data.cached).toBe(true);
    });

    it('respects ?force=true query parameter to bypass cache', async () => {
      const mockFreshResult = {
        cached: false,
        checkId: 102,
        repoName: 'owner/repo',
        headSha: 'abc123def456',
        ruleScore: 85,
        verdict: 'ready',
        createdAt: new Date().toISOString(),
      };

      const spy = jest
        .spyOn(checkOrchestrator, 'runFullCheck')
        .mockResolvedValueOnce(mockFreshResult);

      const res = await request(app)
        .post('/api/check?force=true')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ repoUrl: 'https://github.com/owner/repo' });

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, force: true }));
    });
  });

  // ── GET /api/check/history ───────────────────────────────────────────────────

  describe('GET /api/check/history', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/check/history');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when invalid verdict query parameter is provided', async () => {
      const res = await request(app)
        .get('/api/check/history?verdict=invalid_verdict')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Validation failed');
    });

    it('returns 200 with paginated check history', async () => {
      const mockHistory = {
        checks: [
          {
            id: 1,
            repoUrl: 'https://github.com/owner/repo',
            repoName: 'owner/repo',
            headSha: 'sha1',
            ruleScore: 85,
            verdict: 'ready',
            cached: false,
            status: 'completed',
            createdAt: new Date().toISOString(),
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      jest.spyOn(checkStore, 'getChecksHistory').mockResolvedValueOnce(mockHistory);

      const res = await request(app)
        .get('/api/check/history?page=1&limit=10&verdict=ready')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.checks).toHaveLength(1);
      expect(res.body.data.pagination.total).toBe(1);
    });
  });

  // ── GET /api/check/:id ───────────────────────────────────────────────────────

  describe('GET /api/check/:id', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/check/1');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when id parameter is not a positive integer', async () => {
      const res = await request(app)
        .get('/api/check/not-a-number')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when report does not exist or belongs to another user', async () => {
      jest.spyOn(checkStore, 'getCheckById').mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/check/999')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not found/i);
    });

    it('returns 200 with full report details when report is owned by user', async () => {
      const mockReport = {
        id: 10,
        user_id: 1,
        repo_url: 'https://github.com/owner/repo',
        repo_name: 'owner/repo',
        head_sha: 'sha123',
        rule_score: 90,
        verdict: 'ready',
        report: { summary: 'Detailed report' },
        checker_results: [],
        created_at: new Date().toISOString(),
      };

      jest.spyOn(checkStore, 'getCheckById').mockResolvedValueOnce(mockReport);

      const res = await request(app)
        .get('/api/check/10')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(10);
      expect(res.body.data.rule_score).toBe(90);
    });
  });
});
