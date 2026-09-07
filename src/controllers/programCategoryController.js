const ProgramCategory = require('../models/ProgramCategory');
const Program = require('../models/Program');
const AppError = require('../utils/appError');
const logActivity = require('../utils/logActivity');

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * Seed initial categories if collection is empty
 */
async function seedDefaultsIfEmpty() {
  const count = await ProgramCategory.countDocuments();
  if (count === 0) {
    const defaultCategories = [
      'Fishing Essentials',
      'Kayak & Boating',
      'Offshore & Deep Sea',
      'Junior Angler',
      'Spearfishing & Diving',
      'Custom Private',
      'Little Angler',
      'Angler',
      'Discovery',
      'Advanced Camp',
      'Trips'
    ];

    const seedItems = defaultCategories.map(name => ({
      name,
      description: '',
      status: 'Active'
    }));

    // Also pick up any distinct categories already used by existing programs
    try {
      const existingProgramCats = await Program.distinct('category');
      for (const cat of existingProgramCats) {
        if (cat && cat.trim() && !seedItems.some(s => s.name.toLowerCase() === cat.trim().toLowerCase())) {
          seedItems.push({
            name: cat.trim(),
            description: '',
            status: 'Active'
          });
        }
      }
    } catch (e) {}

    await ProgramCategory.insertMany(seedItems, { ordered: false }).catch(() => {});
  }
}

/**
 * GET /api/v1/programs/categories
 * GET /api/v1/program-categories
 */
exports.getCategories = async (req, res, next) => {
  try {
    await seedDefaultsIfEmpty();

    const { status, includeInactive, search } = req.query;
    let query = {};

    if (status) {
      query.status = status;
    } else if (includeInactive !== 'true') {
      query.status = 'Active';
    }

    if (search && search.trim()) {
      query.name = { $regex: escapeRegex(search.trim()), $options: 'i' };
    }

    const categories = await ProgramCategory.find(query).sort({ name: 1 });

    // Compute program count for each category
    const programCounts = await Program.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    const countMap = {};
    programCounts.forEach(pc => {
      if (pc._id) countMap[pc._id.trim().toLowerCase()] = pc.count;
    });

    const data = categories.map(cat => {
      const obj = cat.toObject();
      obj.programCount = countMap[cat.name.trim().toLowerCase()] || 0;
      return obj;
    });

    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/programs/categories
 * POST /api/v1/program-categories
 */
exports.createCategory = async (req, res, next) => {
  try {
    const { name, description, status } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return next(new AppError('Category name is required', 400));
    }

    const trimmedName = name.trim();
    const escaped = escapeRegex(trimmedName);

    // Case-insensitive duplicate check
    const existing = await ProgramCategory.findOne({
      name: { $regex: new RegExp('^' + escaped + '$', 'i') }
    });

    if (existing) {
      return next(new AppError(`Category "${trimmedName}" already exists.`, 400));
    }

    const category = await ProgramCategory.create({
      name: trimmedName,
      description: description && typeof description === 'string' ? description.trim() : '',
      status: status === 'Inactive' ? 'Inactive' : 'Active'
    });

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `PROGRAM_CATEGORY_CREATED: Category "${category.name}" created.`,
      performedBy: req.user._id,
      metadata: { categoryId: category._id, name: category.name }
    }).catch(() => {});

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/programs/categories/:id
 * PUT /api/v1/program-categories/:id
 */
exports.updateCategory = async (req, res, next) => {
  try {
    const { name, description, status } = req.body;
    const oldCat = await ProgramCategory.findById(req.params.id);
    if (!oldCat) {
      return next(new AppError('Category not found', 404));
    }

    const updateData = {};
    if (description !== undefined) updateData.description = typeof description === 'string' ? description.trim() : '';
    if (status !== undefined) updateData.status = status === 'Inactive' ? 'Inactive' : 'Active';

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return next(new AppError('Category name cannot be empty', 400));
      }

      const trimmedName = name.trim();
      if (trimmedName.toLowerCase() !== oldCat.name.toLowerCase()) {
        const escaped = escapeRegex(trimmedName);
        const existing = await ProgramCategory.findOne({
          _id: { $ne: req.params.id },
          name: { $regex: new RegExp('^' + escaped + '$', 'i') }
        });

        if (existing) {
          return next(new AppError(`Category "${trimmedName}" already exists.`, 400));
        }
      }
      updateData.name = trimmedName;
    }

    const updated = await ProgramCategory.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    });

    // If category name changed, update all existing Programs using this category
    if (updateData.name && updateData.name !== oldCat.name) {
      await Program.updateMany(
        { category: { $regex: new RegExp('^' + escapeRegex(oldCat.name) + '$', 'i') } },
        { category: updateData.name }
      );
    }

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `PROGRAM_CATEGORY_UPDATED: Category "${oldCat.name}" renamed to "${updated.name}" (status: ${updated.status}).`,
      performedBy: req.user._id,
      metadata: { categoryId: updated._id, oldName: oldCat.name, newName: updated.name }
    }).catch(() => {});

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/programs/categories/:id/archive
 * PATCH /api/v1/program-categories/:id/archive
 */
exports.archiveCategory = async (req, res, next) => {
  try {
    const existing = await ProgramCategory.findById(req.params.id);
    if (!existing) {
      return next(new AppError('Category not found', 404));
    }

    const newStatus = existing.status === 'Active' ? 'Inactive' : 'Active';
    const category = await ProgramCategory.findByIdAndUpdate(
      req.params.id,
      { status: newStatus },
      { new: true }
    );

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `PROGRAM_CATEGORY_STATUS_CHANGED: Category "${category.name}" marked ${category.status}.`,
      performedBy: req.user._id
    }).catch(() => {});

    res.status(200).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/programs/categories/:id/dependencies
 */
exports.checkCategoryDependencies = async (req, res, next) => {
  try {
    const category = await ProgramCategory.findById(req.params.id);
    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    const programs = await Program.find(
      { category: { $regex: new RegExp('^' + escapeRegex(category.name) + '$', 'i') } },
      'title code status price'
    );

    res.status(200).json({
      success: true,
      hasDependencies: programs.length > 0,
      inUseCount: programs.length,
      programs
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/programs/categories/:id
 * DELETE /api/v1/program-categories/:id
 */
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await ProgramCategory.findById(req.params.id);
    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    // Check if category is used by any programs
    const inUseCount = await Program.countDocuments({
      category: { $regex: new RegExp('^' + escapeRegex(category.name) + '$', 'i') }
    });

    if (inUseCount > 0) {
      return next(new AppError(`Cannot permanently delete category "${category.name}" as it is currently used by ${inUseCount} program(s). Please archive it instead.`, 400));
    }

    await ProgramCategory.findByIdAndDelete(req.params.id);

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `PROGRAM_CATEGORY_DELETED: Category "${category.name}" deleted.`,
      performedBy: req.user._id
    }).catch(() => {});

    res.status(200).json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    next(error);
  }
};
