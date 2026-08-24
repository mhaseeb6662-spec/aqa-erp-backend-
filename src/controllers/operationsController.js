const Vessel = require('../models/Vessel');
const Maintenance = require('../models/Maintenance');
const Equipment = require('../models/Equipment');
const Incident = require('../models/Incident');
const Schedule = require('../models/Schedule');
const Branch = require('../models/Branch');
const AppError = require('../utils/appError');

// --- Fleet Management ---

exports.getAllVessels = async (req, res, next) => {
  try {
    const vessels = await Vessel.find().populate('branch', 'name code').sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: vessels.length, data: vessels });
  } catch (err) {
    next(err);
  }
};

exports.createVessel = async (req, res, next) => {
  try {
    const vesselId = req.body.vesselId || 'VES-' + Math.floor(100000 + Math.random() * 900000);
    const vessel = await Vessel.create({
      ...req.body,
      vesselId,
      capacity: Number(req.body.capacity) || 8,
    });
    const populated = await Vessel.findById(vessel._id).populate('branch', 'name code');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    next(err);
  }
};

exports.updateVessel = async (req, res, next) => {
  try {
    const vessel = await Vessel.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).populate('branch', 'name code');
    if (!vessel) return next(new AppError('Vessel not found', 404));
    res.status(200).json({ success: true, data: vessel });
  } catch (err) {
    next(err);
  }
};

exports.deleteVessel = async (req, res, next) => {
  try {
    const vessel = await Vessel.findByIdAndDelete(req.params.id);
    if (!vessel) return next(new AppError('Vessel not found', 404));
    res.status(200).json({ success: true, message: 'Vessel deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// --- Operations Dashboard Stats ---

exports.getOperationsDashboard = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todaySessions, activeTrips, vessels, pendingIncidents, lowEquipment, totalEquipment] = await Promise.all([
      Schedule.countDocuments({ startTime: { $gte: today, $lt: tomorrow } }),
      Schedule.countDocuments({ sessionType: 'Trip', startTime: { $gte: today, $lt: tomorrow } }),
      Vessel.find(),
      Incident.countDocuments({ status: { $in: ['Open', 'Under Investigation'] } }),
      Equipment.countDocuments({ availableQuantity: { $lt: 5 }, status: 'Active' }),
      Equipment.countDocuments({ status: 'Active' }),
    ]);
    
    let readyVessels = 0;
    let maintenanceVessels = 0;
    vessels.forEach((v) => {
      if (v.operationalStatus === 'Available' && v.readinessStatus === 'Ready') readyVessels++;
      if (v.operationalStatus === 'Maintenance') maintenanceVessels++;
    });

    res.status(200).json({
      success: true,
      data: {
        todaySessions,
        activeTrips,
        fleetReadiness: {
          total: vessels.length,
          ready: readyVessels,
          maintenance: maintenanceVessels,
        },
        pendingIncidents,
        lowEquipment,
        totalEquipment,
      },
    });
  } catch (err) {
    next(err);
  }
};

// --- Equipment Management ---

exports.getAllEquipment = async (req, res, next) => {
  try {
    const equipment = await Equipment.find().populate('branch', 'name code').sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: equipment.length, data: equipment });
  } catch (err) {
    next(err);
  }
};

exports.createEquipment = async (req, res, next) => {
  try {
    const total = Number(req.body.totalQuantity) || 0;
    const damaged = Number(req.body.damagedQuantity) || 0;
    const reserved = Number(req.body.reservedQuantity) || 0;
    const available = total - damaged - reserved;

    const eq = await Equipment.create({
      ...req.body,
      totalQuantity: total,
      damagedQuantity: damaged,
      reservedQuantity: reserved,
      availableQuantity: req.body.availableQuantity !== undefined ? Number(req.body.availableQuantity) : Math.max(0, available),
    });
    const populated = await Equipment.findById(eq._id).populate('branch', 'name code');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    next(err);
  }
};

exports.updateEquipment = async (req, res, next) => {
  try {
    if (req.body.totalQuantity !== undefined && req.body.availableQuantity === undefined) {
      const total = Number(req.body.totalQuantity) || 0;
      const damaged = Number(req.body.damagedQuantity) || 0;
      const reserved = Number(req.body.reservedQuantity) || 0;
      req.body.availableQuantity = Math.max(0, total - damaged - reserved);
    }

    const eq = await Equipment.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).populate('branch', 'name code');
    if (!eq) return next(new AppError('Equipment item not found', 404));
    res.status(200).json({ success: true, data: eq });
  } catch (err) {
    next(err);
  }
};

exports.deleteEquipment = async (req, res, next) => {
  try {
    const eq = await Equipment.findByIdAndDelete(req.params.id);
    if (!eq) return next(new AppError('Equipment item not found', 404));
    res.status(200).json({ success: true, message: 'Equipment deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// --- Incident Reporting ---

exports.getAllIncidents = async (req, res, next) => {
  try {
    const incidents = await Incident.find()
      .populate('session', 'title startTime')
      .populate('student', 'fullName email')
      .populate('reportedBy', 'fullName email')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: incidents.length, data: incidents });
  } catch (err) {
    next(err);
  }
};

exports.createIncident = async (req, res, next) => {
  try {
    const incidentId = 'INC-' + Math.floor(100000 + Math.random() * 900000);
    const inc = await Incident.create({
      ...req.body,
      incidentId,
      reportedBy: req.user?._id || req.user?.id,
    });
    const populated = await Incident.findById(inc._id)
      .populate('session', 'title startTime')
      .populate('student', 'fullName email')
      .populate('reportedBy', 'fullName email');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    next(err);
  }
};

exports.updateIncident = async (req, res, next) => {
  try {
    const inc = await Incident.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('session', 'title startTime')
      .populate('student', 'fullName email')
      .populate('reportedBy', 'fullName email');
    if (!inc) return next(new AppError('Incident not found', 404));
    res.status(200).json({ success: true, data: inc });
  } catch (err) {
    next(err);
  }
};

exports.deleteIncident = async (req, res, next) => {
  try {
    const inc = await Incident.findByIdAndDelete(req.params.id);
    if (!inc) return next(new AppError('Incident not found', 404));
    res.status(200).json({ success: true, message: 'Incident deleted successfully' });
  } catch (err) {
    next(err);
  }
};

