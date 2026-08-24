const Customer = require('../models/Customer');
const FollowUp = require('../models/FollowUp');
const Activity = require('../models/Activity');
const PaymentLink = require('../models/PaymentLink');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');

/**
 * GET /api/v1/customers
 * Customers are created automatically when a lead converts; this list
 * supports search + pagination like the Leads table.
 */
exports.getCustomers = catchAsync(async (req, res) => {
  const { search = '', assignedTo, page = 1, limit = 10 } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  if (assignedTo) filter.assignedTo = assignedTo;

  const pageNum = Math.max(Number(page), 1);
  const limitNum = Math.min(Math.max(Number(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .populate('assignedTo', 'fullName email')
      .sort({ convertedAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Customer.countDocuments(filter),
  ]);

  return sendResponse(res, 200, 'Customers fetched successfully.', customers, {
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  });
});

/**
 * POST /api/v1/customers
 * Direct student add — for when a student/child needs to be added straight
 * to the roster (e.g. from the Calendar's "new class" form) without going
 * through the Lead -> Convert flow. `originalLead` stays null for these.
 */
exports.createCustomer = catchAsync(async (req, res, next) => {
  const { fullName, email, phone, source, interestedIn, notes, assignedTo } = req.body;

  if (!fullName || !phone) {
    return next(new AppError('Full name and phone number are required.', 400));
  }

  const customer = await Customer.create({
    fullName,
    email,
    phone,
    source,
    interestedIn,
    notes,
    assignedTo: assignedTo || null,
    originalLead: null,
    createdBy: req.user._id,
  });

  return sendResponse(res, 201, 'Student added successfully.', customer);
});

/**
 * GET /api/v1/customers/:id
 */
exports.getCustomer = catchAsync(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id).populate('assignedTo', 'fullName email');
  if (!customer) return next(new AppError('Customer not found.', 404));
  return sendResponse(res, 200, 'Customer fetched successfully.', customer);
});

/**
 * PATCH /api/v1/customers/:id
 */
exports.updateCustomer = catchAsync(async (req, res, next) => {
  const disallowed = ['originalLead', 'convertedAt', 'createdBy'];
  disallowed.forEach((field) => delete req.body[field]);

  const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('assignedTo', 'fullName email');

  if (!customer) return next(new AppError('Customer not found.', 404));
  return sendResponse(res, 200, 'Customer updated successfully.', customer);
});

/**
 * DELETE /api/v1/customers/:id
 * Cascades related follow-ups, activity history and payment links.
 */
exports.deleteCustomer = catchAsync(async (req, res, next) => {
  const customer = await Customer.findByIdAndDelete(req.params.id);
  if (!customer) return next(new AppError('Customer not found.', 404));

  await Promise.all([
    FollowUp.deleteMany({ entityType: 'customer', entityId: customer._id }),
    Activity.deleteMany({ entityType: 'customer', entityId: customer._id }),
    PaymentLink.deleteMany({ customerId: customer._id }),
  ]);

  return sendResponse(res, 200, 'Customer removed successfully.');
});
