const rateLimit = require('express-rate-limit');

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 mins default
const maxGeneral = parseInt(process.env.RATE_LIMIT_MAX_GENERAL || '100', 10);
const maxAuth = parseInt(process.env.RATE_LIMIT_MAX_AUTH || '10', 10);

const skipInTest = () => process.env.NODE_ENV === 'test';

const generalLimiter = rateLimit({
  windowMs,
  max: maxGeneral,
  standardHeaders: true, // Draft-6 RateLimit headers: `RateLimit-*`
  legacyHeaders: false, // Disable `X-RateLimit-*`
  skip: skipInTest,
  message: {
    success: false,
    error: {
      message: 'Too many requests from this IP, please try again later.',
    },
  },
});

const authLimiter = rateLimit({
  windowMs,
  max: maxAuth,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    success: false,
    error: {
      message: 'Too many authentication attempts. Please try again after 15 minutes.',
    },
  },
});

module.exports = {
  generalLimiter,
  authLimiter,
};
