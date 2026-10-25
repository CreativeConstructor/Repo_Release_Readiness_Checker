/**
 * Redis Configuration & Connection Factory
 *
 * Provides connection options and clients for BullMQ and application caching.
 *
 * Important BullMQ Connection Architecture:
 *  - Queue and QueueEvents can share standard Redis connections.
 *  - BullMQ Worker MUST have a dedicated Redis connection with maxRetriesPerRequest: null.
 *    (BullMQ uses blocking commands like BRPOPLPUSH/BLMOVE and manages its own retries).
 */

const Redis = require('ioredis');

/**
 * Parses and returns base Redis connection options from environment variables.
 */
const getRedisConnectionOptions = () => {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  const options = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    lazyConnect: true,
  };

  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }

  return options;
};

let sharedClient = null;

/**
 * Returns a shared Redis client singleton (used for BullMQ Queue & general caching).
 */
const getSharedRedisClient = () => {
  if (!sharedClient) {
    const options = getRedisConnectionOptions();
    sharedClient = new Redis(options);

    sharedClient.on('error', (err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[Redis Shared Client Error]:', err.message);
      }
    });
  }
  return sharedClient;
};

/**
 * Creates a dedicated Redis client specifically for BullMQ Workers.
 * Workers require `maxRetriesPerRequest: null`.
 */
const createWorkerRedisClient = () => {
  const baseOptions = getRedisConnectionOptions();
  const options =
    typeof baseOptions === 'string'
      ? { maxRetriesPerRequest: null }
      : { ...baseOptions, maxRetriesPerRequest: null };

  const client =
    typeof baseOptions === 'string'
      ? new Redis(baseOptions, options)
      : new Redis(options);

  client.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Redis Worker Client Error]:', err.message);
    }
  });

  return client;
};

/**
 * Closes the shared client connection (for graceful shutdown or test teardown).
 */
const closeSharedRedisClient = async () => {
  if (sharedClient) {
    try {
      await sharedClient.quit();
    } catch {
      sharedClient.disconnect();
    } finally {
      sharedClient = null;
    }
  }
};

module.exports = {
  getRedisConnectionOptions,
  getSharedRedisClient,
  createWorkerRedisClient,
  closeSharedRedisClient,
};
