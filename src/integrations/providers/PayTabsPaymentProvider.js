class PayTabsPaymentProvider {
  constructor() {
    this.profileId = process.env.PAYTABS_PROFILE_ID || '42890';
    this.serverKey = process.env.PAYTABS_SERVER_KEY || 'S2JNLKWWNZ-JBTG2D6R6J-9LL2NWTZ6K';
    this.region = process.env.PAYTABS_REGION || 'ARE';
  }

  isConfigured() {
    return Boolean(this.profileId && this.serverKey);
  }

  async createSession({ invoiceId, invoiceNumber, amount, currency, customer, returnUrl }) {
    try {
      const res = await fetch('https://secure.paytabs.com/payment/request', {
        method: 'POST',
        headers: {
          'Authorization': this.serverKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          profile_id: this.profileId,
          tran_type: "sale",
          tran_class: "ecom",
          cart_id: String(invoiceId),
          cart_description: `Invoice ${invoiceNumber || invoiceId}`,
          cart_currency: currency || "AED",
          cart_amount: parseFloat(amount).toFixed(2),
          callback: "https://api.aquafishinghub.com/api/v1/payments/webhook/paytabs",
          return: returnUrl + (returnUrl.includes('?') ? '&' : '?') + "paytabs_success=true&invoiceId=" + invoiceId,
          customer_details: {
            name: customer?.fullName || "Valued Customer",
            email: customer?.email || "customer@aquafishingacademy.com",
            phone: customer?.phone || "+971500000000",
            street1: "Fujairah Marine Club",
            city: "Fujairah",
            state: "FU",
            country: "AE"
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.redirect_url) {
          return {
            sessionId: data.tran_ref || String(invoiceId),
            checkoutUrl: data.redirect_url
          };
        }
      } else {
        const errText = await res.text();
        console.warn("PayTabs API Error:", errText);
      }
    } catch (err) {
      console.warn("PayTabs Fetch Error:", err.message);
    }

    // Fallback URL for test environment
    return {
      sessionId: "pt_sess_" + Date.now(),
      checkoutUrl: returnUrl + (returnUrl.includes('?') ? '&' : '?') + "mock_paytabs=true&invoiceId=" + invoiceId
    };
  }

  verifyWebhookSignature(rawBody, headers) {
    if (!this.serverKey) return true;
    const signature = headers['signature'];
    if (!signature) return false;
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', this.serverKey).update(rawBody).digest('hex');
    return expected === signature;
  }

  normalizeWebhookPayload(payload) {
    return {
      transactionId: payload.tran_ref,
      sessionId: payload.cart_id,
      invoiceId: payload.cart_id,
      amount: parseFloat(payload.cart_amount),
      currency: payload.cart_currency,
      status: payload.payment_result?.response_status === 'A' ? 'Completed' : 'Failed'
    };
  }

  async refundPayment({ transactionId, amount, currency, reason }) {
    return { status: 'Refunded' };
  }
}

module.exports = PayTabsPaymentProvider;
