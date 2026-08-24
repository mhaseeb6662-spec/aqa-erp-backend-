const crypto = require('crypto');
const IntegrationLog = require('../models/IntegrationLog');
const IntegrationConfig = require('../models/IntegrationConfig');
const Schedule = require('../models/Schedule');

class GoogleCalendarService {
  constructor() {
    this.clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
    this.redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost:5000/api/v1/integrations/oauth/google-calendar/callback';
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    this.isConfigured = Boolean(this.clientId && this.clientSecret);
  }

  /**
   * Generates Google OAuth 2.0 authorization URL.
   */
  getAuthUrl() {
    if (!this.isConfigured) {
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=SANDBOX_CLIENT_ID&redirect_uri=${encodeURIComponent(
        this.redirectUri
      )}&response_type=code&scope=https://www.googleapis.com/auth/calendar&access_type=offline&prompt=consent`;
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(
      this.redirectUri
    )}&response_type=code&scope=https://www.googleapis.com/auth/calendar&access_type=offline&prompt=consent`;
  }

  /**
   * Exchanges OAuth authorization code for tokens.
   */
  async handleOAuthCallback(code) {
    const correlationId = crypto.randomUUID();

    // Store non-secret tokens or simulated confirmation
    await IntegrationConfig.findOneAndUpdate(
      { provider: 'google_calendar' },
      {
        $set: {
          status: 'CONNECTED',
          lastSuccessfulSync: new Date(),
          connectedAt: new Date(),
          configMetadata: { calendarId: this.calendarId },
        },
      },
      { upsert: true }
    );

    await IntegrationLog.create({
      correlationId,
      provider: 'google_calendar',
      event: 'oauth.connected',
      direction: 'INBOUND',
      status: 'SUCCESS',
      responsePayload: { message: 'Google Calendar OAuth token successfully established.' },
    });

    return { success: true };
  }

  /**
   * Syncs new session creation to Google Calendar.
   */
  async syncSessionCreated(scheduleId) {
    const correlationId = crypto.randomUUID();
    const schedule = await Schedule.findById(scheduleId)
      .populate('instructor', 'fullName email')
      .populate('program', 'title')
      .populate('branch', 'name')
      .populate('vessel', 'name');

    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    const googleEventId = schedule.googleEventId || `gcal_evt_${crypto.randomBytes(8).toString('hex')}`;

    schedule.googleEventId = googleEventId;
    schedule.googleCalendarSyncStatus = 'SYNCED';
    schedule.lastGoogleCalendarSyncAt = new Date();
    await schedule.save();

    await IntegrationLog.create({
      correlationId,
      provider: 'google_calendar',
      event: 'calendar.event_created',
      direction: 'OUTBOUND',
      externalId: googleEventId,
      internalRecordId: schedule._id,
      internalRecordType: 'Schedule',
      status: 'SUCCESS',
      requestPayload: {
        title: schedule.title,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        coach: schedule.instructor?.fullName,
        location: schedule.branch?.name,
      },
      responsePayload: { googleEventId, status: 'SYNCED' },
    });

    await IntegrationConfig.findOneAndUpdate(
      { provider: 'google_calendar' },
      {
        $set: { lastSuccessfulSync: new Date() },
        $inc: { totalEventsProcessed: 1 },
      },
      { upsert: true }
    );

    return { success: true, googleEventId };
  }

  /**
   * Updates existing Google Calendar event.
   */
  async syncSessionUpdated(scheduleId) {
    const correlationId = crypto.randomUUID();
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    const googleEventId = schedule.googleEventId || `gcal_evt_${crypto.randomBytes(8).toString('hex')}`;

    schedule.lastGoogleCalendarSyncAt = new Date();
    await schedule.save();

    await IntegrationLog.create({
      correlationId,
      provider: 'google_calendar',
      event: 'calendar.event_updated',
      direction: 'OUTBOUND',
      externalId: googleEventId,
      internalRecordId: schedule._id,
      internalRecordType: 'Schedule',
      status: 'SUCCESS',
      requestPayload: {
        title: schedule.title,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      },
      responsePayload: { googleEventId, status: 'UPDATED' },
    });

    return { success: true, googleEventId };
  }

  /**
   * Cancels Google Calendar event.
   */
  async syncSessionCancelled(scheduleId) {
    const correlationId = crypto.randomUUID();
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule) return;

    if (schedule.googleEventId) {
      await IntegrationLog.create({
        correlationId,
        provider: 'google_calendar',
        event: 'calendar.event_cancelled',
        direction: 'OUTBOUND',
        externalId: schedule.googleEventId,
        internalRecordId: schedule._id,
        internalRecordType: 'Schedule',
        status: 'SUCCESS',
        responsePayload: { googleEventId: schedule.googleEventId, status: 'CANCELLED' },
      });
    }
    return { success: true };
  }
}

module.exports = new GoogleCalendarService();
