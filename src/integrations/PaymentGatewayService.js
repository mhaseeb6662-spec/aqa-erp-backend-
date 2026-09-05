require('../models/User');
const TabbyPaymentProvider = require('./providers/TabbyPaymentProvider');
const PayTabsPaymentProvider = require('./providers/PayTabsPaymentProvider');
const TotalPayPaymentProvider = require('./providers/TotalPayPaymentProvider');
const IntegrationLog = require('../models/IntegrationLog');
const crypto = require('crypto');
const Invoice = require('../models/Invoice');
const PaymentTransaction = require('../models/PaymentTransaction');
const Booking = require('../models/Booking');
const Receipt = require('../models/Receipt');

class PaymentGatewayService {
  constructor() {
    this.providers = {
      Tabby: new TabbyPaymentProvider(),
      PayTabs: new PayTabsPaymentProvider(),
      TotalPay: new TotalPayPaymentProvider(),
    };
  }

  getProvider(providerName) {
    const provider = this.providers[providerName];
    if (!provider) {
      throw new Error(`Payment provider ${providerName} is not supported.`);
    }
    return provider;
  }

  getAvailableProviders() {
    const available = [];
    for (const [name, provider] of Object.entries(this.providers)) {
      if (provider.isConfigured()) {
        available.push(name);
      }
    }
    return available;
  }

  async createCheckoutSession({ providerName, invoice, amount, currency = 'AED', customer, returnUrl }) {
    const provider = this.getProvider(providerName);
    
    if (!provider.isConfigured()) {
      throw new Error(`Provider ${providerName} is not fully configured.`);
    }

    const correlationId = crypto.randomUUID();

    try {
      const session = await provider.createSession({
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        amount,
        currency,
        customer,
        returnUrl
      });

      await IntegrationLog.create({
        correlationId,
        provider: providerName,
        event: 'checkout.session.created',
        direction: 'OUTBOUND',
        externalId: session.sessionId,
        internalRecordId: invoice._id,
        internalRecordType: 'Invoice',
        status: 'SUCCESS',
        requestPayload: { invoiceId: invoice._id, amount, currency, customerEmail: customer?.email },
        responsePayload: session,
      });

      return session;

    } catch (error) {
      await IntegrationLog.create({
        correlationId,
        provider: providerName,
        event: 'checkout.session.created',
        direction: 'OUTBOUND',
        internalRecordId: invoice._id,
        internalRecordType: 'Invoice',
        status: 'ERROR',
        requestPayload: { invoiceId: invoice._id, amount, currency, customerEmail: customer?.email },
        responsePayload: { error: error.message },
      });
      throw error;
    }
  }

  async processWebhook(providerName, rawBody, headers) {
    const provider = this.getProvider(providerName);
    const correlationId = crypto.randomUUID();

    try {
      if (!provider.verifyWebhookSignature(rawBody, headers)) {
        throw new Error('Invalid webhook signature');
      }

      const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      const normalized = provider.normalizeWebhookPayload(payload);

      await IntegrationLog.create({
        correlationId,
        provider: providerName,
        event: 'webhook.received',
        direction: 'INBOUND',
        externalId: normalized.transactionId,
        status: 'SUCCESS',
        requestPayload: payload,
        responsePayload: normalized,
      });

      if (normalized.status === 'Completed') {
        await this.handleSuccessfulPayment(normalized, providerName);
      } else if (normalized.status === 'Failed') {
        // Just log or mark failure, idempotency allows safe retry
      }

      return { success: true };

    } catch (error) {
      await IntegrationLog.create({
        correlationId,
        provider: providerName,
        event: 'webhook.received',
        direction: 'INBOUND',
        status: 'ERROR',
        requestPayload: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
        responsePayload: { error: error.message },
      });
      throw error;
    }
  }

  async handleSuccessfulPayment(normalized, providerName) {
    // IDEMPOTENCY CHECK
    const existing = await PaymentTransaction.findOne({
      provider: providerName,
      providerTransactionId: normalized.transactionId
    });

    if (existing && existing.status === 'Completed') {
      return; // Already processed
    }

    const invoice = await Invoice.findById(normalized.invoiceId).populate('customer student booking program branch');
    if (!invoice) throw new Error('Invoice not found for webhook payment');

    // Amount and currency verification
    if (normalized.currency !== 'AED') throw new Error('Currency mismatch. Expected AED.');

    const paymentAmount = normalized.amount;

    let transaction;
    if (existing) {
      transaction = existing;
      transaction.status = 'Completed';
      transaction.amount = paymentAmount;
      transaction.paidAt = new Date();
      await transaction.save();
    } else {
      transaction = await PaymentTransaction.create({
        transactionId: `TXN-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        invoice: invoice._id,
        customer: invoice.customer._id,
        amount: paymentAmount,
        paymentMethod: providerName,
        status: 'Completed',
        provider: providerName,
        providerTransactionId: normalized.transactionId,
        providerSessionId: normalized.sessionId,
        currency: normalized.currency,
        gatewayReference: normalized.transactionId,
        paidAt: new Date(),
        notes: `Online payment via ${providerName}`,
      });
    }

    // Update Invoice
    invoice.amountPaid += paymentAmount;
    invoice.balanceDue = invoice.totalAmount - invoice.amountPaid;
    if (invoice.balanceDue <= 0) {
      invoice.status = 'Paid';
      invoice.balanceDue = 0;
    } else {
      invoice.status = 'Partially Paid';
    }
    await invoice.save();

    // Update Booking if fully paid
    if (invoice.booking && invoice.status === 'Paid') {
      await Booking.findByIdAndUpdate(invoice.booking, { status: 'Confirmed' });
    }

    // Generate Receipt
    await Receipt.create({
      receiptNumber: `RCT-${Date.now().toString().slice(-6)}`,
      invoice: invoice._id,
      payment: transaction._id,
      customer: invoice.customer._id,
      amount: paymentAmount,
      date: new Date(),
      paymentMethod: providerName,
      notes: `Receipt for online payment via ${providerName}`,
    });
  }

  async refundPayment(transactionId, amount, reason) {
    const transaction = await PaymentTransaction.findById(transactionId).populate('invoice');
    if (!transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'Completed') throw new Error('Can only refund completed transactions');

    if (['Tabby', 'PayTabs', 'TotalPay'].includes(transaction.provider)) {
      const provider = this.getProvider(transaction.provider);
      if (!provider.isConfigured()) throw new Error(`Provider ${transaction.provider} is not configured.`);
      
      const refundResult = await provider.refundPayment({
        transactionId: transaction.providerTransactionId,
        amount,
        currency: transaction.currency,
        reason
      });

      if (refundResult.status === 'Refunded') {
        // Return success, the caller (financeController) will handle invoice/DB updates
        return { success: true, message: `Online refund processed via ${transaction.provider}` };
      } else {
        throw new Error('Provider rejected refund');
      }
    } else {
      throw new Error('This transaction is not an online provider transaction.');
    }
  }
}

module.exports = new PaymentGatewayService();
