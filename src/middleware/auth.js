import { verifyAccessToken } from '../utils/jwt.js';

/**
 * Express middleware to protect routes. Checks for Bearer JWT token in Authorization header.
 */
export const protect = (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    const error = new Error('Not authorized, no token provided');
    error.statusCode = 401;
    return next(error);
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    const error = new Error('Not authorized, token expired or invalid');
    error.statusCode = 401;
    return next(error);
  }

  req.user = decoded;
  next();
};
