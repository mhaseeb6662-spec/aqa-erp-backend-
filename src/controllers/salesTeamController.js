const User = require('../models/User');
const Role = require('../models/Role');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const { OPEN_STAGES } = require('../config/crm.constants');

/**
 * Computes workload/pipeline stats for a single sales rep:
 * open leads currently assigned, customers they've won, and their
 * lead -> customer conversion rate.
 */
const computeStats = async (userId) => {
  const [openLeads, totalLeadsAssigned, customers] = await Promise.all([
    Lead.countDocuments({ assignedTo: userId, stage: { $in: OPEN_STAGES } }),
    Lead.countDocuments({ assignedTo: userId }),
    Customer.countDocuments({ assignedTo: userId }),
  ]);

  const conversionRate = totalLeadsAssigned > 0 ? Math.round((customers / totalLeadsAssigned) * 100) : 0;

  return { openLeads, customers, conversionRate, totalLeadsAssigned };
};

/**
 * GET /api/v1/sales-team
 * Sales team roster (Sales Manager + Sales Agent roles) with workload stats.
 * Backs both the assignment dropdowns (leads/customers forms) and the
 * Sales Team page.
 */
exports.getSalesTeam = catchAsync(async (req, res) => {
  const salesRoles = await Role.find({ slug: { $in: ['sales-manager', 'sales-agent'] } }).select('_id');
  const roleIds = salesRoles.map((r) => r._id);

  const members = await User.find({ role: { $in: roleIds }, status: 'active' })
    .select('fullName email phone role branch avatarUrl')
    .populate('role', 'name slug')
    .sort({ fullName: 1 });

  const withStats = await Promise.all(
    members.map(async (m) => {
      const stats = await computeStats(m._id);
      return { ...m.toObject(), stats };
    })
  );

  return sendResponse(res, 200, 'Sales team fetched successfully.', withStats);
});

/**
 * GET /api/v1/sales-team/:userId/stats
 */
exports.getTeamMemberStats = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.userId).populate('role', 'name slug');
  if (!user) return next(new AppError('Sales team member not found.', 404));

  const stats = await computeStats(user._id);
  return sendResponse(res, 200, 'Team member stats fetched successfully.', {
    _id: user._id,
    fullName: user.fullName,
    role: user.role,
    stats,
  });
});
