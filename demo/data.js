/* Samboza Family Finance — demo ledger.
   In-memory only: anything added during a demo disappears on reload. */
window.DEMO = (function () {
  'use strict';

  const TODAY = new Date(2026, 8, 1);          // 1 Sep 2026
  const RATES = { EGP: 1, SAR: 12.95, USD: 48.60 };

  /* ---- people (§2). isUser decides who can sign in. ------------------ */
  const people = [
    { id:'mother',  rel:'mother',      role:'viewer', isUser:true,  initials:'M',  color:'#4a3aa7', allowance:0 },
    { id:'abdo',    rel:'brother',     role:'admin',  isUser:true,  initials:'A',  color:'#0f9d75', allowance:0 },
    { id:'zeyad',   rel:'son',         role:'member', isUser:true,  initials:'Z',  color:'#2a78d6', allowance:3000 },
    { id:'rewan',   rel:'daughter',    role:'member', isUser:true,  initials:'R',  color:'#e87ba4', allowance:3000 },
    { id:'mona',    rel:'aunt',        role:null,     isUser:false, initials:'Mo', color:'#eb6834', allowance:1500 },
    { id:'grandma', rel:'grandmother', role:null,     isUser:false, initials:'G',  color:'#eda100', allowance:2000 },
    { id:'marwa',   rel:'aunt',        role:null,     isUser:false, initials:'Ma', color:'#1baf7a', allowance:1500 },
    { id:'uncle',   rel:'uncle',       role:null,     isUser:false, initials:'U',  color:'#e34948', allowance:0 }
  ];

  /* ---- categories (§3.2). Colour is fixed per category, never by rank.
     The five largest carry validated categorical slots 1–5; the rest are
     neutral and fold into a single "Other" slice in the donut. --------- */
  const categories = [
    { id:'allowance',  kind:'expense', color:'#2a78d6', major:true },
    { id:'rent',       kind:'expense', color:'#eb6834', major:true },
    { id:'food',       kind:'expense', color:'#1baf7a', major:true },
    { id:'education',  kind:'expense', color:'#eda100', major:true },
    { id:'medical',    kind:'expense', color:'#e87ba4', major:true },
    { id:'gifts',      kind:'expense', color:'#8a9490', occasional:true },
    { id:'car',        kind:'expense', color:'#8a9490' },
    { id:'loanrepay',  kind:'expense', color:'#8a9490' },
    { id:'other',      kind:'expense', color:'#8a9490' },
    { id:'remittance', kind:'income',  color:'#1baf7a' },
    { id:'carprofit',  kind:'income',  color:'#2a78d6' },
    { id:'loanin',     kind:'income',  color:'#eda100' }
  ];

  let seq = 0;
  const uid = p => p + (++seq);
  const d = (m, day) => new Date(2026, m - 1, day);

  /* ---- family ledger ------------------------------------------------- */
  const tx = [];
  function add(o) {
    const t = Object.assign({
      id: uid('t'), currency:'EGP', fx:1, forWhom:null, by:'abdo', src:null
    }, o);
    if (t.amountOriginal == null) t.amountOriginal = t.amount;
    tx.push(t);
    return t;
  }

  // Recurring: rent, groceries, and the five allowances — March to August.
  const foodDays   = [[3,1850],[9,720],[16,2100],[24,1430]];
  const drift      = [0, 140, -90, 260, -180, 75];
  const recipients = [['zeyad',3000],['rewan',3000],['mona',1500],['grandma',2000],['marwa',1500]];

  for (let i = 0; i < 6; i++) {
    const m = 3 + i;
    add({ type:'expense', cat:'rent', amount:8000, date:d(m,1), note:'n_rent' });
    foodDays.forEach(function (pair, k) {
      add({ type:'expense', cat:'food', amount: pair[1] + drift[(i + k) % 6],
            date:d(m, pair[0]), note: k === 0 ? 'n_grocery_big' : 'n_grocery' });
    });
    recipients.forEach(function (r) {
      add({ type:'expense', cat:'allowance', amount:r[1], forWhom:r[0],
            date:d(m,5), note:'n_allowance' });
    });
  }

  // Irregular expenses.
  [ ['education', 4500,  d(3,12), 'n_school_term',  null],
    ['education', 12000, d(8,20), 'n_uni_fees',     'zeyad'],
    ['medical',   900,   d(3,18), 'n_prescription', 'grandma'],
    ['medical',   750,   d(4,22), 'n_clinic',       null],
    ['medical',   1200,  d(5,9),  'n_prescription', 'grandma'],
    ['medical',   800,   d(6,27), 'n_dentist',      'rewan'],
    ['medical',   950,   d(7,15), 'n_prescription', 'grandma'],
    ['medical',   1100,  d(8,8),  'n_clinic',       null],
    ['gifts',     2500,  d(4,14), 'n_eid_gifts',    null],
    ['gifts',     3500,  d(6,21), 'n_wedding_gift', null],
    ['other',     600,   d(3,25), 'n_utilities',    null],
    ['other',     550,   d(4,27), 'n_utilities',    null],
    ['other',     600,   d(5,30), 'n_utilities',    null],
    ['other',     700,   d(6,29), 'n_utilities',    null],
    ['other',     620,   d(7,30), 'n_utilities',    null],
    ['other',     580,   d(8,29), 'n_utilities',    null],
    ['food',      480,   d(9,1),  'n_grocery',      null],
    ['other',     250,   d(9,1),  'n_taxi',         null]
  ].forEach(function (r) {
    add({ type:'expense', cat:r[0], amount:r[1], date:r[2], note:r[3], forWhom:r[4] });
  });

  /* ---- remittances (§3.1). Lumpy — they arrive when she visits. ------ */
  const remittances = [
    { id:'r1', amountOriginal:5000, currency:'SAR', fx:12.88, date:d(3,20), visit:'n_visit_spring' },
    { id:'r2', amountOriginal:5200, currency:'SAR', fx:12.95, date:d(6,14), visit:'n_visit_eid' },
    { id:'r3', amountOriginal:1200, currency:'USD', fx:48.60, date:d(7,18), visit:'n_visit_summer' }
  ];
  remittances.forEach(function (r) {
    r.amount = Math.round(r.amountOriginal * r.fx);
    r.by = 'abdo';
    add({ type:'income', cat:'remittance', amount:r.amount, amountOriginal:r.amountOriginal,
          currency:r.currency, fx:r.fx, date:r.date, note:r.visit, forWhom:'mother', src:r.id });
  });

  /* ---- car settlements (§3.4): uncle ⅓ of gross, then 75/25 on profit - */
  // Six settled months, then September still open for Abdo to close on screen.
  const grosses = [17400, 18900, 16800, 19600, 18200, 20100, 1900];
  const expenseSets = [
    [['fuel',2400],['maintenance',900],['licensing',500]],
    [['fuel',2650],['maintenance',1800]],
    [['fuel',2300],['maintenance',600],['licensing',900]],
    [['fuel',2850],['maintenance',2100]],
    [['fuel',2500],['maintenance',750]],
    [['fuel',2900],['maintenance',1400],['licensing',500]],
    [['fuel',400]]
  ];
  const settlements = grosses.map(function (gross, i) {
    const m = 3 + i;
    const items = expenseSets[i].map(function (e, k) {
      return { id:uid('ce'), kind:e[0], amount:e[1], date:d(m, i === 6 ? 1 : 10 + k * 6) };
    });
    const spent  = items.reduce(function (s, e) { return s + e.amount; }, 0);
    const uncle  = Math.round(gross / 3);
    const pool   = gross - uncle;
    const profit = pool - spent;
    const family = Math.round(profit * 0.75);
    return {
      id:'s' + m, month:m, start:d(m,1), end:new Date(2026, m, 0),
      gross, uncle, pool, expenses:items, spent, profit,
      family, marwa: profit - family,
      status: i === 6 ? 'open' : 'settled', settledBy:'abdo'
    };
  });
  settlements.filter(function (s) { return s.status === 'settled'; }).forEach(function (s) {
    add({ type:'income', cat:'carprofit', amount:s.family, date:d(s.month, 28), note:'n_car_share', src:s.id });
  });

  /* ---- loans (§3.5) --------------------------------------------------- */
  const loans = [{
    id:'l1', direction:'borrowed', lender:'Hazem', amount:25000, currency:'EGP',
    date:d(5,10), note:'n_loan_note', status:'partial',
    payments:[ { id:'lp1', amount:5000, date:d(7,12) }, { id:'lp2', amount:5000, date:d(8,12) } ]
  }];
  loans.forEach(function (l) {
    add({ type:'income', cat:'loanin', amount:l.amount, date:l.date, note:'n_loan_in', src:l.id });
    l.payments.forEach(function (p) {
      add({ type:'expense', cat:'loanrepay', amount:p.amount, date:p.date, note:'n_loan_out', src:l.id });
    });
  });

  /* ---- allowance disbursement register (§3.3) ------------------------- */
  const allowances = [];
  for (let i = 0; i < 6; i++) {
    const m = 3 + i;
    recipients.forEach(function (r) {
      allowances.push({ id:uid('a'), person:r[0], amount:r[1], month:m, paidOn:d(m,5), paidBy:'abdo' });
    });
  }

  /* ---- member sub-ledger: what Zeyad and Rewan log against allowance.
     Deliberately separate from the family ledger — the family already
     expensed the disbursement, so counting the kid's spending again
     would double-count it. ---------------------------------------------- */
  const memberTx = [];
  const zeyadPlan = [[6,'food',260,'n_canteen'],[8,'other',150,'n_transport'],[13,'food',320,'n_eating_out'],
                     [17,'education',480,'n_books'],[21,'other',180,'n_transport'],[26,'food',290,'n_eating_out']];
  const rewanPlan = [[7,'food',210,'n_canteen'],[11,'other',140,'n_transport'],[15,'gifts',350,'n_gift_friend'],
                     [19,'education',400,'n_stationery'],[23,'food',260,'n_eating_out'],[28,'medical',180,'n_pharmacy']];
  for (let i = 0; i < 6; i++) {
    const m = 3 + i;
    zeyadPlan.forEach(function (p, k) {
      memberTx.push({ id:uid('mx'), person:'zeyad', cat:p[1],
        amount: p[2] + Math.round(drift[(i + k) % 6] / 4), date:d(m, p[0]), note:p[3] });
    });
    rewanPlan.forEach(function (p, k) {
      memberTx.push({ id:uid('mx'), person:'rewan', cat:p[1],
        amount: p[2] + Math.round(drift[(i + k) % 6] / 5), date:d(m, p[0]), note:p[3] });
    });
  }

  return { TODAY, RATES, people, categories, tx, remittances, settlements,
           loans, allowances, memberTx, add, uid };
})();
