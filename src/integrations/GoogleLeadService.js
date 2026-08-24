const crypto = require('crypto');
const config = require('../config/config');
const ingestWebhookLead = require('../utils/ingestWebhookLead');
const IntegrationLog = require('../models/IntegrationLog');
const IntegrationConfig = require('../models/IntegrationConfig');

class GoogleLeadService {
  constructor() {
    this.webhookKey = process.env.GOOGLE_ADS_WEBHOOK_KEY || config.integrations?.google?.webhookKey || '';
    this.isConfigured = Boolean(this.webhookKey);
  }

  /**
   * Validates the Google webhook secret key.
   */
  verifyWebhookKey(receivedKey) {
    if (!this.webhookKey) return true; // Accept during testing/sandbox
    return receivedKey === this.webhookKey;
  }

  /**
   * Normalizes and ingests Google Ads Lead Form payload.
   */
  async processWebhook(payload, correlationId = crypto.randomUUID()) {
    // 1. Check test payload
    if (payload.is_test) {
      await IntegrationLog.create({
        correlationId,
        provider: 'google_leads',
        event: 'lead.test_ping_acknowledged',
        direction: 'INBOUND',
        status: 'SUCCESS',
        requestPayload: payload,
        responsePayload: { message: 'Test payload verified.' },
      });
      return { isTest: true, created: false };
    }

    // 2. Parse Google user_column_data fields
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

    const fullName = values.fullName || [values.firstName, values.lastName].filter(Boolean).join(' ') || 'Google Lead';
    const externalId = payload.lead_id ? String(payload.lead_id) : `google_${Date.now()}`;

    const ingestResult = await ingestWebhookLead({
      fullName,
      phone: values.phone || '',
      email: values.email || '',
      source: 'Google Ads',
      externalId,
      interestedIn: payload.campaign_name || 'Google Search / Discovery Ad',
      notes: extraLines.join('\n'),
      newLeadDescription: `Lead auto-captured via Google Ads${payload.campaign_name ? ` (Campaign: ${payload.campaign_name})` : ''}.`,
    });

    await IntegrationLog.create({
      correlationId,
      provider: 'google_leads',
      event: 'lead.ingested',
      direction: 'INBOUND',
      externalId,
      internalRecordId: ingestResult.lead?._id,
      internalRecordType: 'Lead',
      status: ingestResult.created ? 'SUCCESS' : 'IGNORED_DUPLICATE',
      requestPayload: payload,
      responsePayload: { leadId: ingestResult.lead?._id, created: ingestResult.created },
    });

    await IntegrationConfig.findOneAndUpdate(
      { provider: 'google_leads' },
      {
        $set: {
          lastSuccessfulSync: new Date(),
          lastWebhookReceivedAt: new Date(),
          status: this.isConfigured ? 'CONNECTED' : 'WAITING_FOR_CREDENTIALS',
        },
        $inc: { totalEventsProcessed: 1 },
      },
      { upsert: true }
    );

    return ingestResult;
  }
}

module.exports = new GoogleLeadService();
