const PaymentLink = require('../models/PaymentLink');
const Customer = require('../models/Customer');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const logActivity = require('../utils/logActivity');

/**
 * GET /api/v1/payment-links?customerId=...
 */
exports.getPaymentLinks = catchAsync(async (req, res, next) => {
  const { customerId } = req.query;
  if (!customerId) return next(new AppError('customerId is required.', 400));

  const links = await PaymentLink.find({ customerId }).sort({ createdAt: -1 });

  // Lazily expire any pending links whose expiry date has passed.
  const toExpire = links.filter((l) => l.applyExpiryIfNeeded());
  if (toExpire.length) {
    await Promise.all(toExpire.map((l) => l.save()));
  }

  return sendResponse(res, 200, 'Payment links fetched successfully.', links);
});

/**
 * POST /api/v1/payment-links
 * Generates a shareable payment link for a customer (e.g. course deposit).
 */
exports.generatePaymentLink = catchAsync(async (req, res, next) => {
  const { customerId, amount, description, expiresAt } = req.body;

  if (!customerId) return next(new AppError('customerId is required.', 400));

  const customer = await Customer.findById(customerId);
  if (!customer) return next(new AppError('Customer not found.', 404));

  const paymentLink = await PaymentLink.create({
    customerId,
    amount,
    description,
    expiresAt: expiresAt || null,
    createdBy: req.user._id,
  });

  await logActivity({
    entityType: 'customer',
    entityId: customerId,
    type: 'payment_link',
    description: `Payment link generated for Rs. ${Number(amount).toLocaleString()} — ${description}`,
    performedBy: req.user._id,
  });

  return sendResponse(res, 201, 'Payment link generated.', paymentLink);
});

/**
 * PATCH /api/v1/payment-links/:id/cancel
 */
exports.cancelPaymentLink = catchAsync(async (req, res, next) => {
  const link = await PaymentLink.findById(req.params.id);
  if (!link) return next(new AppError('Payment link not found.', 404));

  if (link.status !== 'pending') {
    return next(new AppError(`Only pending links can be cancelled (current status: ${link.status}).`, 400));
  }

  link.status = 'cancelled';
  link.cancelledAt = new Date();
  await link.save();

  return sendResponse(res, 200, 'Payment link cancelled.', link);
});
