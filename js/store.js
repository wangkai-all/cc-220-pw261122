/* 数据存取：localStorage 持久化 + JSON / CSV 导入导出 */
(function (global) {
  'use strict';
  const U = global.RevUtil;
  const KEY = 'rev-demo-contracts-v1';

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }
  function saveAll(contracts) {
    localStorage.setItem(KEY, JSON.stringify(contracts));
  }
  function exportJson(contracts) {
    return JSON.stringify({ format: 'revenue-deferral-demo', version: 1, exportedAt: new Date().toISOString(), contracts }, null, 2);
  }
  function importJson(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.contracts;
    if (!Array.isArray(list)) throw new Error('JSON 中未找到 contracts 数组');
    return list.map(normalize);
  }

  /** 合同结构兜底，避免缺字段导致引擎异常 */
  function normalize(c) {
    return {
      id: c.id || U.uid('c'),
      name: c.name || '未命名合同',
      currency: c.currency || 'CNY',
      price: U.num(c.price),
      obligations: (c.obligations || []).map((o) => ({
        id: o.id || U.uid('o'),
        name: o.name || '未命名项目',
        type: o.type === 'goods' ? 'goods' : 'service',
        start: o.start || '', end: o.end || '',
        deliveryDate: o.deliveryDate || '',
        ssp: U.num(o.ssp),
      })),
      invoices: (c.invoices || []).map((i) => ({ id: i.id || U.uid('i'), date: i.date, amount: U.num(i.amount), note: i.note || '' })),
      collections: (c.collections || []).map((p) => ({ id: p.id || U.uid('p'), date: p.date, amount: U.num(p.amount), note: p.note || '' })),
      changes: (c.changes || []).map((h) => ({
        id: h.id || U.uid('ch'),
        type: ['extension', 'termination', 'priceAdjustment'].includes(h.type) ? h.type : 'priceAdjustment',
        obligationId: h.obligationId || '',
        effectiveDate: h.effectiveDate,
        newEnd: h.newEnd || '',
        priceDelta: U.num(h.priceDelta),
        correctionRule: h.correctionRule === 'catchup' ? 'catchup' : 'prospective',
        label: h.label || '', note: h.note || '',
      })),
    };
  }

  /* ---------- CSV：多区块文本，每区块带表头行 #section ---------- */
  function exportCsv(contract) {
    const blocks = [];
    blocks.push(U.toCsv([
      ['#contract'], ['id', 'name', 'currency', 'price'],
      [contract.id, contract.name, contract.currency, contract.price],
    ]));
    blocks.push(U.toCsv([
      ['#obligations'], ['id', 'name', 'type', 'start', 'end', 'deliveryDate', 'ssp'],
      ...contract.obligations.map((o) => [o.id, o.name, o.type, o.start, o.end, o.deliveryDate, o.ssp]),
    ]));
    blocks.push(U.toCsv([
      ['#invoices'], ['id', 'date', 'amount', 'note'],
      ...contract.invoices.map((i) => [i.id, i.date, i.amount, i.note]),
    ]));
    blocks.push(U.toCsv([
      ['#collections'], ['id', 'date', 'amount', 'note'],
      ...contract.collections.map((p) => [p.id, p.date, p.amount, p.note]),
    ]));
    blocks.push(U.toCsv([
      ['#changes'], ['id', 'type', 'obligationId', 'effectiveDate', 'newEnd', 'priceDelta', 'correctionRule', 'label', 'note'],
      ...contract.changes.map((h) => [h.id, h.type, h.obligationId, h.effectiveDate, h.newEnd, h.priceDelta, h.correctionRule, h.label, h.note]),
    ]));
    return blocks.join('\n\n');
  }

  function importCsv(text) {
    const rows = U.parseCsv(text);
    const sections = {};
    let cur = null;
    for (const r of rows) {
      if (r[0] && r[0].startsWith('#')) { cur = r[0].slice(1); sections[cur] = []; }
      else if (cur) sections[cur].push(r);
    }
    const table = (name) => {
      const rows2 = sections[name] || [];
      const head = rows2[0] || [];
      return rows2.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
    };
    const cRow = table('contract')[0] || {};
    return normalize({
      id: cRow.id, name: cRow.name, currency: cRow.currency, price: cRow.price,
      obligations: table('obligations'),
      invoices: table('invoices'),
      collections: table('collections'),
      changes: table('changes'),
    });
  }

  const api = { loadAll, saveAll, exportJson, importJson, exportCsv, importCsv, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RevStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
