const Subject = require('../models/Subject');
const Activity = require('../models/Activity');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');

// Default initial subjects to seed on first load if collection is empty
const INITIAL_DEFAULT_SUBJECTS = [
  { name: 'Art & Craft', defaultDuration: 60, sortOrder: 1 },
  { name: 'Biology', defaultDuration: 90, sortOrder: 2 },
  { name: 'Chemistry', defaultDuration: 60, sortOrder: 3 },
  { name: 'Computer Science', defaultDuration: 60, sortOrder: 4 },
  { name: 'English', defaultDuration: 45, sortOrder: 5 },
  { name: 'General Science', defaultDuration: 60, sortOrder: 6 },
  { name: 'History', defaultDuration: 45, sortOrder: 7 },
  { name: 'Mathematics', defaultDuration: 60, sortOrder: 8 },
  { name: 'Physical Training', defaultDuration: 60, sortOrder: 9 },
  { name: 'Physics', defaultDuration: 60, sortOrder: 10 },
  { name: 'Marine Biology', defaultDuration: 90, sortOrder: 11 },
  { name: 'Boat Handling & Safety', defaultDuration: 120, sortOrder: 12 },
  { name: 'Angling & Casting Techniques', defaultDuration: 75, sortOrder: 13 },
];

const seedDefaultsIfEmpty = async () => {
  const count = await Subject.countDocuments();
  if (count === 0) {
    await Subject.insertMany(INITIAL_DEFAULT_SUBJECTS);
  }
};

/**
 * GET /api/v1/subjects
 */
exports.getSubjects = catchAsync(async (req, res) => {
  await seedDefaultsIfEmpty();

  const { includeArchived = 'false', search = '' } = req.query;
  const filter = {};

  if (includeArchived !== 'true') {
    filter.status = 'active';
  } else {
    filter.status = { $ne: 'archived' };
  }

  if (search) {
    filter.name = { $regex: search, $options: 'i' };
  }

  const subjects = await Subject.find(filter).sort({ sortOrder: 1, name: 1 });
  return sendResponse(res, 200, 'Subjects fetched successfully.', subjects);
});

/**
 * GET /api/v1/subjects/:id
 */
exports.getSubject = catchAsync(async (req, res, next) => {
  const subject = await Subject.findById(req.params.id);
  if (!subject) return next(new AppError('Subject not found.', 404));
  return sendResponse(res, 200, 'Subject details fetched successfully.', subject);
});

/**
 * POST /api/v1/subjects
 */
exports.createSubject = catchAsync(async (req, res, next) => {
  const { name, defaultDuration = 60, description = '', sortOrder = 0, color = '#0ea5e9', status = 'active' } = req.body;

  if (!name || !name.trim()) {
    return next(new AppError('Subject name is required.', 400));
  }

  const trimmedName = name.trim();
  const existing = await Subject.findOne({ name: { $regex: new RegExp(`^${trimmedName}$`, 'i') } });
  if (existing) {
    return next(new AppError(`A subject named "${trimmedName}" already exists.`, 400));
  }

  const durationNum = Number(defaultDuration);
  if (isNaN(durationNum) || durationNum <= 0) {
    return next(new AppError('Default duration must be a positive number of minutes.', 400));
  }

  const subject = await Subject.create({
    name: trimmedName,
    defaultDuration: durationNum,
    description: description.trim(),
    sortOrder: Number(sortOrder) || 0,
    color,
    status,
    createdBy: req.user?._id || null,
  });

  try {
    await Activity.create({
      action: 'SUBJECT_CREATED',
      entityType: 'subject',
      entityId: subject._id,
      title: 'New Subject Created',
      description: `Created subject "${subject.name}" with default duration ${subject.defaultDuration} mins.`,
      performedBy: req.user?._id || null,
    });
  } catch (e) {}

  return sendResponse(res, 201, 'Subject created successfully.', subject);
});

/**
 * PATCH /api/v1/subjects/:id
 */
exports.updateSubject = catchAsync(async (req, res, next) => {
  const subject = await Subject.findById(req.params.id);
  if (!subject) return next(new AppError('Subject not found.', 404));

  const { name, defaultDuration, description, sortOrder, color, status } = req.body;

  if (name && name.trim() !== subject.name) {
    const trimmedName = name.trim();
    const existing = await Subject.findOne({
      _id: { $ne: subject._id },
      name: { $regex: new RegExp(`^${trimmedName}$`, 'i') }
    });
    if (existing) {
      return next(new AppError(`Another subject named "${trimmedName}" already exists.`, 400));
    }
    subject.name = trimmedName;
  }

  if (defaultDuration !== undefined) {
    const durationNum = Number(defaultDuration);
    if (isNaN(durationNum) || durationNum <= 0) {
      return next(new AppError('Default duration must be a positive number of minutes.', 400));
    }
    subject.defaultDuration = durationNum;
  }

  if (description !== undefined) subject.description = description.trim();
  if (sortOrder !== undefined) subject.sortOrder = Number(sortOrder) || 0;
  if (color !== undefined) subject.color = color;
  if (status !== undefined) subject.status = status;
  subject.updatedBy = req.user?._id || null;

  await subject.save();

  try {
    await Activity.create({
      action: 'SUBJECT_UPDATED',
      entityType: 'subject',
      entityId: subject._id,
      title: 'Subject Updated',
      description: `Updated subject "${subject.name}" (Default duration: ${subject.defaultDuration} mins, Status: ${subject.status}).`,
      performedBy: req.user?._id || null,
    });
  } catch (e) {}

  return sendResponse(res, 200, 'Subject updated successfully.', subject);
});

/**
 * DELETE /api/v1/subjects/:id
 * Safe archive - deactivates the subject from new selections without breaking historical events
 */
exports.deleteSubject = catchAsync(async (req, res, next) => {
  const subject = await Subject.findById(req.params.id);
  if (!subject) return next(new AppError('Subject not found.', 404));

  subject.status = 'archived';
  subject.updatedBy = req.user?._id || null;
  await subject.save();

  try {
    await Activity.create({
      action: 'SUBJECT_ARCHIVED',
      entityType: 'subject',
      entityId: subject._id,
      title: 'Subject Archived',
      description: `Archived subject "${subject.name}".`,
      performedBy: req.user?._id || null,
    });
  } catch (e) {}

  return sendResponse(res, 200, 'Subject archived successfully.');
});
