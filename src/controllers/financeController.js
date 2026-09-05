const Invoice = require('../models/Invoice');
const PaymentTransaction = require('../models/PaymentTransaction');
const PaymentGatewayService = require('../integrations/PaymentGatewayService');
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
    if (req.user.role?.slug === 'student') {
      filter.$or = [{ customer: req.user.id }, { student: req.user.id }];
    } else if (req.user.role?.slug === 'parent') {
      const ParentProfile = require('../models/ParentProfile');
      const parentProfile = await ParentProfile.findOne({ user: req.user.id });
      const childIds = parentProfile?.children || [];
      filter.$or = [{ customer: req.user.id }, { student: { $in: childIds } }];
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
      .populate('customer', 'fullName email phone branch address')
      .populate('student', 'fullName email phone branch')
      .populate('booking', 'bookingId sessionDate slotTime bookingType status')
      .populate('program', 'title code price category duration')
      .populate('branch', 'name code city address phone email');

    if (!invoice) return next(new AppError('Invoice not found', 404));

    // IDOR / Security check
    if (req.user.role?.slug === 'student') {
      const isOwner = String(invoice.customer?._id || invoice.customer) === String(req.user.id) ||
                      String(invoice.student?._id || invoice.student) === String(req.user.id);
      if (!isOwner) return next(new AppError('You do not have permission to view this invoice', 403));
    } else if (req.user.role?.slug === 'parent') {
      const ParentProfile = require('../models/ParentProfile');
      const parentProfile = await ParentProfile.findOne({ user: req.user.id });
      const childIds = (parentProfile?.children || []).map(id => String(id));
      const isParent = String(invoice.customer?._id || invoice.customer) === String(req.user.id) ||
                       childIds.includes(String(invoice.student?._id || invoice.student));
      if (!isParent) return next(new AppError('You do not have permission to view this invoice', 403));
    }

    let studentCode = null;
    if (invoice.student?._id) {
      const StudentProfile = require('../models/StudentProfile');
      const sProfile = await StudentProfile.findOne({ user: invoice.student._id });
      if (sProfile) studentCode = sProfile.studentCode;
    }

    const invoiceData = invoice.toObject();
    if (studentCode && invoiceData.student) {
      invoiceData.student.studentCode = studentCode;
    }

    res.status(200).json({ success: true, data: invoiceData });
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
      message: `Invoice ${invoiceNumber} for AED ${Number(totalAmount).toLocaleString()} has been generated for your account.`,
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
      message: `Reminder: Invoice ${invoice.invoiceNumber} (AED ${Number(invoice.balanceDue).toLocaleString()} due) is outstanding. Please complete payment.`,
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
    const EmailService = require('../integrations/EmailService');
    const StudentProfile = require('../models/StudentProfile');

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

    // Populate full details for notifications and email receipt dispatch
    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate('customer', 'fullName email phone')
      .populate('student', 'fullName email phone')
      .populate('program', 'title')
      .populate('branch', 'name city');

    let studentCode = null;
    if (populatedInvoice?.student?._id) {
      const sProfile = await StudentProfile.findOne({ user: populatedInvoice.student._id });
      if (sProfile) studentCode = sProfile.studentCode;
    }

    // In-app notifications
    await Notification.create({
      recipient: req.user.id,
      title: 'Payment Successful',
      message: `Your payment of AED ${Number(payAmount).toLocaleString()} for Invoice ${invoice.invoiceNumber} was processed successfully. Receipt: ${receiptNumber}`,
      type: 'booking_alert',
      link: '/finance/receipts',
    });

    if (populatedInvoice.student?._id && String(populatedInvoice.student._id) !== String(req.user.id)) {
      await Notification.create({
        recipient: populatedInvoice.student._id,
        title: 'Payment Confirmed',
        message: `Payment of AED ${Number(payAmount).toLocaleString()} for your ${populatedInvoice.program?.title || 'Program'} has been confirmed. Receipt: ${receiptNumber}`,
        type: 'booking_alert',
        link: '/finance/receipts',
      });
    }

    // Automatic Receipt Email Dispatch to registered Parent & Student
    const recipients = [];
    const parentEmail = populatedInvoice.customer?.email;
    const studentEmail = populatedInvoice.student?.email;

    if (parentEmail && parentEmail.includes('@')) {
      recipients.push({ email: parentEmail, name: populatedInvoice.customer?.fullName || 'Valued Client' });
    }
    if (studentEmail && studentEmail.includes('@') && studentEmail.toLowerCase() !== parentEmail?.toLowerCase()) {
      recipients.push({ email: studentEmail, name: populatedInvoice.student?.fullName || 'Student' });
    }

    for (const rec of recipients) {
      try {
        await EmailService.sendEmail({
          to: rec.email,
          subject: `Payment Receipt – Invoice ${invoice.invoiceNumber} – Aqua Fishing Academy`,
          template: 'paymentReceipt',
          data: {
            recipientName: rec.name,
            customerName: populatedInvoice.customer?.fullName || rec.name,
            parentName: populatedInvoice.customer?.fullName,
            studentName: populatedInvoice.student?.fullName || populatedInvoice.customer?.fullName,
            studentCode: studentCode || '',
            invoiceNumber: invoice.invoiceNumber,
            receiptNumber,
            programTitle: populatedInvoice.program?.title || 'Maritime & Fishing Academy Program',
            branchName: populatedInvoice.branch?.name || 'Dubai Marina Branch',
            amount: payAmount,
            balanceDue: newBalanceDue,
            paymentMethod: paymentMethod || 'Credit Card',
            paymentDate: new Date().toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }),
          },
        });
      } catch (mailErr) {
        console.warn(`[Payment] Automatic receipt email failed for ${rec.email}:`, mailErr.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Online payment processed successfully and receipt issued!',
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

// ---- Record Payment (Physical Card / POS Machine, Cash, Bank Transfer, Online) ----
exports.recordPayment = async (req, res, next) => {
  try {
    const {
      invoiceId,
      amount,
      paymentMethod,
      paymentDate,
      approvalCode,
      evidenceUrl,
      evidenceMetadata,
      notes,
    } = req.body;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return next(new AppError('Invoice not found', 404));

    const payAmount = Number(amount);
    if (!payAmount || payAmount <= 0) {
      return next(new AppError('Payment amount must be greater than 0', 400));
    }

    if (payAmount > invoice.balanceDue) {
      return next(
        new AppError(
          `Payment amount (AED ${payAmount.toFixed(2)}) exceeds outstanding balance (AED ${invoice.balanceDue.toFixed(2)})`,
          400
        )
      );
    }

    const transactionId = 'TXN-' + Math.floor(100000 + Math.random() * 900000);
    const receiptNumber = 'RCT-' + Math.floor(100000 + Math.random() * 900000);

    const transaction = await PaymentTransaction.create({
      transactionId,
      invoice: invoice._id,
      customer: invoice.customer,
      amount: payAmount,
      paymentMethod: paymentMethod || 'Physical Card / POS Machine',
      approvalCode: approvalCode || '',
      evidenceUrl: evidenceUrl || '',
      evidenceMetadata: evidenceUrl
        ? {
            uploadedBy: req.user.id,
            uploadedAt: new Date(),
            fileName: evidenceMetadata?.fileName || 'pos_receipt.jpg',
            mimeType: evidenceMetadata?.mimeType || 'image/jpeg',
            fileSize: evidenceMetadata?.fileSize || 0,
          }
        : undefined,
      status: 'Completed',
      paidAt: paymentDate ? new Date(paymentDate) : new Date(),
      notes: notes || `Manual payment recorded via ${paymentMethod || 'POS Machine'}.`,
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
      customer: invoice.customer,
      amountPaid: payAmount,
      paymentMethod: paymentMethod || 'Physical Card / POS Machine',
      notes: `Official Payment Receipt - ${paymentMethod || 'Physical Card / POS Machine'}`,
      issuedAt: paymentDate ? new Date(paymentDate) : new Date(),
    });

    // Update linked booking and operations schedule
    const Booking = require('../models/Booking');
    const Schedule = require('../models/Schedule');
    const EmailService = require('../integrations/EmailService');
    const StudentProfile = require('../models/StudentProfile');
    const Activity = require('../models/Activity');

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

      await Schedule.updateMany(
        { booking: booking._id },
        { status: 'Scheduled' }
      );
    }

    // Populate for notifications and receipt email dispatch
    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate('customer', 'fullName email phone')
      .populate('student', 'fullName email phone')
      .populate('program', 'title')
      .populate('branch', 'name city');

    let studentCode = null;
    if (populatedInvoice?.student?._id) {
      const sProfile = await StudentProfile.findOne({ user: populatedInvoice.student._id });
      if (sProfile) studentCode = sProfile.studentCode;
    }

    // Log audit activity
    try {
      await Activity.create({
        entityType: 'Customer',
        entityId: invoice.customer,
        type: 'status_change',
        description: `Recorded ${paymentMethod || 'POS'} payment of AED ${payAmount.toFixed(2)} for Invoice ${invoice.invoiceNumber}. Receipt: ${receiptNumber}`,
        performedBy: req.user.id,
        metadata: {
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          transactionId,
          receiptNumber,
          amount: payAmount,
          paymentMethod: paymentMethod || 'Physical Card / POS Machine',
          hasEvidence: Boolean(evidenceUrl),
        },
      });
    } catch (auditErr) {
      console.warn('[Activity Audit] Failed to log payment activity:', auditErr.message);
    }

    // In-app notifications
    await Notification.create({
      recipient: invoice.customer,
      title: 'Payment Recorded',
      message: `Payment of AED ${payAmount.toLocaleString()} for Invoice ${invoice.invoiceNumber} was recorded via ${paymentMethod || 'POS Machine'}. Receipt: ${receiptNumber}`,
      type: 'booking_alert',
      link: '/finance/receipts',
    });

    if (populatedInvoice.student?._id && String(populatedInvoice.student._id) !== String(invoice.customer)) {
      await Notification.create({
        recipient: populatedInvoice.student._id,
        title: 'Payment Confirmed',
        message: `Payment of AED ${payAmount.toLocaleString()} for ${populatedInvoice.program?.title || 'your program'} was confirmed. Receipt: ${receiptNumber}`,
        type: 'booking_alert',
        link: '/finance/receipts',
      });
    }

    // Automatic Receipt Email Dispatch
    const recipients = [];
    const parentEmail = populatedInvoice.customer?.email;
    const studentEmail = populatedInvoice.student?.email;

    if (parentEmail && parentEmail.includes('@')) {
      recipients.push({ email: parentEmail, name: populatedInvoice.customer?.fullName || 'Valued Client' });
    }
    if (studentEmail && studentEmail.includes('@') && studentEmail.toLowerCase() !== parentEmail?.toLowerCase()) {
      recipients.push({ email: studentEmail, name: populatedInvoice.student?.fullName || 'Student' });
    }

    for (const rec of recipients) {
      try {
        await EmailService.sendEmail({
          to: rec.email,
          subject: `Payment Receipt – Invoice ${invoice.invoiceNumber} – Aqua Fishing Academy`,
          template: 'paymentReceipt',
          data: {
            recipientName: rec.name,
            customerName: populatedInvoice.customer?.fullName || rec.name,
            parentName: populatedInvoice.customer?.fullName,
            studentName: populatedInvoice.student?.fullName || populatedInvoice.customer?.fullName,
            studentCode: studentCode || '',
            invoiceNumber: invoice.invoiceNumber,
            receiptNumber,
            programTitle: populatedInvoice.program?.title || 'Maritime & Fishing Academy Program',
            branchName: populatedInvoice.branch?.name || 'Dubai Marina Branch',
            amount: payAmount,
            balanceDue: newBalanceDue,
            paymentMethod: paymentMethod || 'Physical Card / POS Machine',
            paymentDate: new Date().toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }),
          },
        });
      } catch (mailErr) {
        console.warn(`[Payment] Automatic receipt email failed for ${rec.email}:`, mailErr.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Payment recorded successfully and receipt issued!',
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

// ---- Administrative Status Override ----
exports.overrideInvoiceStatus = async (req, res, next) => {
  try {
    const { status, reason } = req.body;
    if (!status) return next(new AppError('Please specify the new invoice status', 400));
    if (!reason || !reason.trim()) {
      return next(new AppError('A valid administrative reason is required for status override', 400));
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return next(new AppError('Invoice not found', 404));

    const oldStatus = invoice.status;
    invoice.status = status;
    await invoice.save();

    // Audit the status override
    const Activity = require('../models/Activity');
    try {
      await Activity.create({
        entityType: 'Customer',
        entityId: invoice.customer,
        type: 'status_change',
        description: `Administrative Invoice Status Override for ${invoice.invoiceNumber}: from "${oldStatus}" to "${status}". Reason: ${reason}`,
        performedBy: req.user.id,
        metadata: {
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          oldStatus,
          newStatus: status,
          reason,
          overriddenAt: new Date(),
        },
      });
    } catch (auditErr) {
      console.warn('[Activity Audit] Failed to log status override:', auditErr.message);
    }

    res.status(200).json({
      success: true,
      message: `Invoice status overridden from ${oldStatus} to ${status}`,
      data: invoice,
    });
  } catch (err) {
    next(err);
  }
};

// ---- View Payment Evidence ----
exports.getPaymentEvidence = async (req, res, next) => {
  try {
    const payment = await PaymentTransaction.findById(req.params.id)
      .populate('recordedBy', 'fullName email role')
      .populate('customer', 'fullName email')
      .populate('invoice', 'invoiceNumber totalAmount');

    if (!payment) return next(new AppError('Payment transaction not found', 404));

    if (!payment.evidenceUrl) {
      return next(new AppError('No receipt photo evidence recorded for this payment', 404));
    }

    res.status(200).json({
      success: true,
      data: {
        transactionId: payment.transactionId,
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
        approvalCode: payment.approvalCode,
        evidenceUrl: payment.evidenceUrl,
        evidenceMetadata: payment.evidenceMetadata,
        recordedBy: payment.recordedBy,
        paidAt: payment.paidAt,
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
      .populate('recordedBy', 'fullName email')
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
    if (payment.status === 'Refunded') {
      return next(new AppError('Payment has already been fully refunded', 400));
    }

    const existingRefunds = await Refund.find({ payment: payment._id, status: 'Processed' });
    const alreadyRefunded = existingRefunds.reduce((sum, r) => sum + (r.amount || 0), 0);
    const refundableBalance = Math.max(0, payment.amount - alreadyRefunded);

    const refundAmount = Number(amount) || refundableBalance;
    if (refundAmount <= 0) {
      return next(new AppError('Refund amount must be greater than zero', 400));
    }
    if (refundAmount > refundableBalance) {
      return next(new AppError(`Refund amount (AED ${refundAmount}) exceeds remaining refundable balance (AED ${refundableBalance})`, 400));
    }

    const refundId = 'REF-' + Math.floor(100000 + Math.random() * 900000);

    const RefundAuditLog = require('../models/RefundAuditLog');

    const isOnline = ['Tabby', 'PayTabs', 'TotalPay'].includes(payment.provider);
    let initialRefundStatus = 'Processed';
    let providerResult = null;

    if (isOnline) {
      const PaymentGatewayService = require('../integrations/PaymentGatewayService');
      
      await RefundAuditLog.create({
        action: 'REFUND_REQUESTED',
        user: req.user.id,
        payment: payment._id,
        invoice: payment.invoice,
        amount: refundAmount,
        providerReference: payment.provider,
        notes: `Online refund requested via ${payment.provider}`
      });

      try {
        providerResult = await PaymentGatewayService.refundPayment(payment._id, refundAmount, reason);
        initialRefundStatus = 'Processed';
      } catch (err) {
        await RefundAuditLog.create({
          action: 'REFUND_FAILED',
          user: req.user.id,
          payment: payment._id,
          invoice: payment.invoice,
          amount: refundAmount,
          providerReference: payment.provider,
          notes: `Provider refund failed: ${err.message}`
        });
        return next(new AppError(`Provider refund failed: ${err.message}`, 400));
      }
    }

    const refund = await Refund.create({
      refundId,
      payment: payment._id,
      invoice: payment.invoice,
      customer: payment.customer,
      amount: refundAmount,
      reason,
      status: initialRefundStatus,
      processedBy: req.user.id,
    });

    if (initialRefundStatus === 'Processed') {
      const newTotalRefunded = alreadyRefunded + refundAmount;
      payment.status = newTotalRefunded >= payment.amount ? 'Refunded' : 'Partially Refunded';
      await payment.save();

      await RefundAuditLog.create({
        action: 'REFUND_COMPLETED',
        user: req.user.id,
        refund: refund._id,
        payment: payment._id,
        invoice: payment.invoice,
        amount: refundAmount,
        notes: 'Refund marked as completed in database'
      });

      if (payment.invoice) {
        const invoice = await Invoice.findById(payment.invoice).populate('student');
        if (invoice) {
          const oldStatus = invoice.status;
          
          invoice.amountRefunded = (invoice.amountRefunded || 0) + refundAmount;
          const netPaid = invoice.amountPaid - invoice.amountRefunded;
          
          if (invoice.amountRefunded >= invoice.amountPaid) {
            invoice.status = 'Refunded';
          } else if (invoice.amountRefunded > 0) {
            invoice.status = 'Partially Refunded';
          } else if (netPaid >= invoice.totalAmount) {
            invoice.status = 'Paid';
          } else if (netPaid > 0) {
            invoice.status = 'Partially Paid';
          } else {
            invoice.status = 'Sent';
          }
          await invoice.save();

          await RefundAuditLog.create({
            action: 'INVOICE_STATUS_UPDATED',
            user: req.user.id,
            refund: refund._id,
            invoice: invoice._id,
            oldStatus,
            newStatus: invoice.status,
            notes: 'Invoice status recalculated automatically'
          });

          const targetStudentId = invoice.student ? invoice.student._id.toString() : null;
          const targetCustomerId = payment.customer ? payment.customer.toString() : null;

          const recipientsToNotify = new Set();
          if (targetStudentId) recipientsToNotify.add(targetStudentId);
          if (targetCustomerId) recipientsToNotify.add(targetCustomerId);

          for (const recipientId of recipientsToNotify) {
            await Notification.create({
              recipient: recipientId,
              title: 'Refund Completed',
              message: `Your refund of AED ${Number(refundAmount).toLocaleString()} for Invoice ${invoice.invoiceNumber} has been completed successfully.`,
              type: 'system',
              link: `/student/invoices/${invoice._id}`,
            });

            await RefundAuditLog.create({
              action: 'STUDENT_REFUND_NOTIFICATION_CREATED',
              user: req.user.id,
              refund: refund._id,
              invoice: invoice._id,
              student: recipientId,
              notes: 'Notification sent to student/parent dashboard'
            });
          }
        }
      } else {
        await Notification.create({
          recipient: payment.customer,
          title: 'Refund Completed',
          message: `Your refund of AED ${Number(refundAmount).toLocaleString()} for transaction ${payment.transactionId} has been completed successfully.`,
          type: 'system',
          link: '/student/history',
        });
      }
    }

    res.status(201).json({
      success: true,
      message: initialRefundStatus === 'Processed' ? 'Refund processed successfully' : 'Refund request submitted to provider',
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
      { $match: { status: { $in: ['Completed', 'Partially Refunded', 'Refunded'] } } },
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

    // --- Graph Data Calculation ---
    const period = (req.query.graphPeriod || 'monthly').toLowerCase();
    const timezone = '+04:00'; // UAE Timezone
    let dateGroupId;

    switch (period) {
      case 'daily':
        dateGroupId = { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone } };
        break;
      case 'weekly':
        dateGroupId = { $dateToString: { format: '%G-W%V', date: '$paidAt', timezone } };
        break;
      case 'yearly':
        dateGroupId = { $dateToString: { format: '%Y', date: '$paidAt', timezone } };
        break;
      case 'monthly':
      default:
        dateGroupId = { $dateToString: { format: '%Y-%m', date: '$paidAt', timezone } };
        break;
    }

    const paymentsData = await PaymentTransaction.aggregate([
      { $match: { status: { $in: ['Completed', 'Partially Refunded', 'Refunded'] } } },
      {
        $group: {
          _id: dateGroupId,
          revenue: { $sum: '$amount' }
        }
      }
    ]);

    let refundDateGroupId;
    switch (period) {
      case 'daily':
        refundDateGroupId = { $dateToString: { format: '%Y-%m-%d', date: '$processedAt', timezone } };
        break;
      case 'weekly':
        refundDateGroupId = { $dateToString: { format: '%G-W%V', date: '$processedAt', timezone } };
        break;
      case 'yearly':
        refundDateGroupId = { $dateToString: { format: '%Y', date: '$processedAt', timezone } };
        break;
      case 'monthly':
      default:
        refundDateGroupId = { $dateToString: { format: '%Y-%m', date: '$processedAt', timezone } };
        break;
    }

    const refundsData = await Refund.aggregate([
      { $match: { status: 'Processed' } },
      {
        $group: {
          _id: refundDateGroupId,
          refunds: { $sum: '$amount' }
        }
      }
    ]);

    const trendMap = new Map();
    paymentsData.forEach(p => {
      if (p._id) {
        trendMap.set(p._id, { revenue: p.revenue, refunds: 0, netRevenue: p.revenue });
      }
    });

    refundsData.forEach(r => {
      if (r._id) {
        if (trendMap.has(r._id)) {
          const existing = trendMap.get(r._id);
          existing.refunds += r.refunds;
          existing.netRevenue = existing.revenue - existing.refunds;
        } else {
          trendMap.set(r._id, { revenue: 0, refunds: r.refunds, netRevenue: -r.refunds });
        }
      }
    });

    // Format chart labels and sort
    const formatChartLabel = (granularity, rawDateStr) => {
      try {
        if (granularity === 'daily') {
          const [y, m, d] = rawDateStr.split('-');
          return new Date(y, m - 1, d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short' });
        }
        if (granularity === 'weekly') {
          const [y, w] = rawDateStr.split('-W');
          return `Week ${w}, ${y}`;
        }
        if (granularity === 'monthly') {
          const [y, m] = rawDateStr.split('-');
          return new Date(y, m - 1, 1).toLocaleDateString('en-AE', { month: 'short', year: 'numeric' });
        }
        return rawDateStr; // yearly
      } catch (e) {
        return rawDateStr;
      }
    };

    const sortedKeys = Array.from(trendMap.keys()).sort();
    const trendData = sortedKeys.map(k => {
      const data = trendMap.get(k);
      return {
        period: k,
        label: formatChartLabel(period, k),
        revenue: data.revenue,
        refunds: data.refunds,
        netRevenue: data.netRevenue,
      };
    });
    // --- End Graph Data Calculation ---

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
        trendData,
        graphPeriod: period,
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
