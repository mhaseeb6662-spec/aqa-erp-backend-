const crypto = require('crypto');
const config = require('../config/config');
const catchAsync = require('../utils/catchAsync');
const ingestWebhookLead = require('../utils/ingestWebhookLead');

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body.
 * Skipped (returns true) when no app secret is configured, so the webhook
 * still works during initial setup before that value is filled in.
 */
const isValidMetaSignature = (rawBody, signatureHeader, appSecret) => {
  if (!appSecret) return true;
  if (!signatureHeader || !rawBody) return false;

  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
};

/**
 * Fetches the real lead field data (name/phone/email/...) from the Graph
 * API — Meta's webhook only tells us a leadgen_id exists, never the data.
 */
const fetchMetaLeadFields = async (leadgenId) => {
  const { pageAccessToken, graphApiVersion } = config.integrations.meta;
  if (!pageAccessToken) {
    throw new Error('META_PAGE_ACCESS_TOKEN is not configured — cannot fetch lead details.');
  }

  const url = `https://graph.facebook.com/${graphApiVersion}/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || 'Graph API returned an error.');
  }

  const fields = {};
  (data.field_data || []).forEach((entry) => {
    const value = Array.isArray(entry.values) ? entry.values[0] : entry.values;
    fields[entry.name] = value;
  });
  return fields;
};

/**
 * GET /api/v1/webhooks/leads/meta
 * Meta's one-time webhook subscription handshake.
 */
exports.verifyMetaWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = config.integrations.meta.verifyToken;

  if (mode === 'subscribe' && expected && token === expected) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

/**
 * POST /api/v1/webhooks/leads/meta
 * Facebook / Instagram Lead Ads. Meta only sends a leadgen_id per new
 * lead — we fetch the actual field data from the Graph API, then hand it
 * off to the shared ingestion pipeline.
 */
exports.handleMetaWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!isValidMetaSignature(req.rawBody, signature, config.integrations.meta.appSecret)) {
    console.error('[webhooks/meta] Invalid signature — payload ignored.');
    return res.sendStatus(200); // ack anyway so Meta doesn't retry-storm us
  }

  const entries = req.body?.entry || [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const { leadgen_id: leadgenId, form_id: formId } = change.value || {};
      if (!leadgenId) continue;

      try {
        const fields = await fetchMetaLeadFields(leadgenId);
        const fullName =
          fields.full_name ||
          [fields.first_name, fields.last_name].filter(Boolean).join(' ') ||
          '';

        const knownKeys = new Set(['full_name', 'first_name', 'last_name', 'email', 'phone_number']);
        const extraLines = Object.entries(fields)
          .filter(([key, value]) => !knownKeys.has(key) && value)
          .map(([key, value]) => `${key}: ${value}`);

        await ingestWebhookLead({
          fullName,
          phone: fields.phone_number || '',
          email: fields.email || '',
          source: 'Facebook Ads',
          externalId: leadgenId,
          interestedIn: formId ? `Lead form: ${formId}` : '',
          notes: extraLines.join('\n'),
          newLeadDescription: 'Lead auto-captured via Facebook/Instagram Lead Ads.',
        });
      } catch (err) {
        console.error(`[webhooks/meta] Failed to process leadgen_id ${leadgenId}: ${err.message}`);
      }
    }
  }

  return res.sendStatus(200);
});

/**
 * POST /api/v1/webhooks/leads/google
 * Google Ads Lead Form extension, "Webhook" delivery method.
 */
exports.handleGoogleWebhook = catchAsync(async (req, res) => {
  const payload = req.body || {};
  const configuredKey = config.integrations.google.webhookKey;

  if (configuredKey && payload.google_key !== configuredKey) {
    console.error('[webhooks/google] google_key mismatch — payload ignored.');
    return res.status(200).json({ success: false });
  }

  // Google sends a test payload when the delivery method is first saved —
  // acknowledge it without creating a lead.
  if (payload.is_test) {
    return res.status(200).json({ success: true, message: 'Test payload acknowledged.' });
  }

  const values = {};
  const extraLines = [];

  (payload.user_column_data || []).forEach(({ column_id: id, column_name: name, string_value: value }) => {
    if (!value) return;
    const key = (id || name || '').toUpperCase();

    if (key.includes('FULL_NAME')) values.fullName = value;
    else if (key.includes('FIRST_NAME')) values.firstName = value;
    else if (key.includes('LAST_NAME')) values.lastName = value;
    else if (key.includes('EMAIL')) values.email = value;
    else if (key.includes('PHONE')) values.phone = value;
    else extraLines.push(`${name || id}: ${value}`);
  });

  const fullName = values.fullName || [values.firstName, values.lastName].filter(Boolean).join(' ');

  await ingestWebhookLead({
    fullName,
    phone: values.phone || '',
    email: values.email || '',
    source: 'Google Ads',
    externalId: payload.lead_id ? String(payload.lead_id) : undefined,
    interestedIn: payload.campaign_name || '',
    notes: extraLines.join('\n'),
    newLeadDescription: `Lead auto-captured via Google Ads${payload.campaign_name ? ` (campaign: ${payload.campaign_name})` : ''}.`,
  });

  return res.status(200).json({ success: true });
});

/**
 * GET /api/v1/webhooks/leads/whatsapp
 * WhatsApp Business Cloud API's webhook subscription handshake — same
 * mechanics as Meta's, since it lives under the same App/webhook config.
 */
exports.verifyWhatsappWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = config.integrations.whatsapp.verifyToken;

  if (mode === 'subscribe' && expected && token === expected) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

/**
 * POST /api/v1/webhooks/leads/whatsapp
 * Incoming customer-initiated WhatsApp messages. First message from a new
 * number creates a lead; every later message from a number we already
 * know (any source, not just WhatsApp) is logged onto that existing
 * lead's activity timeline instead of creating a duplicate.
 */
exports.handleWhatsappWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!isValidMetaSignature(req.rawBody, signature, config.integrations.whatsapp.appSecret)) {
    console.error('[webhooks/whatsapp] Invalid signature — payload ignored.');
    return res.sendStatus(200);
  }

  const entries = req.body?.entry || [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const contacts = value.contacts || [];
      const messages = value.messages || [];

      for (const message of messages) {
        const phone = message.from;
        if (!phone) continue;

        const contact = contacts.find((c) => c.wa_id === phone);
        const name = contact?.profile?.name || '';
        const text =
          message.text?.body ||
          message.button?.text ||
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          '';

        try {
          await ingestWebhookLead({
            fullName: name,
            phone,
            source: 'WhatsApp',
            matchAnySource: true,
            interestedIn: text ? text.slice(0, 120) : '',
            newLeadDescription: `New WhatsApp lead${text ? `: "${text}"` : '.'}`,
            existingLeadDescription: `WhatsApp message received: "${text || '(no text)'}"`,
            existingLeadActivityType: 'whatsapp',
          });
        } catch (err) {
          console.error(`[webhooks/whatsapp] Failed to process message from ${phone}: ${err.message}`);
        }
      }
    }
  }

  return res.sendStatus(200);
});
