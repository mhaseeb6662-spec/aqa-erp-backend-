const express = require('express');
const reportController = require('../controllers/reportController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.use(protect);
router.use(restrictTo('super-admin', 'admin', 'management', 'ceo', 'operations-manager', 'sales-manager', 'finance-manager'));

// Daily Operational Snapshot
router.get('/daily', reportController.getDailyOperationalReport);

// Weekly Executive Performance
router.get('/weekly', reportController.getWeeklyPerformanceReport);

// Monthly Board & CEO Review
router.get('/monthly', reportController.getMonthlyExecutiveReport);

// Export CSV / Excel
router.get('/export/csv', reportController.downloadReportCsv);

module.exports = router;
