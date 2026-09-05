const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const FollowUp = require('../models/FollowUp');
const Activity = require('../models/Activity');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const logActivity = require('../utils/logActivity');
const { PIPELINE_STAGES, OPEN_STAGES } = require('../config/crm.constants');

const applyDateFilter = (filter, { datePeriod, startDate, endDate }) => {
  if (!datePeriod && !startDate && !endDate) return filter;

  const now = new Date();
  let start, end;

  if (datePeriod === 'Daily') {
    start = new Date(now.setHours(0, 0, 0, 0));
    end = new Date(now.setHours(23, 59, 59, 999));
  } else if (datePeriod === 'Weekly') {
    const d = new Date(now);
    const day = d.getDay() || 7;
    if (day !== 1) d.setHours(-24 * (day - 1));
    start = new Date(d.setHours(0, 0, 0, 0));
    end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (datePeriod === 'Monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (datePeriod === 'Yearly') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else if (datePeriod === 'Custom' && (startDate || endDate)) {
    if (startDate) start = new Date(startDate);
    if (endDate) {
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    }
  }

  if (start || end) {
    filter.createdAt = {};
    if (start) filter.createdAt.$gte = start;
    if (end) filter.createdAt.$lte = end;
  }
  return filter;
};

/**
 * GET /api/v1/leads
 * Lead list with search, source/stage/assignedTo filters and pagination —
 * backs the main Leads table.
 */
exports.getLeads = catchAsync(async (req, res) => {
  const { search = '', source, stage, assignedTo, sortBy = 'createdAt', sortOrder = 'desc', sort, page = 1, limit = 10, datePeriod, startDate, endDate } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  if (source) filter.source = source;
  if (stage) filter.stage = stage;
  if (assignedTo) filter.assignedTo = assignedTo;

  applyDateFilter(filter, { datePeriod, startDate, endDate });

  // Build validated sort object
  const sortObj = {};
  const allowedSortFields = {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    fullName: 'fullName',
    stage: 'stage',
    source: 'source',
  };

  let targetField = 'createdAt';
  let targetDirection = -1;

  if (sort === 'newest') {
    targetField = 'createdAt';
    targetDirection = -1;
  } else if (sort === 'oldest') {
    targetField = 'createdAt';
    targetDirection = 1;
  } else if (sort) {
    if (sort.startsWith('-')) {
      const field = sort.slice(1);
      if (allowedSortFields[field]) {
        targetField = allowedSortFields[field];
        targetDirection = -1;
      }
    } else {
      if (allowedSortFields[sort]) {
        targetField = allowedSortFields[sort];
        targetDirection = 1;
      }
    }
  } else if (sortBy && allowedSortFields[sortBy]) {
    targetField = allowedSortFields[sortBy];
    targetDirection = (String(sortOrder).toLowerCase() === 'asc' || String(sortOrder) === '1') ? 1 : -1;
  }

  sortObj[targetField] = targetDirection;

  const pageNum = Math.max(Number(page), 1);
  const limitNum = Math.min(Math.max(Number(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate('assignedTo', 'fullName email')
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum),
    Lead.countDocuments(filter),
  ]);

  return sendResponse(res, 200, 'Leads fetched successfully.', leads, {
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  });
});

/**
 * GET /api/v1/leads/pipeline
 * List of leads (all stages) for the Kanban pipeline board with sorting & filtering.
 * Registered before "/:id" so it isn't swallowed by the id route.
 */
exports.getPipeline = catchAsync(async (req, res) => {
  const { assignedTo, stage, source, search = '', sortBy = 'createdAt', sortOrder = 'desc', sort, datePeriod, startDate, endDate } = req.query;

  const filter = {};
  if (assignedTo) filter.assignedTo = assignedTo;
  if (stage) filter.stage = stage;
  if (source) filter.source = source;
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  applyDateFilter(filter, { datePeriod, startDate, endDate });

  // Build validated sort object
  const sortObj = {};
  const allowedSortFields = {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    fullName: 'fullName',
    source: 'source',
  };

  let targetField = 'createdAt';
  let targetDirection = -1;

  if (sort === 'newest') {
    targetField = 'createdAt';
    targetDirection = -1;
  } else if (sort === 'oldest') {
    targetField = 'createdAt';
    targetDirection = 1;
  } else if (sort) {
    if (sort.startsWith('-')) {
      const field = sort.slice(1);
      if (allowedSortFields[field]) {
        targetField = allowedSortFields[field];
        targetDirection = -1;
      }
    } else {
      if (allowedSortFields[sort]) {
        targetField = allowedSortFields[sort];
        targetDirection = 1;
      }
    }
  } else if (sortBy && allowedSortFields[sortBy]) {
    targetField = allowedSortFields[sortBy];
    targetDirection = (String(sortOrder).toLowerCase() === 'asc' || String(sortOrder) === '1') ? 1 : -1;
  }

  sortObj[targetField] = targetDirection;

  const leads = await Lead.find(filter)
    .populate('assignedTo', 'fullName email')
    .sort(sortObj);

  return sendResponse(res, 200, 'Pipeline fetched successfully.', leads);
});

/**
 * GET /api/v1/leads/:id
 */
exports.getLead = catchAsync(async (req, res, next) => {
  const lead = await Lead.findById(req.params.id).populate('assignedTo', 'fullName email');
  if (!lead) return next(new AppError('Lead not found.', 404));
  return sendResponse(res, 200, 'Lead fetched successfully.', lead);
});

/**
 * POST /api/v1/leads
 * Lead capture — the entry point for the entire sales workflow.
 */
exports.createLead = catchAsync(async (req, res) => {
  const { fullName, email, phone, source, interestedIn, assignedTo, notes } = req.body;

  const lead = await Lead.create({
    fullName,
    email,
    phone,
    source,
    interestedIn,
    notes,
    assignedTo: assignedTo || null,
    createdBy: req.user._id,
  });

  if (lead.assignedTo) {
    await logActivity({
      entityType: 'lead',
      entityId: lead._id,
      type: 'assignment',
      description: 'Lead captured and assigned.',
      performedBy: req.user._id,
    });
  }

  await lead.populate('assignedTo', 'fullName email');
  return sendResponse(res, 201, 'Lead captured successfully.', lead);
});

/**
 * PATCH /api/v1/leads/:id
 * General edit form (name/contact/source/interestedIn/notes/assignedTo).
 * Stage transitions and dedicated (re)assignment go through their own
 * endpoints so they can be logged distinctly on the activity timeline.
 */
exports.updateLead = catchAsync(async (req, res, next) => {
  const disallowed = ['stage', 'convertedToCustomer', 'convertedAt', 'createdBy', 'externalId'];
  disallowed.forEach((field) => delete req.body[field]);

  const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('assignedTo', 'fullName email');

  if (!lead) return next(new AppError('Lead not found.', 404));
  return sendResponse(res, 200, 'Lead updated successfully.', lead);
});

/**
 * DELETE /api/v1/leads/:id
 * Cascades related follow-ups and activity history for this lead.
 */
exports.deleteLead = catchAsync(async (req, res, next) => {
  const lead = await Lead.findByIdAndDelete(req.params.id);
  if (!lead) return next(new AppError('Lead not found.', 404));

  await Promise.all([
    FollowUp.deleteMany({ entityType: 'lead', entityId: lead._id }),
    Activity.deleteMany({ entityType: 'lead', entityId: lead._id }),
  ]);

  return sendResponse(res, 200, 'Lead deleted successfully.');
});

/**
 * PATCH /api/v1/leads/:id/assign
 * Lead assignment & distribution to a sales rep.
 */
exports.assignLead = catchAsync(async (req, res, next) => {
  const { assignedTo } = req.body;
  if (!assignedTo) return next(new AppError('A sales representative must be selected.', 400));

  const lead = await Lead.findByIdAndUpdate(
    req.params.id,
    { assignedTo },
    { new: true, runValidators: true }
  ).populate('assignedTo', 'fullName email');

  if (!lead) return next(new AppError('Lead not found.', 404));

  await logActivity({
    entityType: 'lead',
    entityId: lead._id,
    type: 'assignment',
    description: `Assigned to ${lead.assignedTo?.fullName || 'a sales representative'}.`,
    performedBy: req.user._id,
  });

  return sendResponse(res, 200, 'Lead assignment updated.', lead);
});

/**
 * PATCH /api/v1/leads/bulk-assign
 * Bulk lead distribution across multiple leads at once.
 */
exports.bulkAssign = catchAsync(async (req, res, next) => {
  const { leadIds, assignedTo } = req.body;

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return next(new AppError('At least one lead must be selected.', 400));
  }
  if (!assignedTo) return next(new AppError('A sales representative must be selected.', 400));

  const validIds = leadIds.filter((id) => mongoose.isValidObjectId(id));

  const result = await Lead.updateMany(
    { _id: { $in: validIds } },
    { $set: { assignedTo } }
  );

  await Promise.all(
    validIds.map((id) =>
      logActivity({
        entityType: 'lead',
        entityId: id,
        type: 'assignment',
        description: 'Lead reassigned via bulk assignment.',
        performedBy: req.user._id,
      })
    )
  );

  return sendResponse(res, 200, `${result.modifiedCount} lead(s) reassigned.`, {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });
});

/**
 * PATCH /api/v1/leads/:id/stage
 * Sales stage / pipeline progression.
 */
exports.updateStage = catchAsync(async (req, res, next) => {
  const { stage } = req.body;
  if (!PIPELINE_STAGES.includes(stage)) {
    return next(new AppError('Invalid pipeline stage.', 400));
  }

  const existing = await Lead.findById(req.params.id);
  if (!existing) return next(new AppError('Lead not found.', 404));

  if (existing.stage === stage) {
    await existing.populate('assignedTo', 'fullName email');
    return sendResponse(res, 200, 'Lead is already at this stage.', existing);
  }

  const previousStage = existing.stage;
  existing.stage = stage;
  await existing.save();
  await existing.populate('assignedTo', 'fullName email');

  await logActivity({
    entityType: 'lead',
    entityId: existing._id,
    type: 'stage_change',
    description: `Stage changed from "${previousStage}" to "${stage}".`,
    performedBy: req.user._id,
    metadata: { from: previousStage, to: stage },
  });

  return sendResponse(res, 200, 'Pipeline stage updated.', existing);
});

/**
 * POST /api/v1/leads/:id/convert
 * Lead conversion process: creates a Customer from the lead, moves the
 * lead to the "won" stage, and re-homes follow-up/activity history onto
 * the new customer record so nothing is lost.
 */
exports.convertLead = catchAsync(async (req, res, next) => {
  const { conversionNote = '' } = req.body;

  const lead = await Lead.findById(req.params.id);
  if (!lead) return next(new AppError('Lead not found.', 404));
  if (lead.convertedToCustomer) {
    return next(new AppError('This lead has already been converted.', 409));
  }
  if (lead.stage === 'lost') {
    return next(new AppError('A lost lead cannot be converted.', 400));
  }

  const customer = await Customer.create({
    fullName: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    interestedIn: lead.interestedIn,
    notes: lead.notes,
    assignedTo: lead.assignedTo,
    originalLead: lead._id,
    conversionNote,
    convertedAt: new Date(),
    createdBy: req.user._id,
  });

  lead.stage = 'won';
  lead.convertedToCustomer = customer._id;
  lead.convertedAt = new Date();
  await lead.save();

  // Carry follow-up & activity history from the lead over to the new customer
  // record so "Convert to customer" keeps everything intact, as promised in the UI.
  await Promise.all([
    FollowUp.updateMany(
      { entityType: 'lead', entityId: lead._id },
      { $set: { entityType: 'customer', entityId: customer._id } }
    ),
    Activity.updateMany(
      { entityType: 'lead', entityId: lead._id },
      { $set: { entityType: 'customer', entityId: customer._id } }
    ),
  ]);

  await logActivity({
    entityType: 'customer',
    entityId: customer._id,
    type: 'conversion',
    description: conversionNote || 'Lead converted to customer.',
    performedBy: req.user._id,
  });

  await customer.populate('assignedTo', 'fullName email');
  return sendResponse(res, 201, `${lead.fullName} converted to a customer.`, customer);
});

/**
 * GET /api/v1/leads/export
 * Export filtered/permitted leads dataset as a downloadable CSV file.
 */
exports.exportLeads = catchAsync(async (req, res) => {
  const { search = '', source, stage, assignedTo, sortBy = 'createdAt', sortOrder = 'desc', datePeriod, startDate, endDate } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  if (source) filter.source = source;
  if (stage) filter.stage = stage;
  if (assignedTo) filter.assignedTo = assignedTo;

  applyDateFilter(filter, { datePeriod, startDate, endDate });

  const sortObj = {};
  const allowedSortFields = {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    fullName: 'fullName',
    stage: 'stage',
    source: 'source',
  };
  const targetField = allowedSortFields[sortBy] || 'createdAt';
  const targetDirection = (String(sortOrder).toLowerCase() === 'asc' || String(sortOrder) === '1') ? 1 : -1;
  sortObj[targetField] = targetDirection;

  const leads = await Lead.find(filter)
    .populate('assignedTo', 'fullName email')
    .sort(sortObj)
    .lean();

  const headers = [
    'Full Name',
    'Phone',
    'Email',
    'Source',
    'Stage',
    'Assigned To',
    'Created Date',
    'Last Contacted',
    'Follow Up Date',
    'Interest Level',
    'Subject / Program',
    'Notes',
    'City',
    'Age',
    'Gender',
    'Nationality',
    'Guardian Name',
    'Guardian Phone',
    'Guardian Email',
  ];

  const sanitizeCell = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    if (/^[=+\-@]/.test(str)) {
      str = "'" + str;
    }
    if (/[",\n\r]/.test(str)) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const csvRows = [headers.map(sanitizeCell).join(',')];

  leads.forEach((l) => {
    const row = [
      l.fullName,
      l.phone,
      l.email,
      l.source,
      l.stage,
      l.assignedTo?.fullName || '',
      l.createdAt ? new Date(l.createdAt).toISOString().split('T')[0] : '',
      l.lastContacted ? new Date(l.lastContacted).toISOString().split('T')[0] : '',
      l.followUpDate ? new Date(l.followUpDate).toISOString().split('T')[0] : '',
      l.interestLevel,
      l.interestedIn || l.subject,
      l.notes,
      l.city,
      l.age,
      l.gender,
      l.nationality,
      l.guardianName,
      l.guardianPhone,
      l.guardianEmail,
    ];
    csvRows.push(row.map(sanitizeCell).join(','));
  });

  const csvContent = '\uFEFF' + csvRows.join('\n');
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `aqua-fishing-leads-${dateStr}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(csvContent);
});

