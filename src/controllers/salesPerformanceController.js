const Lead = require('../models/Lead');
const PaymentLink = require('../models/PaymentLink');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const { PIPELINE_STAGES, PIPELINE_STAGE_CONFIG } = require('../config/crm.constants');

const parseDateRange = (query) => {
  const range = query.range || 'all';
  const now = new Date();
  let start = null;
  let end = null;

  if (range === 'today') {
    start = new Date(now); start.setHours(0, 0, 0, 0);
    end = new Date(now); end.setHours(23, 59, 59, 999);
  } else if (range === 'this_week') {
    start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    end = new Date(now); end.setHours(23, 59, 59, 999);
  } else if (range === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (range === 'this_year' || range === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else if (range === '7d') {
    start = new Date(now); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
    end = new Date(now); end.setHours(23, 59, 59, 999);
  } else if (range === '30d') {
    start = new Date(now); start.setDate(now.getDate() - 30); start.setHours(0, 0, 0, 0);
    end = new Date(now); end.setHours(23, 59, 59, 999);
  } else if (range === '90d') {
    start = new Date(now); start.setDate(now.getDate() - 90); start.setHours(0, 0, 0, 0);
    end = new Date(now); end.setHours(23, 59, 59, 999);
  } else if (range === 'custom' && (query.startDate || query.endDate)) {
    if (query.startDate) { start = new Date(query.startDate); start.setHours(0, 0, 0, 0); }
    if (query.endDate) { end = new Date(query.endDate); end.setHours(23, 59, 59, 999); }
  }

  return { start, end };
};

/**
 * GET /api/v1/sales-performance/overview
 * New leads, conversion rate, revenue closed and average deal size for the range.
 */
exports.getOverview = catchAsync(async (req, res) => {
  const { start, end } = parseDateRange(req.query);

  const leadMatch = {};
  if (start || end) {
    leadMatch.createdAt = {};
    if (start) leadMatch.createdAt.$gte = start;
    if (end) leadMatch.createdAt.$lte = end;
  }

  const wonMatch = { stage: 'won' };
  if (start || end) {
    const timeMatch = {};
    if (start) timeMatch.$gte = start;
    if (end) timeMatch.$lte = end;
    wonMatch.$or = [
      { convertedAt: timeMatch },
      { createdAt: timeMatch }
    ];
  }

  const linkMatch = { status: 'paid' };
  if (start || end) {
    linkMatch.paidAt = {};
    if (start) linkMatch.paidAt.$gte = start;
    if (end) linkMatch.paidAt.$lte = end;
  }

  const [newLeads, totalLeadsInRange, wonLeads, paidLinks] = await Promise.all([
    Lead.countDocuments(leadMatch),
    Lead.countDocuments(leadMatch),
    Lead.countDocuments(wonMatch),
    PaymentLink.find(linkMatch).select('amount'),
  ]);

  const revenue = paidLinks.reduce((sum, l) => sum + (l.amount || 0), 0);
  const conversionRate = totalLeadsInRange > 0 ? Math.round((wonLeads / totalLeadsInRange) * 100) : 0;
  const avgDealSize = wonLeads > 0 ? Math.round(revenue / wonLeads) : 0;

  return sendResponse(res, 200, 'Sales overview fetched successfully.', {
    newLeads,
    conversionRate,
    revenue,
    avgDealSize,
    wonLeads,
  });
});

/**
 * GET /api/v1/sales-performance/by-rep
 * Revenue (from paid payment links) attributed to each sales rep's customers.
 */
exports.getByRep = catchAsync(async (req, res) => {
  const { start, end } = parseDateRange(req.query);

  const match = { status: 'paid' };
  if (start || end) {
    match.paidAt = {};
    if (start) match.paidAt.$gte = start;
    if (end) match.paidAt.$lte = end;
  }

  const results = await PaymentLink.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'customers',
        localField: 'customerId',
        foreignField: '_id',
        as: 'customer',
      },
    },
    { $unwind: '$customer' },
    { $match: { 'customer.assignedTo': { $ne: null } } },
    {
      $group: {
        _id: '$customer.assignedTo',
        revenue: { $sum: '$amount' },
        dealCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 1,
        fullName: '$user.fullName',
        revenue: 1,
        dealCount: 1,
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  return sendResponse(res, 200, 'Revenue by sales rep fetched successfully.', results);
});

/**
 * GET /api/v1/sales-performance/by-source
 * Lead volume grouped by acquisition source.
 */
exports.getBySource = catchAsync(async (req, res) => {
  const { start, end } = parseDateRange(req.query);
  
  const match = {};
  if (start || end) {
    match.createdAt = {};
    if (start) match.createdAt.$gte = start;
    if (end) match.createdAt.$lte = end;
  }

  const results = await Lead.aggregate([
    ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
    { $group: { _id: '$source', leadCount: { $sum: 1 } } },
    { $project: { _id: 0, source: { $ifNull: ['$_id', 'Other'] }, leadCount: 1 } },
    { $sort: { leadCount: -1 } },
  ]);

  return sendResponse(res, 200, 'Leads by source fetched successfully.', results);
});

/**
 * GET /api/v1/sales-performance/by-stage
 * Pipeline distribution — how many leads currently sit in each stage
 * (of those matching the selected range).
 */
exports.getByStage = catchAsync(async (req, res) => {
  const { start, end } = parseDateRange(req.query);

  const match = {};
  if (start || end) {
    match.createdAt = {};
    if (start) match.createdAt.$gte = start;
    if (end) match.createdAt.$lte = end;
  }

  const raw = await Lead.aggregate([
    ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
    { $group: { _id: '$stage', count: { $sum: 1 } } },
  ]);

  const countsByStage = raw.reduce((acc, r) => ({ ...acc, [r._id ? String(r._id).toLowerCase() : '']: r.count }), {});
  
  const activeStages = (PIPELINE_STAGE_CONFIG || []).filter((s) => s.active !== false);
  const results = activeStages.map((stage) => ({
    stage: stage.key,
    stageName: stage.label,
    stageOrder: stage.order,
    count: countsByStage[stage.key.toLowerCase()] || 0,
  }));

  return sendResponse(res, 200, 'Pipeline distribution fetched successfully.', results);
});
