const Activity = require('../models/Activity');

/**
 * Writes a system-generated entry to the unified activity timeline
 * (stage_change, assignment, conversion, payment_link, ...).
 * Never throws — a logging failure should not break the primary action.
 */
const logActivity = async ({ entityType, entityId, type, description, performedBy, metadata }) => {
  try {
    await Activity.create({ entityType, entityId, type, description, performedBy, metadata });
  } catch (err) {
    console.error(`[logActivity] Failed to log "${type}" for ${entityType}:${entityId} — ${err.message}`);
  }
};

module.exports = logActivity;
