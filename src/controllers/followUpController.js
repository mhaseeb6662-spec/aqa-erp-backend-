const FollowUp = require('../models/FollowUp');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const { ENTITY_TYPES } = require('../config/crm.constants');

/**
 * GET /api/v1/follow-ups?entityType=lead|customer&entityId=...
 */
exports.getFollowUps = catchAsync(async (req, res, next) => {
  const { entityType, entityId } = req.query;

  if (!entityType || !entityId) {
    return next(new AppError('entityType and entityId are required.', 400));
  }
  if (!ENTITY_TYPES.includes(entityType)) {
    return next(new AppError('Invalid entityType.', 400));
  }

  const followUps = await FollowUp.find({ entityType, entityId }).sort({ dueDate: 1 });
  return sendResponse(res, 200, 'Follow-ups fetched successfully.', followUps);
});

/**
 * GET /api/v1/follow-ups/mine
 * Follow-ups scheduled by the current user — used for a personal
 * "what do I need to do today" style view.
 */
exports.getMyFollowUps = catchAsync(async (req, res) => {
  const { status } = req.query;

  const filter = { createdBy: req.user._id };
  if (status) filter.status = status;

  const followUps = await FollowUp.find(filter).sort({ dueDate: 1 });
  return sendResponse(res, 200, 'Your follow-ups fetched successfully.', followUps);
});

/**
 * POST /api/v1/follow-ups
 */
exports.createFollowUp = catchAsync(async (req, res, next) => {
  const { entityType, entityId, type, dueDate, notes } = req.body;

  if (!entityType || !entityId) {
    return next(new AppError('entityType and entityId are required.', 400));
  }

  const followUp = await FollowUp.create({
    entityType,
    entityId,
    type,
    dueDate,
    notes,
    createdBy: req.user._id,
  });

  return sendResponse(res, 201, 'Follow-up scheduled.', followUp);
});

/**
 * PATCH /api/v1/follow-ups/:id
 */
exports.updateFollowUp = catchAsync(async (req, res, next) => {
  const disallowed = ['entityType', 'entityId', 'createdBy', 'completedAt'];
  disallowed.forEach((field) => delete req.body[field]);

  const followUp = await FollowUp.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!followUp) return next(new AppError('Follow-up not found.', 404));
  return sendResponse(res, 200, 'Follow-up updated.', followUp);
});

/**
 * PATCH /api/v1/follow-ups/:id/complete
 */
exports.completeFollowUp = catchAsync(async (req, res, next) => {
  const { outcomeNote = '' } = req.body;

  const followUp = await FollowUp.findByIdAndUpdate(
    req.params.id,
    { status: 'completed', outcomeNote, completedAt: new Date() },
    { new: true }
  );

  if (!followUp) return next(new AppError('Follow-up not found.', 404));
  return sendResponse(res, 200, 'Follow-up marked complete.', followUp);
});

/**
 * DELETE /api/v1/follow-ups/:id
 */
exports.deleteFollowUp = catchAsync(async (req, res, next) => {
  const followUp = await FollowUp.findByIdAndDelete(req.params.id);
  if (!followUp) return next(new AppError('Follow-up not found.', 404));
  return sendResponse(res, 200, 'Follow-up removed.');
});
