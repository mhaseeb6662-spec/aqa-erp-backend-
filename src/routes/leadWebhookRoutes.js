const express = require('express');
const leadWebhookController = require('../controllers/leadWebhookController');

const router = express.Router();

// These endpoints are called directly by Meta/Google/WhatsApp's own
// servers, never by the ERP's logged-in users — deliberately NOT behind
// the `protect` auth middleware used everywhere else in this API.
// Authenticity is instead checked per-provider (verify token on the GET
// handshake, HMAC signature and/or a shared secret key on the POST body).

// Meta (Facebook + Instagram) Lead Ads
router.get('/meta', leadWebhookController.verifyMetaWebhook);
router.post('/meta', leadWebhookController.handleMetaWebhook);

// Google Ads Lead Form extension (Webhook delivery method)
router.post('/google', leadWebhookController.handleGoogleWebhook);

// WhatsApp Business Cloud API (incoming customer messages)
router.get('/whatsapp', leadWebhookController.verifyWhatsappWebhook);
router.post('/whatsapp', leadWebhookController.handleWhatsappWebhook);

module.exports = router;
