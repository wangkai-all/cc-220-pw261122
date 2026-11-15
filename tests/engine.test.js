/* Node 单元测试：node tests/engine.test.js
   验证演示规则的算术正确性（非会计合规测试）。 */
'use strict';
const assert = require('assert');
const U = require('../js/util');
const E = require('../js/engine');
const samples = require('../data/samples');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const approx = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} 失败`);

console.log('日期与区间工具');
test('2024 闰日计入服务天数（2024-02-28 ~ 2024-03-01 = 3 天）', () => {
  assert.strictEqual(U.daysInclusive('2024-02-28', '2024-03-01'), 3);
});
test('2023 平年 2 月只有 28 天', () => {
  assert.strictEqual(U.daysInclusive('2023-02-28', '2023-03-01'), 2);
});
test('跨年区间按月重叠天数：2025-12-31 ~ 2026-01-02 各月切分', () => {
  assert.strictEqual(U.overlapDays('2025-12-31', '2026-01-02', '2025-12-01', '2025-12-31'), 1);
  assert.strictEqual(U.overlapDays('2025-12-31', '2026-01-02', '2026-01-01', '2026-01-31'), 2);
});

console.log('独立售价分摊与尾差');
test('组合合同按 SSP 比例分摊，尾差并入最后一项且合计精确', () => {
  const alloc = E.allocate(samples[1].obligations, 168888.01);
  assert.strictEqual(alloc.rows.length, 2);
  approx(alloc.rows[0].allocatedAmount, 76767.28);
  approx(alloc.rows[1].allocatedAmount, 92120.73);
  assert.strictEqual(U.round2(U.sum(alloc.rows.map((r) => r.allocatedAmount))), 168888.01);
  assert.strictEqual(alloc.residualAbsorbedBy, 'o2');
});
test('未配置 SSP 时兜底均分为两项', () => {
  const alloc = E.allocate(
    [{ id: 'a', ssp: 0 }, { id: 'b', ssp: 0 }], 100);
  assert.strictEqual(alloc.rows[0].allocatedAmount, 50);
  assert.strictEqual(alloc.rows[1].allocatedAmount, 50);
});

console.log('服务按天 / 商品按交付日');
test('服务 V1 合计精确等于分摊价（月尾差并入最后一月）', () => {
  const plan = E.buildAllPlans(samples[1])[0];
  const svc = plan.poSchedules.filter((r) => r.obligationId === 'o2');
  assert.strictEqual(U.round2(U.sum(svc.map((r) => r.amount))), 92120.73);
  // 2024 闰年共 1096 天，2024-02 含 29 天
  const feb = svc.find((r) => r.month === '2024-02');
  approx(feb.amount, 92120.73 * 29 / 1096);
});
test('商品在交付日所在月一次性确认', () => {
  const plan = E.buildAllPlans(samples[1])[0];
  const goods = plan.poSchedules.filter((r) => r.obligationId === 'o1');
  assert.strictEqual(goods.length, 1);
  assert.strictEqual(goods[0].month, '2024-02');
  assert.strictEqual(goods[0].amount, 76767.28);
});

console.log('合同一：追溯调价 + 累计追补法');
test('锁定月 1-10 月收入在 V2 中不被改写（基准 120,000 口径，前 123/365 天）', () => {
  const plans = E.buildAllPlans(samples[0]);
  const v1 = plans[0], v2 = plans[1];
  const pre = (p) => p.lines.filter((l) => l.month <= '2025-10').reduce((a, l) => a + l.revenue, 0);
  assert.strictEqual(U.round2(pre(v2)), U.round2(pre(v1)));
  assert.strictEqual(U.round2(pre(v1)), 40438.35);
});
test('追补调整 = -4,043.84 计入生效月 2025-11，V2 总收入 = 108,000', () => {
  const v2 = E.buildAllPlans(samples[0])[1];
  assert.strictEqual(v2.adjustments.length, 1);
  assert.strictEqual(v2.adjustments[0].month, '2025-11');
  assert.strictEqual(v2.adjustments[0].amount, -4043.84);
  assert.strictEqual(v2.totals.revenue, 108000);
});
test('V2 的 2025-11 月行 = 新口径月度收入 + 追补调整', () => {
  const v2 = E.buildAllPlans(samples[0])[1];
  const nov = v2.lines.find((l) => l.month === '2025-11');
  approx(nov.revenue, 8876.71 - 4043.84);
});

console.log('合同二：合同延长 + 未来适用法');
test('锁定月之前收入不变，剩余金额在延长期间摊完', () => {
  const plans = E.buildAllPlans(samples[1]);
  const v1 = plans[0], v2 = plans[1];
  const pre = (p) => p.lines.filter((l) => l.month <= '2025-06').reduce((a, l) => a + l.revenue, 0);
  assert.strictEqual(U.round2(pre(v2)), U.round2(pre(v1)));
  // V2 最后一个月为 2027-06，且全部计划合计仍等于合同价
  assert.strictEqual(v2.lines[v2.lines.length - 1].month, '2027-06');
  assert.strictEqual(v2.totals.revenue, 168888.01);
});

console.log('合同三：部分终止 + 部分退款（负数开票/收款）');
test('1-7 月锁定收入 = 52,273.99，V2 新计划只覆盖 8-9 月', () => {
  const v2 = E.buildAllPlans(samples[2])[1];
  const locked = v2.lines.filter((l) => l.frozen);
  assert.strictEqual(U.round2(U.sum(locked.map((l) => l.revenue))), 52273.99);
  const future = v2.lines.filter((l) => !l.frozen && l.revenue !== 0);
  assert.deepStrictEqual(future.map((l) => l.month), ['2025-08', '2025-09']);
  assert.strictEqual(v2.totals.revenue, 75000);
});
test('红冲开票与退款打款为负数；年末递延与应收均归零', () => {
  const v2 = E.buildAllPlans(samples[2])[1];
  assert.strictEqual(v2.totals.billings, 75000);
  assert.strictEqual(v2.totals.collections, 75000);
  const last = v2.lines[v2.lines.length - 1];
  assert.strictEqual(last.deferred, 0);
  assert.strictEqual(last.receivable, 0);
});
test('退款月 2025-08 递延余额 = 累计净开票 - 累计收入', () => {
  const v2 = E.buildAllPlans(samples[2])[1];
  const aug = v2.lines.find((l) => l.month === '2025-08');
  const augRev = v2.lines.filter((l) => l.month <= '2025-08').reduce((a, l) => a + l.revenue, 0);
  approx(aug.deferred, 75000 - augRev);
});
test('现金事实按版本存续期截止：V1 不含后来的退款，V2 含全部记录', () => {
  const plans = E.buildAllPlans(samples[2]);
  assert.strictEqual(plans[0].totals.billings, 90000);
  assert.strictEqual(plans[0].totals.collections, 90000);
  assert.strictEqual(plans[1].totals.billings, 75000);
  assert.strictEqual(plans[1].totals.collections, 75000);
  // V1 计划行不应出现 8 月的红冲开票
  assert.ok(!plans[0].lines.some((l) => l.month === '2025-08' && l.billings !== 0));
});

console.log('版本对比');
test('comparePlans 差异合计 = 两版总收入之差', () => {
  const plans = E.buildAllPlans(samples[0]);
  const cmp = E.comparePlans(plans[0], plans[1]);
  assert.strictEqual(cmp.totalA, 120000);
  assert.strictEqual(cmp.totalB, 108000);
  assert.strictEqual(cmp.totalDelta, -12000);
  // 锁定月差异全部为 0
  assert.ok(cmp.rows.filter((r) => r.frozenB).every((r) => r.delta === 0));
});

console.log('多笔变更链式压力（catchup → 延长 prospective → 加价 prospective）');
test('每个版本收入与分摊合计闭合，且锁定月累计跨版完全一致', () => {
  const c = {
    id: 'x', name: '压力合同', price: 100000,
    obligations: [
      { id: 'a', name: '服务A', type: 'service', start: '2024-01-01', end: '2025-12-31', ssp: 60000 },
      { id: 'b', name: '商品B', type: 'goods', deliveryDate: '2024-06-15', ssp: 40000 },
    ],
    invoices: [{ id: 'i1', date: '2024-01-10', amount: 100000 }],
    collections: [{ id: 'p1', date: '2024-02-10', amount: 100000 }],
    changes: [
      { id: 'h1', type: 'priceAdjustment', effectiveDate: '2024-09-01', priceDelta: -10000, correctionRule: 'catchup' },
      { id: 'h2', type: 'extension', obligationId: 'a', effectiveDate: '2025-04-01', newEnd: '2026-06-30', priceDelta: 0, correctionRule: 'prospective' },
      { id: 'h3', type: 'priceAdjustment', effectiveDate: '2025-10-01', priceDelta: 5000, correctionRule: 'prospective' },
    ],
  };
  const plans = E.buildAllPlans(c);
  assert.strictEqual(plans.length, 4);
  for (const p of plans) {
    const allocTotal = U.round2(U.sum(p.allocations.rows.map((r) => r.allocatedAmount)));
    assert.strictEqual(p.totals.revenue, allocTotal);
  }
  for (let i = 1; i < plans.length; i++) {
    const lock = plans[i].lockMonth;
    const prev = U.round2(plans[i - 1].lines.filter((l) => l.month <= lock).reduce((s, l) => s + l.revenue, 0));
    const cur = U.round2(plans[i].lines.filter((l) => l.month <= lock).reduce((s, l) => s + l.revenue, 0));
    assert.strictEqual(prev, cur);
  }
  assert.strictEqual(plans[3].totals.revenue, 95000);
  // 已交付商品在未来适用法下的加价：生效月显式调整行，不回写历史
  const v4Adj = plans[3].adjustments;
  assert.strictEqual(v4Adj.length, 1);
  assert.strictEqual(v4Adj[0].month, '2025-10');
  assert.strictEqual(v4Adj[0].amount, 2000);
});

console.log('CSV 往返');
test('含引号、逗号、换行的字段可正确往返', () => {
  const rows = [['月份', '备注'], ['2025-01', '含,逗号'], ['2025-02', '含"引号"\n换行']];
  const back = U.parseCsv(U.toCsv(rows));
  assert.deepStrictEqual(back, rows);
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : ''}`);
