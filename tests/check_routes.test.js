const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const checkOrchestrator = require('../services/check_orchestrator');

describe('Check Endpoint (POST /api/check)', () => {
  const JWT_SECRET = 'test-secret-at-least-32-characters-for-jwt';
  let validToken;

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    validToken = jwt.sign({ id: 1, username: 'testuser' }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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
});
