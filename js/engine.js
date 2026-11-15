/*
 * 收入确认引擎（教学/演示用的简化规则，非会计准则实现）
 *
 * 规则概览（详见 README 与页面「规则说明」）：
 * 1. 组合合同按各履约项目的独立售价(SSP)比例分摊合同价格；
 *    各项先按比例四舍五入到分，尾差并入最后一项，分摊过程全部保留可追溯。
 * 2. 服务类项目：在起止区间内按天履约，月度收入 = 分摊价 × 当月履约天数 / 总天数；
 *    每月四舍五入到分，尾差并入该项目最后一个履约月。
 * 3. 商品类项目：在确认交付日所在月份一次性确认全部分摊价。
 * 4. 变更（延长/部分终止/追溯调价）生成新版本计划：
 *    - 锁定月（变更生效日的上一个月）及之前的期间原样保留，绝不改写；
 *    - prospective（未来适用法）：剩余待确认金额在剩余期间重新按天分摊；
 *    - catchup（累计追补法）：按新条件完整重算，锁定月以前的新旧差额
 *      作为一条「累计追补调整」计入变更生效月，历史月份本身仍不改写。
 * 5. 开票、收款是独立的现金/结算事实：退款以负数开票与负数收款录入。
 *    递延收入余额 = 累计开票 - 累计确认收入；应收余额 = 累计开票 - 累计收款。
 */
(function (global) {
  'use strict';
  const U = (typeof module !== 'undefined' && module.exports) ? require('./util') : global.RevUtil;
  const { round2, sum, monthKey, monthStart, monthEnd, nextMonth, eachMonth, overlapDays, daysInclusive } = U;

  function prevMonth(m) {
    const [y, mo] = m.split('-').map(Number);
    return mo === 1 ? `${y - 1}-12` : `${y}-${U.pad(mo - 1)}`;
  }

  /* ---------------- 独立售价分摊（含尾差追溯） ---------------- */
  function allocate(obligations, totalPrice) {
    const sspTotal = sum(obligations.map((o) => o.ssp || 0));
    let weights;
    if (sspTotal > 0) weights = obligations.map((o) => (o.ssp || 0) / sspTotal);
    else weights = obligations.map(() => 1 / obligations.length); // 兜底：未配置 SSP 时均分

    const rows = obligations.map((o, i) => {
      const raw = totalPrice * weights[i];
      return {
        obligationId: o.id, name: o.name, type: o.type,
        ssp: o.ssp || 0, weight: weights[i], rawAmount: raw, allocatedAmount: round2(raw),
      };
    });
    // 尾差 = 合同价 - 各项舍入后之和，并入最后一项
    const residual = round2(totalPrice - sum(rows.map((r) => r.allocatedAmount)));
    if (rows.length) {
      rows[rows.length - 1].allocatedAmount = round2(rows[rows.length - 1].allocatedAmount + residual);
    }
    return { rows, residualAbsorbedBy: rows.length ? rows[rows.length - 1].obligationId : null, total: totalPrice };
  }

  /* ---------------- 单项目完整计划（无变更基准） ---------------- */
  function fullServiceSchedule(po, allocated) {
    const totalDays = daysInclusive(po.start, po.end);
    const months = eachMonth(monthKey(po.start), monthKey(po.end));
    const raw = months.map((m) => ({
      month: m,
      amount: (allocated * overlapDays(po.start, po.end, monthStart(m), monthEnd(m))) / totalDays,
      basis: `服务 ${overlapDays(po.start, po.end, monthStart(m), monthEnd(m))}/${totalDays} 天`,
    }));
    return fixResidual(raw, allocated);
  }

  function fullGoodsSchedule(po, allocated) {
    return [{ month: monthKey(po.deliveryDate), amount: allocated, basis: `商品交付日 ${po.deliveryDate} 一次性确认` }];
  }

  function fullSchedule(po, allocated) {
    return po.type === 'goods' ? fullGoodsSchedule(po, allocated) : fullServiceSchedule(po, allocated);
  }

  /** 月度行四舍五入后，把舍入尾差并入最后一行，保证合计精确等于 allocated */
  function fixResidual(rows, allocated) {
    const out = rows.map((r) => ({ ...r, amount: round2(r.amount) }));
    if (out.length) {
      const residual = round2(allocated - sum(out.map((r) => r.amount)));
      out[out.length - 1].amount = round2(out[out.length - 1].amount + residual);
      out[out.length - 1].basis += `（含分摊尾差 ${residual >= 0 ? '+' : ''}${residual.toFixed(2)}）`;
    }
    return out;
  }

  /* ---------------- 合同状态回放：基准 + 变更 → 生效条件 ---------------- */
  function effectiveState(contract, versionIdx) {
    let price = contract.price;
    let pos = contract.obligations.map((o) => ({ ...o }));
    const applied = [];
    // versionIdx=0 为基准（套用 0 笔变更），versionIdx=k 套用前 k 笔变更
    for (let i = 0; i < versionIdx; i++) {
      const ch = contract.changes[i];
      applied.push(ch);
      if (ch.type === 'extension') {
        const po = pos.find((o) => o.id === ch.obligationId);
        if (po && ch.newEnd) po.end = ch.newEnd;
      } else if (ch.type === 'termination') {
        const po = pos.find((o) => o.id === ch.obligationId);
        if (po && ch.newEnd) po.end = ch.newEnd; // 部分终止 = 服务提前结束
      } else if (ch.type === 'priceAdjustment') {
        price = round2(price + (ch.priceDelta || 0));
      }
    }
    return { price, obligations: pos, applied };
  }

  /* ---------------- 版本计划构建 ---------------- */
  /**
   * @param priorPlan 上一版本计划（V1 传 null）
   * @param change    产生本版本的变更（V1 传 null）
   */
  function buildVersionPlan(contract, versionIdx, priorPlan, change) {
    const state = effectiveState(contract, versionIdx);
    const baseAlloc = allocate(state.obligations, contract.price);

    // 价格增量：任何类型的变更都可能携带 priceDelta（部分终止的退款同样通过它入账）；
    // 增量按 SSP 权重摊到各项，尾差并入最后一项，无价格变更时增量为 0
    let priceDeltaTotal = 0;
    for (let i = 0; i < versionIdx; i++) priceDeltaTotal += contract.changes[i].priceDelta || 0;
    const deltaRows = baseAlloc.rows.map((r) => ({
      obligationId: r.obligationId, weight: r.weight, amount: round2(priceDeltaTotal * r.weight),
    }));
    if (deltaRows.length) {
      const deltaResidual = round2(priceDeltaTotal - sum(deltaRows.map((r) => r.amount)));
      deltaRows[deltaRows.length - 1].amount = round2(deltaRows[deltaRows.length - 1].amount + deltaResidual);
    }
    const deltaMap = Object.fromEntries(deltaRows.map((r) => [r.obligationId, r.amount]));
    const allocRows = baseAlloc.rows.map((r) => ({
      ...r,
      baseAllocated: r.allocatedAmount,
      priceDelta: deltaMap[r.obligationId] || 0,
      allocatedAmount: round2(r.allocatedAmount + (deltaMap[r.obligationId] || 0)),
    }));
    const alloc = {
      rows: allocRows,
      residualAbsorbedBy: baseAlloc.residualAbsorbedBy,
      total: round2(sum(allocRows.map((r) => r.allocatedAmount))),
      baseTotal: contract.price,
      priceDeltaTotal: round2(priceDeltaTotal),
    };
    const allocMap = Object.fromEntries(alloc.rows.map((r) => [r.obligationId, r]));

    const lockMonth = change ? prevMonth(monthKey(change.effectiveDate)) : null;
    const rule = change ? (change.correctionRule || 'prospective') : null;

    // 从上一版本取出锁定月及以前的实际确认（按项目、按月），
    // 必须同时包含常规排期与追补/未来适用调整行——调整行也是已确认收入
    const frozenPo = {};   // obligationId -> { month -> amount }
    const freezeEntry = (r) => {
      frozenPo[r.obligationId] = frozenPo[r.obligationId] || {};
      frozenPo[r.obligationId][r.month] = round2((frozenPo[r.obligationId][r.month] || 0) + r.amount);
    };
    if (priorPlan && lockMonth) {
      for (const r of priorPlan.poSchedules) if (r.month <= lockMonth) freezeEntry(r);
      for (const r of priorPlan.adjustments) if (r.month <= lockMonth) freezeEntry(r);
    }
    const recognizedOf = (poId) => round2(sum(Object.values(frozenPo[poId] || {})));

    const poSchedules = [];
    const adjustments = [];

    for (const po of state.obligations) {
      const allocated = allocMap[po.id].allocatedAmount;
      const recognized = recognizedOf(po.id);

      if (!change) {
        // V1：完整计划
        for (const r of fullSchedule(po, allocated)) {
          poSchedules.push({ obligationId: po.id, month: r.month, amount: r.amount, basis: r.basis });
        }
        continue;
      }

      // 锁定月部分原样继承
      for (const [m, amt] of Object.entries(frozenPo[po.id] || {})) {
        poSchedules.push({ obligationId: po.id, month: m, amount: amt, basis: '锁定期间：沿用已确认金额' });
      }

      if (rule === 'catchup') {
        // 完整重算：未来月按新计划，锁定月以前的新旧差额走调整行
        const full = fullSchedule(po, allocated);
        for (const r of full) {
          if (r.month > lockMonth) {
            poSchedules.push({ obligationId: po.id, month: r.month, amount: r.amount, basis: `重算计划：${r.basis}` });
          }
        }
        const hypothetical = round2(sum(full.filter((r) => r.month <= lockMonth).map((r) => r.amount)));
        const adj = round2(hypothetical - recognized);
        if (adj !== 0) {
          adjustments.push({
            obligationId: po.id, month: monthKey(change.effectiveDate), amount: adj,
            label: `累计追补调整（${po.name}）：新口径应确认 ${hypothetical.toFixed(2)} - 已确认 ${recognized.toFixed(2)}`,
          });
        }
      } else {
        // 未来适用法：剩余金额 = 新分摊价 - 已确认，在剩余期间按天分摊
        const remaining = round2(allocated - recognized);
        if (po.type === 'goods') {
          if (monthKey(po.deliveryDate) > lockMonth) {
            // 交付日在未来：剩余分摊价（含价格增量）随交付一次性确认
            if (remaining !== 0) {
              poSchedules.push({
                obligationId: po.id, month: monthKey(po.deliveryDate), amount: remaining,
                basis: `商品交付日 ${po.deliveryDate} 确认剩余分摊价`,
              });
            }
          } else if (remaining !== 0) {
            // 商品已在锁定月前交付：无未来履约期可承接，增量在生效月显式调整（不回写历史）
            adjustments.push({
              obligationId: po.id, month: monthKey(change.effectiveDate), amount: remaining,
              label: `未来适用调整（${po.name}，已交付）：价格变动 ${remaining.toFixed(2)} 计入生效月`,
            });
          }
        } else if (remaining > 0) {
          const firstFuture = monthStart(nextMonth(lockMonth));
          const remStart = po.start > firstFuture ? po.start : firstFuture;
          const remEnd = po.end;
          if (remEnd >= remStart) {
            const totalDays = daysInclusive(remStart, remEnd);
            const months = eachMonth(monthKey(remStart), monthKey(remEnd));
            const rows = months.map((m) => {
              const d = overlapDays(remStart, remEnd, monthStart(m), monthEnd(m));
              return { month: m, amount: (remaining * d) / totalDays, basis: `未来适用：剩余服务 ${d}/${totalDays} 天` };
            });
            for (const r of fixResidual(rows, remaining)) {
              poSchedules.push({ obligationId: po.id, month: r.month, amount: r.amount, basis: r.basis });
            }
          } else {
            // 服务已在锁定月前结束：无可摊销期间，增量在生效月显式调整
            adjustments.push({
              obligationId: po.id, month: monthKey(change.effectiveDate), amount: remaining,
              label: `未来适用调整（${po.name}，服务已结束）：价格变动 ${remaining.toFixed(2)} 计入生效月`,
            });
          }
        } else if (remaining < 0) {
          // 降价额超过剩余待确认：无法由未来期间吸收的部分在生效月显式调减
          adjustments.push({
            obligationId: po.id, month: monthKey(change.effectiveDate), amount: remaining,
            label: `未来适用调减（${po.name}）：剩余待确认不足，差额 ${remaining.toFixed(2)} 计入生效月`,
          });
        }
      }
    }

    const plan = {
      versionIndex: versionIdx,
      versionId: versionIdx === 0 ? 'V1' : `V${versionIdx + 1}`,
      label: versionIdx === 0 ? 'V1 基准计划' : `V${versionIdx + 1} ${change.label || change.type}`,
      effectiveDate: change ? change.effectiveDate : null,
      // 现金截止点：下一版变更生效日（该版本存续期内的开票/收款都纳入），末版不截止
      cashCutoff: contract.changes[versionIdx] ? contract.changes[versionIdx].effectiveDate : null,
      lockMonth, rule,
      allocations: alloc,
      poSchedules,
      adjustments,
    };
    plan.lines = buildMonthlyLines(contract, plan);
    plan.totals = {
      revenue: round2(sum(plan.lines.map((l) => l.revenue))),
      billings: round2(sum(plan.lines.map((l) => l.billings))),
      collections: round2(sum(plan.lines.map((l) => l.collections))),
    };
    return plan;
  }

  /* ---------------- 月度汇总行（收入 + 开票收款 + 递延/应收） ---------------- */
  function buildMonthlyLines(contract, plan) {
    const revMap = {};   // month -> amount
    const basisMap = {}; // month -> [basis...]
    for (const r of plan.poSchedules) {
      revMap[r.month] = round2((revMap[r.month] || 0) + r.amount);
      (basisMap[r.month] = basisMap[r.month] || []).push(r.basis);
    }
    for (const a of plan.adjustments) {
      revMap[a.month] = round2((revMap[a.month] || 0) + a.amount);
      (basisMap[a.month] = basisMap[a.month] || []).push(a.label);
    }
    // 开票/收款是结算事实：按版本存续期截止（下一版变更生效日之前的记录纳入本版），
    // 末版包含全部记录；避免把后续期间才发生的退款/开票提前计入历史版本
    const cashCutoff = plan.cashCutoff;
    const billMap = {}, colMap = {};
    for (const inv of contract.invoices || []) {
      if (cashCutoff && inv.date >= cashCutoff) continue;
      billMap[monthKey(inv.date)] = round2((billMap[monthKey(inv.date)] || 0) + (inv.amount || 0));
    }
    for (const c of contract.collections || []) {
      if (cashCutoff && c.date >= cashCutoff) continue;
      colMap[monthKey(c.date)] = round2((colMap[monthKey(c.date)] || 0) + (c.amount || 0));
    }

    const allMonths = [
      ...Object.keys(revMap), ...Object.keys(billMap), ...Object.keys(colMap),
    ].sort();
    if (!allMonths.length) return [];
    const from = allMonths[0], to = allMonths[allMonths.length - 1];

    let cumRev = 0, cumBill = 0, cumCol = 0;
    return eachMonth(from, to).map((m) => {
      const revenue = round2(revMap[m] || 0);
      const billings = round2(billMap[m] || 0);
      const collections = round2(colMap[m] || 0);
      cumRev = round2(cumRev + revenue);
      cumBill = round2(cumBill + billings);
      cumCol = round2(cumCol + collections);
      return {
        month: m,
        revenue, billings, collections,
        cumRevenue: cumRev, cumBilling: cumBill, cumCollection: cumCol,
        deferred: round2(cumBill - cumRev),       // 递延收入余额
        receivable: round2(cumBill - cumCol),     // 应收余额
        frozen: plan.lockMonth ? m <= plan.lockMonth : false,
        note: (basisMap[m] || []).join('；'),
      };
    });
  }

  /** 生成合同的全部版本计划（V1 + 每个变更一个版本） */
  function buildAllPlans(contract) {
    const plans = [];
    let prior = null;
    for (let i = 0; i <= contract.changes.length; i++) {
      const change = i === 0 ? null : contract.changes[i - 1];
      const plan = buildVersionPlan(contract, i, prior, change);
      plans.push(plan);
      prior = plan;
    }
    return plans;
  }

  /** 版本对比：按月并排两版收入，输出差异 */
  function comparePlans(planA, planB) {
    const mapA = Object.fromEntries(planA.lines.map((l) => [l.month, l]));
    const mapB = Object.fromEntries(planB.lines.map((l) => [l.month, l]));
    const months = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort();
    const rows = months.map((m) => {
      const a = mapA[m]?.revenue || 0;
      const b = mapB[m]?.revenue || 0;
      return {
        month: m,
        revenueA: round2(a), revenueB: round2(b), delta: round2(b - a),
        frozenB: mapB[m]?.frozen || false,
        noteB: mapB[m]?.note || '',
      };
    });
    return {
      rows,
      totalA: round2(sum(rows.map((r) => r.revenueA))),
      totalB: round2(sum(rows.map((r) => r.revenueB))),
      totalDelta: round2(sum(rows.map((r) => r.delta))),
    };
  }

  const api = {
    allocate, fullServiceSchedule, fullGoodsSchedule, fullSchedule,
    effectiveState, buildVersionPlan, buildAllPlans, buildMonthlyLines, comparePlans, prevMonth,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RevEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
