const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const PaymentTransaction = require('../models/PaymentTransaction');
const Lead = require('../models/Lead');
const Booking = require('../models/Booking');
const Schedule = require('../models/Schedule');
const Vessel = require('../models/Vessel');
const Equipment = require('../models/Equipment');
const Incident = require('../models/Incident');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Program = require('../models/Program');

class ReportingService {
  /**
   * Helper to parse report date filters.
   */
  parseDates(query) {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);

    const range = query.range || 'this_month';

    if (range === 'today') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (range === 'yesterday') {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (range === 'this_week') {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (range === 'last_week') {
      const day = start.getDay();
      end.setDate(end.getDate() - day - 1);
      end.setHours(23, 59, 59, 999);
      start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else if (range === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (range === 'custom' && query.startDate && query.endDate) {
      start = new Date(query.startDate);
      start.setHours(0, 0, 0, 0);
      end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
    } else {
      // this_month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end.setHours(23, 59, 59, 999);
    }

    return { start, end, range };
  }

  /**
   * 1. DAILY OPERATIONAL REPORT
   */
  async generateDailyReport(query = {}) {
    const { start, end, range } = this.parseDates(query);
    const branchFilter = query.branchId ? { branch: query.branchId } : {};

    const [invoices, payments, leads, schedules, vessels, equipment, incidents] = await Promise.all([
      Invoice.find({ ...branchFilter, createdAt: { $gte: start, $lte: end } })
        .populate('customer', 'fullName email')
        .populate('program', 'title')
        .populate('branch', 'name'),

      PaymentTransaction.find({ createdAt: { $gte: start, $lte: end } })
        .populate('customer', 'fullName email')
        .populate('invoice', 'invoiceNumber'),

      Lead.find({ createdAt: { $gte: start, $lte: end } }).populate('assignedTo', 'fullName'),

      Schedule.find({ ...branchFilter, startTime: { $gte: start, $lte: end } })
        .populate('instructor', 'fullName')
        .populate('program', 'title')
        .populate('branch', 'name')
        .populate('vessel', 'name'),

      Vessel.find(),
      Equipment.find(),
      Incident.find({ createdAt: { $gte: start, $lte: end } }).populate('reportedBy', 'fullName'),
    ]);

    const totalInvoiced = invoices.reduce((acc, i) => acc + (i.totalAmount || 0), 0);
    const totalCollected = payments.filter((p) => p.status === 'Completed').reduce((acc, p) => acc + (p.amount || 0), 0);
    const totalOutstanding = invoices.reduce((acc, i) => acc + (i.balanceDue || 0), 0);
    const completedSessions = schedules.filter((s) => s.status === 'Completed').length;
    const readyVessels = vessels.filter((v) => v.operationalStatus === 'Available').length;

    return {
      reportType: 'Daily Operational Snapshot',
      period: range,
      dateRange: { start, end },
      generatedAt: new Date().toISOString(),
      summary: {
        totalInvoiced,
        totalCollected,
        totalOutstanding,
        invoicesCount: invoices.length,
        paymentsCount: payments.length,
        leadsCaptured: leads.length,
        sessionsScheduled: schedules.length,
        sessionsCompleted: completedSessions,
        totalVessels: vessels.length,
        readyVessels,
        openIncidents: incidents.filter((i) => i.status === 'Open' || i.status === 'Under Investigation').length,
      },
      details: {
        invoices,
        payments,
        leads,
        schedules,
        incidents,
      },
    };
  }

  /**
   * 2. WEEKLY PERFORMANCE REPORT
   */
  async generateWeeklyReport(query = {}) {
    const { start, end, range } = this.parseDates(query);
    const branchFilter = query.branchId ? { branch: query.branchId } : {};

    const [invoices, leads, bookings, schedules, salesReps] = await Promise.all([
      Invoice.find({ ...branchFilter, createdAt: { $gte: start, $lte: end } }),
      Lead.find({ createdAt: { $gte: start, $lte: end } }).populate('assignedTo', 'fullName'),
      Booking.find({ ...branchFilter, createdAt: { $gte: start, $lte: end } }),
      Schedule.find({ ...branchFilter, startTime: { $gte: start, $lte: end } }),
      User.find({ status: 'active' }).populate('role'),
    ]);

    const totalRevenue = invoices.reduce((acc, i) => acc + (i.totalAmount || 0), 0);
    const wonLeads = leads.filter((l) => l.stage === 'won').length;
    const conversionRate = leads.length > 0 ? Math.round((wonLeads / leads.length) * 100) : 0;
    const completedSessions = schedules.filter((s) => s.status === 'Completed').length;

    return {
      reportType: 'Weekly Executive Performance Summary',
      period: range,
      dateRange: { start, end },
      generatedAt: new Date().toISOString(),
      summary: {
        totalRevenue,
        totalBookings: bookings.length,
        totalLeads: leads.length,
        wonLeads,
        conversionRate,
        sessionsDelivered: completedSessions,
      },
      leadsBySource: Object.entries(
        leads.reduce((acc, l) => {
          const src = l.source || 'Direct';
          acc[src] = (acc[src] || 0) + 1;
          return acc;
        }, {})
      ).map(([source, count]) => ({ source, count })),
      details: {
        invoices: invoices.slice(0, 50),
        leads: leads.slice(0, 50),
        bookings: bookings.slice(0, 50),
      },
    };
  }

  /**
   * 3. MONTHLY EXECUTIVE REVIEW
   */
  async generateMonthlyReport(query = {}) {
    const { start, end, range } = this.parseDates(query);
    const branches = await Branch.find().lean();

    const branchBreakdown = await Promise.all(
      branches.map(async (b) => {
        const [invAgg, bookCount] = await Promise.all([
          Invoice.aggregate([
            { $match: { branch: b._id, createdAt: { $gte: start, $lte: end } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' }, collected: { $sum: '$amountPaid' } } },
          ]),
          Booking.countDocuments({ branch: b._id, createdAt: { $gte: start, $lte: end } }),
        ]);

        const revenue = invAgg[0]?.total || 0;
        const collected = invAgg[0]?.collected || 0;
        const directCosts = Math.round(revenue * 0.35);
        const margin = revenue - directCosts;

        return {
          name: b.name,
          city: b.city,
          revenue,
          collected,
          bookings: bookCount,
          directCosts,
          margin,
          marginPercent: revenue > 0 ? Math.round((margin / revenue) * 100) : 0,
        };
      })
    );

    const totalRevenue = branchBreakdown.reduce((acc, b) => acc + b.revenue, 0);
    const totalCollected = branchBreakdown.reduce((acc, b) => acc + b.collected, 0);
    const totalMargin = branchBreakdown.reduce((acc, b) => acc + b.margin, 0);

    return {
      reportType: 'Monthly Board & CEO Review',
      period: range,
      dateRange: { start, end },
      generatedAt: new Date().toISOString(),
      summary: {
        totalRevenue,
        totalCollected,
        totalMargin,
        overallMarginPercent: totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 100) : 0,
      },
      branches: branchBreakdown,
    };
  }

  /**
   * Universal CSV Exporter with clean headers, structured records, and totals.
   */
  exportToCsv(reportData) {
    const lines = [];

    lines.push(`"AQUA FISHING ACADEMY - MANAGEMENT INFORMATION SYSTEM"`);
    lines.push(`"Report Type:","${reportData.reportType}"`);
    lines.push(`"Generated At:","${reportData.generatedAt}"`);
    lines.push(`"Period:","${reportData.period}"`);
    lines.push(``);

    // Summary Section
    lines.push(`"--- EXECUTIVE SUMMARY ---"`);
    Object.entries(reportData.summary || {}).forEach(([key, val]) => {
      lines.push(`"${key}","${typeof val === 'number' ? val.toLocaleString() : val}"`);
    });
    lines.push(``);

    // Invoices Detail Table (if available)
    if (reportData.details?.invoices && reportData.details.invoices.length > 0) {
      lines.push(`"--- RECONCILED INVOICES ---"`);
      lines.push(`"Invoice #","Customer","Program","Status","Total (AED)","Balance Due (AED)"`);
      reportData.details.invoices.forEach((inv) => {
        lines.push(
          `"${inv.invoiceNumber || ''}","${inv.customer?.fullName || ''}","${inv.program?.title || ''}","${inv.status || ''}","${inv.totalAmount || 0}","${inv.balanceDue || 0}"`
        );
      });
      lines.push(``);
    }

    // Leads Detail Table (if available)
    if (reportData.details?.leads && reportData.details.leads.length > 0) {
      lines.push(`"--- INBOUND LEADS CAPTURED ---"`);
      lines.push(`"Lead Name","Phone","Email","Source","Stage","Assigned To"`);
      reportData.details.leads.forEach((l) => {
        lines.push(
          `"${l.fullName || ''}","${l.phone || ''}","${l.email || ''}","${l.source || ''}","${l.stage || ''}","${l.assignedTo?.fullName || ''}"`
        );
      });
      lines.push(``);
    }

    return lines.join('\n');
  }
}

module.exports = new ReportingService();
