/**
 * Standardized API response helpers for predictable contract serialization.
 */

const sendSuccess = (res, data = null, statusCode = 200, message = null) => {
  const payload = {
    success: true,
  };
  if (message) payload.message = message;
  if (data !== null) payload.data = data;
  return res.status(statusCode).json(payload);
};

const sendError = (res, message = 'Internal Server Error', statusCode = 500, details = null) => {
  const payload = {
    success: false,
    error: {
      message,
    },
  };
  if (details !== null) payload.error.details = details;
  return res.status(statusCode).json(payload);
};

module.exports = {
  sendSuccess,
  sendError,
};
