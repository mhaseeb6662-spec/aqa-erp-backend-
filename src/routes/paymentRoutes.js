require('../models/User');
const express = require('express');
const router = express.Router();
const PaymentGatewayService = require('../integrations/PaymentGatewayService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Invoice = require('../models/Invoice');
const config = require('../config/config');

// Get available configured providers
router.get('/providers', (req, res) => {
  const providers = PaymentGatewayService.getAvailableProviders();
  res.status(200).json({ success: true, data: providers });
});

// Create checkout session
router.post('/checkout', catchAsync(async (req, res, next) => {
  const { invoiceId, providerName, returnUrl } = req.body;
  if (!invoiceId || !providerName) {
    return next(new AppError('Invoice ID and Provider Name are required', 400));
  }

  const invoice = await Invoice.findById(invoiceId).populate('customer');
  if (!invoice) {
    return next(new AppError('Invoice not found', 404));
  }

  const session = await PaymentGatewayService.createCheckoutSession({
    providerName,
    invoice,
    amount: invoice.balanceDue,
    currency: 'AED',
    customer: invoice.customer,
    returnUrl: returnUrl || `${config.clientUrl}/finance/invoices`
  });

  res.status(200).json({ success: true, data: session });
}));

// Webhook endpoint
router.post('/webhook/:provider', express.raw({ type: 'application/json' }), catchAsync(async (req, res, next) => {
  const providerName = req.params.provider;
  const rawBody = req.body;
  
  // Need to map route param to provider class name
  const providerMap = {
    'tabby': 'Tabby',
    'paytabs': 'PayTabs',
    'totalpay': 'TotalPay'
  };

  const actualProvider = providerMap[providerName.toLowerCase()];
  if (!actualProvider) {
    return res.status(400).send('Unknown provider');
  }

  await PaymentGatewayService.processWebhook(actualProvider, rawBody, req.headers);
  res.status(200).send('OK');
}));


// TotalPay form redirect
router.get('/totalpay/redirect', (req, res) => {
  const { invoiceId, amount, currency, returnUrl } = req.query;
  const merchantKey = process.env.TOTALPAY_MERCHANT_KEY || 'cd0cc97e-6008-11f1-abb4-dea970b3cbca';
  
  // Render auto-submitting form
  const html = `
    <html>
      <body onload="document.forms[0].submit()">
        <p>Redirecting to TotalPay secure checkout...</p>
        <form action="https://checkout.totalpay.global/purchase" method="POST">
          <input type="hidden" name="merchant_key" value="${merchantKey}" />
          <input type="hidden" name="operation" value="purchase" />
          <input type="hidden" name="order_id" value="${invoiceId}" />
          <input type="hidden" name="amount" value="${amount}" />
          <input type="hidden" name="currency" value="${currency || 'AED'}" />
          <input type="hidden" name="return_url" value="${returnUrl}" />
        </form>
      </body>
    </html>
  `;
  res.send(html);
});

module.exports = router;
