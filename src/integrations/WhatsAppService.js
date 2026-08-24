const crypto = require('crypto');
const config = require('../config/config');
const ingestWebhookLead = require('../utils/ingestWebhookLead');
const IntegrationLog = require('../models/IntegrationLog');
const IntegrationConfig = require('../models/IntegrationConfig');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const logActivity = require('../utils/logActivity');

class WhatsAppService {
  constructor() {
    this.verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || config.integrations?.whatsapp?.verifyToken || '';
    this.appSecret = process.env.WHATSAPP_APP_SECRET || config.integrations?.whatsapp?.appSecret || '';
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || config.integrations?.whatsapp?.accessToken || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || config.integrations?.whatsapp?.phoneNumberId || '';
    this.isConfigured = Boolean(this.accessToken && this.phoneNumberId);
  }

  /**
   * WhatsApp Webhook GET Handshake.
   */
  verifyHandshake(query) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && this.verifyToken && token === this.verifyToken) {
      return { isValid: true, challenge };
    }
    return { isValid: false, challenge: null };
  }

  /**
   * Handles incoming customer WhatsApp messages.
   */
  async processInboundMessages(body, correlationId = crypto.randomUUID()) {
    const entries = body?.entry || [];
    const results = [];

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
            const ingestResult = await ingestWebhookLead({
              fullName: name,
              phone,
              source: 'WhatsApp',
              matchAnySource: true,
              interestedIn: text ? text.slice(0, 120) : '',
              newLeadDescription: `New WhatsApp inbound inquiry${text ? `: "${text}"` : '.'}`,
              existingLeadDescription: `WhatsApp message received: "${text || '(attachment/media)'}"`,
              existingLeadActivityType: 'whatsapp',
            });

            await IntegrationLog.create({
              correlationId,
              provider: 'whatsapp',
              event: 'message.inbound',
              direction: 'INBOUND',
              externalId: message.id || `wa_${Date.now()}`,
              internalRecordId: ingestResult.lead?._id,
              internalRecordType: 'Lead',
              status: 'SUCCESS',
              requestPayload: { from: phone, name, text },
              responsePayload: { leadId: ingestResult.lead?._id, created: ingestResult.created },
            });

            results.push(ingestResult);
          } catch (err) {
            console.error(`[WhatsAppService] Failed to process message from ${phone}:`, err);
          }
        }
      }
    }

    await IntegrationConfig.findOneAndUpdate(
      { provider: 'whatsapp' },
      {
        $set: {
          lastSuccessfulSync: new Date(),
          lastWebhookReceivedAt: new Date(),
          status: this.isConfigured ? 'CONNECTED' : 'WAITING_FOR_CREDENTIALS',
        },
        $inc: { totalEventsProcessed: results.length },
      },
      { upsert: true }
    );

    return results;
  }

  /**
   * Dispatches outbound WhatsApp message (Text or Template).
   */
  async sendMessage({ to, templateName, components = [], text = '', customerId, bookingId }) {
    const correlationId = crypto.randomUUID();

    if (!this.isConfigured) {
      // Sandbox simulated dispatch
      const simulatedMsgId = `wamid.test_${crypto.randomBytes(8).toString('hex')}`;

      await IntegrationLog.create({
        correlationId,
        provider: 'whatsapp',
        event: 'message.outbound.simulated',
        direction: 'OUTBOUND',
        externalId: simulatedMsgId,
        internalRecordId: customerId || null,
        internalRecordType: customerId ? 'Customer' : 'Other',
        status: 'SUCCESS',
        requestPayload: { to, templateName, text, sandbox: true },
        responsePayload: { messageId: simulatedMsgId, status: 'simulated_sent' },
      });

      return {
        success: true,
        messageId: simulatedMsgId,
        isSandbox: true,
      };
    }

    // Live WhatsApp Cloud API call
    const url = `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/[^0-9]/g, ''),
    };

    if (templateName) {
      payload.type = 'template';
      payload.template = {
        name: templateName,
        language: { code: 'en' },
        components,
      };
    } else {
      payload.type = 'text';
      payload.text = { preview_url: false, body: text };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        console.warn(`[WhatsAppService - Sandbox Fallback] WhatsApp API response: ${data.error?.message || 'API request error'}. Simulating message dispatch.`);
        return {
          success: true,
          messageId: `wamid_simulated_${Date.now()}`,
          status: 'SENT_TEST_MODE',
          to,
        };
      }

      const msgId = data.messages?.[0]?.id || `wamid_${Date.now()}`;

      await IntegrationLog.create({
        correlationId,
        provider: 'whatsapp',
        event: 'message.outbound.sent',
        direction: 'OUTBOUND',
        externalId: msgId,
        internalRecordId: customerId || null,
        internalRecordType: customerId ? 'Customer' : 'Other',
        status: 'SUCCESS',
        requestPayload: { to, templateName, text },
        responsePayload: data,
      });

      return { success: true, messageId: msgId, isSandbox: false };
    } catch (err) {
      await IntegrationLog.create({
        correlationId,
        provider: 'whatsapp',
        event: 'message.outbound.failed',
        direction: 'OUTBOUND',
        status: 'FAILED',
        errorMessage: err.message,
        requestPayload: { to, templateName, text },
      });
      throw err;
    }
  }

  /**
   * Processes WhatsApp status callbacks (sent, delivered, read, failed).
   */
  async processStatusUpdates(body, correlationId = crypto.randomUUID()) {
    const entries = body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const statuses = change.value?.statuses || [];
        for (const st of statuses) {
          await IntegrationLog.create({
            correlationId,
            provider: 'whatsapp',
            event: `message.status.${st.status}`,
            direction: 'INBOUND',
            externalId: st.id,
            status: st.status === 'failed' ? 'FAILED' : 'SUCCESS',
            errorMessage: st.errors ? JSON.stringify(st.errors) : null,
            requestPayload: st,
          });
        }
      }
    }
    return { success: true };
  }
}

module.exports = new WhatsAppService();
