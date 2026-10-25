const {
  getRedisConnectionOptions,
  createWorkerRedisClient,
  closeSharedRedisClient,
} = require('../config/redis');

describe('Redis Configuration (config/redis.js)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await closeSharedRedisClient();
  });

  it('parses host and port from environment variables', () => {
    process.env.REDIS_HOST = 'custom-redis-host';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'secret-password';

    const options = getRedisConnectionOptions();

    expect(options).toEqual(
      expect.objectContaining({
        host: 'custom-redis-host',
        port: 6380,
        password: 'secret-password',
      })
    );
  });

  it('returns REDIS_URL directly when configured', () => {
    process.env.REDIS_URL = 'redis://:mypassword@redis.internal:6379/0';

    const options = getRedisConnectionOptions();

    expect(options).toBe('redis://:mypassword@redis.internal:6379/0');
  });

  it('createWorkerRedisClient creates client with maxRetriesPerRequest: null', () => {
    const client = createWorkerRedisClient();

    // BullMQ worker requires maxRetriesPerRequest = null
    expect(client.options.maxRetriesPerRequest).toBeNull();

    client.disconnect();
  });
});
