/* 主应用：合同列表、计划渲染、版本对比、图表与导入导出 */
(function () {
  'use strict';
  const U = RevUtil, E = RevEngine, Store = RevStore, Chart = RevChart, Editor = RevEditor;
  const $ = (sel) => document.querySelector(sel);

  let contracts = Store.loadAll();
  let currentId = null;
  let versionIdx = 0;

  /* ---------------- 基础交互 ---------------- */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, 2400);
  }
  function current() { return contracts.find((c) => c.id === currentId) || null; }
  function persist() { Store.saveAll(contracts); }

  function renderList() {
    const ul = $('#contractList');
    ul.innerHTML = '';
    if (!contracts.length) {
      ul.innerHTML = '<li class="hint" style="cursor:default">暂无合同，点击上方「新建」或「载入样例」</li>';
      return;
    }
    for (const c of contracts) {
      const li = document.createElement('li');
      if (c.id === currentId) li.classList.add('active');
      li.innerHTML = `<div class="c-name">${escapeHtml(c.name)}</div>
        <div class="c-meta">${c.obligations.length} 个项目 · ${c.changes.length} 次变更 · ${U.fmtMoney(c.price)} ${c.currency}</div>`;
      li.onclick = () => { currentId = c.id; versionIdx = 0; renderAll(); };
      ul.appendChild(li);
    }
  }

  function renderAll() {
    renderList();
    const c = current();
    $('#emptyState').hidden = !!c;
    $('#contractView').hidden = !c;
    if (!c) return;
    const plans = E.buildAllPlans(c);
    versionIdx = Math.min(versionIdx, plans.length - 1);
    $('#cvName').textContent = c.name;
    $('#cvMeta').textContent = `合同价格 ${U.fmtMoney(c.price)} ${c.currency} · ${c.obligations.length} 个履约项目 · ${c.changes.length} 笔变更 · ${plans.length} 个计划版本`;
    renderVersionSelect(plans);
    renderPlan(c, plans[versionIdx]);
    renderAlloc(c, plans[versionIdx]);
    renderChanges(c);
    renderCompare(c, plans);
  }

  function renderVersionSelect(plans) {
    const sel = $('#versionSelect');
    sel.innerHTML = plans.map((p, i) => `<option value="${i}" ${i === versionIdx ? 'selected' : ''}>${p.label}</option>`).join('');
    sel.onchange = () => { versionIdx = Number(sel.value); renderAll(); };
    const p = plans[versionIdx];
    const ruleText = p.rule === 'catchup' ? '累计追补法' : p.rule === 'prospective' ? '未来适用法' : '—';
    $('#versionMeta').textContent = p.effectiveDate
      ? `变更生效日 ${p.effectiveDate} · 锁定月 ≤ ${p.lockMonth} · 更正规则：${ruleText} · 开票收款截止 ${p.cashCutoff || '（含全部记录）'}`
      : `基准计划（V1），无锁定期间 · 开票收款截止 ${p.cashCutoff || '（含全部记录）'}`;
  }

  /* ---------------- 收入计划视图 ---------------- */
  function renderPlan(c, plan) {
    const lines = plan.lines;
    // 指标卡
    const last = lines[lines.length - 1];
    const tiles = [
      ['计划确认总收入', U.fmtMoney(plan.totals.revenue), `${c.currency} · 含调整行`],
      ['累计开票', U.fmtMoney(plan.totals.billings), '退款以负数计入'],
      ['累计收款', U.fmtMoney(plan.totals.collections), '现金结算口径'],
      ['期末递延余额', U.fmtMoney(last?.deferred ?? 0), '累计开票 − 累计收入'],
      ['期末应收余额', U.fmtMoney(last?.receivable ?? 0), '累计开票 − 累计收款'],
    ];
    $('#statTiles').innerHTML = tiles.map(([l, v, s]) =>
      `<div class="stat-tile"><div class="t-label">${l}</div><div class="t-value">${v}</div><div class="t-sub">${s}</div></div>`).join('');

    // 折线图（收入 / 开票 / 收款，同一尺度）
    const colors = Chart.colors();
    Chart.lineChart($('#lineChart'), [
      { name: '确认收入', color: colors[0], points: lines.map((l) => ({ label: l.month, value: l.revenue })) },
      { name: '开票金额', color: colors[1], points: lines.map((l) => ({ label: l.month, value: l.billings })) },
      { name: '收款金额', color: colors[2], points: lines.map((l) => ({ label: l.month, value: l.collections })) },
    ]);
    Chart.barChart($('#barChart'), lines.map((l) => ({ label: l.month, value: l.deferred })));

    // 月度明细表
    const tbody = $('#scheduleTable tbody');
    tbody.innerHTML = lines.map((l) => `
      <tr class="${l.frozen ? 'locked' : ''}">
        <td>${l.month}${l.frozen ? ' <span class="chip locked">锁定</span>' : ''}</td>
        <td>${money(l.revenue)}</td><td>${money(l.billings)}</td><td>${money(l.collections)}</td>
        <td>${money(l.cumRevenue)}</td><td>${money(l.cumBilling)}</td><td>${money(l.cumCollection)}</td>
        <td>${money(l.deferred)}</td><td>${money(l.receivable)}</td>
        <td class="note">${escapeHtml(l.note || '')}</td>
      </tr>`).join('');
  }

  /* ---------------- 分摊与项目视图 ---------------- */
  function renderAlloc(c, plan) {
    const alloc = plan.allocations;
    $('#allocTable tbody').innerHTML = alloc.rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.type === 'goods' ? '商品' : '服务'}</td>
        <td>${money(r.ssp)}</td>
        <td>${(r.weight * 100).toFixed(4)}%</td>
        <td>${money(r.rawAmount)}</td>
        <td>${money(r.baseAllocated)}</td>
        <td>${money(r.priceDelta)}</td>
        <td><b>${money(r.allocatedAmount)}</b></td>
      </tr>`).join('');
    $('#allocFoot').textContent =
      `基准合同价 ${U.fmtMoney(alloc.baseTotal)}，价格增量合计 ${U.fmtMoney(alloc.priceDeltaTotal)}，` +
      `本版本分摊合计 ${U.fmtMoney(alloc.total)}；舍入尾差并入项目「${alloc.residualAbsorbedBy}」，各行原值与权重均已保留。`;

    const poMap = Object.fromEntries(c.obligations.map((o) => [o.id, o]));
    const groups = {};
    for (const r of plan.poSchedules) (groups[r.obligationId] = groups[r.obligationId] || []).push(r);
    $('#poSchedules').innerHTML = Object.entries(groups).map(([poId, rows]) => {
      const po = poMap[poId];
      const total = U.round2(U.sum(rows.map((r) => r.amount)));
      return `<div class="po-block"><h4>${escapeHtml(po?.name || poId)} · 合计 ${U.fmtMoney(total)}</h4>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>月份</th><th>确认收入</th><th>计算依据</th></tr></thead>
          <tbody>${rows.sort((a, b) => a.month.localeCompare(b.month)).map((r) => `
            <tr><td>${r.month}</td><td>${money(r.amount)}</td><td class="note">${escapeHtml(r.basis)}</td></tr>`).join('')}
          </tbody></table></div></div>`;
    }).join('');
  }

  function renderChanges(c) {
    const typeName = { extension: '合同延长', termination: '部分终止', priceAdjustment: '追溯调价' };
    const ruleName = { prospective: '未来适用法', catchup: '累计追补法' };
    $('#changeTable tbody').innerHTML = c.changes.length ? c.changes.map((h) => `
      <tr>
        <td>${typeName[h.type] || h.type}</td><td>${h.effectiveDate}</td>
        <td>${ruleName[h.correctionRule] || h.correctionRule}</td>
        <td class="note">${escapeHtml(h.label || '')} ${h.note ? '（' + escapeHtml(h.note) + '）' : ''}</td>
        <td>${money(h.priceDelta)}</td><td>${h.newEnd || '—'}</td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="hint">暂无变更，仅存在 V1 基准计划</td></tr>';
  }

  /* ---------------- 版本对比 ---------------- */
  function renderCompare(c, plans) {
    const opts = plans.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
    const aSel = $('#cmpA'), bSel = $('#cmpB');
    if (aSel.options.length !== plans.length) {
      aSel.innerHTML = opts; bSel.innerHTML = opts;
      aSel.value = '0'; bSel.value = String(plans.length - 1);
    }
    const draw = () => {
      const cmp = E.comparePlans(plans[Number(aSel.value)], plans[Number(bSel.value)]);
      $('#cmpSummary').innerHTML =
        `A 版合计 <b>${U.fmtMoney(cmp.totalA)}</b> · B 版合计 <b>${U.fmtMoney(cmp.totalB)}</b> · ` +
        `差异合计 <b class="${cmp.totalDelta < 0 ? 'neg' : ''}">${U.fmtMoney(cmp.totalDelta)}</b>　` +
        `锁定期间（B 版阴影行）差异恒为 0，历史已确认金额不被改写。`;
      $('#cmpTable tbody').innerHTML = cmp.rows.map((r) => `
        <tr class="${r.frozenB ? 'locked' : ''}">
          <td>${r.month}${r.frozenB ? ' <span class="chip locked">锁定</span>' : ''}</td>
          <td>${money(r.revenueA)}</td><td>${money(r.revenueB)}</td>
          <td class="${r.delta < 0 ? 'neg' : ''}">${money(r.delta)}</td>
          <td>${r.frozenB ? '已锁定' : '可调整'}</td>
          <td class="note">${escapeHtml(r.noteB || '')}</td>
        </tr>`).join('');
      $('#exportCmpBtn').onclick = () => downloadCsv(`版本对比_${aSel.value}-${bSel.value}.csv`, cmpToCsv(cmp, plans, aSel.value, bSel.value));
    };
    aSel.onchange = draw; bSel.onchange = draw;
    draw();
  }

  /* ---------------- 导入导出 ---------------- */
  function download(name, text, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob(['﻿' + text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function downloadCsv(name, text) { download(name, text); }

  function scheduleCsv(plan) {
    const rows = [
      ['月份', '确认收入', '开票金额', '收款金额', '累计收入', '累计开票', '累计收款', '递延余额', '应收余额', '是否锁定', '计算依据'],
      ...plan.lines.map((l) => [l.month, l.revenue, l.billings, l.collections, l.cumRevenue, l.cumBilling,
        l.cumCollection, l.deferred, l.receivable, l.frozen ? '是' : '否', l.note || '']),
      ['合计', plan.totals.revenue, plan.totals.billings, plan.totals.collections, '', '', '', '', '', '', ''],
    ];
    return U.toCsv(rows);
  }
  function cmpToCsv(cmp, plans, ia, ib) {
    const rows = [
      [`月份`, `${plans[ia].label} 收入`, `${plans[ib].label} 收入`, '差异(B-A)', 'B版状态', 'B版依据'],
      ...cmp.rows.map((r) => [r.month, r.revenueA, r.revenueB, r.delta, r.frozenB ? '锁定' : '可调整', r.noteB || '']),
      ['合计', cmp.totalA, cmp.totalB, cmp.totalDelta, '', ''],
    ];
    return U.toCsv(rows);
  }

  /* ---------------- 规则文档 ---------------- */
  function renderRules() {
    $('#rulesContent').innerHTML = `
    <div class="notice"><b>重要声明：</b>本工具是规则演示与算术核对工具，按下列<b>明示的简化规则</b>机械计算，
    <b>不构成任何会计准则下的会计处理意见或合规结论</b>。真实合同的收入确认需结合合同条款、权利义务转移、
    可变对价、重大融资成分等因素由专业人员判断。</div>

    <h3>1. 独立售价（SSP）分摊与尾差</h3>
    <ul>
      <li>组合合同按各履约项目独立售价占比分摊合同价格：<code>分摊原值 = 合同价 × 项目SSP / SSP合计</code>。</li>
      <li>各项目按原值四舍五入到分；<b>舍入尾差（合同价 − 各项舍入值之和）并入最后一个项目</b>，原值、权重、尾差去向均在「分摊与项目」页展示，可追溯。</li>
      <li>未配置任何 SSP 时兜底按项目数均分（页面会提示这不是正常配置）。</li>
    </ul>

    <h3>2. 履约节奏</h3>
    <ul>
      <li><b>服务：按天履约。</b>起止区间含首尾两天（<code>天数 = 结束日 − 开始日 + 1</code>），闰日自然计入（2024-02 有 29 天）。</li>
      <li>月度收入 = <code>分摊价 × 当月落在服务区间内的天数 / 总天数</code>；月度值四舍五入到分，月舍入尾差并入该项目最后一个履约月。</li>
      <li><b>商品：按确认交付日履约。</b>在交付日所在月份一次性确认该商品的全部分摊价。</li>
    </ul>

    <h3>3. 变更、版本与锁定期间</h3>
    <ul>
      <li>每笔变更（合同延长 / 部分终止 / 追溯调价）生成一个新计划版本，版本按变更生效日先后排列。</li>
      <li><b>锁定月 = 变更生效日的上一个自然月</b>；锁定月及以前已确认的收入原样复制到新版本，任何规则下都不会被改写（表中阴影行）。</li>
      <li>价格增量（含部分终止的退款 <code>priceDelta</code>）按 SSP 权重分摊到各项目，同样保留尾差去向。</li>
      <li>延长/终止通过修改服务项目的结束日生效；退款等现金动作通过<b>负数开票与负数收款</b>单独记录。</li>
    </ul>

    <h3>4. 两种更正规则（可逐笔变更选择）</h3>
    <ul>
      <li><b>未来适用法（prospective）：</b>新版本下每个项目的待确认余额 = 新分摊价 − 已确认金额，在锁定月之后的剩余服务天数内重新按天摊销；商品则在交付日（若晚于锁定月）确认剩余金额。<b>若项目已在锁定月前履约完毕（商品已交付、服务已结束），没有未来期间可承接的价格增量，会作为一条明示的「未来适用调整」计入变更生效月，绝不回写历史月份</b>；降价额超过剩余待确认时同理在生效月显式调减。</li>
      <li><b>累计追补法（catchup）：</b>按新条件完整重算整段计划；锁定月以前的历史月份仍不改写，新旧口径在锁定月前的累计差额作为一条<b>「累计追补调整」</b>计入变更生效月，调整金额与计算式在月度备注中展示。</li>
      <li>两种规则下，版本对比页中锁定期间的两版差异恒为 0；全部差额只出现在生效月及以后。</li>
    </ul>

    <h3>5. 开票、收款与递延/应收</h3>
    <ul>
      <li>开票与收款是独立于收入确认的结算事实，按发生月汇总；红冲开票、退款打款以负数录入。</li>
      <li><b>按版本存续期截止：</b>每个计划版本只包含下一版变更生效日之前已发生的开票与收款（末版包含全部记录），历史版本不会被后来才发生的退款、补开票“穿越”改写。</li>
      <li><b>递延收入余额 = 累计开票 − 累计确认收入</b>（为负表示已确认未开票）。</li>
      <li><b>应收余额 = 累计开票 − 累计收款</b>。</li>
      <li>全部金额以元为单位、两位小数展示；内部计算先按完整精度计算，仅在展示与月度确认点舍入，尾差有明确承接行。</li>
    </ul>

    <h3>6. 导入导出与数据边界</h3>
    <ul>
      <li>JSON 为整库导入导出；CSV 为单合同多区块文本（<code>#contract / #obligations / #invoices / #collections / #changes</code>），可在表格软件中编辑后导回。</li>
      <li>数据仅保存在当前浏览器 localStorage，不上传任何服务器；清除浏览器数据会丢失，请及时导出。</li>
    </ul>`;
  }

  /* ---------------- 小工具 ---------------- */
  function money(v) {
    const cls = v < 0 ? ' class="neg"' : '';
    return `<span${cls}>${U.fmtMoney(v)}</span>`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /* ---------------- 事件接线 ---------------- */
  $('#newContractBtn').onclick = async () => {
    const blank = Store.normalize({
      name: '新合同 ' + new Date().toISOString().slice(0, 10), price: 0,
      obligations: [{ id: U.uid('o'), name: '服务项一', type: 'service', start: '', end: '', ssp: 0 }],
      invoices: [], collections: [], changes: [],
    });
    const saved = await Editor.open(blank);
    if (saved) { contracts.push(saved); currentId = saved.id; versionIdx = 0; persist(); renderAll(); toast('合同已创建'); }
  };

  $('#editContractBtn').onclick = async () => {
    const c = current();
    if (!c) return;
    const saved = await Editor.open(c);
    if (saved) {
      const idx = contracts.findIndex((x) => x.id === c.id);
      contracts[idx] = Store.normalize(saved);
      versionIdx = 0; persist(); renderAll(); toast('已保存并重新计算全部版本');
    }
  };

  $('#loadSamplesBtn').onclick = () => {
    const fresh = RevSamples.map((s) => Store.normalize(JSON.parse(JSON.stringify(s))));
    contracts = fresh.concat(contracts);
    currentId = fresh[0].id; versionIdx = 0;
    persist(); renderAll(); toast('已载入 3 份虚构演示合同');
  };

  $('#exportJsonBtn').onclick = () => {
    if (!current()) return toast('请先选择合同');
    download('合同收入数据.json', Store.exportJson([current()]), 'application/json;charset=utf-8');
  };
  $('#exportCsvBtn').onclick = () => {
    if (!current()) return toast('请先选择合同');
    download(`${current().name}.csv`, Store.exportCsv(current()));
  };
  $('#exportScheduleBtn').onclick = () => {
    const c = current(); if (!c) return;
    const plan = E.buildAllPlans(c)[versionIdx];
    download(`${c.name}_${plan.versionId}_月度计划.csv`, scheduleCsv(plan));
  };

  const fileInput = $('#fileInput');
  $('#importJsonBtn').onclick = () => { fileInput.dataset.mode = 'json'; fileInput.click(); };
  $('#importCsvBtn').onclick = () => { fileInput.dataset.mode = 'csv'; fileInput.click(); };
  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const list = fileInput.dataset.mode === 'csv'
          ? [Store.importCsv(String(reader.result))]
          : Store.importJson(String(reader.result));
        contracts = list.map((c) => Store.normalize(c)).concat(contracts);
        currentId = contracts[list.length - 1].id; versionIdx = 0;
        persist(); renderAll(); toast(`导入成功：${list.length} 份合同`);
      } catch (e) { alert('导入失败：' + e.message); }
      fileInput.value = '';
    };
    reader.readAsText(f, 'utf-8');
  };

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
      if (tab.dataset.tab === 'rules') renderRules();
    };
  });

  $('#themeToggle').onclick = () => {
    const body = document.body;
    const next = body.dataset.theme === 'light' ? 'dark' : 'light';
    body.dataset.theme = next;
    $('#themeToggle').textContent = next === 'light' ? '切换深色' : '切换浅色';
    localStorage.setItem('rev-demo-theme', next);
    renderAll(); // 图表颜色依赖 CSS 变量，重绘取新色
  };
  const savedTheme = localStorage.getItem('rev-demo-theme');
  if (savedTheme === 'dark') { body.dataset.theme = 'dark'; $('#themeToggle').textContent = '切换浅色'; }

  renderList();
  renderRules();
})();
