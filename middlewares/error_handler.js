const AppError = require('../utils/app_error');

/**
 * Centralized Express Error Handling Middleware.
 * Must declare 4 arguments (err, req, res, next) so Express recognizes it as an error handler.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let error = err;

  // PostgreSQL Unique Constraint Violation (Code 23505)
  if (err.code === '23505') {
    const detail = err.detail || 'Duplicate resource exists';
    error = new AppError(`Conflict: ${detail}`, 409);
  }

  // Fallback status code and message
  const statusCode = error.statusCode || 500;
  const isOperational = error.isOperational || false;
  const message = isOperational ? error.message : 'Internal Server Error';

  // Log unhandled / 500 errors for observability
  if (statusCode >= 500) {
    console.error(`[Unhandled Error] ${req.method} ${req.originalUrl}:`, err);
  }

  const responseBody = {
    success: false,
    error: {
      message,
    },
  };

  if (error.details) {
    responseBody.error.details = error.details;
  }

  // Never leak internal implementation stack traces to clients in production
  if (process.env.NODE_ENV === 'development') {
    responseBody.error.stack = err.stack;
  }

  return res.status(statusCode).json(responseBody);
};

module.exports = errorHandler;
