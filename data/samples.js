/* 虚构演示合同：数据均为编造，仅用于演示计算规则，不对应任何真实主体 */
(function (global) {
  'use strict';

  const samples = [
    {
      id: 'c1',
      name: '合同一：跨年云订阅服务（含追溯调价·累计追补）',
      currency: 'CNY',
      price: 120000,
      obligations: [
        { id: 'o1', name: 'SaaS 平台年度订阅', type: 'service', start: '2025-07-01', end: '2026-06-30', ssp: 120000 },
      ],
      invoices: [
        { id: 'i1', date: '2025-07-05', amount: 72000, note: '首付款开票 60%' },
        { id: 'i2', date: '2026-01-10', amount: 48000, note: '尾款开票 40%' },
      ],
      collections: [
        { id: 'p1', date: '2025-07-20', amount: 72000, note: '首付款到账' },
        { id: 'p2', date: '2026-02-15', amount: 48000, note: '尾款到账' },
      ],
      changes: [
        {
          id: 'ch1', type: 'priceAdjustment', effectiveDate: '2025-11-01',
          priceDelta: -12000, correctionRule: 'catchup',
          label: '服务范围缩减的追溯调价',
          note: '经协商合同价由 120,000 调减为 108,000，采用累计追补法更正。',
        },
      ],
    },
    {
      id: 'c2',
      name: '合同二：软件许可 + 运维组合合同（含独立售价分摊、闰日、合同延长）',
      currency: 'CNY',
      price: 168888.01,
      obligations: [
        { id: 'o1', name: '软件永久许可（商品）', type: 'goods', deliveryDate: '2024-02-20', ssp: 100000 },
        { id: 'o2', name: '三年运维服务（含 2024 闰日）', type: 'service', start: '2024-01-01', end: '2026-12-31', ssp: 120000 },
      ],
      invoices: [
        { id: 'i1', date: '2024-01-15', amount: 100000, note: '许可部分开票' },
        { id: 'i2', date: '2024-01-15', amount: 68888.01, note: '运维部分开票' },
      ],
      collections: [
        { id: 'p1', date: '2024-02-10', amount: 168888.01, note: '全额到账' },
      ],
      changes: [
        {
          id: 'ch1', type: 'extension', obligationId: 'o2', effectiveDate: '2025-07-01',
          newEnd: '2027-06-30', priceDelta: 0, correctionRule: 'prospective',
          label: '运维服务延长半年（不加价）',
          note: '服务期由 2026-12-31 延长至 2027-06-30，剩余待确认收入在延长后期间按天摊销。',
        },
      ],
    },
    {
      id: 'c3',
      name: '合同三：跨年度服务包部分终止（部分退款·未来适用法）',
      currency: 'CNY',
      price: 90000,
      obligations: [
        { id: 'o1', name: '驻场技术支持服务', type: 'service', start: '2025-01-01', end: '2025-12-31', ssp: 90000 },
      ],
      invoices: [
        { id: 'i1', date: '2025-01-10', amount: 90000, note: '全额开票' },
        { id: 'i2', date: '2025-08-05', amount: -15000, note: '部分退款：红冲开票' },
      ],
      collections: [
        { id: 'p1', date: '2025-01-25', amount: 90000, note: '全额收款' },
        { id: 'p2', date: '2025-08-12', amount: -15000, note: '部分退款打款' },
      ],
      changes: [
        {
          id: 'ch1', type: 'termination', obligationId: 'o1', effectiveDate: '2025-08-01',
          newEnd: '2025-09-30', priceDelta: -15000, correctionRule: 'prospective',
          label: '部分终止：服务提前至 9 月底结束',
          note: '原服务至 12/31，提前于 9/30 终止，退还 15,000；已确认的 1-7 月收入不改写。',
        },
      ],
    },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = samples;
  else global.RevSamples = samples;
})(typeof globalThis !== 'undefined' ? globalThis : this);
