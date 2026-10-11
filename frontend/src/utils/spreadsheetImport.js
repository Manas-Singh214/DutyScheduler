import { API_BASE_URL } from './api';

const HEADER_PATTERNS = {
  teachers: /teacher|staff|invigilator|name/i,
  rooms: /room|venue|hall|class|location|number/i
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export async function readListSpreadsheet(file, listType) {
  let sheetRows;
  if (/\.csv$/i.test(file.name)) {
    sheetRows = parseCsv(await file.text());
  } else {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE_URL}/import-list`, { method: 'POST', body: formData });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.detail || `Spreadsheet import failed (${response.status}).`);
    }
    sheetRows = (await response.json()).rows;
  }

  if (sheetRows.length === 0) {
    throw new Error('The selected worksheet is empty.');
  }

  const firstRow = sheetRows[0].map(value => String(value).trim());
  const suggestedColumn = firstRow.findIndex(value => HEADER_PATTERNS[listType].test(value));
  const hasHeader = suggestedColumn >= 0;

  return {
    columns: firstRow.map((value, index) => value || `Column ${index + 1}`),
    rows: hasHeader ? sheetRows.slice(1) : sheetRows,
    selectedColumn: hasHeader ? suggestedColumn : 0,
    fileName: file.name
  };
}

export function getSpreadsheetColumnValues(importedSheet, columnIndex) {
  if (!importedSheet) return [];

  return importedSheet.rows
    .map(row => String(row[columnIndex] ?? '').trim())
    .filter(Boolean);
}