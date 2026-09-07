const mongoose = require('mongoose');
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
      .populate('student', 'fullName email phone studentCode')
      .populate('invoicedBy', 'fullName email role')
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
      .populate('student', 'fullName email phone branch studentCode')
      .populate('invoicedBy', 'fullName email role')
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
    const {
      customerId,
      studentId,
      invoicedById,
      customInvoiceNumber,
      invoiceNumber: reqInvoiceNumber,
      issuedDate,
      dueDate,
      lineItems,
      coupon,
      roundingAdjustment,
      programId,
      branchId,
      taxRate,
      discount,
      notes,
    } = req.body;

    // Student / Customer resolution
    const targetStudentId = studentId || customerId;
    if (!targetStudentId) {
      return next(new AppError('Please select a student to invoice', 400));
    }

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return next(new AppError('Please add at least one line item to the invoice', 400));
    }

    // Resolve Customer / Payer:
    let targetCustomerId = customerId;
    if (!targetCustomerId) {
      const ParentProfile = require('../models/ParentProfile');
      const parentProfile = await ParentProfile.findOne({ children: targetStudentId }).lean();
      if (parentProfile && parentProfile.user) {
        targetCustomerId = parentProfile.user;
      } else {
        targetCustomerId = targetStudentId;
      }
    }

    // Invoice number generation
    let finalInvoiceNumber = (customInvoiceNumber || reqInvoiceNumber || '').trim();
    if (!finalInvoiceNumber) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      finalInvoiceNumber = `AFA-${randomSuffix}`;
      let exists = await Invoice.findOne({ invoiceNumber: finalInvoiceNumber });
      while (exists) {
        const nextSuffix = Math.floor(1000 + Math.random() * 9000);
        finalInvoiceNumber = `AFA-${nextSuffix}`;
        exists = await Invoice.findOne({ invoiceNumber: finalInvoiceNumber });
      }
    } else {
      const exists = await Invoice.findOne({ invoiceNumber: finalInvoiceNumber });
      if (exists) {
        return next(new AppError(`Invoice number ${finalInvoiceNumber} already exists. Please use a unique number.`, 400));
      }
    }

    // Parse and compute line items
    let subtotal = 0;
    let totalItemDiscounts = 0;
    let totalTaxAmount = 0;

    const computedItems = lineItems.map((item, idx) => {
      const title = (item.item || item.description || `Item #${idx + 1}`).trim();
      const desc = (item.description || '').trim();
      const qty = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
      const baseAmount = qty * unitPrice;
      subtotal += baseAmount;

      // Item discount
      let itemDiscAmount = 0;
      let discType = 'fixed';
      let discValue = 0;
      if (item.discount) {
        if (typeof item.discount === 'object') {
          discType = item.discount.type === 'percentage' ? 'percentage' : 'fixed';
          discValue = Math.max(0, Number(item.discount.value) || 0);
          if (discType === 'percentage') {
            itemDiscAmount = (baseAmount * Math.min(100, discValue)) / 100;
          } else {
            itemDiscAmount = Math.min(baseAmount, discValue);
          }
        } else {
          discValue = Math.max(0, Number(item.discount) || 0);
          itemDiscAmount = Math.min(baseAmount, discValue);
        }
      }
      totalItemDiscounts += itemDiscAmount;

      // Item tax
      let itemTaxRate = 0;
      if (item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== '') {
        itemTaxRate = Math.max(0, Number(item.taxRate) || 0);
      } else if (taxRate !== undefined && taxRate !== null && taxRate !== '') {
        itemTaxRate = Math.max(0, Number(taxRate) || 0);
      }
      const taxableAmount = Math.max(0, baseAmount - itemDiscAmount);
      const itemTaxAmount = (taxableAmount * itemTaxRate) / 100;
      totalTaxAmount += itemTaxAmount;

      const finalItemAmount = Math.max(0, taxableAmount + itemTaxAmount);

      return {
        item: title,
        description: desc,
        quantity: qty,
        unitPrice,
        amount: finalItemAmount,
        discount: {
          type: discType,
          value: discValue,
          amount: itemDiscAmount,
        },
        validity: item.validity ? new Date(item.validity) : null,
        taxRate: itemTaxRate,
        taxAmount: itemTaxAmount,
        program: item.program || null,
      };
    });

    // Form-wide discount if any
    const extraDiscount = Math.max(0, Number(discount) || 0);
    const allDiscounts = totalItemDiscounts + extraDiscount;

    // Coupon calculation
    let couponDiscount = 0;
    let couponCode = '';
    if (coupon && typeof coupon === 'object') {
      couponCode = (coupon.code || '').trim();
      couponDiscount = Math.max(0, Number(coupon.discountAmount) || 0);
    } else if (typeof coupon === 'string' && coupon.trim()) {
      couponCode = coupon.trim();
    }

    const totalExcludingTax = Math.max(0, subtotal - allDiscounts - couponDiscount);
    const rounding = Number(roundingAdjustment) || 0;
    const totalAmount = Math.max(0, totalExcludingTax + totalTaxAmount + rounding);

    // Invoiced By
    const invoicedByStaff = invoicedById || req.user.id;

    // Dates
    const finalIssueDate = issuedDate ? new Date(issuedDate) : new Date();
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(finalIssueDate.getTime() + 15 * 86400000);

    const invoice = await Invoice.create({
      invoiceNumber: finalInvoiceNumber,
      customer: targetCustomerId,
      student: targetStudentId,
      invoicedBy: invoicedByStaff,
      program: programId || null,
      branch: branchId || req.user.branch || null,
      lineItems: computedItems,
      subtotal,
      totalExcludingTax,
      taxRate: Number(taxRate) >= 0 ? Number(taxRate) : 0,
      taxAmount: totalTaxAmount,
      discount: allDiscounts,
      coupon: {
        code: couponCode,
        discountAmount: couponDiscount,
      },
      roundingAdjustment: rounding,
      totalAmount,
      balanceDue: totalAmount,
      amountPaid: 0,
      status: 'Sent',
      issuedDate: finalIssueDate,
      dueDate: finalDueDate,
      notes: notes || 'Thank you for choosing Aqua Fishing Academy.',
      createdBy: req.user.id,
    });

    const populated = await Invoice.findById(invoice._id)
      .populate('customer', 'fullName email phone studentCode')
      .populate('student', 'fullName email phone studentCode')
      .populate('invoicedBy', 'fullName email role')
      .populate('program', 'title')
      .populate('branch', 'name');

    // Notify customer
    try {
      await Notification.create({
        recipient: targetCustomerId,
        title: 'New Invoice Issued',
        message: `Invoice ${finalInvoiceNumber} for AED ${Number(totalAmount).toLocaleString()} has been generated for your account.`,
        type: 'system',
        link: '/finance/invoices',
      });
    } catch (notifErr) {
      console.warn('Could not create invoice notification:', notifErr.message);
    }

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
    if (status === 'Paid' && invoice.balanceDue > 0) {
      const payAmount = invoice.balanceDue;
      invoice.amountPaid = invoice.totalAmount;
      invoice.balanceDue = 0;
      await invoice.save();

      // Create recorded PaymentTransaction so it is auditable and refundable
      await PaymentTransaction.create({
        transactionId: 'TXN-ADM-' + Math.floor(100000 + Math.random() * 900000),
        invoice: invoice._id,
        customer: invoice.customer,
        amount: payAmount,
        paymentMethod: 'Bank Transfer',
        approvalCode: 'ADMIN_OVERRIDE',
        status: 'Completed',
        notes: `Administrative payment recorded on status override to Paid. Reason: ${reason}`,
        recordedBy: req.user.id,
        paidAt: new Date(),
      });
    } else {
      await invoice.save();
    }

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

// ---- Eligible Refund Transactions ----
exports.getEligibleRefundTransactions = async (req, res, next) => {
  try {
    const { search, branch, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const cleanSearch = (search || '').trim();

    // 1. Backfill any historical 'Paid' / 'Partially Paid' invoices that lack a PaymentTransaction
    const paidInvoicesWithoutTxn = await Invoice.find({
      status: { $in: ['Paid', 'Partially Paid'] },
      amountPaid: { $gt: 0 },
    }).lean();

    for (const inv of paidInvoicesWithoutTxn) {
      const exists = await PaymentTransaction.findOne({ invoice: inv._id });
      if (!exists) {
        await PaymentTransaction.create({
          transactionId: 'TXN-REC-' + Math.floor(100000 + Math.random() * 900000),
          invoice: inv._id,
          customer: inv.customer,
          amount: inv.amountPaid || inv.totalAmount,
          paymentMethod: 'Bank Transfer',
          status: 'Completed',
          approvalCode: 'AUTO_RECONCILED',
          notes: `Reconciled transaction for paid invoice ${inv.invoiceNumber}`,
          paidAt: inv.updatedAt || inv.createdAt || new Date(),
        });
      }
    }

    // 2. Query eligible payment transactions
    const paymentFilter = {
      status: { $in: ['Completed', 'Partially Refunded', 'Succeeded', 'Settled'] },
    };

    // RBAC customer/student/parent scoping
    if (req.user.role?.slug === 'student') {
      paymentFilter.$or = [{ customer: req.user.id }];
    } else if (req.user.role?.slug === 'parent') {
      const ParentProfile = require('../models/ParentProfile');
      const pProfile = await ParentProfile.findOne({ user: req.user.id }).lean();
      const childIds = pProfile?.children || [];
      paymentFilter.customer = { $in: [req.user.id, ...childIds] };
    }

    // Branch scoping
    const isSuperAdmin = ['super-admin', 'super_admin', 'admin'].includes(req.user.role?.slug);
    if (branch) {
      const branchInvoices = await Invoice.find({ branch }).select('_id').lean();
      paymentFilter.invoice = { $in: branchInvoices.map((b) => b._id) };
    } else if (
      !isSuperAdmin &&
      req.user.branch &&
      req.user.branch !== 'All Branches' &&
      req.user.branch !== 'Main Branch'
    ) {
      const branchInvoices = await Invoice.find({ branch: req.user.branch }).select('_id').lean();
      paymentFilter.invoice = { $in: branchInvoices.map((b) => b._id) };
    }

    // 3. Dynamic Server-Side Search Filtering across real relationships
    if (cleanSearch) {
      const ParentProfile = require('../models/ParentProfile');
      const escaped = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');

      // A. Search Users by name, code, phone, email
      const matchedUsers = await User.find({
        $or: [
          { fullName: searchRegex },
          { studentCode: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
        ],
      })
        .select('_id fullName')
        .lean();

      const matchedUserObjectIds = matchedUsers.map((u) => u._id);

      // B. Resolve Parent-Child Relationships (Parent <-> Students)
      const parentProfiles = await ParentProfile.find({
        $or: [{ user: { $in: matchedUserObjectIds } }, { children: { $in: matchedUserObjectIds } }],
      }).lean();

      const allRelatedUserIds = new Set(matchedUserObjectIds.map((id) => id.toString()));
      for (const pp of parentProfiles) {
        if (pp.user) allRelatedUserIds.add(pp.user.toString());
        if (Array.isArray(pp.children)) {
          for (const ch of pp.children) {
            if (ch) allRelatedUserIds.add(ch.toString());
          }
        }
      }
      const relatedUserObjectIds = Array.from(allRelatedUserIds).map((id) =>
        mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
      );

      // C. Search Invoices by invoiceNumber or linked customer/student
      const invoiceSearchFilter = {
        $or: [
          { invoiceNumber: searchRegex },
          { customer: { $in: relatedUserObjectIds } },
          { student: { $in: relatedUserObjectIds } },
        ],
      };
      if (branch) invoiceSearchFilter.branch = branch;

      const matchedInvoices = await Invoice.find(invoiceSearchFilter).select('_id invoiceNumber').lean();
      const matchedInvoiceObjectIds = matchedInvoices.map((inv) => inv._id);

      // D. Combine into PaymentTransaction search clauses
      const searchClauses = [
        { transactionId: searchRegex },
        { approvalCode: searchRegex },
        { gatewayReference: searchRegex },
        { providerSessionId: searchRegex },
        { customer: { $in: relatedUserObjectIds } },
        { invoice: { $in: matchedInvoiceObjectIds } },
      ];

      if (paymentFilter.$or) {
        paymentFilter.$and = [{ $or: paymentFilter.$or }, { $or: searchClauses }];
        delete paymentFilter.$or;
      } else {
        paymentFilter.$or = searchClauses;
      }
    }

    // Fetch payments sorted latest first
    const payments = await PaymentTransaction.find(paymentFilter)
      .populate('customer', 'fullName email phone studentCode')
      .populate({
        path: 'invoice',
        select: 'invoiceNumber totalAmount amountPaid amountRefunded status branch student customer',
        populate: [
          { path: 'student', select: 'fullName email phone studentCode' },
          { path: 'customer', select: 'fullName email phone' },
        ],
      })
      .sort({ paidAt: -1, createdAt: -1 });

    // 4. Pre-fetch all processed refunds for these payments in one batch query
    const paymentIds = payments.map((p) => p._id);
    const allRefunds = await Refund.find({
      payment: { $in: paymentIds },
      status: 'Processed',
    }).lean();

    const refundMap = {};
    for (const r of allRefunds) {
      const pid = r.payment.toString();
      refundMap[pid] = (refundMap[pid] || 0) + (r.amount || 0);
    }

    let eligibleList = [];

    for (const p of payments) {
      const alreadyRefunded = refundMap[p._id.toString()] || 0;
      const remainingRefundable = Math.max(0, p.amount - alreadyRefunded);

      // Strictly exclude fully refunded transactions
      if (remainingRefundable <= 0) continue;

      // Optional branch filter validation
      if (branch && p.invoice?.branch && p.invoice.branch.toString() !== branch.toString()) {
        continue;
      }

      const invNum = p.invoice?.invoiceNumber || 'N/A';
      const custName = p.customer?.fullName || p.invoice?.customer?.fullName || 'N/A';
      const custEmail = p.customer?.email || p.invoice?.customer?.email || '';
      const stuName = p.invoice?.student?.fullName || custName;

      eligibleList.push({
        id: p._id,
        paymentId: p._id,
        transactionId: p.transactionId,
        invoiceId: p.invoice?._id || null,
        invoiceNumber: invNum,
        customerName: custName,
        customerEmail: custEmail,
        studentName: stuName,
        paidAmount: p.amount,
        refundedAmount: alreadyRefunded,
        refundableAmount: remainingRefundable,
        paymentMethod: p.paymentMethod,
        provider: p.provider || 'Manual',
        approvalCode: p.approvalCode || '',
        status: p.status,
        paidAt: p.paidAt || p.createdAt,
        createdAt: p.createdAt,
      });
    }

    // 5. Prioritize exact matches if search is provided
    if (cleanSearch) {
      const qLower = cleanSearch.toLowerCase();
      eligibleList.sort((a, b) => {
        const aExact =
          a.transactionId.toLowerCase() === qLower ||
          a.invoiceNumber.toLowerCase() === qLower ||
          a.customerName.toLowerCase() === qLower;
        const bExact =
          b.transactionId.toLowerCase() === qLower ||
          b.invoiceNumber.toLowerCase() === qLower ||
          b.customerName.toLowerCase() === qLower;

        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return new Date(b.paidAt || b.createdAt) - new Date(a.paidAt || a.createdAt);
      });
    }

    const total = eligibleList.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedData = eligibleList.slice(startIndex, startIndex + limitNum);

    res.status(200).json({
      success: true,
      count: paginatedData.length,
      total,
      page: pageNum,
      limit: limitNum,
      search: cleanSearch,
      data: paginatedData,
    });
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
      .populate('customer', 'fullName email phone studentCode')
      .populate({
        path: 'invoice',
        select: 'invoiceNumber totalAmount subtotal discount coupon roundingAdjustment lineItems issuedDate dueDate student branch customer amountPaid balanceDue',
        populate: [
          { path: 'student', select: 'fullName email phone studentCode' },
          { path: 'customer', select: 'fullName email phone' },
          { path: 'branch', select: 'name city address' },
        ],
      })
      .populate('payment', 'transactionId gatewayReference cardLast4 paymentMethod amount createdAt paidAt status provider approvalCode')
      .sort({ issuedAt: -1 });

    res.status(200).json({ success: true, count: receipts.length, data: receipts });
  } catch (err) {
    next(err);
  }
};

exports.getReceiptById = async (req, res, next) => {
  try {
    const receipt = await Receipt.findById(req.params.id)
      .populate('customer', 'fullName email phone studentCode')
      .populate({
        path: 'invoice',
        select: 'invoiceNumber totalAmount subtotal discount coupon roundingAdjustment lineItems issuedDate dueDate student branch customer amountPaid balanceDue',
        populate: [
          { path: 'student', select: 'fullName email phone studentCode' },
          { path: 'customer', select: 'fullName email phone' },
          { path: 'branch', select: 'name city address' },
        ],
      })
      .populate('payment', 'transactionId gatewayReference cardLast4 paymentMethod amount createdAt paidAt status provider approvalCode');

    if (!receipt) {
      return next(new AppError('Payment receipt not found', 404));
    }

    // RBAC check: Student/Parent can only view their own receipt
    if (req.user.role?.slug === 'student' || req.user.role?.slug === 'parent') {
      const isOwner =
        String(receipt.customer?._id || receipt.customer) === String(req.user.id) ||
        String(receipt.invoice?.student?._id || receipt.invoice?.student) === String(req.user.id);
      if (!isOwner) {
        return next(new AppError('You do not have permission to view this receipt', 403));
      }
    }

    res.status(200).json({ success: true, data: receipt });
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
