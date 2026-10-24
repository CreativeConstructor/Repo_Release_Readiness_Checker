const request = require('supertest');
const app = require('../app');
const db = require('../db');
const bcrypt = require('bcrypt');

describe('Authentication Endpoints (/api/auth)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-for-jwt';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/auth/register', () => {
    test('returns 400 when username or password fails validation', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'ab', password: '123' }); // username too short, password too short

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Validation failed');
      expect(Array.isArray(res.body.error.details)).toBe(true);
    });

    test('returns 409 when user already exists', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{ id: 1, username: 'existinguser', email: 'existinguser@readiness.local' }],
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'existinguser', password: 'securepassword123' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/already exists/i);
    });

    test('returns 201 with created user details on successful registration', async () => {
      // 1st query: check existence (returns 0 rows)
      // 2nd query: insert user (returns inserted row)
      jest
        .spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 42,
              username: 'newuser',
              email: 'newuser@readiness.local',
              created_at: new Date().toISOString(),
            },
          ],
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'newuser', password: 'securepassword123' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/registered successfully/i);
      expect(res.body.data.user.id).toBe(42);
      expect(res.body.data.user.username).toBe('newuser');
    });
  });

  describe('POST /api/auth/login', () => {
    test('returns 400 when fields are missing', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 401 on non-existent username', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'somepassword' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/invalid/i);
    });

    test('returns 401 on incorrect password', async () => {
      const hashedPassword = await bcrypt.hash('correctpassword', 10);
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{ id: 10, username: 'validuser', password_hash: hashedPassword }],
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'validuser', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/invalid/i);
    });

    test('returns 200 with JWT token on valid credentials', async () => {
      const hashedPassword = await bcrypt.hash('correctpassword', 10);
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{ id: 10, username: 'validuser', password_hash: hashedPassword }],
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'validuser', password: 'correctpassword' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.user.id).toBe(10);
    });
  });
});
