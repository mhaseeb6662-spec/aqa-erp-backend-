const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const ImportBatch = require('../models/ImportBatch');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const logActivity = require('../utils/logActivity');
const { parseCsvString } = require('../utils/csvParser');
const { LEAD_SOURCES, PIPELINE_STAGES } = require('../config/crm.constants');

// --- NORMALIZATION HELPERS ---
function normalizePhone(raw) {
  if (!raw) return '';
  const p = String(raw).trim();
  const digits = p.replace(/\D/g, '');
  if (!digits) return '';
  if (p.startsWith('05') && digits.length === 10) {
    return `+971${digits.slice(1)}`;
  }
  if (digits.startsWith('971') && digits.length >= 11) {
    return `+${digits}`;
  }
  if (digits.startsWith('00')) {
    return `+${digits.slice(2)}`;
  }
  if (p.startsWith('+')) {
    return `+${digits}`;
  }
  if (digits.startsWith('971')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

function normalizeEmail(raw) {
  if (!raw) return '';
  const e = String(raw).trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    return e;
  }
  return '';
}

function parseDate(raw) {
  if (!raw || !String(raw).trim()) return null;
  const str = String(raw).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  
  // Try DD/MM/YYYY or MM/DD/YYYY
  const parts = str.split(/[/\-\.]/);
  if (parts.length === 3) {
    const d1 = new Date(parts[2], parts[1] - 1, parts[0]);
    if (!isNaN(d1.getTime())) return d1;
  }
  return null;
}

const DEFAULT_STAGE_MAP = {
  'New': 'new',
  'new': 'new',
  'Follow Up': 'contacted',
  'follow up': 'contacted',
  'Follow-Up': 'contacted',
  'Contacted': 'contacted',
  'contacted': 'contacted',
  'Interested': 'qualified',
  'interested': 'qualified',
  'Qualified': 'qualified',
  'qualified': 'qualified',
  'Ready for payment': 'proposal',
  'ready for payment': 'proposal',
  'Ready for Payment': 'proposal',
  'Proposal': 'proposal',
  'proposal': 'proposal',
  'Negotiation': 'negotiation',
  'negotiation': 'negotiation',
  'Won': 'won',
  'won': 'won',
  'No Answer': 'contacted',
  'no answer': 'contacted',
  'Not interested': 'lost',
  'not interested': 'lost',
  'Not Interested': 'lost',
  'Not qualified': 'lost',
  'not qualified': 'lost',
  'Not Qualified': 'lost',
  'Spam': 'lost',
  'spam': 'lost',
  'Lost': 'lost',
  'lost': 'lost',
};

const DEFAULT_SOURCE_MAP = {
  'Facebook': 'Facebook Ads',
  'facebook': 'Facebook Ads',
  'Facebook Ads': 'Facebook Ads',
  'Instagram': 'Social Media',
  'instagram': 'Social Media',
  'TikTok': 'Social Media',
  'tiktok': 'Social Media',
  'Social Media': 'Social Media',
  'Website': 'Website',
  'website': 'Website',
  'Call': 'Phone Inquiry',
  'call': 'Phone Inquiry',
  'Phone': 'Phone Inquiry',
  'Phone Inquiry': 'Phone Inquiry',
  'Referral': 'Referral',
  'referral': 'Referral',
  'Walk-in': 'Walk-in',
  'walk-in': 'Walk-in',
  'WhatsApp': 'WhatsApp',
  'whatsapp': 'WhatsApp',
  'Google': 'Google Ads',
  'Google Ads': 'Google Ads',
  'Email Campaign': 'Email Campaign',
  'Event': 'Event',
  'Advertisement': 'Advertisement',
  'Manual entry': 'Other',
  'Other': 'Other',
  '': 'Other',
};

const ERP_MAPPING_RULES = [
  { key: 'fullName', exact: ['name', 'full name', 'fullname', 'contact name', 'lead name', 'student name'], fallback: ['contact'] },
  { key: 'firstName', exact: ['first name', 'firstname', 'fname'], fallback: [] },
  { key: 'lastName', exact: ['last name', 'lastname', 'lname'], fallback: [] },
  { key: 'phone', exact: ['phone', 'mobile', 'phone number', 'mobile number', 'contact number', 'tel', 'whatsapp'], fallback: [] },
  { key: 'email', exact: ['email', 'email address', 'e-mail', 'mail'], fallback: [] },
  { key: 'source', exact: ['source', 'lead source', 'channel', 'platform'], fallback: ['signup source'] },
  { key: 'status', exact: ['status', 'stage', 'lead status', 'pipeline stage'], fallback: [] },
  { key: 'owner', exact: ['owner', 'sales rep', 'assigned to', 'agent', 'salesperson'], fallback: [] },
  { key: 'createdOn', exact: ['created on', 'created at', 'created date', 'date', 'signup date', 'lead date'], fallback: [] },
  { key: 'interestLevel', exact: ['interest level', 'interest', 'priority', 'rating', 'temperature'], fallback: [] },
  { key: 'subject', exact: ['subject', 'course', 'courses', 'program', 'interested in'], fallback: [] },
  { key: 'notes', exact: ['last note', 'note', 'notes', 'comment', 'remarks'], fallback: [] },
  { key: 'city', exact: ['city', 'location', 'emirate', 'address'], fallback: [] },
  { key: 'age', exact: ['age'], fallback: [] },
  { key: 'gender', exact: ['gender', 'sex'], fallback: [] },
  { key: 'nationality', exact: ['nationality', 'country'], fallback: [] },
  { key: 'guardianName', exact: ['guardian name', 'guardian', 'parent name', 'parent', 'father name', 'mother name'], fallback: [] },
  { key: 'guardianPhone', exact: ['guardian phone', 'parent phone', 'emergency phone'], fallback: [] },
  { key: 'guardianEmail', exact: ['guardian email', 'parent email'], fallback: [] },
  { key: 'numberOfKids', exact: ['number of kids', 'kids', 'children', 'no of kids'], fallback: [] },
  { key: 'birthday', exact: ['birthday', 'dob', 'date of birth'], fallback: [] },
  { key: 'lastContacted', exact: ['last contacted', 'contacted date', 'last contact'], fallback: [] },
  { key: 'followUp', exact: ['follow up', 'follow up date', 'followup', 'next follow up'], fallback: [] },
];

function generateAutoMapping(headers) {
  const mapping = {};
  const cleanHeaders = headers.map((h) => h.trim());

  for (const rule of ERP_MAPPING_RULES) {
    let matched = null;
    for (const h of cleanHeaders) {
      const hLower = h.toLowerCase();
      if (rule.exact.includes(hLower)) {
        matched = h;
        break;
      }
    }
    if (!matched && rule.fallback.length > 0) {
      for (const h of cleanHeaders) {
        const hLower = h.toLowerCase();
        if (rule.fallback.includes(hLower)) {
          matched = h;
          break;
        }
      }
    }
    if (matched) {
      mapping[rule.key] = matched;
    }
  }
  return mapping;
}

function resolvePayloadRows(req) {
  if (req.file && req.file.buffer) {
    const csvString = req.file.buffer.toString('utf-8');
    const { headers, rows } = parseCsvString(csvString);
    return { headers, rows, filename: req.file.originalname };
  }
  if (Array.isArray(req.body.rows)) {
    const headers = req.body.headers || (req.body.rows.length > 0 ? Object.keys(req.body.rows[0]) : []);
    return { headers, rows: req.body.rows, filename: req.body.filename || 'leads.csv' };
  }
  if (typeof req.body.csvText === 'string') {
    const { headers, rows } = parseCsvString(req.body.csvText);
    return { headers, rows, filename: req.body.filename || 'leads.csv' };
  }
  return { headers: [], rows: [], filename: 'leads.csv' };
}

function parseJsonField(val, defaultVal = {}) {
  if (!val) return defaultVal;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return defaultVal;
  }
}

/**
 * POST /api/v1/leads/import/upload
 * Handles direct multipart file upload, parses CSV, suggests column mapping
 */
exports.uploadCsvFile = catchAsync(async (req, res, next) => {
  const { headers, rows, filename } = resolvePayloadRows(req);

  if (rows.length === 0) {
    return next(new AppError('The uploaded CSV file contains no data rows.', 400));
  }

  const suggestedMapping = generateAutoMapping(headers);

  return sendResponse(res, 200, 'CSV parsed successfully.', {
    filename,
    headers,
    totalRows: rows.length,
    sampleRows: rows.slice(0, 5),
    suggestedMapping,
  });
});

/**
 * POST /api/v1/leads/import/validate
 * Accepts CSV rows/file + field mapping and returns a dry-run validation preview
 */
exports.validateCsvData = catchAsync(async (req, res, next) => {
  const { headers, rows } = resolvePayloadRows(req);
  const mapping = parseJsonField(req.body.mapping, {});
  const options = parseJsonField(req.body.options, {});

  if (!Array.isArray(rows) || rows.length === 0) {
    return next(new AppError('No CSV rows provided for validation.', 400));
  }

  // Fetch users for owner matching
  const users = await User.find({}, 'fullName email role').lean();
  const userMap = new Map();
  users.forEach((u) => {
    if (u.fullName) userMap.set(u.fullName.toLowerCase().trim(), u);
    if (u.email) userMap.set(u.email.toLowerCase().trim(), u);
  });

  // Collect phones & emails from incoming CSV to check against DB
  const incomingPhones = [];
  const incomingEmails = [];

  rows.forEach((row) => {
    let p = normalizePhone(row[mapping.phone] || row.Phone || row['Phone Number'] || row.Mobile || '');
    if (!p) {
      const fName = String(row[mapping.firstName] || row['First Name'] || '').trim();
      if (/\d{7,}/.test(fName)) p = normalizePhone(fName);
    }
    if (p) incomingPhones.push(p);

    const e = normalizeEmail(row[mapping.email] || row.Email || row['Email Address'] || '');
    if (e) incomingEmails.push(e);
  });

  // DB duplicates lookup
  const [existingLeads, existingCustomers] = await Promise.all([
    Lead.find({
      $or: [
        { phone: { $in: incomingPhones } },
        ...(incomingEmails.length > 0 ? [{ email: { $in: incomingEmails } }] : []),
      ],
    }, 'phone email fullName').lean(),
    Customer.find({
      $or: [
        { phone: { $in: incomingPhones } },
        ...(incomingEmails.length > 0 ? [{ email: { $in: incomingEmails } }] : []),
      ],
    }, 'phone email fullName').lean(),
  ]);

  const dbPhoneSet = new Set([
    ...existingLeads.map((l) => l.phone).filter(Boolean),
    ...existingCustomers.map((c) => c.phone).filter(Boolean),
  ]);
  const dbEmailSet = new Set([
    ...existingLeads.map((l) => l.email).filter(Boolean).map((e) => e.toLowerCase()),
    ...existingCustomers.map((c) => c.email).filter(Boolean).map((e) => e.toLowerCase()),
  ]);

  // Process rows
  const validatedRows = [];
  const seenCsvPhones = new Set();
  const seenCsvEmails = new Set();

  let readyCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let warningCount = 0;

  const sourceCounts = {};
  const stageCounts = {};
  const ownerCounts = {};
  const unmatchedOwners = new Set();

  rows.forEach((row, index) => {
    const rowNum = index + 1;
    const issues = [];
    let status = 'ready';

    const rawFirstName = String(row[mapping.firstName] || row['First Name'] || '').trim();
    const rawLastName = String(row[mapping.lastName] || row['Last Name'] || '').trim();
    const rawName = String(row[mapping.fullName] || row.Name || row['Full Name'] || '').trim();
    let rawPhone = String(row[mapping.phone] || row.Phone || row['Phone Number'] || row.Mobile || '').trim();
    const rawEmail = String(row[mapping.email] || row.Email || row['Email Address'] || '').trim();
    const rawSource = String(row[mapping.source] || row.Source || row['Lead Source'] || options.defaultSource || '').trim();
    const rawStatus = String(row[mapping.status] || row.Status || row.Stage || options.defaultStage || 'New').trim();
    const rawOwner = String(row[mapping.owner] || row.Owner || row['Sales Rep'] || '').trim();
    const rawCreatedOn = String(row[mapping.createdOn] || row['Created On'] || row['Created Date'] || '').trim();
    const rawNote = String(row[mapping.notes] || row['Last Note'] || row.Notes || '').trim();
    const rawSubject = String(row[mapping.subject] || row.Subject || row.Course || row.Courses || '').trim();

    // 1. Phone validation & recovery
    let normPhone = normalizePhone(rawPhone);
    if (!normPhone && /\d{7,}/.test(rawFirstName)) {
      normPhone = normalizePhone(rawFirstName);
      rawPhone = rawFirstName;
      issues.push('Phone recovered from First Name column');
      status = 'warning';
      warningCount++;
    }

    if (!normPhone) {
      issues.push('Missing or invalid phone number');
      status = 'invalid';
      invalidCount++;
    }

    // 2. Email normalization
    const normEmail = normalizeEmail(rawEmail);
    if (rawEmail && !normEmail) {
      issues.push('Invalid email format (ignored)');
      if (status === 'ready') {
        status = 'warning';
        warningCount++;
      }
    }

    // 3. Duplicate checks
    if (normPhone) {
      if (seenCsvPhones.has(normPhone)) {
        issues.push('Duplicate phone within CSV file');
        status = 'duplicate';
        duplicateCount++;
      } else if (dbPhoneSet.has(normPhone)) {
        issues.push('Phone number matches existing Lead or Customer in database');
        status = 'duplicate';
        duplicateCount++;
      }
      seenCsvPhones.add(normPhone);
    }

    if (normEmail) {
      if (seenCsvEmails.has(normEmail)) {
        if (status !== 'duplicate') {
          issues.push('Duplicate email within CSV file');
          status = 'duplicate';
          duplicateCount++;
        }
      } else if (dbEmailSet.has(normEmail)) {
        if (status !== 'duplicate') {
          issues.push('Email matches existing record in database');
          status = 'duplicate';
          duplicateCount++;
        }
      }
      seenCsvEmails.add(normEmail);
    }

    // 4. Name cleanup
    let displayName = rawName || `${rawFirstName} ${rawLastName}`.trim();
    displayName = displayName.replace(/\s+/g, ' ').trim();
    let isPhoneName = false;

    const digitsInName = displayName.replace(/\D/g, '');
    if (digitsInName.length >= 7 && (/^[+\d\s().-]+$/.test(displayName) || displayName.endsWith('.'))) {
      isPhoneName = true;
      displayName = normPhone ? `Lead ${normPhone}` : displayName;
    } else if (!displayName || ['.', '-', '--', 'not .', 'Call lead'].includes(displayName)) {
      isPhoneName = true;
      displayName = normPhone ? `Lead ${normPhone}` : 'Unknown Lead';
    }

    // 5. Source, Stage, Owner mappings
    const mappedSource = DEFAULT_SOURCE_MAP[rawSource] || options.defaultSource || 'Other';
    const mappedStage = DEFAULT_STAGE_MAP[rawStatus] || options.defaultStage || 'new';

    sourceCounts[mappedSource] = (sourceCounts[mappedSource] || 0) + 1;
    stageCounts[mappedStage] = (stageCounts[mappedStage] || 0) + 1;

    let matchedUser = null;
    if (rawOwner) {
      matchedUser = userMap.get(rawOwner.toLowerCase().trim());
      if (!matchedUser) {
        unmatchedOwners.add(rawOwner);
      }
    }
    ownerCounts[rawOwner || 'Unassigned'] = (ownerCounts[rawOwner || 'Unassigned'] || 0) + 1;

    // 6. Dates
    const parsedCreatedAt = parseDate(rawCreatedOn) || new Date();

    if (status === 'ready') {
      readyCount++;
    }

    validatedRows.push({
      rowNum,
      status,
      issues,
      data: {
        fullName: displayName,
        phone: normPhone,
        rawPhone,
        email: normEmail,
        source: mappedSource,
        rawSource,
        stage: mappedStage,
        rawStatus,
        assignedTo: matchedUser ? matchedUser._id : null,
        assignedToName: matchedUser ? matchedUser.fullName : null,
        rawOwner,
        createdAt: parsedCreatedAt,
        notes: rawNote,
        interestedIn: rawSubject,
        isPhoneAsName: isPhoneName,
        guardianName: String(row[mapping.guardianName] || row['Guardian Name'] || '').trim(),
        guardianPhone: String(row[mapping.guardianPhone] || row['Guardian Phone'] || '').trim(),
        guardianEmail: String(row[mapping.guardianEmail] || row['Guardian Email'] || '').trim(),
        numberOfKids: String(row[mapping.numberOfKids] || row['Number of Kids'] || '').trim(),
        city: String(row[mapping.city] || row.City || '').trim(),
        gender: String(row[mapping.gender] || row.Gender || '').trim(),
        nationality: String(row[mapping.nationality] || row.Nationality || '').trim(),
        age: String(row[mapping.age] || row.Age || '').trim(),
      },
    });
  });

  return sendResponse(res, 200, 'CSV validation complete.', {
    summary: {
      totalRows: rows.length,
      readyCount,
      warningCount,
      duplicateCount,
      invalidCount,
      importableCount: readyCount + warningCount,
    },
    sourceBreakdown: sourceCounts,
    stageBreakdown: stageCounts,
    ownerBreakdown: ownerCounts,
    unmatchedOwners: Array.from(unmatchedOwners),
    previewRows: validatedRows.slice(0, 100),
    totalValidatedRows: validatedRows.length,
  });
});

/**
 * POST /api/v1/leads/import/execute
 * Performs the actual batched database import into MongoDB
 */
exports.executeCsvImport = catchAsync(async (req, res, next) => {
  const { headers, rows, filename } = resolvePayloadRows(req);
  const mapping = parseJsonField(req.body.mapping, {});
  const options = parseJsonField(req.body.options, {
    isHistoricalImport: true,
    skipDuplicates: true,
    defaultSource: 'Other',
    defaultStage: 'new',
    batchName: '',
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return next(new AppError('No lead rows provided for import.', 400));
  }

  const batchId = `BATCH_${new Date().toISOString().replace(/[\D]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const startTime = new Date();

  // Create initial batch record
  const batchRecord = await ImportBatch.create({
    batchId,
    filename: options.batchName || filename || 'leads_import.csv',
    type: 'leads',
    totalRows: rows.length,
    status: 'started',
    executedBy: req.user?.fullName || 'Admin User',
    createdAt: startTime,
  });

  // Fetch users for owner matching
  const users = await User.find({}, 'fullName email role').lean();
  const userMap = new Map();
  users.forEach((u) => {
    if (u.fullName) userMap.set(u.fullName.toLowerCase().trim(), u);
    if (u.email) userMap.set(u.email.toLowerCase().trim(), u);
  });

  // Query existing DB phones & emails
  const incomingPhones = [];
  const incomingEmails = [];
  rows.forEach((r) => {
    const p = normalizePhone(r[mapping.phone] || r.Phone || r.phone || '');
    if (p) incomingPhones.push(p);
    const e = normalizeEmail(r[mapping.email] || r.Email || r.email || '');
    if (e) incomingEmails.push(e);
  });

  const [existingLeads, existingCustomers] = await Promise.all([
    Lead.find({
      $or: [
        { phone: { $in: incomingPhones } },
        ...(incomingEmails.length > 0 ? [{ email: { $in: incomingEmails } }] : []),
      ],
    }, 'phone email').lean(),
    Customer.find({
      $or: [
        { phone: { $in: incomingPhones } },
        ...(incomingEmails.length > 0 ? [{ email: { $in: incomingEmails } }] : []),
      ],
    }, 'phone email').lean(),
  ]);

  const dbPhoneSet = new Set([
    ...existingLeads.map((l) => l.phone).filter(Boolean),
    ...existingCustomers.map((c) => c.phone).filter(Boolean),
  ]);
  const dbEmailSet = new Set([
    ...existingLeads.map((l) => l.email).filter(Boolean).map((e) => e.toLowerCase()),
    ...existingCustomers.map((c) => c.email).filter(Boolean).map((e) => e.toLowerCase()),
  ]);

  const seenCsvPhones = new Set();
  const seenCsvEmails = new Set();

  const docsToInsert = [];
  let internalDuplicatesSkipped = 0;
  let dbDuplicatesSkipped = 0;
  const failedRows = [];

  const sourceCounts = {};
  const stageCounts = {};
  const ownerCounts = {};

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const rawFirstName = String(row[mapping.firstName] || row['First Name'] || row.firstName || '').trim();
    const rawLastName = String(row[mapping.lastName] || row['Last Name'] || row.lastName || '').trim();
    const rawName = String(row[mapping.fullName] || row.Name || row.fullName || '').trim();
    let rawPhone = String(row[mapping.phone] || row.Phone || row.phone || '').trim();
    const rawEmail = String(row[mapping.email] || row.Email || row.email || '').trim();
    const rawSource = String(row[mapping.source] || row.Source || row.source || options.defaultSource || '').trim();
    const rawStatus = String(row[mapping.status] || row.Status || row.status || options.defaultStage || 'New').trim();
    const rawOwner = String(row[mapping.owner] || row.Owner || row.rawOwner || '').trim();
    const rawCreatedOn = String(row[mapping.createdOn] || row['Created On'] || row.createdAt || '').trim();
    const rawNote = String(row[mapping.notes] || row['Last Note'] || row.notes || '').trim();
    const rawSubject = String(row[mapping.subject] || row.Subject || row.interestedIn || row.Courses || '').trim();

    // 1. Phone validation & recovery
    let normPhone = normalizePhone(rawPhone);
    if (!normPhone && /\d{7,}/.test(rawFirstName)) {
      normPhone = normalizePhone(rawFirstName);
      rawPhone = rawFirstName;
    }

    if (!normPhone) {
      failedRows.push({ row: rowNum, name: rawName || rawFirstName, reason: 'Missing Phone Number' });
      return;
    }

    const normEmail = normalizeEmail(rawEmail);

    // 2. Duplicate checking
    if (seenCsvPhones.has(normPhone) || (normEmail && seenCsvEmails.has(normEmail))) {
      internalDuplicatesSkipped++;
      return;
    }
    seenCsvPhones.add(normPhone);
    if (normEmail) seenCsvEmails.add(normEmail);

    if (dbPhoneSet.has(normPhone) || (normEmail && dbEmailSet.has(normEmail))) {
      dbDuplicatesSkipped++;
      return;
    }

    // 3. Name resolution
    let displayName = rawName || `${rawFirstName} ${rawLastName}`.trim();
    displayName = displayName.replace(/\s+/g, ' ').trim();
    let isPhoneName = false;

    const digitsInName = displayName.replace(/\D/g, '');
    if (digitsInName.length >= 7 && (/^[+\d\s().-]+$/.test(displayName) || displayName.endsWith('.'))) {
      isPhoneName = true;
      displayName = `Lead ${normPhone}`;
    } else if (!displayName || ['.', '-', '--', 'not .', 'Call lead'].includes(displayName)) {
      isPhoneName = true;
      displayName = `Lead ${normPhone}`;
    }

    // 4. Mappings
    const mappedSource = DEFAULT_SOURCE_MAP[rawSource] || options.defaultSource || 'Other';
    const mappedStage = DEFAULT_STAGE_MAP[rawStatus] || options.defaultStage || 'new';

    sourceCounts[mappedSource] = (sourceCounts[mappedSource] || 0) + 1;
    stageCounts[mappedStage] = (stageCounts[mappedStage] || 0) + 1;
    ownerCounts[rawOwner || 'Unassigned'] = (ownerCounts[rawOwner || 'Unassigned'] || 0) + 1;

    let matchedUser = null;
    if (rawOwner) {
      matchedUser = userMap.get(rawOwner.toLowerCase().trim());
    }

    const createdDt = parseDate(rawCreatedOn) || new Date();
    const bdayDt = parseDate(row[mapping.birthday] || row.Birthday || row.birthday);
    const lastContactDt = parseDate(row[mapping.lastContacted] || row['Last Contacted'] || row.lastContacted);
    const followUpDt = parseDate(row[mapping.followUp] || row['Follow Up'] || row.followUp);

    docsToInsert.push({
      fullName: displayName,
      email: normEmail,
      phone: normPhone,
      source: mappedSource,
      stage: mappedStage,
      interestedIn: rawSubject,
      notes: rawNote,
      assignedTo: matchedUser ? matchedUser._id : null,
      convertedToCustomer: null,
      convertedAt: null,
      createdBy: req.user?._id || null,
      createdAt: createdDt,
      updatedAt: createdDt,
      migrationMetadata: {
        batchId,
        importedAt: new Date(),
        rawOwner,
        rawStatus,
        rawSource,
        interestLevel: String(row[mapping.interestLevel] || row['Interest Level'] || row.interestLevel || '').trim(),
        subject: rawSubject,
        courses: String(row[mapping.courses] || row.Courses || '').trim(),
        birthday: bdayDt,
        age: String(row[mapping.age] || row.Age || row.age || '').trim(),
        gender: String(row[mapping.gender] || row.Gender || row.gender || '').trim(),
        nationality: String(row[mapping.nationality] || row.Nationality || row.nationality || '').trim(),
        city: String(row[mapping.city] || row.City || row.city || '').trim(),
        guardianName: String(row[mapping.guardianName] || row['Guardian Name'] || row.guardianName || '').trim(),
        guardianPhone: String(row[mapping.guardianPhone] || row['Guardian Phone'] || row.guardianPhone || '').trim(),
        guardianEmail: String(row[mapping.guardianEmail] || row['Guardian Email'] || row.guardianEmail || '').trim(),
        numberOfKids: String(row[mapping.numberOfKids] || row['Number of Kids'] || row.numberOfKids || '').trim(),
        signupSource: String(row[mapping.signupSource] || row['Signup Source'] || 'CSV Import').trim(),
        lastContacted: lastContactDt,
        followUpDate: followUpDt,
        isPhoneAsName: isPhoneName,
        ownerMappingRequired: Boolean(rawOwner && !matchedUser),
      },
    });
  });

  // Batch insert into MongoDB (chunks of 100)
  const CHUNK_SIZE = 100;
  let totalInserted = 0;

  for (let i = 0; i < docsToInsert.length; i += CHUNK_SIZE) {
    const chunk = docsToInsert.slice(i, i + CHUNK_SIZE);
    try {
      const result = await Lead.insertMany(chunk, { ordered: false });
      totalInserted += result.length;
    } catch (bulkErr) {
      if (bulkErr.insertedDocs) {
        totalInserted += bulkErr.insertedDocs.length;
      }
      if (bulkErr.writeErrors) {
        dbDuplicatesSkipped += bulkErr.writeErrors.length;
      }
    }
  }

  const endTime = new Date();
  const durationSecs = ((endTime - startTime) / 1000).toFixed(2);

  // Update batch record
  await ImportBatch.findByIdAndUpdate(batchRecord._id, {
    importedCount: totalInserted,
    duplicatesSkipped: internalDuplicatesSkipped + dbDuplicatesSkipped,
    existingDuplicatesSkipped: dbDuplicatesSkipped,
    failedCount: failedRows.length,
    status: 'completed',
    sourceBreakdown: sourceCounts,
    stageBreakdown: stageCounts,
    ownerBreakdown: ownerCounts,
    completedAt: endTime,
    notes: `Imported ${totalInserted} leads via CSV wizard in ${durationSecs}s`,
  });

  // Audit activity log
  if (typeof logActivity === 'function') {
    logActivity({
      userId: req.user?._id,
      action: 'LEAD_IMPORT_COMPLETED',
      entity: 'Lead',
      entityId: batchRecord._id,
      description: `CSV Leads Import '${batchId}' completed: ${totalInserted} leads imported, ${internalDuplicatesSkipped + dbDuplicatesSkipped} duplicates skipped.`,
      metadata: { batchId, totalInserted, totalRows: rows.length },
    });
  }

  return sendResponse(res, 201, 'CSV Leads Import successfully completed.', {
    batchId,
    totalRows: rows.length,
    importedCount: totalInserted,
    duplicatesSkipped: internalDuplicatesSkipped + dbDuplicatesSkipped,
    internalDuplicatesSkipped,
    existingDuplicatesSkipped: dbDuplicatesSkipped,
    failedCount: failedRows.length,
    durationSeconds: Number(durationSecs),
    sourceBreakdown: sourceCounts,
    stageBreakdown: stageCounts,
    ownerBreakdown: ownerCounts,
    failedRows: failedRows.slice(0, 50),
  });
});

/**
 * GET /api/v1/leads/import/batches
 * List previous CSV import batches
 */
exports.getImportBatches = catchAsync(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(Number(page), 1);
  const limitNum = Math.min(Math.max(Number(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [batches, total] = await Promise.all([
    ImportBatch.find({ type: 'leads' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    ImportBatch.countDocuments({ type: 'leads' }),
  ]);

  return sendResponse(res, 200, 'Import batches fetched.', batches, {
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  });
});

/**
 * GET /api/v1/leads/import/batches/:id
 * Get details of a single import batch
 */
exports.getImportBatchDetails = catchAsync(async (req, res, next) => {
  const batch = await ImportBatch.findOne({
    $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { batchId: req.params.id }],
  }).lean();

  if (!batch) {
    return next(new AppError('Import batch not found.', 404));
  }

  return sendResponse(res, 200, 'Batch details fetched.', batch);
});

/**
 * GET /api/v1/leads/import/template
 * Returns standard CSV template definition
 */
exports.downloadCsvTemplate = catchAsync(async (req, res) => {
  const headers = [
    'First Name',
    'Last Name',
    'Name',
    'Phone',
    'Email',
    'Source',
    'Status',
    'Interest Level',
    'Subject',
    'Owner',
    'Created On',
    'Last Contacted',
    'Follow Up',
    'Last Note',
    'City',
    'Age',
    'Gender',
    'Nationality',
    'Guardian Name',
    'Guardian Phone',
    'Guardian Email',
    'Number of Kids'
  ];

  const sampleRow = [
    'Rashid',
    'Al-Falasi',
    'Rashid Al-Falasi',
    '+971501234567',
    'rashid@example.com',
    'Instagram',
    'New',
    'Warm',
    'Kayak Fishing Program',
    'Sales Agent',
    '2026-08-20 10:30:00',
    '2026-08-20 12:00:00',
    '2026-08-25 09:00:00',
    'Inquired for weekend session',
    'Dubai',
    '28',
    'Male',
    'AE',
    'Fatima Al-Falasi',
    '+971509876543',
    'fatima@example.com',
    '2'
  ];

  const csvContent = `${headers.join(',')}\n"${sampleRow.join('","')}"\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="aqua_leads_import_template.csv"');
  return res.status(200).send(csvContent);
});
