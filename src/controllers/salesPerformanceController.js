const Lead = require('../models/Lead');
const PaymentLink = require('../models/PaymentLink');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const { PIPELINE_STAGES } = require('../config/crm.constants');

/**
 * Resolves a "range" query param (7d | 30d | 90d | year) into a start date.
 * Defaults to the last 30 days for anything unrecognized.
 */
const resolveSince = (range) => {
  const now = new Date();
  const since = new Date(now);
  switch (range) {
    case '7d':
      since.setDate(now.getDate() - 7);
      break;
    case '90d':
      since.setDate(now.getDate() - 90);
      break;
    case 'year':
      since.setFullYear(now.getFullYear() - 1);
      break;
    case '30d':
    default:
      since.setDate(now.getDate() - 30);
      break;
  }
  return since;
};

/**
 * GET /api/v1/sales-performance/overview
 * New leads, conversion rate, revenue closed and average deal size for the range.
 */
exports.getOverview = catchAsync(async (req, res) => {
  const since = resolveSince(req.query.range);

  const [newLeads, totalLeadsInRange, wonLeads, paidLinks] = await Promise.all([
    Lead.countDocuments({ createdAt: { $gte: since } }),
    Lead.countDocuments({ createdAt: { $gte: since } }),
    Lead.countDocuments({ stage: 'won', convertedAt: { $gte: since } }),
    PaymentLink.find({ status: 'paid', paidAt: { $gte: since } }).select('amount'),
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
  const since = resolveSince(req.query.range);

  const results = await PaymentLink.aggregate([
    { $match: { status: 'paid', paidAt: { $gte: since } } },
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
  const since = resolveSince(req.query.range);

  const results = await Lead.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$source', leadCount: { $sum: 1 } } },
    { $project: { _id: 0, source: '$_id', leadCount: 1 } },
    { $sort: { leadCount: -1 } },
  ]);

  return sendResponse(res, 200, 'Leads by source fetched successfully.', results);
});

/**
 * GET /api/v1/sales-performance/by-stage
 * Pipeline distribution — how many leads currently sit in each stage
 * (of those created within the selected range).
 */
exports.getByStage = catchAsync(async (req, res) => {
  const since = resolveSince(req.query.range);

  const raw = await Lead.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$stage', count: { $sum: 1 } } },
  ]);

  const countsByStage = raw.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});
  const results = PIPELINE_STAGES.map((stage) => ({ stage, count: countsByStage[stage] || 0 }));

  return sendResponse(res, 200, 'Pipeline distribution fetched successfully.', results);
});
