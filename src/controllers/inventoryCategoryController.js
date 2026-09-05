const InventoryCategory = require('../models/InventoryCategory');
const AppError = require('../utils/appError');
const logActivity = require('../utils/logActivity');
const Equipment = require('../models/Equipment');

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

exports.getCategories = async (req, res, next) => {
  try {
    const { type, status, includeInactive } = req.query;

    // Check if categories collection is empty; if so, seed default categories + distinct from Equipment
    const count = await InventoryCategory.countDocuments();
    if (count === 0) {
      const defaultAcademy = [
        'Fishing Rod',
        'Reel',
        'Life Jacket',
        'Tackle & Lures',
        'Safety Gear',
        'Electronics / Sonar',
        'Kayak / Small Craft',
        'Bait Tank / Aerator'
      ];
      const defaultMerch = [
        'Apparel & Uniforms',
        'Academy Merchandise',
        'Fishing Accessories',
        'Bait & Tackle',
        'Branded Gear',
        'Pro Shop'
      ];

      const seedItems = [
        ...defaultAcademy.map(name => ({ name, inventoryType: 'ACADEMY_USE', status: 'Active' })),
        ...defaultMerch.map(name => ({ name, inventoryType: 'MERCHANDISE_FOR_SALE', status: 'Active' }))
      ];

      // Also get any existing categories from Equipment
      const existingEquipCats = await Equipment.distinct('category');
      for (const cat of existingEquipCats) {
        if (cat && !seedItems.some(s => s.name.toLowerCase() === cat.trim().toLowerCase())) {
          seedItems.push({ name: cat.trim(), inventoryType: 'BOTH', status: 'Active' });
        }
      }

      await InventoryCategory.insertMany(seedItems, { ordered: false }).catch(() => {});
    }

    let query = {};
    if (type && type !== 'All') {
      query.inventoryType = { $in: [type, 'BOTH'] };
    }
    if (status) {
      query.status = status;
    } else if (includeInactive !== 'true') {
      query.status = 'Active';
    }

    const categories = await InventoryCategory.find(query).sort({ name: 1 });
    res.status(200).json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    next(error);
  }
};

exports.createCategory = async (req, res, next) => {
  try {
    const { name, description, inventoryType, status } = req.body;

    if (!name || !name.trim()) {
      return next(new AppError('Category name is required', 400));
    }

    const trimmedName = name.trim();
    const escaped = escapeRegex(trimmedName);

    // Case-insensitive duplicate check
    const existing = await InventoryCategory.findOne({
      name: { $regex: new RegExp('^' + escaped + '$', 'i') }
    });

    if (existing) {
      return next(new AppError(`Category "${trimmedName}" already exists.`, 400));
    }

    const category = await InventoryCategory.create({
      name: trimmedName,
      description: description ? description.trim() : '',
      inventoryType: inventoryType || 'BOTH',
      status: status || 'Active'
    });

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `INVENTORY_CATEGORY_CREATED: Category "${category.name}" created (${category.inventoryType}).`,
      performedBy: req.user._id
    }).catch(() => {});

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const { name, description, inventoryType, status } = req.body;
    const oldCat = await InventoryCategory.findById(req.params.id);
    if (!oldCat) {
      return next(new AppError('Category not found', 404));
    }

    const updateData = {};
    if (description !== undefined) updateData.description = description.trim();
    if (inventoryType !== undefined) updateData.inventoryType = inventoryType;
    if (status !== undefined) updateData.status = status;

    if (name && name.trim().toLowerCase() !== oldCat.name.toLowerCase()) {
      const trimmedName = name.trim();
      const escaped = escapeRegex(trimmedName);
      const existing = await InventoryCategory.findOne({
        _id: { $ne: req.params.id },
        name: { $regex: new RegExp('^' + escaped + '$', 'i') }
      });

      if (existing) {
        return next(new AppError(`Category "${trimmedName}" already exists.`, 400));
      }
      updateData.name = trimmedName;
    } else if (name) {
      updateData.name = name.trim();
    }

    const updated = await InventoryCategory.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    });

    // If category name changed, update all existing Equipment using this category
    if (updateData.name && updateData.name !== oldCat.name) {
      await Equipment.updateMany({ category: oldCat.name }, { category: updateData.name });
    }

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `INVENTORY_CATEGORY_UPDATED: Category "${oldCat.name}" renamed to "${updated.name}" (status: ${updated.status}).`,
      performedBy: req.user._id
    }).catch(() => {});

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.archiveCategory = async (req, res, next) => {
  try {
    const category = await InventoryCategory.findByIdAndUpdate(
      req.params.id,
      { status: 'Inactive' },
      { new: true }
    );
    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `INVENTORY_CATEGORY_ARCHIVED: Category "${category.name}" archived.`,
      performedBy: req.user._id
    }).catch(() => {});

    res.status(200).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await InventoryCategory.findById(req.params.id);
    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    // Check if category is used by any equipment
    const inUseCount = await Equipment.countDocuments({ category: category.name });
    if (inUseCount > 0) {
      return next(new AppError(`Cannot permanently delete category "${category.name}" as it is currently used by ${inUseCount} inventory item(s). Please archive it instead.`, 400));
    }

    await InventoryCategory.findByIdAndDelete(req.params.id);

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `INVENTORY_CATEGORY_DELETED: Category "${category.name}" deleted.`,
      performedBy: req.user._id
    }).catch(() => {});

    res.status(200).json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    next(error);
  }
};
