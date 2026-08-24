const jwt = require('jsonwebtoken');
const config = require('../config/config');

const generateAccessToken = (userId) =>
  jwt.sign({ id: userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

const generateRefreshToken = (userId) =>
  jwt.sign({ id: userId }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });

const verifyAccessToken = (token) => jwt.verify(token, config.jwt.secret);

const verifyRefreshToken = (token) => jwt.verify(token, config.jwt.refreshSecret);

/**
 * Sends the refresh token as an httpOnly cookie and returns the
 * access token in the JSON body. Keeping the refresh token out of
 * JS-accessible storage is a core part of the Phase 1 security baseline.
 */
const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'strict',
    maxAge: config.cookie.expiresDays * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth',
  });
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  setRefreshTokenCookie,
};
