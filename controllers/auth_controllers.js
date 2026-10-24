const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../db');
const AppError = require('../utils/app_error');
const { sendSuccess } = require('../utils/api_response');

const register = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const email = req.body.email || `${username.toLowerCase().trim()}@readiness.local`;

    // Check if user with same username or email already exists
    const existing = await db.query(
      'SELECT id, username, email FROM Users WHERE username = $1 OR email = $2 LIMIT 1',
      [username, email]
    );

    if (existing.rows.length > 0) {
      return next(new AppError('User with this username or email already exists', 409));
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertResult = await db.query(
      'INSERT INTO Users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, hashedPassword]
    );

    const newUser = insertResult.rows[0];
    return sendSuccess(
      res,
      {
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          createdAt: newUser.created_at,
        },
      },
      201,
      'User registered successfully'
    );
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const userResult = await db.query(
      'SELECT id, username, password_hash FROM Users WHERE username = $1 LIMIT 1',
      [username]
    );

    const user = userResult.rows[0];
    if (!user) {
      return next(new AppError('Invalid username or password', 401));
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return next(new AppError('Invalid username or password', 401));
    }

    const payload = {
      id: user.id,
      username: user.username,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    });

    return sendSuccess(
      res,
      {
        token,
        user: {
          id: user.id,
          username: user.username,
        },
      },
      200,
      'Login successful'
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
};
