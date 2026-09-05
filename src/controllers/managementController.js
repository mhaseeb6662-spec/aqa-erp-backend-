const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const PaymentTransaction = require('../models/PaymentTransaction');
const Refund = require('../models/Refund');
const Lead = require('../models/Lead');
const Booking = require('../models/Booking');
const Schedule = require('../models/Schedule');
const Program = require('../models/Program');
const Branch = require('../models/Branch');
const User = require('../models/User');
const Vessel = require('../models/Vessel');
const Equipment = require('../models/Equipment');
const Incident = require('../models/Incident');
const Activity = require('../models/Activity');
const CoachCertification = require('../models/CoachCertification');
const ProgressNote = require('../models/ProgressNote');
const SessionReport = require('../models/SessionReport');
const KpiDefinition = require('../models/KpiDefinition');
const ManagementAlert = require('../models/ManagementAlert');
const AppError = require('../utils/appError');
const { PIPELINE_STAGE_CONFIG } = require('../config/crm.constants');

// -------------------------------------------------------------
// Helper: Parse Date Ranges & Comparison Periods
// -------------------------------------------------------------
const parseDateFilters = (query) => {
  const now = new Date();
  let currentStart = null;
  let currentEnd = null;
  let prevStart = null;
  let prevEnd = null;

  const range = query.range || 'all';

  if (range === 'today') {
    currentStart = new Date(now);
    currentStart.setHours(0, 0, 0, 0);
    currentEnd = new Date(now);
    currentEnd.setHours(23, 59, 59, 999);

    prevStart = new Date(now);
    prevStart.setDate(prevStart.getDate() - 1);
    prevStart.setHours(0, 0, 0, 0);
    prevEnd = new Date(now);
    prevEnd.setDate(prevEnd.getDate() - 1);
    prevEnd.setHours(23, 59, 59, 999);
  } else if (range === 'yesterday') {
    currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - 1);
    currentStart.setHours(0, 0, 0, 0);
    currentEnd = new Date(now);
    currentEnd.setDate(currentEnd.getDate() - 1);
    currentEnd.setHours(23, 59, 59, 999);

    prevStart = new Date(now);
    prevStart.setDate(prevStart.getDate() - 2);
    prevStart.setHours(0, 0, 0, 0);
    prevEnd = new Date(now);
    prevEnd.setDate(prevEnd.getDate() - 2);
    prevEnd.setHours(23, 59, 59, 999);
  } else if (range === 'this_week') {
    currentStart = new Date(now);
    const day = currentStart.getDay();
    currentStart.setDate(currentStart.getDate() - day);
    currentStart.setHours(0, 0, 0, 0);
    currentEnd = new Date(now);
    currentEnd.setHours(23, 59, 59, 999);

    prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd = new Date(currentStart);
    prevEnd.setMilliseconds(-1);
  } else if (range === 'last_week') {
    const day = now.getDay();
    currentEnd = new Date(now);
    currentEnd.setDate(currentEnd.getDate() - day - 1);
    currentEnd.setHours(23, 59, 59, 999);
    currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() - 6);
    currentStart.setHours(0, 0, 0, 0);

    prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd = new Date(currentStart);
    prevEnd.setMilliseconds(-1);
  } else if (range === 'this_month') {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59, 999);
  } else if (range === 'last_month') {
    currentStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    currentEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59, 999);
  } else if (range === 'this_quarter' || range === 'quarter' || range === '90d') {
    currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - 90);
    currentStart.setHours(0, 0, 0, 0);
    currentEnd = new Date(now);
    currentEnd.setHours(23, 59, 59, 999);

    prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - 90);
    prevEnd = new Date(currentStart);
    prevEnd.setMilliseconds(-1);
  } else if (range === 'this_year' || range === 'year') {
    currentStart = new Date(now.getFullYear(), 0, 1);
    currentEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

    prevStart = new Date(now.getFullYear() - 1, 0, 1);
    prevEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
  } else if (range === '7d') {
    currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - 7);
    currentStart.setHours(0, 0, 0, 0);
    currentEnd = new Date(now);
    currentEnd.setHours(23, 59, 59, 999);

    prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd = new Date(currentStart);
    prevEnd.setMilliseconds(-1);
  } else if (range === '30d') {
    currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - 30);
    currentStart.setHours(0, 0, 0, 0);
    currentEnd = new Date(now);
    currentEnd.setHours(23, 59, 59, 999);

    prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - 30);
    prevEnd = new Date(currentStart);
    prevEnd.setMilliseconds(-1);
  } else if (range === 'custom' && (query.startDate || query.endDate)) {
    // UAE is UTC+4.
    // Ensure accurate boundaries for the selected days in UAE time
    // regardless of server local timezone.
    if (query.startDate) {
      const [y, m, d] = query.startDate.split('-');
      currentStart = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), 0, 0, 0, 0));
      currentStart.setUTCHours(currentStart.getUTCHours() - 4);
    }
    if (query.endDate) {
      const [y, m, d] = query.endDate.split('-');
      currentEnd = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), 23, 59, 59, 999));
      currentEnd.setUTCHours(currentEnd.getUTCHours() - 4);
    }
    if (currentStart && currentEnd) {
      const diffMs = currentEnd.getTime() - currentStart.getTime();
      prevEnd = new Date(currentStart.getTime() - 1);
      prevStart = new Date(prevEnd.getTime() - diffMs);
    }
  } else {
    // 'all' or 'all_time' or default: no date bounding
    currentStart = null;
    currentEnd = null;
    prevStart = null;
    prevEnd = null;
  }

  return {
    range,
    current: { start: currentStart, end: currentEnd },
    previous: { start: prevStart, end: prevEnd },
  };
};

const calcPercentChange = (current, previous) => {
  if (!previous || previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
};

// -------------------------------------------------------------
// 1. GET /api/v1/management/overview
// -------------------------------------------------------------
exports.getExecutiveOverview = async (req, res, next) => {
  try {
    const dates = parseDateFilters(req.query);
    const branchFilter = req.query.branchId ? { branch: req.query.branchId } : {};

    const curDateMatch = (dates.current.start && dates.current.end) ? { createdAt: { $gte: dates.current.start, $lte: dates.current.end } } : {};
    const prevDateMatch = (dates.previous.start && dates.previous.end) ? { createdAt: { $gte: dates.previous.start, $lte: dates.previous.end } } : {};
    const curSessionMatch = (dates.current.start && dates.current.end) ? { startTime: { $gte: dates.current.start, $lte: dates.current.end } } : {};
    const prevSessionMatch = (dates.previous.start && dates.previous.end) ? { startTime: { $gte: dates.previous.start, $lte: dates.previous.end } } : {};
    const curWonMatch = { stage: 'won', ...((dates.current.start && dates.current.end) ? { $or: [{ convertedAt: { $gte: dates.current.start, $lte: dates.current.end } }, { createdAt: { $gte: dates.current.start, $lte: dates.current.end } }] } : {}) };
    const prevWonMatch = { stage: 'won', ...((dates.previous.start && dates.previous.end) ? { $or: [{ convertedAt: { $gte: dates.previous.start, $lte: dates.previous.end } }, { createdAt: { $gte: dates.previous.start, $lte: dates.previous.end } }] } : {}) };

    // Parallel aggregate queries for Current & Previous period
    const [
      curPaidAgg,
      prevPaidAgg,
      curInvoicedAgg,
      prevInvoicedAgg,
      curRefundsAgg,
      prevRefundsAgg,
      curLeads,
      prevLeads,
      curWonLeads,
      prevWonLeads,
      curBookings,
      prevBookings,
      curSessions,
      prevSessions,
      curCompletedSessions,
      allVessels,
      lowStockEquipment,
      pendingIncidents,
      alerts
    ] = await Promise.all([
      // Paid revenue
      PaymentTransaction.aggregate([
        { $match: { status: { $in: ['Completed', 'Partially Refunded', 'Refunded'] }, ...curDateMatch } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      PaymentTransaction.aggregate([
        { $match: { status: { $in: ['Completed', 'Partially Refunded', 'Refunded'] }, ...prevDateMatch } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // Invoiced amount & outstanding
      Invoice.aggregate([
        { $match: { ...branchFilter, ...curDateMatch } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, balance: { $sum: '$balanceDue' } } },
      ]),
      Invoice.aggregate([
        { $match: { ...branchFilter, ...prevDateMatch } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, balance: { $sum: '$balanceDue' } } },
      ]),
      // Refunds
      Refund.aggregate([
        { $match: { status: 'Processed', ...curDateMatch } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Refund.aggregate([
        { $match: { status: 'Processed', ...prevDateMatch } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // Leads
      Lead.countDocuments(curDateMatch),
      Lead.countDocuments(prevDateMatch),
      // Won Leads
      Lead.countDocuments(curWonMatch),
      Lead.countDocuments(prevWonMatch),
      // Bookings
      Booking.countDocuments({ ...branchFilter, ...curDateMatch }),
      Booking.countDocuments({ ...branchFilter, ...prevDateMatch }),
      // Sessions
      Schedule.countDocuments({ ...branchFilter, ...curSessionMatch }),
      Schedule.countDocuments({ ...branchFilter, ...prevSessionMatch }),
      Schedule.countDocuments({ ...branchFilter, status: 'Completed', ...curSessionMatch }),
      // Fleet & Inventory & Safety
      Vessel.find(),
      Equipment.countDocuments({ availableQuantity: { $lt: 5 }, status: 'Active' }),
      Incident.countDocuments({ status: { $in: ['Open', 'Under Investigation'] } }),
      ManagementAlert.find({ status: { $in: ['New', 'Acknowledged'] } }).sort({ createdAt: -1 }).limit(5)
    ]);

    const currentCash = curPaidAgg[0]?.total || 0;
    const prevCash = prevPaidAgg[0]?.total || 0;

    const currentInvoiced = curInvoicedAgg[0]?.total || 0;
    const prevInvoiced = prevInvoicedAgg[0]?.total || 0;

    const currentRefund = curRefundsAgg[0]?.total || 0;
    const prevRefund = prevRefundsAgg[0]?.total || 0;

    const netRevenue = Math.max(0, currentInvoiced - currentRefund);
    const prevNetRevenue = Math.max(0, prevInvoiced - prevRefund);

    const outstandingBalance = curInvoicedAgg[0]?.balance || 0;
    const prevOutstanding = prevInvoicedAgg[0]?.balance || 0;

    const curConvRate = curLeads > 0 ? Math.round((curWonLeads / curLeads) * 100) : 0;
    const prevConvRate = prevLeads > 0 ? Math.round((prevWonLeads / prevLeads) * 100) : 0;

    const totalVessels = allVessels.length;
    const readyVessels = allVessels.filter((v) => v.operationalStatus === 'Available').length;
    const maintenanceVessels = allVessels.filter((v) => v.operationalStatus === 'Maintenance').length;
    const fleetReadyRate = totalVessels > 0 ? Math.round((readyVessels / totalVessels) * 100) : 100;

    const sessionDeliveryRate = curSessions > 0 ? Math.round((curCompletedSessions / curSessions) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        period: dates.range,
        dateRange: { start: dates.current.start, end: dates.current.end },
        lastRefreshed: new Date().toISOString(),
        kpiCards: {
          revenue: {
            title: 'Gross Revenue Invoiced',
            value: currentInvoiced,
            unit: 'AED',
            prevValue: prevInvoiced,
            changePercent: calcPercentChange(currentInvoiced, prevInvoiced),
            dataQuality: 'Live',
            kpiId: 'KPI-REV-01',
          },
          cashCollected: {
            title: 'Cash Collected',
            value: currentCash,
            unit: 'AED',
            prevValue: prevCash,
            changePercent: calcPercentChange(currentCash, prevCash),
            dataQuality: 'Live',
            kpiId: 'KPI-CASH-01',
          },
          netRevenue: {
            title: 'Net Revenue',
            value: netRevenue,
            unit: 'AED',
            prevValue: prevNetRevenue,
            changePercent: calcPercentChange(netRevenue, prevNetRevenue),
            dataQuality: 'Live',
            kpiId: 'KPI-NETREV-01',
          },
          outstanding: {
            title: 'Outstanding Receivables',
            value: outstandingBalance,
            unit: 'AED',
            prevValue: prevOutstanding,
            changePercent: calcPercentChange(outstandingBalance, prevOutstanding),
            dataQuality: 'Live',
            kpiId: 'KPI-OUT-01',
          },
          leads: {
            title: 'New Inbound Leads',
            value: curLeads,
            unit: 'Count',
            prevValue: prevLeads,
            changePercent: calcPercentChange(curLeads, prevLeads),
            dataQuality: 'Live',
            kpiId: 'KPI-LEAD-01',
          },
          conversionRate: {
            title: 'Lead Conversion Rate',
            value: curConvRate,
            unit: '%',
            prevValue: prevConvRate,
            changePercent: curConvRate - prevConvRate,
            dataQuality: 'Live',
            kpiId: 'KPI-CONV-01',
          },
          bookings: {
            title: 'Program Bookings',
            value: curBookings,
            unit: 'Count',
            prevValue: prevBookings,
            changePercent: calcPercentChange(curBookings, prevBookings),
            dataQuality: 'Live',
            kpiId: 'KPI-BOOK-01',
          },
          sessions: {
            title: 'Sessions & Trips',
            value: curSessions,
            unit: 'Count',
            prevValue: prevSessions,
            changePercent: calcPercentChange(curSessions, prevSessions),
            dataQuality: 'Live',
            kpiId: 'KPI-SESS-01',
          },
          fleetReadiness: {
            title: 'Fleet Operational Readiness',
            value: fleetReadyRate,
            unit: '%',
            details: `${readyVessels} of ${totalVessels} boats ready (${maintenanceVessels} in maintenance)`,
            dataQuality: totalVessels > 0 ? 'Live' : 'No Data',
            kpiId: 'KPI-FLEET-01',
          },
          inventoryAlerts: {
            title: 'Low Stock Gear Alerts',
            value: lowStockEquipment,
            unit: 'Items',
            dataQuality: 'Live',
            kpiId: 'KPI-EQUIP-01',
          },
          openIncidents: {
            title: 'Open Safety Incidents',
            value: pendingIncidents,
            unit: 'Cases',
            dataQuality: 'Live',
            kpiId: 'KPI-SAFE-01',
          },
          deliveryRate: {
            title: 'Session Completion Rate',
            value: sessionDeliveryRate,
            unit: '%',
            dataQuality: 'Live',
            kpiId: 'KPI-DELV-01',
          },
        },
        alerts,
      },
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 2. GET /api/v1/management/revenue
// -------------------------------------------------------------
exports.getRevenueAnalytics = async (req, res, next) => {
  try {
    const dates = parseDateFilters(req.query);
    const branchFilter = req.query.branchId ? { branch: req.query.branchId } : {};

    const [
      invoices,
      payments,
      refunds,
      revenueByBranch,
      revenueByProgram,
      revenueByMethod,
      monthlyTrend
    ] = await Promise.all([
      Invoice.find({ ...branchFilter, createdAt: { $gte: dates.current.start, $lte: dates.current.end } })
        .populate('customer', 'fullName email')
        .populate('program', 'title')
        .populate('branch', 'name')
        .sort({ createdAt: -1 }),

      PaymentTransaction.find({ createdAt: { $gte: dates.current.start, $lte: dates.current.end } })
        .populate('customer', 'fullName email')
        .sort({ createdAt: -1 }),

      Refund.find({ createdAt: { $gte: dates.current.start, $lte: dates.current.end } }),

      // Aggregations
      Invoice.aggregate([
        { $match: { createdAt: { $gte: dates.current.start, $lte: dates.current.end } } },
        { $group: { _id: '$branch', totalRevenue: { $sum: '$totalAmount' }, totalCollected: { $sum: '$amountPaid' }, invoiceCount: { $sum: 1 } } },
        { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
        { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      ]),

      Invoice.aggregate([
        { $match: { ...branchFilter, createdAt: { $gte: dates.current.start, $lte: dates.current.end } } },
        { $group: { _id: '$program', totalRevenue: { $sum: '$totalAmount' }, totalPaid: { $sum: '$amountPaid' }, bookingsCount: { $sum: 1 } } },
        { $lookup: { from: 'programs', localField: '_id', foreignField: '_id', as: 'program' } },
        { $unwind: { path: '$program', preserveNullAndEmptyArrays: true } },
        { $sort: { totalRevenue: -1 } }
      ]),

      PaymentTransaction.aggregate([
        { $match: { status: 'Completed', createdAt: { $gte: dates.current.start, $lte: dates.current.end } } },
        { $group: { _id: '$paymentMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      Invoice.aggregate([
        { $match: { createdAt: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 5)) } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            revenue: { $sum: '$totalAmount' },
            collected: { $sum: '$amountPaid' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
    ]);

    const totalInvoiced = invoices.reduce((acc, inv) => acc + (inv.totalAmount || 0), 0);
    const totalCollected = payments.filter((p) => p.status === 'Completed').reduce((acc, p) => acc + (p.amount || 0), 0);
    const totalRefunded = refunds.filter((r) => r.status === 'Processed').reduce((acc, r) => acc + (r.amount || 0), 0);
    const totalDiscounted = invoices.reduce((acc, inv) => acc + (inv.discount || 0), 0);
    const outstandingDues = invoices.reduce((acc, inv) => acc + (inv.balanceDue || 0), 0);
    const netRevenue = Math.max(0, totalInvoiced - totalRefunded - totalDiscounted);
    const avgBookingValue = invoices.length > 0 ? Math.round(totalInvoiced / invoices.length) : 0;
    const collectionRate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalInvoiced,
          totalCollected,
          totalRefunded,
          totalDiscounted,
          netRevenue,
          outstandingDues,
          avgBookingValue,
          collectionRate,
        },
        revenueByBranch: revenueByBranch.map((b) => ({
          branchId: b._id,
          branchName: b.branch?.name || 'Unassigned',
          totalRevenue: b.totalRevenue,
          totalCollected: b.totalCollected,
          invoiceCount: b.invoiceCount,
        })),
        revenueByProgram: revenueByProgram.map((p) => ({
          programId: p._id,
          programTitle: p.program?.title || 'Custom Booking',
          totalRevenue: p.totalRevenue,
          totalPaid: p.totalPaid,
          bookingsCount: p.bookingsCount,
        })),
        revenueByMethod,
        monthlyTrend,
        recentInvoices: invoices.slice(0, 10),
      },
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 3. GET /api/v1/management/sales
// -------------------------------------------------------------
exports.getSalesAnalytics = async (req, res, next) => {
  try {
    const dates = parseDateFilters(req.query);

    const leadMatch = {};
    if (dates.current.start && dates.current.end) {
      leadMatch.createdAt = { $gte: dates.current.start, $lte: dates.current.end };
    }

    const wonMatch = { stage: 'won' };
    if (dates.current.start && dates.current.end) {
      wonMatch.$or = [
        { convertedAt: { $gte: dates.current.start, $lte: dates.current.end } },
        { createdAt: { $gte: dates.current.start, $lte: dates.current.end } },
      ];
    }

    const lostMatch = { stage: 'lost', ...leadMatch };

    const [
      totalLeads,
      wonLeads,
      lostLeads,
      leadsBySource,
      rawStageCounts,
      salesRepsData,
      recentLeads
    ] = await Promise.all([
      Lead.countDocuments(leadMatch),
      Lead.countDocuments(wonMatch),
      Lead.countDocuments(lostMatch),

      Lead.aggregate([
        ...(Object.keys(leadMatch).length > 0 ? [{ $match: leadMatch }] : []),
        { $group: { _id: '$source', count: { $sum: 1 }, wonCount: { $sum: { $cond: [{ $eq: ['$stage', 'won'] }, 1, 0] } } } },
        { $sort: { count: -1 } },
      ]),

      Lead.aggregate([
        ...(Object.keys(leadMatch).length > 0 ? [{ $match: leadMatch }] : []),
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),

      User.aggregate([
        { $lookup: { from: 'roles', localField: 'role', foreignField: '_id', as: 'roleDoc' } },
        { $unwind: { path: '$roleDoc', preserveNullAndEmptyArrays: true } },
        { $match: { 'roleDoc.slug': { $in: ['sales-representative', 'sales-manager', 'super-admin', 'admin', 'sales-agent'] } } },
        {
          $lookup: {
            from: 'leads',
            localField: '_id',
            foreignField: 'assignedTo',
            pipeline: [
              ...(Object.keys(leadMatch).length > 0 ? [{ $match: leadMatch }] : []),
            ],
            as: 'assignedLeads',
          },
        },
        {
          $project: {
            _id: 1,
            fullName: 1,
            email: 1,
            totalAssigned: { $size: '$assignedLeads' },
            wonCount: {
              $size: {
                $filter: {
                  input: '$assignedLeads',
                  as: 'l',
                  cond: { $eq: ['$$l.stage', 'won'] },
                },
              },
            },
          },
        },
        { $sort: { wonCount: -1, totalAssigned: -1 } },
      ]),

      Lead.find(leadMatch)
        .populate('assignedTo', 'fullName email')
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    // Build map of counts by lowercase stage key
    const countMap = {};
    rawStageCounts.forEach((r) => {
      if (r._id) {
        countMap[String(r._id).toLowerCase()] = r.count;
      }
    });

    // Active stages from single source of truth
    const activeStageConfig = (PIPELINE_STAGE_CONFIG || []).filter((s) => s.active !== false);

    // Calculate total active pipeline leads
    const totalPipelineLeads = totalLeads;

    const leadsByStage = activeStageConfig.map((stage) => {
      const count = countMap[stage.key.toLowerCase()] || 0;
      const percent = totalPipelineLeads > 0 ? Math.round((count / totalPipelineLeads) * 100) : 0;
      return {
        stage: stage.key,
        stageName: stage.label,
        stageOrder: stage.order,
        count,
        percent,
      };
    });

    // In-pipeline open leads (all active stages excluding won & lost)
    const inPipeline = activeStageConfig
      .filter((s) => !['won', 'lost'].includes(s.key))
      .reduce((sum, s) => sum + (countMap[s.key] || 0), 0);

    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalLeads,
          wonLeads,
          lostLeads,
          inPipeline,
          conversionRate,
        },
        leadsBySource: leadsBySource.map((s) => ({
          source: s._id || 'Direct / Walk-In',
          count: s.count,
          wonCount: s.wonCount,
          conversionRate: s.count > 0 ? Math.round((s.wonCount / s.count) * 100) : 0,
        })),
        leadsByStage,
        salesReps: salesRepsData.map((rep) => ({
          repId: rep._id,
          name: rep.fullName,
          email: rep.email,
          totalAssigned: rep.totalAssigned,
          wonCount: rep.wonCount,
          conversionRate: rep.totalAssigned > 0 ? Math.round((rep.wonCount / rep.totalAssigned) * 100) : 0,
        })),
        recentLeads,
      },
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 4. GET /api/v1/management/operations
// -------------------------------------------------------------
exports.getOperationsAnalytics = async (req, res, next) => {
  try {
    const dates = parseDateFilters(req.query);
    const branchFilter = req.query.branchId ? { branch: req.query.branchId } : {};

    const [
      schedules,
      sessionsByType,
      vessels,
      equipment,
      incidents,
      attendanceStats
    ] = await Promise.all([
      Schedule.find({ ...branchFilter, startTime: { $gte: dates.current.start, $lte: dates.current.end } })
        .populate('instructor', 'fullName email')
        .populate('program', 'title category')
        .populate('branch', 'name')
        .populate('vessel', 'name registrationNumber capacity')
        .sort({ startTime: 1 }),

      Schedule.aggregate([
        { $match: { ...branchFilter, startTime: { $gte: dates.current.start, $lte: dates.current.end } } },
        { $group: { _id: '$sessionType', count: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } } } },
      ]),

      Vessel.find().populate('branch', 'name'),
      Equipment.find().populate('branch', 'name'),
      Incident.find({ createdAt: { $gte: dates.current.start, $lte: dates.current.end } })
        .populate('reportedBy', 'fullName')
        .sort({ createdAt: -1 }),

      Schedule.aggregate([
        { $match: { ...branchFilter, startTime: { $gte: dates.current.start, $lte: dates.current.end } } },
        { $group: { _id: '$attendance', count: { $sum: 1 } } },
      ]),
    ]);

    const totalSessions = schedules.length;
    const completedSessions = schedules.filter((s) => s.status === 'Completed').length;
    const cancelledSessions = schedules.filter((s) => s.status === 'Cancelled').length;

    const totalVessels = vessels.length;
    const readyVessels = vessels.filter((v) => v.operationalStatus === 'Available').length;
    const maintenanceVessels = vessels.filter((v) => v.operationalStatus === 'Maintenance').length;

    const totalEquipment = equipment.reduce((acc, eq) => acc + (eq.totalQuantity || 0), 0);
    const availableEquipment = equipment.reduce((acc, eq) => acc + (eq.availableQuantity || 0), 0);
    const damagedEquipment = equipment.reduce((acc, eq) => acc + (eq.damagedQuantity || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalSessions,
          completedSessions,
          cancelledSessions,
          deliveryRate: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0,
          totalVessels,
          readyVessels,
          maintenanceVessels,
          fleetReadinessRate: totalVessels > 0 ? Math.round((readyVessels / totalVessels) * 100) : 100,
          totalEquipment,
          availableEquipment,
          damagedEquipment,
          totalIncidents: incidents.length,
          openIncidents: incidents.filter((i) => i.status === 'Open' || i.status === 'Under Investigation').length,
        },
        sessionsByType: sessionsByType.map((t) => ({
          type: t._id || 'Class',
          count: t.count,
          completed: t.completed,
        })),
        attendanceBreakdown: attendanceStats.map((att) => ({
          status: att._id || 'Pending',
          count: att.count,
        })),
        vesselsList: vessels,
        incidentsList: incidents,
      },
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 5. GET /api/v1/management/staff-coaches
// -------------------------------------------------------------
exports.getStaffCoachPerformance = async (req, res, next) => {
  try {
    const dates = parseDateFilters(req.query);

    const coachRole = await User.aggregate([
      { $lookup: { from: 'roles', localField: 'role', foreignField: '_id', as: 'roleDoc' } },
      { $unwind: '$roleDoc' },
      { $match: { 'roleDoc.slug': 'coach' } },
      {
        $lookup: {
          from: 'schedules',
          localField: '_id',
          foreignField: 'instructor',
          as: 'sessions',
        },
      },
      {
        $lookup: {
          from: 'coachcertifications',
          localField: '_id',
          foreignField: 'coach',
          as: 'certifications',
        },
      },
      {
        $project: {
          _id: 1,
          fullName: 1,
          email: 1,
          phone: 1,
          branch: 1,
          totalAssignedSessions: { $size: '$sessions' },
          completedSessions: {
            $size: {
              $filter: {
                input: '$sessions',
                as: 's',
                cond: { $eq: ['$$s.status', 'Completed'] },
              },
            },
          },
          attendanceMarkedSessions: {
            $size: {
              $filter: {
                input: '$sessions',
                as: 's',
                cond: { $in: ['$$s.attendance', ['Present', 'Absent', 'Late', 'Excused']] },
              },
            },
          },
          certifications: 1,
        },
      },
    ]);

    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 86400000);

    const enrichedCoaches = coachRole.map((c) => {
      const activeCerts = (c.certifications || []).filter((cert) => new Date(cert.expiryDate) > now);
      const expiringSoon = (c.certifications || []).filter(
        (cert) => new Date(cert.expiryDate) <= thirtyDays && new Date(cert.expiryDate) >= now
      );

      const attendanceRate =
        c.totalAssignedSessions > 0
          ? Math.round((c.attendanceMarkedSessions / c.totalAssignedSessions) * 100)
          : 100;

      const completionRate =
        c.totalAssignedSessions > 0
          ? Math.round((c.completedSessions / c.totalAssignedSessions) * 100)
          : 100;

      return {
        coachId: c._id,
        fullName: c.fullName,
        email: c.email,
        phone: c.phone,
        totalAssigned: c.totalAssignedSessions,
        completed: c.completedSessions,
        attendanceRate,
        completionRate,
        totalCertifications: (c.certifications || []).length,
        activeCertifications: activeCerts.length,
        expiringSoonCount: expiringSoon.length,
        complianceStatus: expiringSoon.length > 0 ? 'Warning' : activeCerts.length > 0 ? 'Compliant' : 'Pending Verification',
      };
    });

    res.status(200).json({
      success: true,
      data: {
        coaches: enrichedCoaches,
        totalCoaches: enrichedCoaches.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 6. GET /api/v1/management/branches
// -------------------------------------------------------------
exports.getBranchPerformance = async (req, res, next) => {
  try {
    const dates = parseDateFilters(req.query);

    const branches = await Branch.find().lean();

    const branchAnalytics = await Promise.all(
      branches.map(async (b) => {
        const [invoices, bookings, sessions, fleetCount] = await Promise.all([
          Invoice.aggregate([
            { $match: { branch: b._id, createdAt: { $gte: dates.current.start, $lte: dates.current.end } } },
            { $group: { _id: null, revenue: { $sum: '$totalAmount' }, collected: { $sum: '$amountPaid' } } },
          ]),
          Booking.countDocuments({ branch: b._id, createdAt: { $gte: dates.current.start, $lte: dates.current.end } }),
          Schedule.countDocuments({ branch: b._id, startTime: { $gte: dates.current.start, $lte: dates.current.end } }),
          Vessel.countDocuments({ branch: b._id }),
        ]);

        const revenue = invoices[0]?.revenue || 0;
        const collected = invoices[0]?.collected || 0;
        const estimatedDirectCosts = Math.round(revenue * 0.35); // 35% estimated direct operational cost
        const estimatedMargin = revenue - estimatedDirectCosts;

        return {
          branchId: b._id,
          name: b.name,
          code: b.code,
          city: b.city,
          capacity: b.capacity || 50,
          revenue,
          collected,
          bookingsCount: bookings,
          sessionsCount: sessions,
          fleetCount,
          estimatedDirectCosts,
          estimatedMargin,
          marginPercent: revenue > 0 ? Math.round((estimatedMargin / revenue) * 100) : 0,
          dataQuality: 'Estimated Costs',
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        branches: branchAnalytics,
        totalBranches: branchAnalytics.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 7. GET /api/v1/management/programs
// -------------------------------------------------------------
exports.getProgramAnalytics = async (req, res, next) => {
  try {
    const dates = parseDateFilters(req.query);
    const branchFilter = req.query.branchId ? { branch: req.query.branchId } : {};

    const programStats = await Program.aggregate([
      {
        $lookup: {
          from: 'invoices',
          localField: '_id',
          foreignField: 'program',
          as: 'invoices',
        },
      },
      {
        $lookup: {
          from: 'bookings',
          localField: '_id',
          foreignField: 'program',
          as: 'bookings',
        },
      },
      {
        $lookup: {
          from: 'schedules',
          localField: '_id',
          foreignField: 'program',
          as: 'schedules',
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          category: 1,
          level: 1,
          price: 1,
          capacity: 1,
          totalRevenue: {
            $sum: '$invoices.totalAmount',
          },
          totalBookings: { $size: '$bookings' },
          totalSessions: { $size: '$schedules' },
          completedSessions: {
            $size: {
              $filter: {
                input: '$schedules',
                as: 's',
                cond: { $eq: ['$$s.status', 'Completed'] },
              },
            },
          },
          cancelledSessions: {
            $size: {
              $filter: {
                input: '$schedules',
                as: 's',
                cond: { $eq: ['$$s.status', 'Cancelled'] },
              },
            },
          },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    const enriched = programStats.map((p) => {
      const cancellationRate = p.totalSessions > 0 ? Math.round((p.cancelledSessions / p.totalSessions) * 100) : 0;
      const occupancyRate = p.capacity > 0 && p.totalSessions > 0 ? Math.min(100, Math.round((p.totalBookings / (p.capacity * p.totalSessions)) * 100)) : 80;

      return {
        programId: p._id,
        title: p.title,
        category: p.category,
        level: p.level,
        price: p.price,
        capacity: p.capacity || 10,
        totalRevenue: p.totalRevenue || 0,
        totalBookings: p.totalBookings || 0,
        totalSessions: p.totalSessions || 0,
        completedSessions: p.completedSessions || 0,
        cancellationRate,
        occupancyRate,
      };
    });

    res.status(200).json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 8. GET /api/v1/management/kpis
// -------------------------------------------------------------
exports.getKpiLibrary = async (req, res, next) => {
  try {
    let kpis = await KpiDefinition.find().sort({ category: 1, kpiId: 1 });

    // Seed default Blueprint KPIs if empty
    if (kpis.length === 0) {
      const defaultKpis = [
        {
          kpiId: 'KPI-REV-01',
          name: 'Gross Revenue Invoiced',
          category: 'Revenue',
          description: 'Total monetary value of invoices generated in the period.',
          formula: 'SUM(Invoice.totalAmount)',
          formulaVersion: '1.0.0',
          unit: 'AED',
          targetValue: 100000,
          dataQuality: 'Live',
          sourceCollections: ['Invoices'],
        },
        {
          kpiId: 'KPI-CASH-01',
          name: 'Cash Collected',
          category: 'Finance',
          description: 'Total funds successfully processed through payment gateway and point of sale.',
          formula: 'SUM(PaymentTransaction.amount WHERE status == "Completed")',
          formulaVersion: '1.0.0',
          unit: 'AED',
          targetValue: 80000,
          dataQuality: 'Live',
          sourceCollections: ['PaymentTransactions'],
        },
        {
          kpiId: 'KPI-NETREV-01',
          name: 'Net Recognized Revenue',
          category: 'Revenue',
          description: 'Revenue recognized after deducting processed customer refunds and discounts.',
          formula: 'GrossInvoiced - ProcessedRefunds - TotalDiscounts',
          formulaVersion: '1.0.0',
          unit: 'AED',
          targetValue: 90000,
          dataQuality: 'Live',
          sourceCollections: ['Invoices', 'Refunds'],
        },
        {
          kpiId: 'KPI-CONV-01',
          name: 'Lead-to-Booking Conversion Rate',
          category: 'Sales',
          description: 'Percentage of inbound inquiries successfully converted into enrolled bookings.',
          formula: '(WonLeads / TotalInboundLeads) * 100',
          formulaVersion: '1.0.0',
          unit: '%',
          targetValue: 35,
          warningThreshold: 20,
          criticalThreshold: 10,
          dataQuality: 'Live',
          sourceCollections: ['Leads', 'Bookings'],
        },
        {
          kpiId: 'KPI-OUT-01',
          name: 'Outstanding Accounts Receivable',
          category: 'Finance',
          description: 'Total balance remaining due across sent, partially paid, and overdue invoices.',
          formula: 'SUM(Invoice.balanceDue WHERE status IN ["Sent", "Partially Paid", "Overdue"])',
          formulaVersion: '1.0.0',
          unit: 'AED',
          targetValue: 15000,
          warningThreshold: 25000,
          criticalThreshold: 40000,
          dataQuality: 'Live',
          sourceCollections: ['Invoices'],
        },
        {
          kpiId: 'KPI-FLEET-01',
          name: 'Fleet Operational Readiness Rate',
          category: 'Operations',
          description: 'Percentage of vessels sea-ready and certified for daily student charters.',
          formula: '(ReadyAvailableVessels / TotalRegisteredFleet) * 100',
          formulaVersion: '1.0.0',
          unit: '%',
          targetValue: 90,
          warningThreshold: 75,
          criticalThreshold: 50,
          dataQuality: 'Live',
          sourceCollections: ['Vessels'],
        },
      ];

      kpis = await KpiDefinition.insertMany(defaultKpis);
    }

    res.status(200).json({
      success: true,
      count: kpis.length,
      data: kpis,
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 9. GET /api/v1/management/reports
// -------------------------------------------------------------
exports.getManagementReports = async (req, res, next) => {
  try {
    const dates = parseDateFilters(req.query);

    const [invoices, payments, leads, bookings, sessions, vessels] = await Promise.all([
      Invoice.find({ createdAt: { $gte: dates.current.start, $lte: dates.current.end } })
        .populate('customer', 'fullName email phone')
        .populate('program', 'title')
        .populate('branch', 'name'),
      PaymentTransaction.find({ createdAt: { $gte: dates.current.start, $lte: dates.current.end } }),
      Lead.find({ createdAt: { $gte: dates.current.start, $lte: dates.current.end } }).populate('assignedTo', 'fullName'),
      Booking.find({ createdAt: { $gte: dates.current.start, $lte: dates.current.end } })
        .populate('student', 'fullName email')
        .populate('program', 'title')
        .populate('branch', 'name'),
      Schedule.find({ startTime: { $gte: dates.current.start, $lte: dates.current.end } })
        .populate('instructor', 'fullName email')
        .populate('branch', 'name'),
      Vessel.find(),
    ]);

    const totalRevenue = invoices.reduce((acc, i) => acc + (i.totalAmount || 0), 0);
    const totalCollected = payments.filter((p) => p.status === 'Completed').reduce((acc, p) => acc + (p.amount || 0), 0);
    const totalOutstanding = invoices.reduce((acc, i) => acc + (i.balanceDue || 0), 0);
    const wonLeads = leads.filter((l) => l.stage === 'won').length;

    res.status(200).json({
      success: true,
      data: {
        reportType: req.query.reportType || 'Daily Management Snapshot',
        generatedAt: new Date().toISOString(),
        period: dates.range,
        dateRange: { start: dates.current.start, end: dates.current.end },
        financials: {
          totalRevenue,
          totalCollected,
          totalOutstanding,
          invoicesCount: invoices.length,
          paymentsCount: payments.length,
        },
        commercials: {
          totalLeads: leads.length,
          wonLeads,
          conversionRate: leads.length > 0 ? Math.round((wonLeads / leads.length) * 100) : 0,
          totalBookings: bookings.length,
        },
        operations: {
          totalSessions: sessions.length,
          completedSessions: sessions.filter((s) => s.status === 'Completed').length,
          totalFleet: vessels.length,
          readyFleet: vessels.filter((v) => v.operationalStatus === 'Available').length,
        },
        details: {
          invoices: invoices.slice(0, 50),
          leads: leads.slice(0, 50),
          bookings: bookings.slice(0, 50),
          sessions: sessions.slice(0, 50),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 10. GET & PUT /api/v1/management/alerts
// -------------------------------------------------------------
exports.getManagementAlerts = async (req, res, next) => {
  try {
    const alerts = await ManagementAlert.find()
      .populate('branch', 'name')
      .populate('acknowledgedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: alerts.length, data: alerts });
  } catch (err) {
    next(err);
  }
};

exports.updateAlertStatus = async (req, res, next) => {
  try {
    const { status, resolutionNotes } = req.body;
    const updateData = { status };

    if (status === 'Acknowledged') {
      updateData.acknowledgedBy = req.user._id;
      updateData.acknowledgedAt = new Date();
    }
    if (resolutionNotes) {
      updateData.resolutionNotes = resolutionNotes;
    }

    const alert = await ManagementAlert.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .populate('branch', 'name')
      .populate('acknowledgedBy', 'fullName email');

    if (!alert) return next(new AppError('Alert not found', 404));

    res.status(200).json({ success: true, data: alert });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 11. GET /api/v1/management/audit
// -------------------------------------------------------------
exports.getAuditExplorer = async (req, res, next) => {
  try {
    const { entityType, type, userId, startDate, endDate, page = 1, limit = 25 } = req.query;
    const filter = {};

    if (entityType) filter.entityType = entityType;
    if (type) filter.type = type;
    if (userId) filter.performedBy = userId;

    if (startDate && endDate) {
      filter.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const total = await Activity.countDocuments(filter);
    const activities = await Activity.find(filter)
      .populate('performedBy', 'fullName email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      data: activities,
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 12. GET /api/v1/management/drilldown
// -------------------------------------------------------------
exports.getDrilldownData = async (req, res, next) => {
  try {
    const { metricType } = req.query;
    const dates = parseDateFilters(req.query);
    const branchFilter = req.query.branchId ? { branch: req.query.branchId } : {};

    let records = [];

    switch (metricType) {
      case 'revenue':
      case 'invoices':
      case 'outstanding':
        records = await Invoice.find({
          ...branchFilter,
          createdAt: { $gte: dates.current.start, $lte: dates.current.end },
        })
          .populate('customer', 'fullName email phone')
          .populate('program', 'title category price')
          .populate('branch', 'name code')
          .sort({ createdAt: -1 })
          .limit(100);
        break;

      case 'cash':
      case 'payments':
        records = await PaymentTransaction.find({
          createdAt: { $gte: dates.current.start, $lte: dates.current.end },
        })
          .populate('customer', 'fullName email phone')
          .populate('invoice', 'invoiceNumber totalAmount')
          .sort({ createdAt: -1 })
          .limit(100);
        break;

      case 'leads':
      case 'conversion':
        records = await Lead.find({
          createdAt: { $gte: dates.current.start, $lte: dates.current.end },
        })
          .populate('assignedTo', 'fullName email')
          .populate('interestedProgram', 'title')
          .sort({ createdAt: -1 })
          .limit(100);
        break;

      case 'bookings':
        records = await Booking.find({
          ...branchFilter,
          createdAt: { $gte: dates.current.start, $lte: dates.current.end },
        })
          .populate('student', 'fullName email phone')
          .populate('program', 'title category price')
          .populate('branch', 'name code')
          .sort({ createdAt: -1 })
          .limit(100);
        break;

      case 'sessions':
      case 'operations':
        records = await Schedule.find({
          ...branchFilter,
          startTime: { $gte: dates.current.start, $lte: dates.current.end },
        })
          .populate('instructor', 'fullName email phone')
          .populate('program', 'title category')
          .populate('branch', 'name code')
          .populate('vessel', 'name registrationNumber capacity')
          .sort({ startTime: 1 })
          .limit(100);
        break;

      case 'incidents':
      case 'safety':
        records = await Incident.find({
          createdAt: { $gte: dates.current.start, $lte: dates.current.end },
        })
          .populate('reportedBy', 'fullName email')
          .populate('session', 'title startTime')
          .sort({ createdAt: -1 })
          .limit(100);
        break;

      case 'equipment':
        records = await Equipment.find()
          .populate('branch', 'name code')
          .sort({ availableQuantity: 1 })
          .limit(100);
        break;

      case 'fleet':
        records = await Vessel.find()
          .populate('branch', 'name code')
          .sort({ operationalStatus: 1 })
          .limit(100);
        break;

      default:
        records = [];
    }

    res.status(200).json({
      success: true,
      metricType,
      count: records.length,
      data: records,
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 13. GET /api/v1/management/customer-revenue
// -------------------------------------------------------------
exports.getCustomerRevenue = async (req, res, next) => {
  try {
    const { customerId } = req.query;
    if (!customerId) return next(new AppError('Customer ID is required', 400));

    const dates = parseDateFilters(req.query);
    const curDateMatch = (dates.current.start && dates.current.end) 
      ? { createdAt: { $gte: dates.current.start, $lte: dates.current.end } } 
      : {};

    const { Types } = require('mongoose');
    let custIdObj;
    try {
      custIdObj = new Types.ObjectId(customerId);
    } catch (e) {
      return next(new AppError('Invalid Customer ID format', 400));
    }

    const branchMatch = req.query.branchId ? { 'invoiceData.branch': new Types.ObjectId(req.query.branchId) } : {};

    const branchLookup = req.query.branchId ? [
      {
        $lookup: {
          from: 'invoices',
          localField: 'invoice',
          foreignField: '_id',
          as: 'invoiceData'
        }
      },
      { $unwind: { path: '$invoiceData', preserveNullAndEmptyArrays: false } },
      { $match: branchMatch }
    ] : [];

    const [paymentsAgg, refundsAgg] = await Promise.all([
      PaymentTransaction.aggregate([
        { 
          $match: { 
            customer: custIdObj,
            status: { $in: ['Completed', 'Partially Refunded', 'Refunded'] },
            ...curDateMatch
          } 
        },
        ...branchLookup,
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Refund.aggregate([
        { 
          $match: { 
            customer: custIdObj,
            status: 'Processed',
            ...curDateMatch
          } 
        },
        ...branchLookup,
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const totalPayments = paymentsAgg[0]?.total || 0;
    const totalRefunds = refundsAgg[0]?.total || 0;
    const netRevenue = totalPayments - totalRefunds;

    return sendResponse(res, 200, 'Customer revenue calculated successfully', {
      customerId,
      totalPayments,
      totalRefunds,
      netRevenue,
    });
  } catch (err) {
    next(err);
  }
};
