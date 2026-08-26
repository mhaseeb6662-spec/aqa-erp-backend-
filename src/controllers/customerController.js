const Customer = require('../models/Customer');
const FollowUp = require('../models/FollowUp');
const Activity = require('../models/Activity');
const PaymentLink = require('../models/PaymentLink');
const User = require('../models/User');
const Role = require('../models/Role');
const StudentProfile = require('../models/StudentProfile');
const ParentProfile = require('../models/ParentProfile');
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
      { parentFullName: { $regex: search, $options: 'i' } },
      { parentEmail: { $regex: search, $options: 'i' } },
      { parentPhone: { $regex: search, $options: 'i' } },
    ];
  }
  if (assignedTo) filter.assignedTo = assignedTo;

  const pageNum = Math.max(Number(page), 1);
  const limitNum = Math.min(Math.max(Number(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .populate('assignedTo', 'fullName email')
      .sort({ convertedAt: -1, createdAt: -1 })
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
 * Complete student registration form supporting all client template fields,
 * automatic parent matching/linking, and Student Profile synchronization.
 */
exports.createCustomer = catchAsync(async (req, res, next) => {
  const {
    firstName = '',
    lastName = '',
    phone,
    email = '',
    dateOfBirth,
    gender,
    nationality = '',
    emiratesIdUrl = '',
    emiratesIdMetadata = {},
    streetAddress = '',
    country = 'United Arab Emirates',
    city = 'Dubai',
    state = '',
    zipCode = '',
    parentFullName = '',
    parentEmail = '',
    parentPhone = '',
    parentRelationship = 'Guardian',
    hasBehaviouralNeeds = false,
    behaviouralNeedsDetails = '',
    socialMediaConsent = true,
    source = 'Social Media',
    interestedIn = '',
    notes = '',
    assignedTo,
  } = req.body;

  const resolvedFullName = (firstName && lastName)
    ? `${firstName.trim()} ${lastName.trim()}`
    : (req.body.fullName || firstName || lastName || '').trim();

  if (!resolvedFullName || !phone) {
    return next(new AppError('Student name and contact phone number are required.', 400));
  }

  // 1. Resolve or Create Parent account if parent email provided
  let parentUserId = null;
  const pEmail = (parentEmail || '').trim().toLowerCase();
  const pPhone = (parentPhone || '').trim();
  const pName = (parentFullName || '').trim();

  if (pEmail) {
    let parentUser = await User.findOne({ email: pEmail });
    if (!parentUser) {
      const parentRole = await Role.findOne({ slug: 'parent' });
      parentUser = await User.create({
        fullName: pName || `${resolvedFullName}'s Parent`,
        email: pEmail,
        phone: pPhone,
        role: parentRole?._id,
        password: 'Password@12345',
        status: 'active',
      });
      await ParentProfile.create({
        user: parentUser._id,
        relationshipToStudent: parentRelationship || 'Parent',
        children: [],
      });
    }
    parentUserId = parentUser._id;
  }

  // 2. Create Customer record in CRM
  const customer = await Customer.create({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    fullName: resolvedFullName,
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
    gender: gender || 'Prefer not to say',
    nationality: nationality.trim(),
    emiratesIdUrl,
    emiratesIdMetadata,
    streetAddress: streetAddress.trim(),
    country: country.trim(),
    city: city.trim(),
    state: state.trim(),
    zipCode: zipCode.trim(),
    parentFullName: pName,
    parentEmail: pEmail,
    parentPhone: pPhone,
    parentRelationship,
    hasBehaviouralNeeds: Boolean(hasBehaviouralNeeds),
    behaviouralNeedsDetails: hasBehaviouralNeeds ? (behaviouralNeedsDetails || '').trim() : '',
    socialMediaConsent: Boolean(socialMediaConsent),
    source,
    interestedIn: interestedIn.trim(),
    notes: notes.trim(),
    assignedTo: assignedTo || null,
    originalLead: null,
    createdBy: req.user?._id || null,
  });

  // 3. Create or Link Student Portal User & Profile
  const sEmail = (email || '').trim().toLowerCase();
  if (sEmail) {
    let studentUser = await User.findOne({ email: sEmail });
    if (!studentUser) {
      const studentRole = await Role.findOne({ slug: 'student' });
      studentUser = await User.create({
        fullName: resolvedFullName,
        email: sEmail,
        phone: phone.trim(),
        role: studentRole?._id,
        password: 'Student@12345',
        status: 'active',
      });

      const studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
      await StudentProfile.create({
        user: studentUser._id,
        parentUser: parentUserId,
        studentCode,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        gender: gender || 'Prefer not to say',
        nationality: nationality.trim(),
        emiratesIdUrl,
        emiratesIdMetadata,
        streetAddress: streetAddress.trim(),
        country: country.trim(),
        city: city.trim(),
        state: state.trim(),
        zipCode: zipCode.trim(),
        hasBehaviouralNeeds: Boolean(hasBehaviouralNeeds),
        behaviouralNeedsDetails: hasBehaviouralNeeds ? (behaviouralNeedsDetails || '').trim() : '',
        socialMediaConsent: Boolean(socialMediaConsent),
        hearAboutUs: source,
      });

      if (parentUserId) {
        await ParentProfile.findOneAndUpdate(
          { user: parentUserId },
          { $addToSet: { children: studentUser._id } }
        );
      }
    }
  }

  // 4. Audit Activity Log
  try {
    await Activity.create({
      action: 'STUDENT_CREATED',
      entityType: 'customer',
      entityId: customer._id,
      title: 'New Student Registered',
      description: `Registered student ${resolvedFullName} with parent ${pName || 'N/A'}.`,
      performedBy: req.user?._id || null,
    });
  } catch (auditErr) {
    console.error('Activity audit log warning:', auditErr);
  }

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

  const existing = await Customer.findById(req.params.id);
  if (!existing) return next(new AppError('Customer not found.', 404));

  if (req.body.firstName !== undefined || req.body.lastName !== undefined) {
    const newFirst = req.body.firstName !== undefined ? req.body.firstName : (existing.firstName || '');
    const newLast = req.body.lastName !== undefined ? req.body.lastName : (existing.lastName || '');
    req.body.fullName = `${newFirst} ${newLast}`.trim() || existing.fullName;
  }

  const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('assignedTo', 'fullName email');

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
