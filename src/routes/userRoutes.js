const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect); // every route below requires authentication

router.get('/', requirePermission(PERMISSIONS.USERS_VIEW), userController.getUsers);
router.get('/:id', requirePermission(PERMISSIONS.USERS_VIEW), userController.getUserById);

router.post(
  '/',
  requirePermission(PERMISSIONS.USERS_CREATE),
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required.'),
    body('email').custom(async (value, { req }) => {
      const Role = require('../models/Role');
      let isStudent = false;
      if (req.body.role) {
        const roleDoc = await Role.findById(req.body.role).catch(() => null);
        if (roleDoc && roleDoc.slug === 'student') {
          isStudent = true;
        }
      }
      const s = (value || '').trim();
      if (!s) {
        if (!isStudent) {
          throw new Error('Email is required for staff and admin accounts.');
        }
        return true;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(s)) {
        throw new Error('Please provide a valid email address.');
      }
      return true;
    }),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('role').notEmpty().withMessage('A role must be assigned.'),
  ],
  validate,
  userController.createUser
);

router.patch('/:id', requirePermission(PERMISSIONS.USERS_UPDATE), userController.updateUser);

router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.USERS_UPDATE),
  [body('status').isIn(['active', 'inactive', 'suspended'])],
  validate,
  userController.updateUserStatus
);

router.delete('/:id', requirePermission(PERMISSIONS.USERS_DELETE), userController.deleteUser);

module.exports = router;
