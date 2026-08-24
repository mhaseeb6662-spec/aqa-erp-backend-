const Program = require('../models/Program');
const AppError = require('../utils/appError');

// Get all programs with filters
exports.getPrograms = async (req, res, next) => {
  try {
    const { category, level, ageGroup, branch } = req.query;
    const filter = {};

    if (category) filter.category = category;
    if (level) filter.level = level;
    if (ageGroup) filter.ageGroup = ageGroup;
    if (branch) filter.branches = branch;

    const programs = await Program.find(filter).populate('branches', 'name code city').sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: programs.length,
      data: programs,
    });
  } catch (err) {
    next(err);
  }
};

// Get program by ID
exports.getProgram = async (req, res, next) => {
  try {
    const program = await Program.findById(req.params.id).populate('branches');
    if (!program) return next(new AppError('Program not found', 404));
    res.status(200).json({ success: true, data: program });
  } catch (err) {
    next(err);
  }
};

// Create program (Admin)
exports.createProgram = async (req, res, next) => {
  try {
    const program = await Program.create(req.body);
    res.status(201).json({ success: true, data: program });
  } catch (err) {
    next(err);
  }
};

// Update program (Admin)
exports.updateProgram = async (req, res, next) => {
  try {
    const program = await Program.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!program) return next(new AppError('Program not found', 404));
    res.status(200).json({ success: true, data: program });
  } catch (err) {
    next(err);
  }
};

// Delete program (Admin)
exports.deleteProgram = async (req, res, next) => {
  try {
    const program = await Program.findByIdAndDelete(req.params.id);
    if (!program) return next(new AppError('Program not found', 404));
    res.status(200).json({ success: true, message: 'Program deleted successfully' });
  } catch (err) {
    next(err);
  }
};
