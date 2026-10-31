const request = require('supertest');
const app = require('../app');
const db = require('../db');

describe('Health Probes (/health and /health/db)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('GET /health returns 200 with status ok and uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(typeof res.body.data.uptime).toBe('number');
    expect(res.body.data.timestamp).toBeDefined();
  });

  test('GET /health/db returns 200 when database responds', async () => {
    jest.spyOn(db, 'healthCheck').mockResolvedValueOnce({ status: 'healthy', latencyMs: 5 });

    const res = await request(app).get('/health/db');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.database).toBe('connected');
    expect(res.body.data.latencyMs).toBe(5);
  });

  test('GET /health/db returns 503 when database is unreachable', async () => {
    jest
      .spyOn(db, 'healthCheck')
      .mockRejectedValueOnce(new Error('Connection timeout acquiring client from pool'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/health/db');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Database connection failed');
    expect(res.body.error.details.database).toBe('disconnected');
    expect(JSON.stringify(res.body)).not.toContain('Connection timeout');
  });
});
