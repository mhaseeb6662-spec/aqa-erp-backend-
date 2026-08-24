const express = require('express');
const { body } = require('express-validator');
const roleController = require('../controllers/roleController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission(PERMISSIONS.ROLES_VIEW), roleController.getRoles);
router.get('/permissions', requirePermission(PERMISSIONS.ROLES_VIEW), roleController.getPermissionCatalogue);
router.get('/:id', requirePermission(PERMISSIONS.ROLES_VIEW), roleController.getRoleById);

router.post(
  '/',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  [body('name').trim().notEmpty().withMessage('Role name is required.')],
  validate,
  roleController.createRole
);

router.patch('/:id', requirePermission(PERMISSIONS.ROLES_MANAGE), roleController.updateRole);
router.delete('/:id', requirePermission(PERMISSIONS.ROLES_MANAGE), roleController.deleteRole);

module.exports = router;
