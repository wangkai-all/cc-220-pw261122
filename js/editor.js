/* 合同编辑弹层：动态子表编辑，保存时做基础校验并深拷贝返回 */
(function (global) {
  'use strict';
  const U = global.RevUtil;

  function field(label, inputHtml) {
    return `<label>${label}${inputHtml}</label>`;
  }
  const txt = (name, value, type = 'text', ph = '') =>
    `<input name="${name}" type="${type}" value="${value ?? ''}" placeholder="${ph}">`;

  function open(contract) {
    const c = JSON.parse(JSON.stringify(contract));
    const body = document.getElementById('modalBody');
    body.innerHTML = render(c);
    wire(c, body);
    document.getElementById('modalBackdrop').hidden = false;
    return new Promise((resolve) => {
      const close = (val) => {
        document.getElementById('modalBackdrop').hidden = true;
        document.getElementById('modalSave').onclick = null;
        document.getElementById('modalCancel').onclick = null;
        document.getElementById('modalClose').onclick = null;
        resolve(val);
      };
      document.getElementById('modalSave').onclick = () => {
        try { close(collect(c, body)); }
        catch (e) { alert(e.message); }
      };
      document.getElementById('modalCancel').onclick = () => close(null);
      document.getElementById('modalClose').onclick = () => close(null);
    });
  }

  function render(c) {
    return `
    <div class="form-grid">
      ${field('合同名称', txt('name', c.name))}
      ${field('币种', txt('currency', c.currency, 'text', 'CNY'))}
      ${field('合同价格（合计）', txt('price', c.price, 'number'))}
    </div>

    <div class="sub-form">
      <h4>履约项目 <button type="button" class="btn btn-small" data-add="ob">新增项目</button></h4>
      <div id="obRows">${c.obligations.map((o, i) => obRow(o, i)).join('')}</div>
    </div>

    <div class="sub-form">
      <h4>开票记录（退款/红冲录负数） <button type="button" class="btn btn-small" data-add="inv">新增开票</button></h4>
      <div id="invRows">${c.invoices.map((x, i) => cashRow(x, i, 'inv')).join('')}</div>
    </div>

    <div class="sub-form">
      <h4>收款记录（退款打款录负数） <button type="button" class="btn btn-small" data-add="col">新增收款</button></h4>
      <div id="colRows">${c.collections.map((x, i) => cashRow(x, i, 'col')).join('')}</div>
    </div>

    <div class="sub-form">
      <h4>变更记录（按下发生先后排序） <button type="button" class="btn btn-small" data-add="chg">新增变更</button></h4>
      <div id="chgRows">${c.changes.map((x, i) => chgRow(x, i, c)).join('')}</div>
    </div>`;
  }

  function obRow(o, i) {
    return `<div class="row-grid" data-row="ob" data-idx="${i}">
      ${field('项目名称', txt(`ob_name_${i}`, o.name))}
      <label>类型
        <select name="ob_type_${i}">
          <option value="service" ${o.type === 'service' ? 'selected' : ''}>服务（按天）</option>
          <option value="goods" ${o.type === 'goods' ? 'selected' : ''}>商品（交付日）</option>
        </select>
      </label>
      ${field('服务开始', txt(`ob_start_${i}`, o.start, 'date'))}
      ${field('服务结束', txt(`ob_end_${i}`, o.end, 'date'))}
      ${field('交付日（商品）', txt(`ob_delivery_${i}`, o.deliveryDate, 'date'))}
      ${field('独立售价 SSP', txt(`ob_ssp_${i}`, o.ssp, 'number'))}
      <span><button type="button" class="icon-btn" data-del="ob" data-idx="${i}">删除</button></span>
    </div>`;
  }
  function cashRow(x, i, kind) {
    return `<div class="row-grid" data-row="${kind}" data-idx="${i}">
      ${field('日期', txt(`${kind}_date_${i}`, x.date, 'date'))}
      ${field('金额（负数=退款）', txt(`${kind}_amount_${i}`, x.amount, 'number'))}
      ${field('备注', txt(`${kind}_note_${i}`, x.note))}
      <span><button type="button" class="icon-btn" data-del="${kind}" data-idx="${i}">删除</button></span>
    </div>`;
  }
  function chgRow(h, i, c) {
    const typeOpts = [
      ['extension', '合同延长'], ['termination', '部分终止'], ['priceAdjustment', '追溯调价'],
    ].map(([v, lb]) => `<option value="${v}" ${h.type === v ? 'selected' : ''}>${lb}</option>`).join('');
    const ruleOpts = [
      ['prospective', '未来适用法'], ['catchup', '累计追补法'],
    ].map(([v, lb]) => `<option value="${v}" ${h.correctionRule === v ? 'selected' : ''}>${lb}</option>`).join('');
    const poOpts = c.obligations.map((o) =>
      `<option value="${o.id}" ${h.obligationId === o.id ? 'selected' : ''}>${o.name}</option>`).join('');
    return `<div class="row-grid" data-row="chg" data-idx="${i}">
      ${field('变更说明', txt(`chg_label_${i}`, h.label))}
      <label>类型<select name="chg_type_${i}">${typeOpts}</select></label>
      <label>关联项目<select name="chg_po_${i}">${poOpts}</select></label>
      ${field('生效日', txt(`chg_eff_${i}`, h.effectiveDate, 'date'))}
      ${field('新结束日', txt(`chg_newend_${i}`, h.newEnd, 'date'))}
      ${field('价格增量', txt(`chg_delta_${i}`, h.priceDelta, 'number'))}
      <label>更正规则<select name="chg_rule_${i}">${ruleOpts}</select></label>
      ${field('详细备注', txt(`chg_note_${i}`, h.note))}
      <span><button type="button" class="icon-btn" data-del="chg" data-idx="${i}">删除</button></span>
    </div>`;
  }

  function wire(c, body) {
    body.querySelector('[data-add="ob"]').onclick = () => {
      c.obligations.push({ id: U.uid('o'), name: '新履约项目', type: 'service', start: '', end: '', deliveryDate: '', ssp: 0 });
      rerender(c);
    };
    body.querySelector('[data-add="inv"]').onclick = () => {
      c.invoices.push({ id: U.uid('i'), date: '', amount: 0, note: '' }); rerender(c);
    };
    body.querySelector('[data-add="col"]').onclick = () => {
      c.collections.push({ id: U.uid('p'), date: '', amount: 0, note: '' }); rerender(c);
    };
    body.querySelector('[data-add="chg"]').onclick = () => {
      c.changes.push({
        id: U.uid('ch'), type: 'extension', obligationId: c.obligations[0]?.id || '',
        effectiveDate: '', newEnd: '', priceDelta: 0, correctionRule: 'prospective', label: '新变更', note: '',
      });
      rerender(c);
    };
    body.addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-del]');
      if (!del) return;
      const kind = del.dataset.del, idx = Number(del.dataset.idx);
      if (kind === 'ob') c.obligations.splice(idx, 1);
      if (kind === 'inv') c.invoices.splice(idx, 1);
      if (kind === 'col') c.collections.splice(idx, 1);
      if (kind === 'chg') c.changes.splice(idx, 1);
      rerender(c);
    });
  }
  function rerender(c) {
    const body = document.getElementById('modalBody');
    body.innerHTML = render(c);
    wire(c, body);
  }

  function val(body, name) { return body.querySelector(`[name="${name}"]`)?.value ?? ''; }

  function collect(c, body) {
    c.name = val(body, 'name') || '未命名合同';
    c.currency = val(body, 'currency') || 'CNY';
    c.price = U.num(val(body, 'price'));
    c.obligations.forEach((o, i) => {
      o.name = val(body, `ob_name_${i}`) || o.name;
      o.type = val(body, `ob_type_${i}`);
      o.start = val(body, `ob_start_${i}`);
      o.end = val(body, `ob_end_${i}`);
      o.deliveryDate = val(body, `ob_delivery_${i}`);
      o.ssp = U.num(val(body, `ob_ssp_${i}`));
    });
    ['inv', 'col'].forEach((kind) => {
      const list = kind === 'inv' ? c.invoices : c.collections;
      list.forEach((x, i) => {
        x.date = val(body, `${kind}_date_${i}`);
        x.amount = U.num(val(body, `${kind}_amount_${i}`));
        x.note = val(body, `${kind}_note_${i}`);
        if (!x.date) throw new Error(kind === 'inv' ? `第 ${i + 1} 行开票缺少日期` : `第 ${i + 1} 行收款缺少日期`);
      });
    });
    c.changes.forEach((h, i) => {
      h.label = val(body, `chg_label_${i}`) || h.label;
      h.type = val(body, `chg_type_${i}`);
      h.obligationId = val(body, `chg_po_${i}`);
      h.effectiveDate = val(body, `chg_eff_${i}`);
      h.newEnd = val(body, `chg_newend_${i}`);
      h.priceDelta = U.num(val(body, `chg_delta_${i}`));
      h.correctionRule = val(body, `chg_rule_${i}`);
      h.note = val(body, `chg_note_${i}`);
      if (!h.effectiveDate) throw new Error(`第 ${i + 1} 行变更缺少生效日`);
    });
    c.changes.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    if (!c.obligations.length) throw new Error('至少需要一个履约项目');
    c.obligations.forEach((o) => {
      if (o.type === 'service' && !(o.start && o.end)) throw new Error(`服务项目「${o.name}」缺少起止时间`);
      if (o.type === 'goods' && !o.deliveryDate) throw new Error(`商品项目「${o.name}」缺少交付日`);
    });
    return c;
  }

  global.RevEditor = { open };
})(typeof globalThis !== 'undefined' ? globalThis : this);
