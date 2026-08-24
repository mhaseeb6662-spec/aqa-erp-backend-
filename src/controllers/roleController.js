const Role = require('../models/Role');
const User = require('../models/User');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const { PERMISSIONS } = require('../config/rbac.constants');

/**
 * GET /api/v1/roles
 */
exports.getRoles = catchAsync(async (req, res) => {
  const roles = await Role.find().sort({ createdAt: 1 });
  return sendResponse(res, 200, 'Roles fetched successfully.', roles);
});

/**
 * GET /api/v1/roles/permissions
 * Returns the full catalogue of assignable permission keys so the
 * frontend can render a checklist without hardcoding the list twice.
 */
exports.getPermissionCatalogue = catchAsync(async (req, res) => {
  return sendResponse(res, 200, 'Permission catalogue fetched.', PERMISSIONS);
});

/**
 * GET /api/v1/roles/:id
 */
exports.getRoleById = catchAsync(async (req, res, next) => {
  const role = await Role.findById(req.params.id);
  if (!role) return next(new AppError('Role not found.', 404));
  return sendResponse(res, 200, 'Role fetched successfully.', role);
});

/**
 * POST /api/v1/roles
 */
exports.createRole = catchAsync(async (req, res, next) => {
  const { name, description, permissions } = req.body;

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
  const existing = await Role.findOne({ slug });
  if (existing) return next(new AppError('A role with this name already exists.', 409));

  const role = await Role.create({ name, slug, description, permissions });
  return sendResponse(res, 201, 'Role created successfully.', role);
});

/**
 * PATCH /api/v1/roles/:id
 */
exports.updateRole = catchAsync(async (req, res, next) => {
  const role = await Role.findById(req.params.id);
  if (!role) return next(new AppError('Role not found.', 404));

  if (role.isSystem && req.body.permissions && role.slug === 'super-admin') {
    return next(new AppError('The Super Admin role permissions cannot be modified.', 400));
  }

  const { name, description, permissions, isActive } = req.body;
  if (name && !role.isSystem) role.name = name;
  if (description !== undefined) role.description = description;
  if (permissions !== undefined) role.permissions = permissions;
  if (isActive !== undefined) role.isActive = isActive;

  await role.save();
  return sendResponse(res, 200, 'Role updated successfully.', role);
});

/**
 * DELETE /api/v1/roles/:id
 */
exports.deleteRole = catchAsync(async (req, res, next) => {
  const role = await Role.findById(req.params.id);
  if (!role) return next(new AppError('Role not found.', 404));

  if (role.isSystem) {
    return next(new AppError('System-defined roles cannot be deleted.', 400));
  }

  const usersWithRole = await User.countDocuments({ role: role._id });
  if (usersWithRole > 0) {
    return next(new AppError(`Cannot delete role: ${usersWithRole} user(s) are still assigned to it.`, 400));
  }

  await role.deleteOne();
  return sendResponse(res, 200, 'Role deleted successfully.');
});
