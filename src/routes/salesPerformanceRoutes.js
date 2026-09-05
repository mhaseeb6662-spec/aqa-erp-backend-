const express = require('express');
const salesPerformanceController = require('../controllers/salesPerformanceController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);
router.use(requirePermission(PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.REPORTS_VIEW));

router.get('/overview', salesPerformanceController.getOverview);
router.get('/by-rep', salesPerformanceController.getByRep);
router.get('/by-source', salesPerformanceController.getBySource);
router.get('/by-stage', salesPerformanceController.getByStage);

module.exports = router;
