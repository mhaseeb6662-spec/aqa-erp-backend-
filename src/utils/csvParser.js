/**
 * Robust CSV Parser Utility
 * Handles UTF-8 BOM, CRLF/LF, quoted fields with commas/escaped quotes,
 * multiline cells, empty lines, and header normalization.
 */

function parseCsvString(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return { headers: [], rows: [], totalRows: 0 };
  }

  // 1. Strip UTF-8 BOM if present
  let text = csvText;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const rawLines = [];
  let curLine = [];
  let curField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        curField += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      curLine.push(curField.trim());
      curField = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') {
        i++; // skip LF after CR
      }
      curLine.push(curField.trim());
      if (curLine.some((f) => f.length > 0)) {
        rawLines.push(curLine);
      }
      curLine = [];
      curField = '';
    } else {
      curField += c;
    }
  }

  if (curField || curLine.length > 0) {
    curLine.push(curField.trim());
    if (curLine.some((f) => f.length > 0)) {
      rawLines.push(curLine);
    }
  }

  if (rawLines.length === 0) {
    return { headers: [], rows: [], totalRows: 0 };
  }

  const headers = rawLines[0].map((h) => h.replace(/^["']|["']$/g, '').trim());
  const rows = [];

  for (let r = 1; r < rawLines.length; r++) {
    const line = rawLines[r];
    const rowObj = {};
    headers.forEach((h, colIdx) => {
      let val = line[colIdx] !== undefined ? line[colIdx] : '';
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        val = val.slice(1, -1).replace(/""/g, '"');
      }
      rowObj[h] = val.trim();
    });
    rows.push(rowObj);
  }

  return {
    headers,
    rows,
    totalRows: rows.length,
  };
}

module.exports = {
  parseCsvString,
};
