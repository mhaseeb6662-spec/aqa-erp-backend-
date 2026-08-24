const express = require('express');
const financeController = require('../controllers/financeController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

// Financial Dashboard Metrics & Analytics
router.get('/dashboard/metrics', requirePermission(PERMISSIONS.FINANCE_REPORTS_VIEW, PERMISSIONS.FINANCE_INVOICES_VIEW), financeController.getFinancialDashboardMetrics);

// Invoices
router
  .route('/invoices')
  .get(requirePermission(PERMISSIONS.FINANCE_INVOICES_VIEW), financeController.getInvoices)
  .post(requirePermission(PERMISSIONS.FINANCE_INVOICES_CREATE), financeController.createInvoice);

router.get('/invoices/:id', requirePermission(PERMISSIONS.FINANCE_INVOICES_VIEW), financeController.getInvoiceById);
router.post('/invoices/:id/reminder', requirePermission(PERMISSIONS.FINANCE_INVOICES_UPDATE), financeController.sendInvoiceReminder);

// Online Payment Integration & Checkout
router.post('/checkout', requirePermission(PERMISSIONS.FINANCE_PAYMENTS_PROCESS, PERMISSIONS.FINANCE_INVOICES_VIEW), financeController.processOnlinePayment);
router.get('/payments', requirePermission(PERMISSIONS.FINANCE_PAYMENTS_VIEW), financeController.getPayments);

// Refunds
router
  .route('/refunds')
  .get(requirePermission(PERMISSIONS.FINANCE_REFUNDS_MANAGE, PERMISSIONS.FINANCE_PAYMENTS_VIEW), financeController.getRefunds)
  .post(requirePermission(PERMISSIONS.FINANCE_REFUNDS_MANAGE), financeController.processRefund);

// Receipts
router.get('/receipts', requirePermission(PERMISSIONS.FINANCE_RECEIPTS_VIEW), financeController.getReceipts);

module.exports = router;
