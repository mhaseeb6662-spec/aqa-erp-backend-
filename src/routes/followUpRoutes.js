const express = require('express');
const { body } = require('express-validator');
const followUpController = require('../controllers/followUpController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

// "/mine" must be declared before the generic list route uses query params only,
// but since both are on distinct paths ("/" vs "/mine") ordering here is just for clarity.
router.get('/mine', followUpController.getMyFollowUps);
router.get('/', followUpController.getFollowUps);

router.post(
  '/',
  requirePermission(PERMISSIONS.FOLLOWUPS_CREATE),
  [
    body('entityType').isIn(['lead', 'customer']).withMessage('A valid entityType is required.'),
    body('entityId').notEmpty().withMessage('entityId is required.'),
    body('type').notEmpty().withMessage('Follow-up type is required.'),
    body('dueDate').notEmpty().withMessage('Due date is required.'),
  ],
  validate,
  followUpController.createFollowUp
);

router.patch('/:id', requirePermission(PERMISSIONS.FOLLOWUPS_UPDATE), followUpController.updateFollowUp);
router.patch(
  '/:id/complete',
  requirePermission(PERMISSIONS.FOLLOWUPS_UPDATE),
  followUpController.completeFollowUp
);
router.delete('/:id', requirePermission(PERMISSIONS.FOLLOWUPS_UPDATE), followUpController.deleteFollowUp);

module.exports = router;
