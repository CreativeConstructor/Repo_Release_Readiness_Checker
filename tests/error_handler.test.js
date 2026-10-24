const request = require('supertest');
const express = require('express');
const AppError = require('../utils/app_error');
const errorHandler = require('../middlewares/error_handler');

describe('Centralized Error Handler Middleware', () => {
  let testApp;

  beforeEach(() => {
    testApp = express();
    testApp.use(express.json());
  });

  test('formats operational AppError with custom status code and details', async () => {
    testApp.get('/test-error', (req, res, next) => {
      next(new AppError('Item not found', 404, [{ field: 'id', message: 'Unknown ID' }]));
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test-error');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Item not found');
    expect(res.body.error.details).toEqual([{ field: 'id', message: 'Unknown ID' }]);
  });

  test('masks unexpected programmer errors with generic 500 in non-development environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    testApp.get('/crash', () => {
      throw new Error('Secret database password leaked in stack trace');
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/crash');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Internal Server Error');
    expect(res.body.error.stack).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
  });

  test('maps PostgreSQL duplicate key error code 23505 to 409 Conflict', async () => {
    testApp.get('/db-conflict', (req, res, next) => {
      const pgErr = new Error('duplicate key value violates unique constraint');
      pgErr.code = '23505';
      pgErr.detail = 'Key (username)=(john) already exists.';
      next(pgErr);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/db-conflict');
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Conflict');
  });
});
