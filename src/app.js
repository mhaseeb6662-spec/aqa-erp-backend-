const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');

const config = require('./config/config');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const AppError = require('./utils/appError');

const connectDB = require('./config/db');

const app = express();

// Ensure MongoDB connection is active before processing any API route (crucial for Vercel/Render serverless deployment)
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/') {
    try {
      await connectDB();
    } catch (err) {
      return next(new AppError('Database connection failed. Please check MongoDB Network Access / IP Whitelist.', 500));
    }
  }
  next();
});

// ---- Security foundation ----
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile, Postman) or any localhost/127.0.0.1 origin in dev
      if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin === config.clientUrl) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
  skip: (req) => {
    // In development or localhost testing, do not throttle developers
    if (config.env === 'development' || req.ip === '127.0.0.1' || req.ip === '::1' || req.ip?.includes('127.0.0.1')) {
      return true;
    }
    return req.path.startsWith('/v1/webhooks/leads') || req.path.startsWith('/v1/integrations/webhooks');
  },
});
app.use('/api', limiter);

const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/v1/webhooks/leads', webhookLimiter);

// ---- Body parsing ----
// `verify` stashes the raw request bytes on req.rawBody so the Meta/
// WhatsApp webhook handlers can validate the X-Hub-Signature-256 header
// (signatures are computed over the exact raw body, not the parsed object).
app.use(
  express.json({
    limit: '10kb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ---- Sanitization against NoSQL injection & XSS ----
// Skipped for the inbound lead webhooks: Meta/WhatsApp's verification
// handshake uses dotted query keys ("hub.mode", "hub.verify_token") which
// express-mongo-sanitize strips entirely (it treats any "." in a key as a
// Mongo-injection attempt), silently breaking the handshake. Those routes
// never spread request data into a Mongo query directly (fields are
// picked out individually in the controller/ingest layer), so this is
// safe — the webhook payloads are already authenticated separately via
// HMAC signature / shared secret key.
const skipForWebhooks = (middleware) => (req, res, next) => {
  if (req.path.startsWith('/api/v1/webhooks/leads')) return next();
  return middleware(req, res, next);
};
app.use(skipForWebhooks(mongoSanitize()));
app.use(skipForWebhooks(xss()));

// ---- Logging ----
if (config.env === 'development') {
  app.use(morgan('dev'));
}

// ---- API routes ----
app.use('/api/v1', routes);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Aqua Fishing Academy ERP System API',
    phase: 'Phase 2 - Sales CRM & Lead Management',
  });
});

// ---- 404 handler ----
app.all('*', (req, res, next) => {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
});

// ---- Global error handler (must be last) ----
app.use(errorHandler);

module.exports = app;
