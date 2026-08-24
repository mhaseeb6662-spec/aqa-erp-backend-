const AppError = require('../utils/appError');

/**
 * requirePermission: guards a route behind one or more permission keys.
 * The user's role must contain at least one of the given permissions
 * (or the special "core:*:manage" super-admin wildcard).
 *
 * Usage: router.get('/', protect, requirePermission(PERMISSIONS.USERS_VIEW), handler)
 */
const requirePermission = (...requiredPermissions) => (req, res, next) => {
  const userPermissions = req.user?.role?.permissions || [];

  const isSuperAdmin = req.user?.role?.slug === 'super-admin';
  if (isSuperAdmin) return next();

  const hasPermission = requiredPermissions.some((perm) => userPermissions.includes(perm));

  if (!hasPermission) {
    return next(new AppError('You do not have permission to perform this action.', 403));
  }

  next();
};

/**
 * requireRole: guards a route behind one or more role slugs.
 * Usage: router.delete('/:id', protect, requireRole('super-admin', 'admin'), handler)
 */
const requireRole = (...allowedRoleSlugs) => (req, res, next) => {
  const userRoleSlug = req.user?.role?.slug;

  if (!userRoleSlug || !allowedRoleSlugs.includes(userRoleSlug)) {
    return next(new AppError('Your role does not have access to this resource.', 403));
  }

  next();
};

module.exports = { requirePermission, requireRole };
