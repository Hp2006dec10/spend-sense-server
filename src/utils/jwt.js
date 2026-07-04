import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Generates an Access Token valid for 15 minutes.
 * @param {object} user - User details.
 * @returns {string} The signed JWT.
 */
export const generateAccessToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email, fullName: user.fullName },
    env.jwtAccessSecret,
    { expiresIn: '15m' }
  );
};

/**
 * Generates a Refresh Token valid for 7 days.
 * @param {object} user - User details.
 * @returns {string} The signed JWT.
 */
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user.id },
    env.jwtRefreshSecret,
    { expiresIn: '7d' }
  );
};

/**
 * Verifies an Access Token.
 * @param {string} token - The access token.
 * @returns {object|null} Decoded payload or null if invalid.
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.jwtAccessSecret);
  } catch (error) {
    return null;
  }
};

/**
 * Verifies a Refresh Token.
 * @param {string} token - The refresh token.
 * @returns {object|null} Decoded payload or null if invalid.
 */
export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, env.jwtRefreshSecret);
  } catch (error) {
    return null;
  }
};
export default {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
