const Activity = require('../models/Activity');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const { ENTITY_TYPES, LOGGABLE_ACTIVITY_TYPES } = require('../config/crm.constants');

/**
 * GET /api/v1/activities?entityType=lead|customer&entityId=...
 * Newest first so the timeline reads top-to-bottom as "most recent first".
 */
exports.getActivities = catchAsync(async (req, res, next) => {
  const { entityType, entityId } = req.query;

  if (!entityType || !entityId) {
    return next(new AppError('entityType and entityId are required.', 400));
  }
  if (!ENTITY_TYPES.includes(entityType)) {
    return next(new AppError('Invalid entityType.', 400));
  }

  const activities = await Activity.find({ entityType, entityId })
    .populate('performedBy', 'fullName')
    .sort({ createdAt: -1 });

  return sendResponse(res, 200, 'Activities fetched successfully.', activities);
});

/**
 * POST /api/v1/activities
 * Manually logged customer interaction (note/call/email/meeting/whatsapp).
 */
exports.logActivity = catchAsync(async (req, res, next) => {
  const { entityType, entityId, type, description } = req.body;

  if (!entityType || !entityId) {
    return next(new AppError('entityType and entityId are required.', 400));
  }
  if (!LOGGABLE_ACTIVITY_TYPES.includes(type)) {
    return next(new AppError('Invalid interaction type.', 400));
  }

  const activity = await Activity.create({
    entityType,
    entityId,
    type,
    description,
    performedBy: req.user._id,
  });

  await activity.populate('performedBy', 'fullName');
  return sendResponse(res, 201, 'Interaction logged.', activity);
});
