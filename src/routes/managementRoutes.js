const express = require('express');
const managementController = require('../controllers/managementController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Protect all management endpoints with authentication and RBAC
router.use(protect);
router.use(restrictTo('super-admin', 'admin', 'management', 'ceo', 'finance-manager', 'operations-manager', 'sales-manager'));

// 1. Executive Overview / CEO Dashboard
router.get('/overview', managementController.getExecutiveOverview);

// 2. Revenue & Financial Analytics
router.get('/revenue', managementController.getRevenueAnalytics);

// 3. Sales Pipeline & Commercial Analytics
router.get('/sales', managementController.getSalesAnalytics);

// 4. Operations, Fleet & Inventory Analytics
router.get('/operations', managementController.getOperationsAnalytics);

// 5. Staff & Coach Balanced Scorecard
router.get('/staff-coaches', managementController.getStaffCoachPerformance);

// 6. Multi-Branch Performance Comparison
router.get('/branches', managementController.getBranchPerformance);

// 7. Program Rankings & Occupancy
router.get('/programs', managementController.getProgramAnalytics);

// 8. Central KPI Catalog & Formula Versioning
router.get('/kpis', managementController.getKpiLibrary);

// 9. Daily, Weekly & Monthly Management Reports
router.get('/reports', managementController.getManagementReports);

// 10. Management Threshold Alerts & Acknowledgement
router.get('/alerts', managementController.getManagementAlerts);
router.put('/alerts/:id', managementController.updateAlertStatus);

// 11. Activity & Audit Explorer
router.get('/audit', managementController.getAuditExplorer);

// 12. Transaction Drill-Down Engine
router.get('/drilldown', managementController.getDrilldownData);

// 13. Customer Revenue Search
router.get('/customer-revenue', managementController.getCustomerRevenue);

module.exports = router;
