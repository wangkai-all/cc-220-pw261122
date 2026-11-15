/* 通用工具：日期（UTC，避免时区偏移）、金额舍入、CSV */
(function (global) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  function parseDate(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function fmtDate(d) {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function addDays(s, n) {
    const d = parseDate(s);
    d.setUTCDate(d.getUTCDate() + n);
    return fmtDate(d);
  }

  /** 含首尾两天的天数 */
  function daysInclusive(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000) + 1;
  }

  const monthKey = (s) => String(s).slice(0, 7); // 'YYYY-MM'
  const monthStart = (m) => `${m}-01`;
  function monthEnd(m) {
    const [y, mo] = m.split('-').map(Number);
    return fmtDate(new Date(Date.UTC(y, mo, 0)));
  }
  function nextMonth(m) {
    const [y, mo] = m.split('-').map(Number);
    return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
  }
  /** 按月迭代，含首尾 */
  function eachMonth(fromKey, toKey) {
    const out = [];
    let m = fromKey;
    while (m <= toKey) { out.push(m); m = nextMonth(m); }
    return out;
  }

  /** 区间 [start,end] 与月份 [ms,me] 的重叠天数（含首尾），无重叠返回 0 */
  function overlapDays(start, end, ms, me) {
    const a = start > ms ? start : ms;
    const b = end < me ? end : me;
    return a > b ? 0 : daysInclusive(a, b);
  }

  /** 金额统一按分四舍五入到两位小数 */
  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);
  const num = (v, dft = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : dft;
  };
  const fmtMoney = (x) => {
    const v = round2(x || 0);
    return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

  /** 简单 CSV 解析（支持引号、逗号、换行转义） */
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    const push = () => { row.push(field); field = ''; };
    const endRow = () => { push(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') push();
      else if (c === '\n') endRow();
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
    if (field !== '' || row.length) endRow();
    return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
  }

  function toCsv(rows) {
    return rows.map((r) => r.map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
  }

  const api = {
    pad, parseDate, fmtDate, addDays, daysInclusive,
    monthKey, monthStart, monthEnd, nextMonth, eachMonth, overlapDays,
    round2, sum, num, fmtMoney, uid, parseCsv, toCsv,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RevUtil = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
