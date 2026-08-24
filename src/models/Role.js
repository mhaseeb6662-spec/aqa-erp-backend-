const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Role name is required'],
      trim: true,
      unique: true,
      maxlength: 60,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 250,
    },
    // Flattened "module:resource:action" style permission keys.
    // Kept simple (array of strings) so it can be extended freely
    // by future phases without a schema migration.
    permissions: {
      type: [String],
      default: [],
    },
    // System roles (Super Admin, Admin, etc.) ship with the platform
    // and cannot be removed from the UI, protecting core RBAC.
    isSystem: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Role', roleSchema);
