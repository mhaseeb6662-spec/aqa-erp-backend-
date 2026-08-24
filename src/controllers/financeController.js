const Invoice = require('../models/Invoice');
const PaymentTransaction = require('../models/PaymentTransaction');
const Refund = require('../models/Refund');
const Receipt = require('../models/Receipt');
const User = require('../models/User');
const Program = require('../models/Program');
const Branch = require('../models/Branch');
const Notification = require('../models/Notification');
const AppError = require('../utils/appError');

// ---- Invoices Controller ----
exports.getInvoices = async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role?.slug === 'student' || req.user.role?.slug === 'parent') {
      filter.customer = req.user.id;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const invoices = await Invoice.find(filter)
      .populate('customer', 'fullName email phone')
      .populate('student', 'fullName email')
      .populate('program', 'title code price')
      .populate('branch', 'name code city')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices,
    });
  } catch (err) {
    next(err);
  }
};

exports.getInvoiceById = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('customer', 'fullName email phone branch')
      .populate('student', 'fullName email')
      .populate('program', 'title code price')
      .populate('branch', 'name code city address phone email');

    if (!invoice) return next(new AppError('Invoice not found', 404));

    res.status(200).json({ success: true, data: invoice });
  } catch (err) {
    next(err);
  }
};

exports.createInvoice = async (req, res, next) => {
  try {
    const { customerId, studentId, programId, branchId, lineItems, taxRate, discount, dueDate, notes } = req.body;

    if (!customerId || !lineItems || lineItems.length === 0) {
      return next(new AppError('Please select a customer and add at least one line item', 400));
    }

    const invoiceNumber = 'INV-' + Math.floor(100000 + Math.random() * 900000);

    const computedItems = lineItems.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity) || 1,
      unitPrice: Number(item.unitPrice) || 0,
      amount: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
    }));

    const subtotal = computedItems.reduce((sum, item) => sum + item.amount, 0);
    const taxValue = Number(taxRate) >= 0 ? Number(taxRate) : 5;
    const taxAmount = (subtotal * taxValue) / 100;
    const discountVal = Number(discount) || 0;
    const totalAmount = Math.max(0, subtotal + taxAmount - discountVal);

    const invoice = await Invoice.create({
      invoiceNumber,
      customer: customerId,
      student: studentId || customerId,
      program: programId || null,
      branch: branchId || null,
      lineItems: computedItems,
      subtotal,
      taxRate: taxValue,
      taxAmount,
      discount: discountVal,
      totalAmount,
      balanceDue: totalAmount,
      amountPaid: 0,
      status: 'Sent',
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 15 * 86400000),
      notes: notes || 'Thank you for choosing Aqua Fishing Academy.',
      createdBy: req.user.id,
    });

    const populated = await Invoice.findById(invoice._id)
      .populate('customer', 'fullName email phone')
      .populate('program', 'title')
      .populate('branch', 'name');

    // Notify customer
    await Notification.create({
      recipient: customerId,
      title: 'New Invoice Issued',
      message: `Invoice ${invoiceNumber} for $${totalAmount} USD has been generated for your account.`,
      type: 'system',
      link: '/finance/invoices',
    });

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: populated,
    });
  } catch (err) {
    next(err);
  }
};

exports.sendInvoiceReminder = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email');
    if (!invoice) return next(new AppError('Invoice not found', 404));

    await Notification.create({
      recipient: invoice.customer._id,
      title: 'Payment Reminder',
      message: `Reminder: Invoice ${invoice.invoiceNumber} ($${invoice.balanceDue} USD due) is outstanding. Please complete payment.`,
      type: 'booking_alert',
      link: '/finance/invoices',
    });

    res.status(200).json({
      success: true,
      message: `Payment reminder sent to ${invoice.customer.fullName}.`,
    });
  } catch (err) {
    next(err);
  }
};

// ---- Online Payment Integration & Checkout ----
exports.processOnlinePayment = async (req, res, next) => {
  try {
    const { invoiceId, amount, paymentMethod, cardDetails } = req.body;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return next(new AppError('Invoice not found', 404));

    const payAmount = Number(amount) || invoice.balanceDue;
    if (payAmount <= 0) return next(new AppError('Payment amount must be greater than 0', 400));

    const transactionId = 'TXN-' + Math.floor(100000 + Math.random() * 900000);
    const receiptNumber = 'RCT-' + Math.floor(100000 + Math.random() * 900000);

    // Create payment transaction
    const transaction = await PaymentTransaction.create({
      transactionId,
      invoice: invoice._id,
      customer: req.user.id,
      amount: payAmount,
      paymentMethod: paymentMethod || 'Credit Card',
      status: 'Completed',
      gatewayReference: 'GW-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      cardLast4: cardDetails?.cardNumber ? cardDetails.cardNumber.slice(-4) : '4242',
      recordedBy: req.user.id,
    });

    // Update invoice paid amounts and status
    const newAmountPaid = invoice.amountPaid + payAmount;
    const newBalanceDue = Math.max(0, invoice.totalAmount - newAmountPaid);
    const newStatus = newBalanceDue === 0 ? 'Paid' : 'Partially Paid';

    invoice.amountPaid = newAmountPaid;
    invoice.balanceDue = newBalanceDue;
    invoice.status = newStatus;
    await invoice.save();

    // Generate Official Receipt
    const receipt = await Receipt.create({
      receiptNumber,
      payment: transaction._id,
      invoice: invoice._id,
      customer: req.user.id,
      amountPaid: payAmount,
      paymentMethod: paymentMethod || 'Credit Card',
    });

    // Update linked booking and operations schedule
    const Booking = require('../models/Booking');
    const Schedule = require('../models/Schedule');

    let booking = null;
    if (invoice.booking) {
      booking = await Booking.findById(invoice.booking);
    } else {
      booking = await Booking.findOne({ invoice: invoice._id });
    }

    if (booking) {
      booking.paymentStatus = newStatus === 'Paid' ? 'Paid' : 'Partially Paid';
      booking.status = 'Confirmed';
      await booking.save();

      // Synchronize Operations Schedule
      await Schedule.updateMany(
        { booking: booking._id },
        { status: 'Scheduled' }
      );
    }

    // Notify user
    await Notification.create({
      recipient: req.user.id,
      title: 'Payment Successful',
      message: `Your payment of $${payAmount} USD for Invoice ${invoice.invoiceNumber} was processed successfully. Receipt: ${receiptNumber}`,
      type: 'booking_alert',
      link: '/finance/receipts',
    });

    res.status(200).json({
      success: true,
      message: 'Online payment processed successfully!',
      data: {
        transaction,
        receipt,
        invoiceStatus: newStatus,
        balanceDue: newBalanceDue,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getPayments = async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role?.slug === 'student' || req.user.role?.slug === 'parent') {
      filter.customer = req.user.id;
    }

    const payments = await PaymentTransaction.find(filter)
      .populate('customer', 'fullName email')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .sort({ paidAt: -1 });

    res.status(200).json({ success: true, count: payments.length, data: payments });
  } catch (err) {
    next(err);
  }
};

// ---- Refund Management ----
exports.processRefund = async (req, res, next) => {
  try {
    const { paymentId, amount, reason } = req.body;
    if (!paymentId || !reason) {
      return next(new AppError('Payment transaction ID and refund reason are required', 400));
    }

    const payment = await PaymentTransaction.findById(paymentId);
    if (!payment) return next(new AppError('Payment transaction not found', 404));

    const refundAmount = Number(amount) || payment.amount;
    const refundId = 'REF-' + Math.floor(100000 + Math.random() * 900000);

    const refund = await Refund.create({
      refundId,
      payment: payment._id,
      invoice: payment.invoice,
      customer: payment.customer,
      amount: refundAmount,
      reason,
      status: 'Processed',
      processedBy: req.user.id,
    });

    payment.status = refundAmount >= payment.amount ? 'Refunded' : 'Partially Refunded';
    await payment.save();

    if (payment.invoice) {
      const invoice = await Invoice.findById(payment.invoice);
      if (invoice) {
        invoice.amountPaid = Math.max(0, invoice.amountPaid - refundAmount);
        invoice.balanceDue = Math.max(0, invoice.totalAmount - invoice.amountPaid);
        invoice.status = invoice.amountPaid === 0 ? 'Sent' : 'Partially Paid';
        await invoice.save();
      }
    }

    await Notification.create({
      recipient: payment.customer,
      title: 'Refund Processed',
      message: `A refund of $${refundAmount} USD has been processed for transaction ${payment.transactionId}.`,
      type: 'system',
      link: '/finance/refunds',
    });

    res.status(201).json({
      success: true,
      message: 'Refund processed successfully',
      data: refund,
    });
  } catch (err) {
    next(err);
  }
};

exports.getRefunds = async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role?.slug === 'student' || req.user.role?.slug === 'parent') {
      filter.customer = req.user.id;
    }

    const refunds = await Refund.find(filter)
      .populate('customer', 'fullName email')
      .populate('payment', 'transactionId amount paymentMethod')
      .populate('invoice', 'invoiceNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: refunds.length, data: refunds });
  } catch (err) {
    next(err);
  }
};

// ---- Receipts Management ----
exports.getReceipts = async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role?.slug === 'student' || req.user.role?.slug === 'parent') {
      filter.customer = req.user.id;
    }

    const receipts = await Receipt.find(filter)
      .populate('customer', 'fullName email phone')
      .populate('invoice', 'invoiceNumber totalAmount lineItems')
      .populate('payment', 'transactionId gatewayReference cardLast4')
      .sort({ issuedAt: -1 });

    res.status(200).json({ success: true, count: receipts.length, data: receipts });
  } catch (err) {
    next(err);
  }
};

// ---- Revenue Dashboard & Financial Reporting ----
exports.getFinancialDashboardMetrics = async (req, res, next) => {
  try {
    const totalPayments = await PaymentTransaction.aggregate([
      { $match: { status: { $in: ['Completed', 'Partially Refunded'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const totalRefunds = await Refund.aggregate([
      { $match: { status: 'Processed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const outstandingReceivables = await Invoice.aggregate([
      { $match: { status: { $in: ['Sent', 'Partially Paid', 'Overdue'] } } },
      { $group: { _id: null, total: { $sum: '$balanceDue' } } },
    ]);

    const totalRevenue = (totalPayments[0]?.total || 0) - (totalRefunds[0]?.total || 0);
    const mrr = Math.round(totalRevenue / 3); // estimated 3-month avg
    const receivables = outstandingReceivables[0]?.total || 0;

    const invoicesCount = await Invoice.countDocuments();
    const paymentsCount = await PaymentTransaction.countDocuments();
    const overdueCount = await Invoice.countDocuments({ status: 'Overdue' });

    res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        mrr,
        outstandingReceivables: receivables,
        totalRefunds: totalRefunds[0]?.total || 0,
        invoicesCount,
        paymentsCount,
        overdueCount,
        monthlyTrend: [
          { month: 'Jan', revenue: 4200, expenses: 1100 },
          { month: 'Feb', revenue: 5800, expenses: 1400 },
          { month: 'Mar', revenue: 7400, expenses: 1800 },
          { month: 'Apr', revenue: 8900, expenses: 2100 },
          { month: 'May', revenue: 11200, expenses: 2600 },
          { month: 'Jun', revenue: totalRevenue > 0 ? totalRevenue : 14500, expenses: 3100 },
        ],
        categoryBreakdown: [
          { name: 'Fishing Essentials', percentage: 40, amount: Math.round(totalRevenue * 0.4) },
          { name: 'Offshore & Deep Sea', percentage: 30, amount: Math.round(totalRevenue * 0.3) },
          { name: 'Kayak & Boating', percentage: 15, amount: Math.round(totalRevenue * 0.15) },
          { name: 'Junior Angler', percentage: 15, amount: Math.round(totalRevenue * 0.15) },
        ],
      },
    });
  } catch (err) {
    next(err);
  }
};
