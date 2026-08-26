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

// --- Equipment & Inventory Management ---

exports.getAllEquipment = async (req, res, next) => {
  try {
    const filter = {};

    if (req.query.inventoryType) {
      filter.inventoryType = req.query.inventoryType;
    }
    if (req.query.category && req.query.category !== 'All') {
      filter.category = req.query.category;
    }
    if (req.query.branch) {
      filter.branch = req.query.branch;
    }
    if (req.query.status && req.query.status !== 'All') {
      filter.status = req.query.status;
    }
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { sku: { $regex: req.query.search, $options: 'i' } },
        { category: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const equipment = await Equipment.find(filter)
      .populate('branch', 'name code city')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: equipment.length, data: equipment });
  } catch (err) {
    next(err);
  }
};

exports.getInventoryMetrics = async (req, res, next) => {
  try {
    const allItems = await Equipment.find();

    const academyItems = allItems.filter((i) => (i.inventoryType || 'ACADEMY_USE') === 'ACADEMY_USE');
    const merchandiseItems = allItems.filter((i) => i.inventoryType === 'MERCHANDISE_FOR_SALE');

    // Academy Use metrics
    const academyTotalGear = academyItems.reduce((acc, i) => acc + (i.totalQuantity || 0), 0);
    const academyAvailable = academyItems.reduce((acc, i) => acc + (i.availableQuantity || 0), 0);
    const academyInUse = academyItems.reduce((acc, i) => acc + (i.inUseQuantity || 0), 0);
    const academyDamaged = academyItems.reduce((acc, i) => acc + (i.damagedQuantity || 0), 0);
    const academyUnderRepair = academyItems.reduce((acc, i) => acc + (i.underRepairQuantity || 0), 0);

    // Merchandise metrics
    const merchTotalStock = merchandiseItems.reduce((acc, i) => acc + (i.totalQuantity || 0), 0);
    const merchAvailable = merchandiseItems.reduce((acc, i) => acc + (i.availableQuantity || 0), 0);
    const merchSold = merchandiseItems.reduce((acc, i) => acc + (i.soldQuantity || 0), 0);
    const merchInventoryValue = merchandiseItems.reduce(
      (acc, i) => acc + (i.availableQuantity || 0) * (i.sellingPrice || 0),
      0
    );
    const merchLowStockCount = merchandiseItems.filter(
      (i) => (i.availableQuantity || 0) <= (i.reorderLevel || 5)
    ).length;

    res.status(200).json({
      success: true,
      data: {
        academy: {
          totalGear: academyTotalGear,
          available: academyAvailable,
          inUse: academyInUse,
          damaged: academyDamaged,
          underRepair: academyUnderRepair,
          itemCount: academyItems.length,
        },
        merchandise: {
          totalStock: merchTotalStock,
          availableForSale: merchAvailable,
          sold: merchSold,
          inventoryRetailValue: merchInventoryValue,
          lowStockCount: merchLowStockCount,
          productCount: merchandiseItems.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createEquipment = async (req, res, next) => {
  try {
    const total = Number(req.body.totalQuantity) || 0;
    const damaged = Number(req.body.damagedQuantity) || 0;
    const inUse = Number(req.body.inUseQuantity) || 0;
    const reserved = Number(req.body.reservedQuantity) || 0;
    const available = Math.max(0, total - damaged - inUse - reserved);

    const inventoryType = req.body.inventoryType || 'ACADEMY_USE';
    const sellingPrice = Number(req.body.sellingPrice) || 0;
    const costPrice = Number(req.body.costPrice) || 0;
    const reorderLevel = Number(req.body.reorderLevel) || 5;
    const code = req.body.code || req.body.sku || ('EQ-' + Math.floor(100000 + Math.random() * 900000));

    const eq = await Equipment.create({
      ...req.body,
      code,
      inventoryType,
      totalQuantity: total,
      damagedQuantity: damaged,
      inUseQuantity: inUse,
      reservedQuantity: reserved,
      availableQuantity: req.body.availableQuantity !== undefined ? Number(req.body.availableQuantity) : available,
      sellingPrice,
      costPrice,
      reorderLevel,
      status: available === 0 ? 'Out of Stock' : available <= reorderLevel ? 'Low Stock' : 'Active',
    });

    const populated = await Equipment.findById(eq._id).populate('branch', 'name code city');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    next(err);
  }
};

exports.updateEquipment = async (req, res, next) => {
  try {
    const item = await Equipment.findById(req.params.id);
    if (!item) return next(new AppError('Equipment/Merchandise item not found', 404));

    const total = req.body.totalQuantity !== undefined ? Number(req.body.totalQuantity) : item.totalQuantity;
    const damaged = req.body.damagedQuantity !== undefined ? Number(req.body.damagedQuantity) : item.damagedQuantity;
    const inUse = req.body.inUseQuantity !== undefined ? Number(req.body.inUseQuantity) : (item.inUseQuantity || 0);
    const reserved = req.body.reservedQuantity !== undefined ? Number(req.body.reservedQuantity) : item.reservedQuantity;
    const reorderLevel = req.body.reorderLevel !== undefined ? Number(req.body.reorderLevel) : (item.reorderLevel || 5);

    const available = Math.max(0, total - damaged - inUse - reserved);

    const updatePayload = {
      ...req.body,
      totalQuantity: total,
      damagedQuantity: damaged,
      inUseQuantity: inUse,
      reservedQuantity: reserved,
      availableQuantity: req.body.availableQuantity !== undefined ? Number(req.body.availableQuantity) : available,
      status: available === 0 ? 'Out of Stock' : available <= reorderLevel ? 'Low Stock' : (req.body.status || item.status || 'Active'),
    };

    const eq = await Equipment.findByIdAndUpdate(req.params.id, updatePayload, {
      new: true,
      runValidators: true,
    }).populate('branch', 'name code city');

    res.status(200).json({ success: true, data: eq });
  } catch (err) {
    next(err);
  }
};

exports.adjustEquipmentStock = async (req, res, next) => {
  try {
    const { action, quantity = 1, notes } = req.body;
    const item = await Equipment.findById(req.params.id);
    if (!item) return next(new AppError('Inventory item not found', 404));

    const qty = Number(quantity) || 1;

    switch (action) {
      case 'mark_damaged':
        if (item.availableQuantity < qty) {
          return next(new AppError(`Cannot mark ${qty} as damaged; only ${item.availableQuantity} available`, 400));
        }
        item.availableQuantity = Math.max(0, item.availableQuantity - qty);
        item.damagedQuantity = (item.damagedQuantity || 0) + qty;
        break;

      case 'repair_restore':
        if (item.damagedQuantity < qty) {
          return next(new AppError(`Cannot restore ${qty}; only ${item.damagedQuantity} recorded as damaged`, 400));
        }
        item.damagedQuantity = Math.max(0, item.damagedQuantity - qty);
        item.availableQuantity = item.availableQuantity + qty;
        break;

      case 'issue_gear':
        if (item.availableQuantity < qty) {
          return next(new AppError(`Cannot issue ${qty}; only ${item.availableQuantity} available`, 400));
        }
        item.availableQuantity = Math.max(0, item.availableQuantity - qty);
        item.inUseQuantity = (item.inUseQuantity || 0) + qty;
        break;

      case 'return_gear':
        if ((item.inUseQuantity || 0) < qty) {
          return next(new AppError(`Cannot return ${qty}; only ${item.inUseQuantity || 0} currently in use`, 400));
        }
        item.inUseQuantity = Math.max(0, (item.inUseQuantity || 0) - qty);
        item.availableQuantity = item.availableQuantity + qty;
        break;

      case 'record_sale':
        if (item.availableQuantity < qty) {
          return next(new AppError(`Insufficient stock to sell ${qty} units; only ${item.availableQuantity} in stock`, 400));
        }
        item.availableQuantity = Math.max(0, item.availableQuantity - qty);
        item.soldQuantity = (item.soldQuantity || 0) + qty;
        item.totalQuantity = Math.max(0, item.totalQuantity - qty);
        break;

      case 'restock':
        item.totalQuantity = item.totalQuantity + qty;
        item.availableQuantity = item.availableQuantity + qty;
        break;

      default:
        return next(new AppError('Invalid movement action', 400));
    }

    item.status = item.availableQuantity === 0 ? 'Out of Stock' : item.availableQuantity <= (item.reorderLevel || 5) ? 'Low Stock' : 'Active';
    if (notes) item.notes = notes;
    await item.save();

    const populated = await Equipment.findById(item._id).populate('branch', 'name code city');
    res.status(200).json({ success: true, message: `Stock movement (${action}) completed`, data: populated });
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

