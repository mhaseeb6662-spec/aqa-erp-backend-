const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

/**
 * Central application configuration.
 * Every environment-dependent value used across the app should be
 * read from here instead of directly from process.env, so Phase 1
 * establishes a single, predictable configuration source.
 */
const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/aqua_fishing_academy_erp',

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  cookie: {
    expiresDays: Number(process.env.COOKIE_EXPIRES_DAYS) || 7,
  },

  rateLimit: {
    windowMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES) || 15,
    maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || (process.env.NODE_ENV === 'production' ? 2500 : 15000),
  },

  superAdmin: {
    name: process.env.SUPER_ADMIN_NAME || 'System Administrator',
    email: process.env.SUPER_ADMIN_EMAIL || 'admin@aquafishingacademy.com',
    password: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe@12345',
  },

  // Phase 2.1 — Inbound lead webhooks (Meta/Facebook Lead Ads, Google Ads
  // Lead Form, WhatsApp Business Cloud API). All optional — a source stays
  // inactive until its tokens are filled in, the rest of the ERP is
  // unaffected either way.
  integrations: {
    meta: {
      // Any string you choose — must match exactly what you enter as the
      // "Verify Token" when subscribing the webhook in Meta App Dashboard.
      verifyToken: process.env.META_VERIFY_TOKEN || '',
      // Meta App Secret — used to verify the X-Hub-Signature-256 header so
      // only genuine Meta requests are accepted. Recommended, not required.
      appSecret: process.env.META_APP_SECRET || '',
      // Page Access Token with leads_retrieval permission — required to
      // fetch the actual lead field data (name/phone/email) after Meta
      // notifies us of a new leadgen_id.
      pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || '',
      graphApiVersion: process.env.META_GRAPH_API_VERSION || 'v19.0',
    },
    google: {
      // The secret key you set on the Google Ads "Webhook" lead form
      // delivery method — sent back on every payload as "google_key".
      webhookKey: process.env.GOOGLE_ADS_WEBHOOK_KEY || '',
    },
    whatsapp: {
      // Falls back to the Meta verify token since WhatsApp Cloud API
      // webhooks live under the same Meta App/webhook config in most setups.
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || '',
      appSecret: process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || '',
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    },
  },
};

module.exports = config;
