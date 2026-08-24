const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/register',
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required.'),
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long.'),
  ],
  validate,
  authController.register
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  validate,
  authController.login
);

router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

router.get('/me', protect, authController.getMe);

router.patch(
  '/update-password',
  protect,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required.'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.'),
  ],
  validate,
  authController.updatePassword
);

router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('A valid email is required.').normalizeEmail()],
  validate,
  authController.forgotPassword
);

router.patch(
  '/reset-password/:token',
  [body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')],
  validate,
  authController.resetPassword
);

module.exports = router;
