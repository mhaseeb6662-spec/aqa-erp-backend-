const ReportingService = require('../services/ReportingService');
const AppError = require('../utils/appError');

// 1. GET /api/v1/reports/daily
exports.getDailyOperationalReport = async (req, res, next) => {
  try {
    const report = await ReportingService.generateDailyReport(req.query);
    res.status(200).json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
};

// 2. GET /api/v1/reports/weekly
exports.getWeeklyPerformanceReport = async (req, res, next) => {
  try {
    const report = await ReportingService.generateWeeklyReport(req.query);
    res.status(200).json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
};

// 3. GET /api/v1/reports/monthly
exports.getMonthlyExecutiveReport = async (req, res, next) => {
  try {
    const report = await ReportingService.generateMonthlyReport(req.query);
    res.status(200).json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
};

// 4. GET /api/v1/reports/export/csv
exports.downloadReportCsv = async (req, res, next) => {
  try {
    const { type = 'daily' } = req.query;
    let reportData;

    if (type === 'daily') {
      reportData = await ReportingService.generateDailyReport(req.query);
    } else if (type === 'weekly') {
      reportData = await ReportingService.generateWeeklyReport(req.query);
    } else {
      reportData = await ReportingService.generateMonthlyReport(req.query);
    }

    const csvContent = ReportingService.exportToCsv(reportData);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=AFA_${type}_report_${Date.now()}.csv`);
    return res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
};
