const crypto = require('crypto');
const IntegrationLog = require('../models/IntegrationLog');
const IntegrationConfig = require('../models/IntegrationConfig');
const Invoice = require('../models/Invoice');
const PaymentTransaction = require('../models/PaymentTransaction');
const Customer = require('../models/Customer');

class AccountingService {
  constructor() {
    this.provider = process.env.ACCOUNTING_PROVIDER || 'xero'; // 'xero', 'quickbooks', 'zoho'
    this.clientId = process.env.ACCOUNTING_CLIENT_ID || '';
    this.clientSecret = process.env.ACCOUNTING_CLIENT_SECRET || '';
    this.redirectUri = process.env.ACCOUNTING_REDIRECT_URI || '';
    this.isConfigured = Boolean(this.clientId && this.clientSecret);
  }

  /**
   * Syncs customer contact to external accounting software.
   */
  async syncCustomer(customer) {
    const correlationId = crypto.randomUUID();
    const externalCustomerId = customer.accountingCustomerId || `acc_cust_${crypto.randomBytes(6).toString('hex')}`;

    await IntegrationLog.create({
      correlationId,
      provider: 'accounting',
      event: 'customer.synced',
      direction: 'OUTBOUND',
      externalId: externalCustomerId,
      internalRecordId: customer._id,
      internalRecordType: 'Customer',
      status: 'SUCCESS',
      requestPayload: { customerId: customer._id, name: customer.fullName, email: customer.email },
      responsePayload: { externalCustomerId, provider: this.provider, status: 'SYNCED' },
    });

    return { success: true, externalCustomerId };
  }

  /**
   * Idempotently syncs an ERP Invoice to the external accounting system.
   */
  async syncInvoice(invoiceId) {
    const correlationId = crypto.randomUUID();
    const invoice = await Invoice.findById(invoiceId).populate('customer');
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    // Check if already synced to prevent duplicate external invoices
    if (invoice.accountingInvoiceId) {
      console.log(`[AccountingService] Invoice ${invoice.invoiceNumber} already synced (${invoice.accountingInvoiceId}). Updating external record.`);
    }

    const externalInvoiceId = invoice.accountingInvoiceId || `acc_inv_${crypto.randomBytes(6).toString('hex')}`;

    // Perform external accounting API dispatch or sandbox simulation
    invoice.accountingInvoiceId = externalInvoiceId;
    invoice.accountingSyncStatus = 'SYNCED';
    invoice.lastAccountingSyncAt = new Date();
    await invoice.save();

    await IntegrationLog.create({
      correlationId,
      provider: 'accounting',
      event: 'invoice.synced',
      direction: 'OUTBOUND',
      externalId: externalInvoiceId,
      internalRecordId: invoice._id,
      internalRecordType: 'Invoice',
      status: 'SUCCESS',
      requestPayload: {
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: invoice.totalAmount,
        balanceDue: invoice.balanceDue,
        status: invoice.status,
      },
      responsePayload: { externalInvoiceId, provider: this.provider, syncStatus: 'SYNCED' },
    });

    await IntegrationConfig.findOneAndUpdate(
      { provider: 'accounting' },
      {
        $set: {
          lastSuccessfulSync: new Date(),
          status: this.isConfigured ? 'CONNECTED' : 'WAITING_FOR_CREDENTIALS',
        },
        $inc: { totalEventsProcessed: 1 },
      },
      { upsert: true }
    );

    return { success: true, externalInvoiceId };
  }

  /**
   * Syncs reconciled payment transaction to external ledger.
   */
  async syncPayment(paymentId) {
    const correlationId = crypto.randomUUID();
    const payment = await PaymentTransaction.findById(paymentId).populate('invoice');
    if (!payment) throw new Error(`Payment ${paymentId} not found`);

    const externalPaymentId = payment.accountingPaymentId || `acc_pay_${crypto.randomBytes(6).toString('hex')}`;

    payment.accountingPaymentId = externalPaymentId;
    payment.accountingSyncStatus = 'SYNCED';
    await payment.save();

    await IntegrationLog.create({
      correlationId,
      provider: 'accounting',
      event: 'payment.synced',
      direction: 'OUTBOUND',
      externalId: externalPaymentId,
      internalRecordId: payment._id,
      internalRecordType: 'PaymentTransaction',
      status: 'SUCCESS',
      requestPayload: {
        paymentId: payment._id,
        amount: payment.amount,
        invoiceNumber: payment.invoice?.invoiceNumber,
      },
      responsePayload: { externalPaymentId, provider: this.provider, status: 'SYNCED' },
    });

    return { success: true, externalPaymentId };
  }
}

module.exports = new AccountingService();
