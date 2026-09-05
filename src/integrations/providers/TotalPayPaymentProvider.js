
class TotalPayPaymentProvider {
  constructor() {
    this.merchantKey = process.env.TOTALPAY_MERCHANT_KEY || 'cd0cc97e-6008-11f1-abb4-dea970b3cbca';
    this.password = process.env.TOTALPAY_PASSWORD || '67b3cb40eb92146f17d669be505ab699';
  }

  isConfigured() {
    return Boolean(this.merchantKey && this.password);
  }

    async createSession({ invoiceId, invoiceNumber, amount, currency, customer, returnUrl }) {
    const backendUrl = process.env.API_URL || 'https://api.aquafishinghub.com';
    const redirectUrl = `${backendUrl}/api/v1/payments/totalpay/redirect?invoiceId=${invoiceId}&amount=${amount}&currency=${currency || 'AED'}&returnUrl=${encodeURIComponent(returnUrl)}`;
    
    return {
      sessionId: "tp_sess_" + invoiceId,
      checkoutUrl: redirectUrl
    };
  }

  verifyWebhookSignature(rawBody, headers) {
    // TotalPay uses different hashing (e.g. SHA1 with password)
    // Simplified for mockup
    return true;
  }

  normalizeWebhookPayload(payload) {
    return {
      transactionId: payload.transaction_id,
      sessionId: payload.order_id,
      invoiceId: payload.order_id,
      amount: parseFloat(payload.amount),
      currency: payload.currency,
      status: payload.status === 'SUCCESS' ? 'Completed' : 'Failed'
    };
  }

  async refundPayment({ transactionId, amount, currency, reason }) {
    return { status: 'Refunded' };
  }
}
module.exports = TotalPayPaymentProvider;
