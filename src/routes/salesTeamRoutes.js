const express = require('express');
const salesTeamController = require('../controllers/salesTeamController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission(PERMISSIONS.SALES_TEAM_VIEW), salesTeamController.getSalesTeam);
router.get(
  '/:userId/stats',
  requirePermission(PERMISSIONS.SALES_TEAM_VIEW),
  salesTeamController.getTeamMemberStats
);

module.exports = router;
