const jwt = require('jsonwebtoken');
const authenticateToken = require('../middlewares/token_check');

describe('JWT Authentication Middleware (token_check)', () => {
  const secret = 'test-secret-key-at-least-32-characters-long';
  let mockReq;
  let mockRes;
  let nextFn;

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFn = jest.fn();
  });

  test('returns 401 when Authorization header is absent', () => {
    authenticateToken(mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: expect.stringMatching(/missing/i) }),
      })
    );
    expect(nextFn).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header is malformed (not Bearer)', () => {
    mockReq.headers['authorization'] = 'Basic 123456';
    authenticateToken(mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(nextFn).not.toHaveBeenCalled();
  });

  test('returns 403 when token is invalid or expired', () => {
    mockReq.headers['authorization'] = 'Bearer invalid.token.payload';
    authenticateToken(mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(nextFn).not.toHaveBeenCalled();
  });

  test('attaches decoded user to req.user and calls next() when token is valid', () => {
    const token = jwt.sign({ id: 1, username: 'testuser' }, secret, { expiresIn: '1h' });
    mockReq.headers['authorization'] = `Bearer ${token}`;

    authenticateToken(mockReq, mockRes, nextFn);
    expect(nextFn).toHaveBeenCalled();
    expect(mockReq.user).toBeDefined();
    expect(mockReq.user.id).toBe(1);
    expect(mockReq.user.username).toBe('testuser');
  });
});
