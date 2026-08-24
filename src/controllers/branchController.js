const Branch = require('../models/Branch');
const AppError = require('../utils/appError');

// Get all active branches
exports.getAllBranches = async (req, res, next) => {
  try {
    const branches = await Branch.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: branches.length,
      data: branches,
    });
  } catch (err) {
    next(err);
  }
};

// Get single branch
exports.getBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) return next(new AppError('Branch not found', 404));
    res.status(200).json({ success: true, data: branch });
  } catch (err) {
    next(err);
  }
};

// Create branch (Admin)
exports.createBranch = async (req, res, next) => {
  try {
    const branch = await Branch.create(req.body);
    res.status(201).json({ success: true, data: branch });
  } catch (err) {
    next(err);
  }
};

// Update branch (Admin)
exports.updateBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!branch) return next(new AppError('Branch not found', 404));
    res.status(200).json({ success: true, data: branch });
  } catch (err) {
    next(err);
  }
};

// Delete branch (Admin)
exports.deleteBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findByIdAndDelete(req.params.id);
    if (!branch) return next(new AppError('Branch not found', 404));
    res.status(200).json({ success: true, message: 'Branch deleted successfully' });
  } catch (err) {
    next(err);
  }
};
