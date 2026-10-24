const jwt = require('jsonwebtoken');
const { sendError } = require('../utils/api_response');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return sendError(res, 'Authorization header missing', 401);
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return sendError(res, 'Malformed authorization header. Expected format: Bearer <token>', 401);
  }

  const token = parts[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return sendError(res, 'Invalid or expired token', 403);
    }
    req.user = decoded;
    return next();
  });
};

module.exports = authenticateToken;
