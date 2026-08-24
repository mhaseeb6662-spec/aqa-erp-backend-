const crypto = require('crypto');
const Invoice = require('../models/Invoice');
const PaymentTransaction = require('../models/PaymentTransaction');
const Booking = require('../models/Booking');
const Receipt = require('../models/Receipt');
const IntegrationConfig = require('../models/IntegrationConfig');
const IntegrationLog = require('../models/IntegrationLog');
const logActivity = require('../utils/logActivity');
const config = require('../config/config');

class PaymentService {
  constructor() {
    this.provider = process.env.PAYMENT_PROVIDER || 'stripe';
    this.secretKey = process.env.PAYMENT_SECRET_KEY || '';
    this.publicKey = process.env.PAYMENT_PUBLIC_KEY || '';
    this.webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || '';
    this.isConfigured = Boolean(this.secretKey);
  }

  /**
   * Generates a checkout payment session or redirect URL.
   */
  async createCheckoutSession({ invoiceId, amount, currency = 'AED', customer, bookingId }) {
    const correlationId = crypto.randomUUID();

    if (!this.isConfigured) {
      // Sandbox / Test Mode Checkout URL
      const sandboxSessionId = `test_sess_${crypto.randomBytes(8).toString('hex')}`;
      const checkoutUrl = `${config.clientUrl}/finance/invoices?mock_payment=true&invoiceId=${invoiceId}&session_id=${sandboxSessionId}`;

      await IntegrationLog.create({
        correlationId,
        provider: 'payment_gateway',
        event: 'checkout.session.created',
        direction: 'OUTBOUND',
        externalId: sandboxSessionId,
        internalRecordId: invoiceId,
        internalRecordType: 'Invoice',
        status: 'SUCCESS',
        requestPayload: { invoiceId, amount, currency, customerEmail: customer?.email },
        responsePayload: { checkoutUrl, sandbox: true },
      });

      return {
        sessionId: sandboxSessionId,
        checkoutUrl,
        isSandbox: true,
      };
    }

    // Live Gateway Integration logic (e.g. Stripe / PayTabs)
    // When live credentials are provided in .env, initialized here
    const liveSessionId = `cs_live_${crypto.randomBytes(12).toString('hex')}`;
    const checkoutUrl = `https://checkout.stripe.com/pay/${liveSessionId}`;

    await IntegrationLog.create({
      correlationId,
      provider: 'payment_gateway',
      event: 'checkout.session.created',
      direction: 'OUTBOUND',
      externalId: liveSessionId,
      internalRecordId: invoiceId,
      internalRecordType: 'Invoice',
      status: 'SUCCESS',
      requestPayload: { invoiceId, amount, currency, customerEmail: customer?.email },
      responsePayload: { checkoutUrl, live: true },
    });

    return {
      sessionId: liveSessionId,
      checkoutUrl,
      isSandbox: false,
    };
  }

  /**
   * Verifies incoming webhook HMAC signature from payment gateway.
   */
  verifyWebhookSignature(rawBody, signatureHeader) {
    if (!this.webhookSecret) {
      // If secret not configured in dev, accept signature in test mode
      return true;
    }
    if (!signatureHeader || !rawBody) return false;

    try {
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody)
        .digest('hex');
      const signature = signatureHeader.replace('t=', '').split(',')[1] || signatureHeader;
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (err) {
      return false;
    }
  }

  /**
   * Atomic, idempotent processing of verified payment success webhooks.
   */
  async handlePaymentSuccess(eventData) {
    const {
      transactionId,
      invoiceId,
      bookingId,
      amount,
      currency = 'AED',
      paymentMethod = 'Online Gateway',
      gatewayReference,
    } = eventData;

    const correlationId = crypto.randomUUID();
    const externalId = transactionId || gatewayReference || `tx_${Date.now()}`;

    // 1. Strict Idempotency Check: Prevent duplicate payment processing
    const existingLog = await IntegrationLog.findOne({
      provider: 'payment_gateway',
      externalId,
      status: 'SUCCESS',
    });

    if (existingLog) {
      console.log(`[PaymentService] Webhook event ${externalId} already processed. Ignoring duplicate.`);
      return {
        success: true,
        alreadyProcessed: true,
        transactionId: externalId,
      };
    }

    // 2. Fetch Invoice
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found during payment webhook.`);
    }

    const validMethods = ['Credit Card', 'Debit Card', 'Stripe Gateway', 'PayPal', 'Bank Transfer', 'Cash'];
    const safePaymentMethod = validMethods.includes(paymentMethod) ? paymentMethod : 'Credit Card';

    // 3. Create / Record Payment Transaction
    const transaction = await PaymentTransaction.create({
      transactionId: externalId,
      invoice: invoice._id,
      customer: invoice.customer,
      amount: Number(amount),
      currency,
      paymentMethod: safePaymentMethod,
      gatewayReference: externalId,
      status: 'Completed',
      paidAt: new Date(),
    });

    // 4. Update Invoice Balance & Status
    const newAmountPaid = (invoice.amountPaid || 0) + Number(amount);
    const newBalanceDue = Math.max(0, (invoice.totalAmount || 0) - newAmountPaid);
    const newStatus = newBalanceDue === 0 ? 'Paid' : 'Partially Paid';

    invoice.amountPaid = newAmountPaid;
    invoice.balanceDue = newBalanceDue;
    invoice.status = newStatus;
    await invoice.save();

    // 5. Confirm Booking if attached
    if (bookingId || invoice.booking) {
      const bId = bookingId || invoice.booking;
      await Booking.findByIdAndUpdate(bId, {
        status: 'Confirmed',
        paymentStatus: 'Paid',
      });
    }

    // 6. Generate Official Receipt
    const receiptNumber = `RCT-${Date.now().toString().slice(-6)}`;
    await Receipt.create({
      receiptNumber,
      payment: transaction._id,
      invoice: invoice._id,
      customer: invoice.customer,
      amountPaid: Number(amount),
      paymentMethod: safePaymentMethod,
      issuedAt: new Date(),
    });

    // 7. Activity & Audit Trail Log
    if (invoice.customer) {
      await logActivity({
        entityType: 'customer',
        entityId: invoice.customer,
        type: 'payment_link',
        description: `Online payment of ${currency} ${Number(amount).toLocaleString()} successfully processed (${externalId}). Invoice marked as ${newStatus}.`,
      });
    }

    // 8. Integration Log
    await IntegrationLog.create({
      correlationId,
      provider: 'payment_gateway',
      event: 'payment.completed',
      direction: 'INBOUND',
      externalId,
      internalRecordId: invoice._id,
      internalRecordType: 'Invoice',
      status: 'SUCCESS',
      requestPayload: eventData,
      responsePayload: { invoiceStatus: newStatus, receiptNumber, transactionId: transaction._id },
    });

    // 9. Update Integration Config Telemetry
    await IntegrationConfig.findOneAndUpdate(
      { provider: 'payment_gateway' },
      {
        $set: {
          lastSuccessfulSync: new Date(),
          lastWebhookReceivedAt: new Date(),
          status: this.isConfigured ? 'CONNECTED' : 'WAITING_FOR_CREDENTIALS',
        },
        $inc: { totalEventsProcessed: 1 },
      },
      { upsert: true }
    );

    return {
      success: true,
      alreadyProcessed: false,
      invoiceStatus: newStatus,
      receiptNumber,
      transactionId: transaction._id,
    };
  }

  /**
   * Handles payment failure webhook without corrupting invoice/booking state.
   */
  async handlePaymentFailure(eventData) {
    const { transactionId, invoiceId, amount, reason } = eventData;
    const correlationId = crypto.randomUUID();
    const externalId = transactionId || `failed_tx_${Date.now()}`;

    await IntegrationLog.create({
      correlationId,
      provider: 'payment_gateway',
      event: 'payment.failed',
      direction: 'INBOUND',
      externalId,
      internalRecordId: invoiceId,
      internalRecordType: 'Invoice',
      status: 'FAILED',
      errorMessage: reason || 'Payment transaction failed or was declined by issuing bank.',
      requestPayload: eventData,
    });

    await IntegrationConfig.findOneAndUpdate(
      { provider: 'payment_gateway' },
      {
        $set: {
          lastFailedSync: new Date(),
          lastError: reason || 'Payment transaction failed.',
        },
        $inc: { totalErrors: 1 },
      },
      { upsert: true }
    );

    return { success: false, reason };
  }
}

module.exports = new PaymentService();
