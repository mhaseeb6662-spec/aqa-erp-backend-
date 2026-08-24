const express = require('express');
const integrationController = require('../controllers/integrationController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// 1. Public Webhook Receiver (Verified by signature HMAC)
router.post('/webhooks/payment', integrationController.handlePaymentWebhook);

// 2. OAuth Callback
router.get('/oauth/google-calendar/callback', integrationController.handleGoogleCalendarOAuthCallback);

// 3. Protected Admin Integration Endpoints
router.use(protect);
router.use(restrictTo('super-admin', 'admin'));

router.get('/statuses', integrationController.getIntegrationStatuses);
router.get('/logs', integrationController.getIntegrationLogs);
router.put('/:provider', integrationController.updateIntegrationConfig);
router.post('/:provider/test', integrationController.testIntegrationConnection);

module.exports = router;
