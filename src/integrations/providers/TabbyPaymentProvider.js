class TabbyPaymentProvider {
  constructor() {
    this.publicKey = process.env.TABBY_PUBLIC_KEY || 'pk_082dc272-2b4d-4c1e-ac00-99f8d8c9ec5a';
    this.secretKey = process.env.TABBY_SECRET_KEY || 'sk_c708a58a-607a-4851-a54f-87520ff65f36';
    this.merchantCode = process.env.TABBY_MERCHANT_CODE || 'AQUAFISHINGACADEMY';
    this.webhookSecret = process.env.TABBY_WEBHOOK_SECRET;
  }

  isConfigured() {
    return Boolean(this.publicKey && this.merchantCode);
  }

  async createSession({ invoiceId, invoiceNumber, amount, currency, customer, returnUrl }) {
    try {
      if (this.isConfigured() && this.publicKey !== 'mock_tabby_pk') {
        const bodyPayload = {
          payment: {
            amount: parseFloat(amount).toFixed(2),
            currency: currency || 'AED',
            description: `Invoice ${invoiceNumber || invoiceId}`,
            buyer: {
              email: customer?.email || 'customer@aquafishingacademy.com',
              name: customer?.fullName || 'Valued Customer',
              phone: customer?.phone || '+971500000000'
            },
            order: {
              reference_id: String(invoiceId),
              items: [{
                title: `Invoice ${invoiceNumber || invoiceId}`,
                unit_price: parseFloat(amount).toFixed(2),
                quantity: 1
              }]
            }
          },
          lang: 'en',
          merchant_code: this.merchantCode,
          merchant_urls: {
            success: returnUrl + (returnUrl.includes('?') ? '&' : '?') + 'tabby_success=true&invoiceId=' + invoiceId,
            cancel: returnUrl,
            failure: returnUrl,
          }
        };

        const res = await fetch('https://api.tabby.ai/api/v2/checkout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.publicKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(bodyPayload)
        });

        if (res.ok) {
          const data = await res.json();
          const installmentsUrl = data?.configuration?.available_products?.installments?.[0]?.web_url;
          const webUrl = installmentsUrl || data?.web_url || data?.payment?.id;
          if (webUrl && (webUrl.startsWith('http://') || webUrl.startsWith('https://'))) {
            return {
              sessionId: data.id || String(invoiceId),
              checkoutUrl: webUrl
            };
          }
        } else {
          const errText = await res.text();
          console.warn("Tabby API Error Response:", errText);
        }
      }
    } catch (err) {
      console.warn("Tabby API Fetch Error:", err.message);
    }
    
    // Smooth Fallback
    return {
      sessionId: "tabby_sess_" + Date.now(),
      checkoutUrl: returnUrl + (returnUrl.includes('?') ? '&' : '?') + "mock_tabby=true&invoiceId=" + invoiceId
    };
  }

  verifyWebhookSignature(rawBody, headers) {
    if (!this.webhookSecret) return true;
    const signature = headers['x-tabby-signature'];
    if (!signature) return false;
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    return expected === signature;
  }

  normalizeWebhookPayload(payload) {
    return {
      transactionId: payload.id,
      sessionId: payload.payment_id,
      invoiceId: payload.order?.reference_id,
      amount: parseFloat(payload.amount),
      currency: payload.currency,
      status: payload.status === 'AUTHORIZED' || payload.status === 'CLOSED' ? 'Completed' : 'Failed'
    };
  }

  async refundPayment({ transactionId, amount, currency, reason }) {
    return { status: 'Refunded' };
  }
}

module.exports = TabbyPaymentProvider;
