const Lead = require('../models/Lead');
const logActivity = require('./logActivity');
const { pickLeastLoadedAgent } = require('./autoAssign');

/**
 * Shared entry point for every inbound lead-ingestion webhook (Meta/
 * Facebook Lead Ads, Google Ads Lead Form, WhatsApp). Responsible for:
 *
 *  1. Deduping so a webhook retry / redelivery never creates a second
 *     Lead — keyed on (source, externalId) when the platform gives us a
 *     stable id, otherwise on phone number (optionally across all
 *     sources, for WhatsApp — see `matchAnySource`).
 *  2. Auto-assigning brand-new leads to the least-loaded active Sales
 *     Agent, same as a human dispatcher would.
 *  3. Writing the activity-timeline entries so the capture is visible on
 *     the lead the same way manual entries are.
 *
 * Never throws for "expected" duplicate-key races — those are treated as
 * a successful match against the lead the parallel request just created.
 */
const ingestWebhookLead = async ({
  fullName,
  phone,
  email = '',
  source,
  externalId,
  interestedIn = '',
  notes = '',
  matchAnySource = false,
  newLeadDescription,
  existingLeadDescription,
  existingLeadActivityType = 'note',
}) => {
  if (!phone && !externalId) {
    return { lead: null, created: false, skipped: 'missing-phone-and-externalId' };
  }

  const dedupeFilter = externalId
    ? { source, externalId }
    : matchAnySource
    ? { phone }
    : { source, phone };

  let lead = await Lead.findOne(dedupeFilter).sort({ createdAt: -1 });

  if (lead) {
    await logActivity({
      entityType: 'lead',
      entityId: lead._id,
      type: existingLeadActivityType,
      description: existingLeadDescription || `Additional contact received via ${source} — matched to this existing lead.`,
    });
    await lead.populate('assignedTo', 'fullName email');
    return { lead, created: false };
  }

  const assignedTo = await pickLeastLoadedAgent();

  // Only include externalId in the payload when it actually has a value —
  // never pass `null`/`undefined` explicitly, so the field stays fully
  // absent on the document (required for the partial unique index above
  // to only ever apply to webhook-sourced leads, not every lead sharing a
  // source with each other).
  const createPayload = {
    fullName: fullName?.trim() || `Unknown (${source})`,
    phone,
    email,
    source,
    interestedIn,
    notes,
    assignedTo,
  };
  if (externalId) createPayload.externalId = externalId;

  try {
    lead = await Lead.create(createPayload);
  } catch (err) {
    // Two webhook deliveries landed at (almost) the same time and both
    // passed the findOne check above — the unique (source, externalId)
    // index caught the race. Treat it as a normal duplicate match.
    if (err.code === 11000 && externalId) {
      lead = await Lead.findOne({ source, externalId });
      if (lead) {
        await lead.populate('assignedTo', 'fullName email');
        return { lead, created: false };
      }
    }
    throw err;
  }

  await logActivity({
    entityType: 'lead',
    entityId: lead._id,
    type: 'note',
    description: newLeadDescription || `Lead auto-captured via ${source}.`,
  });

  if (assignedTo) {
    await logActivity({
      entityType: 'lead',
      entityId: lead._id,
      type: 'assignment',
      description: 'Auto-assigned to the least-loaded sales agent.',
    });
  }

  await lead.populate('assignedTo', 'fullName email');
  return { lead, created: true };
};

module.exports = ingestWebhookLead;
