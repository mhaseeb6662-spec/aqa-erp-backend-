const crypto = require('crypto');
const Notification = require('../models/Notification');
const NotificationTemplate = require('../models/NotificationTemplate');
const ScheduledReminder = require('../models/ScheduledReminder');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const PaymentTransaction = require('../models/PaymentTransaction');
const Schedule = require('../models/Schedule');
const EmailService = require('../integrations/EmailService');
const WhatsAppService = require('../integrations/WhatsAppService');
const IntegrationLog = require('../models/IntegrationLog');
const logActivity = require('../utils/logActivity');

const DEFAULT_TEMPLATES = [
  {
    templateKey: 'BOOKING_CONFIRMED',
    name: 'Booking Confirmation',
    category: 'BOOKING_CONFIRMED',
    subject: 'Booking Confirmed — {{bookingNumber}}',
    inAppBody: 'Your enrollment in {{programName}} (Booking: {{bookingNumber}}) is confirmed for {{sessionDate}} at {{branchName}}.',
    emailHtml: 'bookingConfirmation',
    whatsAppBody: 'Ahlan {{customerName}}, your booking for {{programName}} is confirmed for {{sessionDate}} at {{branchName}}. Booking Ref: {{bookingNumber}}.',
  },
  {
    templateKey: 'PAYMENT_CONFIRMED',
    name: 'Payment Confirmation & Receipt',
    category: 'PAYMENT_CONFIRMED',
    subject: 'Payment Received — Receipt {{receiptNumber}}',
    inAppBody: 'Payment of AED {{amount}} for Invoice {{invoiceNumber}} was successfully processed. Receipt: {{receiptNumber}}.',
    emailHtml: 'paymentReceipt',
    whatsAppBody: 'Thank you {{customerName}}. We received your payment of AED {{amount}} for Invoice {{invoiceNumber}}. Receipt: {{receiptNumber}}.',
  },
  {
    templateKey: 'PAYMENT_FAILED',
    name: 'Payment Transaction Failed',
    category: 'PAYMENT_FAILED',
    subject: 'Payment Action Required — Invoice {{invoiceNumber}}',
    inAppBody: 'Your payment of AED {{amount}} for Invoice {{invoiceNumber}} could not be processed. Please retry using the payment link.',
    emailHtml: 'invoiceIssued',
    whatsAppBody: 'Hello {{customerName}}, your payment attempt for Invoice {{invoiceNumber}} (AED {{amount}}) failed. Please retry: {{paymentLink}}.',
  },
  {
    templateKey: 'SESSION_REMINDER',
    name: 'Upcoming Session Reminder (24h)',
    category: 'SESSION_REMINDER',
    subject: 'Upcoming Academy Session Reminder — {{sessionDate}}',
    inAppBody: 'Reminder: Your {{programName}} session is scheduled for tomorrow at {{sessionTime}} ({{branchName}}). Coach: {{coachName}}.',
    emailHtml: 'bookingConfirmation',
    whatsAppBody: 'Reminder {{customerName}}: Your {{programName}} session is scheduled for {{sessionDate}} at {{sessionTime}} at {{branchName}}.',
  },
  {
    templateKey: 'PAYMENT_REMINDER',
    name: 'Invoice Payment Due Reminder',
    category: 'PAYMENT_REMINDER',
    subject: 'Payment Reminder — Invoice {{invoiceNumber}}',
    inAppBody: 'Reminder: Invoice {{invoiceNumber}} for AED {{amount}} is due soon. Click here to view and pay online.',
    emailHtml: 'invoiceIssued',
    whatsAppBody: 'Hello {{customerName}}, this is a friendly reminder that Invoice {{invoiceNumber}} for AED {{amount}} is due. Pay here: {{paymentLink}}.',
  },
  {
    templateKey: 'SCHEDULE_CHANGED',
    name: 'Schedule / Timing Update',
    category: 'SCHEDULE_CHANGED',
    subject: 'Schedule Update — {{programName}}',
    inAppBody: 'Notice: Your session for {{programName}} has been updated to {{sessionDate}} at {{sessionTime}} ({{branchName}}).',
    emailHtml: 'bookingConfirmation',
    whatsAppBody: 'Notice {{customerName}}: Your session for {{programName}} has been updated to {{sessionDate}} at {{sessionTime}}.',
  },
  {
    templateKey: 'CANCELLED',
    name: 'Session or Booking Cancellation',
    category: 'CANCELLED',
    subject: 'Cancellation Notice — {{bookingNumber}}',
    inAppBody: 'Your booking {{bookingNumber}} for {{programName}} has been cancelled. Please contact academy support for assistance.',
    emailHtml: 'bookingConfirmation',
    whatsAppBody: 'Notice {{customerName}}: Your booking {{bookingNumber}} has been cancelled. Support contact: +971 4 000 0000.',
  },
];

class NotificationService {
  /**
   * Replaces variables safely in strings.
   */
  interpolate(templateStr, vars = {}) {
    if (!templateStr) return '';
    return templateStr.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
      return vars[key] !== undefined ? vars[key] : match;
    });
  }

  /**
   * Ensures default templates exist in database.
   */
  async ensureTemplates() {
    for (const t of DEFAULT_TEMPLATES) {
      await NotificationTemplate.findOneAndUpdate(
        { templateKey: t.templateKey },
        { $setOnInsert: t },
        { upsert: true }
      );
    }
  }

  /**
   * Main unified notification dispatch engine.
   */
  async dispatchNotification({
    recipientId,
    type,
    templateKey,
    variables = {},
    relatedRecords = {},
    channels = ['in_app', 'email', 'whatsapp'],
    senderId = null,
  }) {
    const correlationId = crypto.randomUUID();
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      console.warn(`[NotificationService] Recipient ${recipientId} not found. Skipping.`);
      return null;
    }

    // 1. Fetch Template
    let template = await NotificationTemplate.findOne({ templateKey, isActive: true });
    if (!template) {
      await this.ensureTemplates();
      template = await NotificationTemplate.findOne({ templateKey }) || {
        subject: `Notification: ${type}`,
        inAppBody: variables.message || 'You have a new academy notification.',
        whatsAppBody: variables.message || 'Aqua Fishing Academy update.',
      };
    }

    const title = this.interpolate(template.subject, variables);
    const body = this.interpolate(template.inAppBody, variables);
    const whatsAppText = this.interpolate(template.whatsAppBody, variables);

    // 2. Dispatch In-App Notification (Always stored)
    const notification = await Notification.create({
      recipient: recipient._id,
      sender: senderId,
      student: relatedRecords.studentId || null,
      booking: relatedRecords.bookingId || null,
      invoice: relatedRecords.invoiceId || null,
      payment: relatedRecords.paymentId || null,
      schedule: relatedRecords.scheduleId || null,
      title,
      message: body,
      type: type || 'system',
      channels,
      status: 'SENT',
      link: relatedRecords.link || '/notifications',
      metadata: variables,
      sentAt: new Date(),
    });

    // 3. Dispatch Email Channel (if requested & recipient has email)
    if (channels.includes('email') && recipient.email) {
      try {
        const emailRes = await EmailService.sendEmail({
          to: recipient.email,
          subject: title,
          template: template.emailHtml || 'bookingConfirmation',
          data: {
            customerName: recipient.fullName,
            ...variables,
          },
        });
        notification.providerMessageId = emailRes.messageId;
        await notification.save();
      } catch (err) {
        console.error(`[NotificationService] Email delivery failed for ${recipient.email}:`, err.message);
      }
    }

    // 4. Dispatch WhatsApp Channel (if requested & recipient has phone)
    if (channels.includes('whatsapp') && recipient.phone) {
      try {
        await WhatsAppService.sendMessage({
          to: recipient.phone,
          text: whatsAppText,
          customerId: recipient._id,
        });
      } catch (err) {
        console.error(`[NotificationService] WhatsApp delivery failed for ${recipient.phone}:`, err.message);
      }
    }

    // 5. Activity Log
    await logActivity({
      entityType: 'customer',
      entityId: recipient._id,
      type: 'note',
      description: `Notification sent (${type}): "${title}" via [${channels.join(', ')}]`,
    });

    return notification;
  }

  /**
   * Triggered when a booking is confirmed.
   */
  async triggerBookingConfirmed(bookingId) {
    const booking = await Booking.findById(bookingId)
      .populate('student', 'fullName email phone')
      .populate('program', 'title')
      .populate('branch', 'name');

    if (!booking || !booking.student) return;

    const student = booking.student;

    const variables = {
      customerName: student.fullName,
      studentName: student.fullName,
      bookingNumber: booking.bookingId || `BKG-${booking._id.toString().slice(-6).toUpperCase()}`,
      programName: booking.program?.title || 'Fishing Academy Program',
      branchName: booking.branch?.name || 'Dubai Marina',
      sessionDate: booking.sessionDate ? new Date(booking.sessionDate).toLocaleDateString() : 'Scheduled Date',
      sessionTime: booking.slotTime || 'TBD',
    };

    // 1. Dispatch multi-channel confirmation
    const notif = await this.dispatchNotification({
      recipientId: student._id,
      type: 'booking_confirmed',
      templateKey: 'BOOKING_CONFIRMED',
      variables,
      relatedRecords: {
        bookingId: booking._id,
        studentId: student._id,
        link: '/bookings',
      },
      channels: ['in_app', 'email', 'whatsapp'],
    });

    // 2. Automatically schedule Session Reminder (24h before session start)
    if (booking.sessionDate) {
      const sessionDate = new Date(booking.sessionDate);
      const reminderDate = new Date(sessionDate.getTime() - 24 * 60 * 60 * 1000);

      // Only schedule if reminder time is in the future
      if (reminderDate > new Date()) {
        const idempotencyKey = `session_${booking._id}_${student._id}_24h`;

        await ScheduledReminder.findOneAndUpdate(
          { idempotencyKey },
          {
            $set: {
              reminderType: 'session_reminder',
              targetDate: reminderDate,
              recordId: booking._id,
              recordType: 'Booking',
              recipient: student._id,
              channels: ['in_app', 'email', 'whatsapp'],
              status: 'PENDING',
              metadata: variables,
            },
          },
          { upsert: true }
        );
      }
    }

    return notif;
  }

  /**
   * Triggered on verified payment success.
   */
  async triggerPaymentConfirmed(paymentId) {
    const payment = await PaymentTransaction.findById(paymentId)
      .populate('customer', 'fullName email phone')
      .populate('invoice');

    if (!payment || !payment.customer) return;

    const customer = payment.customer;
    const invoice = payment.invoice;

    const variables = {
      customerName: customer.fullName,
      amount: payment.amount?.toLocaleString(),
      invoiceNumber: invoice?.invoiceNumber || 'INV-DIRECT',
      receiptNumber: `RCT-${payment._id.toString().slice(-6).toUpperCase()}`,
      paymentMethod: payment.paymentMethod || 'Online Gateway',
    };

    // 1. Dispatch confirmation & official receipt
    const notif = await this.dispatchNotification({
      recipientId: customer._id,
      type: 'payment_confirmed',
      templateKey: 'PAYMENT_CONFIRMED',
      variables,
      relatedRecords: {
        paymentId: payment._id,
        invoiceId: invoice?._id,
        link: '/finance/invoices',
      },
      channels: ['in_app', 'email', 'whatsapp'],
    });

    // 2. Cancel any pending payment reminders for this invoice
    if (invoice) {
      await this.cancelRemindersForRecord(invoice._id, 'payment_due_reminder');
      await this.cancelRemindersForRecord(invoice._id, 'payment_overdue_reminder');
    }

    return notif;
  }

  /**
   * Triggered on payment failure.
   */
  async triggerPaymentFailed(invoiceId, reason = 'Card declined by issuing bank') {
    const invoice = await Invoice.findById(invoiceId).populate('customer');
    if (!invoice || !invoice.customer) return;

    const customer = invoice.customer;
    const variables = {
      customerName: customer.fullName,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.totalAmount?.toLocaleString(),
      paymentLink: `${process.env.CLIENT_URL || 'http://localhost:5173'}/finance/invoices`,
      failureReason: reason,
    };

    return this.dispatchNotification({
      recipientId: customer._id,
      type: 'payment_failed',
      templateKey: 'PAYMENT_FAILED',
      variables,
      relatedRecords: {
        invoiceId: invoice._id,
        link: '/finance/invoices',
      },
      channels: ['in_app', 'email', 'whatsapp'],
    });
  }

  /**
   * Triggered when a schedule is updated or rescheduled.
   */
  async triggerScheduleChanged(scheduleId, changeNotes = 'Session timing adjusted') {
    const schedule = await Schedule.findById(scheduleId)
      .populate('instructor', 'fullName email phone')
      .populate('program', 'title')
      .populate('branch', 'name');

    if (!schedule) return;

    const variables = {
      programName: schedule.program?.title || 'Academy Charter',
      branchName: schedule.branch?.name || 'Main Marina',
      sessionDate: new Date(schedule.startTime).toLocaleDateString(),
      sessionTime: new Date(schedule.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      coachName: schedule.instructor?.fullName || 'Assigned Instructor',
      notes: changeNotes,
    };

    // 1. Notify Assigned Coach
    if (schedule.instructor) {
      await this.dispatchNotification({
        recipientId: schedule.instructor._id,
        type: 'schedule_changed',
        templateKey: 'SCHEDULE_CHANGED',
        variables: { ...variables, customerName: schedule.instructor.fullName },
        relatedRecords: { scheduleId: schedule._id, link: '/schedule' },
        channels: ['in_app', 'email', 'whatsapp'],
      });
    }

    // 2. Notify Enrolled Bookings
    const bookings = await Booking.find({ schedule: schedule._id }).populate('student');
    for (const b of bookings) {
      if (b.student) {
        await this.dispatchNotification({
          recipientId: b.student._id,
          type: 'schedule_changed',
          templateKey: 'SCHEDULE_CHANGED',
          variables: { ...variables, customerName: b.student.fullName },
          relatedRecords: { scheduleId: schedule._id, bookingId: b._id, link: '/schedule' },
          channels: ['in_app', 'email', 'whatsapp'],
        });
      }
    }
  }

  /**
   * Process all pending scheduled reminders (Runs as cron / background runner).
   */
  async processScheduledReminders() {
    const now = new Date();
    const pendingReminders = await ScheduledReminder.find({
      status: 'PENDING',
      targetDate: { $lte: now },
    }).populate('recipient');

    const results = [];

    for (const r of pendingReminders) {
      try {
        let templateKey = 'SESSION_REMINDER';
        let notifType = 'session_reminder';

        if (r.reminderType === 'payment_due_reminder' || r.reminderType === 'payment_overdue_reminder') {
          templateKey = 'PAYMENT_REMINDER';
          notifType = 'payment_reminder';
        }

        await this.dispatchNotification({
          recipientId: r.recipient._id,
          type: notifType,
          templateKey,
          variables: r.metadata || {},
          relatedRecords: {
            [r.recordType.toLowerCase() + 'Id']: r.recordId,
          },
          channels: r.channels || ['in_app', 'email', 'whatsapp'],
        });

        r.status = 'EXECUTED';
        r.executedAt = new Date();
        await r.save();

        results.push({ id: r._id, status: 'EXECUTED' });
      } catch (err) {
        console.error(`[NotificationService] Error executing reminder ${r._id}:`, err);
        r.status = 'FAILED';
        r.failureReason = err.message;
        await r.save();
      }
    }

    return results;
  }

  /**
   * Cancels obsolete reminders for a record (e.g. invoice paid or booking cancelled).
   */
  async cancelRemindersForRecord(recordId, reminderType) {
    const filter = { recordId, status: 'PENDING' };
    if (reminderType) filter.reminderType = reminderType;

    await ScheduledReminder.updateMany(filter, {
      $set: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }
}

module.exports = new NotificationService();
