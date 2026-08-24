const express = require('express');
const { body } = require('express-validator');
const paymentLinkController = require('../controllers/paymentLinkController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router.get('/', paymentLinkController.getPaymentLinks);

router.post(
  '/',
  requirePermission(PERMISSIONS.PAYMENTS_CREATE),
  [
    body('customerId').notEmpty().withMessage('customerId is required.'),
    body('amount').isFloat({ gt: 0 }).withMessage('A valid amount is required.'),
    body('description').trim().notEmpty().withMessage('Description is required.'),
  ],
  validate,
  paymentLinkController.generatePaymentLink
);

router.patch(
  '/:id/cancel',
  requirePermission(PERMISSIONS.PAYMENTS_CREATE),
  paymentLinkController.cancelPaymentLink
);

module.exports = router;
