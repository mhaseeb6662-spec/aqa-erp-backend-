const express = require('express');
const { body } = require('express-validator');
const activityController = require('../controllers/activityController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router.get('/', activityController.getActivities);

router.post(
  '/',
  requirePermission(PERMISSIONS.ACTIVITIES_CREATE),
  [
    body('entityType').isIn(['lead', 'customer']).withMessage('A valid entityType is required.'),
    body('entityId').notEmpty().withMessage('entityId is required.'),
    body('type').notEmpty().withMessage('Interaction type is required.'),
    body('description').trim().notEmpty().withMessage('Description is required.'),
  ],
  validate,
  activityController.logActivity
);

module.exports = router;
