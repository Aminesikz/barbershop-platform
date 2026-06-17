import { Redis } from 'ioredis';
import { env } from './env.js';

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err: Error) => console.error('Redis error:', err));

export { redis };
