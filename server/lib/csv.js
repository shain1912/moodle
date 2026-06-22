// 간단한 CSV 빌더 — Excel 한글 호환을 위해 UTF-8 BOM 포함

const BOM = '﻿';

function escapeCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  // BOM → Excel에서 한글 깨짐 방지
  return BOM + lines.join('\r\n');
}
