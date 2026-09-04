/* Samboza Family Finance — demo ledger.
   In-memory only: anything added during a demo disappears on reload. */
window.DEMO = (function () {
  'use strict';

  const TODAY = new Date(2026, 8, 1);          // 1 Sep 2026
  const RATES = { EGP: 1, SAR: 12.95, USD: 48.60 };

  /* ---- people (§2). isUser decides who can sign in.
     `dark` is the same hue re-stepped for the dark surface, not a tint. --- */
  const people = [
    { id:'mother',  rel:'mother',          role:'viewer', isUser:true,  initials:'Gh',  color:'#4a3aa7', dark:'#6a5bd0' },
    { id:'abdo',    rel:'brother',         role:'admin',  isUser:true,  initials:'A',  color:'#0f9d75', dark:'#14a87e' },
    { id:'zeyad',   rel:'son',             role:'member', isUser:true,  initials:'Z',  color:'#2a78d6', dark:'#3987e5' },
    { id:'rewan',   rel:'daughter',        role:'member', isUser:true,  initials:'R',  color:'#e87ba4', dark:'#d55181' },
    { id:'uncle',   rel:'uncle_maternal',  role:'driver', isUser:true,  initials:'J',  color:'#e34948', dark:'#e66767' },
    { id:'mona',    rel:'aunt',            role:null,     isUser:false, initials:'Mo', color:'#eb6834', dark:'#d95926' },
    { id:'grandma', rel:'grandmother',     role:null,     isUser:false, initials:'G',  color:'#eda100', dark:'#c98500' },
    { id:'marwa',   rel:'aunt',            role:null,     isUser:false, initials:'Ma', color:'#1baf7a', dark:'#199e70' },
    { id:'adamanas',rel:'cousins',         role:null,     isUser:false, initials:'A&A',color:'#2aa8a0', dark:'#35bdb4' }
  ];

  /* ---- identity (§2.4) ------------------------------------------------
     Two layers, deliberately separate:
       uuid  — the primary key. Never shown, never typed, never reused.
               Survives a rename. This is what row-level security keys on.
       code  — the short public identifier people read out and type.
     The family code is permanent; the invite code is a separate, rotatable
     grant of access. Conflating them would mean a leaked invite could only
     be revoked by changing the family's identity. -------------------------- */
  const FAMILY = {
    id:      '7f3c1a9e-4b2d-4e18-9c05-a1d6f2e83b47',
    code:    'SMBZ-7420',
    name:    'Samboza',
    currency:'EGP',
    createdBy:'abdo',
    invite:  'JOIN-8K2M',
    inviteExpires: new Date(2026, 8, 30)
  };

  // member_no is unique within the family, not globally.
  const IDENTITY = {
    mother:  ['c4a1e07b-9d32-4f6a-8b15-2e7c9a04d3f8', '01'],
    abdo:    ['1b8f3d52-6a04-4c9e-b7d1-58e2f60a9c34', '02'],
    zeyad:   ['9e2d7a41-3f85-4b06-a9c7-d41528b3e6f0', '03'],
    rewan:   ['5a6c8b13-2e79-4d40-8f3b-91a07d5c2e68', '04'],
    mona:    ['e30b4f96-7c15-4a82-b6d9-034e1f7a58c2', '05'],
    grandma: ['2d95c6e8-b174-4093-8a2f-6c5d81e04b73', '06'],
    marwa:   ['84f0a3d7-51c9-4e26-9b48-7d3216fa0c95', '07'],
    adamanas:['6c17e9b4-08a2-4d5f-b391-e5407c8a2d16', '08'],
    uncle:   ['3fa62d08-9e41-4c73-85b6-1207de95f3a4', '09']
  };
  people.forEach(function (p) {
    p.uuid     = IDENTITY[p.id][0];
    p.no       = IDENTITY[p.id][1];
    p.code     = FAMILY.code + '·' + p.no;   // e.g. SMBZ-7420·03
    p.familyId = FAMILY.id;
  });

  /* ---- categories (§3.2). Colour is fixed per category, never by rank.
     The five largest carry validated categorical slots 1–5; the rest are
     neutral and fold into a single "Other" slice in the donut. --------- */
  const categories = [
    { id:'allowance',  kind:'expense', color:'#2a78d6', dark:'#3987e5', major:true },
    { id:'rent',       kind:'expense', color:'#eb6834', dark:'#d95926', major:true },
    { id:'food',       kind:'expense', color:'#1baf7a', dark:'#199e70', major:true },
    { id:'education',  kind:'expense', color:'#eda100', dark:'#c98500', major:true },
    { id:'medical',    kind:'expense', color:'#e87ba4', dark:'#d55181', major:true },
    { id:'gifts',      kind:'expense', color:'#8a9490', dark:'#9aa4a0', occasional:true, needsRecipient:true },
    { id:'car',        kind:'expense', color:'#8a9490', dark:'#9aa4a0' },
    { id:'loanrepay',  kind:'expense', color:'#8a9490', dark:'#9aa4a0' },
    { id:'other',      kind:'expense', color:'#8a9490', dark:'#9aa4a0' },
    { id:'remittance', kind:'income',  color:'#1baf7a', dark:'#199e70' },
    { id:'carprofit',  kind:'income',  color:'#2a78d6', dark:'#3987e5' },
    { id:'loanin',     kind:'income',  color:'#eda100', dark:'#c98500' }
  ];

  let seq = 0;
  const uid = p => p + (++seq);
  const d = (m, day) => new Date(2026, m - 1, day);

  /* Deterministic pseudo-random, so the demo is identical on every open. */
  const rand = (function (seed) {
    let s = seed;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  })(20260901);

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

  /* ---- allowance rates (§3.3, decision D3) -----------------------------
     A fixed monthly figure per recipient that can be raised or lowered.
     Rates are effective-dated rather than overwritten, so a change never
     rewrites what was actually paid in an earlier month. ------------------ */
  const allowanceRates = [
    { person:'zeyad',    amount:2500, from:d(1,1) },
    { person:'zeyad',    amount:3000, from:d(6,1) },   // raised in June
    { person:'rewan',    amount:3000, from:d(1,1) },
    { person:'mona',     amount:2000, from:d(1,1) },
    { person:'grandma',  amount:2000, from:d(1,1) },
    { person:'marwa',    amount:2000, from:d(1,1) },
    { person:'adamanas', amount:2000, from:d(8,1) }    // joined in August
  ];
  function rateOn(personId, when) {
    let found = 0;
    allowanceRates.forEach(function (r) {
      if (r.person === personId && r.from <= when && r.amount != null) found = r.amount;
    });
    return found;
  }
  const currentRate = id => rateOn(id, TODAY);
  people.forEach(function (p) { p.allowance = currentRate(p.id); });

  // Recurring: rent, groceries, and the allowances — March to August.
  const foodDays   = [[3,1850],[9,720],[16,2100],[24,1430]];
  const drift      = [0, 140, -90, 260, -180, 75];
  const recipients = ['zeyad','rewan','mona','grandma','marwa','adamanas'];

  const allowances = [];
  for (let i = 0; i < 6; i++) {
    const m = 3 + i;
    add({ type:'expense', cat:'rent', amount:8000, date:d(m,1), note:'n_rent' });
    foodDays.forEach(function (pair, k) {
      add({ type:'expense', cat:'food', amount: pair[1] + drift[(i + k) % 6],
            date:d(m, pair[0]), note: k === 0 ? 'n_grocery_big' : 'n_grocery' });
    });
    recipients.forEach(function (who) {
      const amount = rateOn(who, d(m, 5));
      if (!amount) return;                       // not a recipient yet that month
      allowances.push({ id:uid('a'), person:who, amount, month:m, paidOn:d(m,5), paidBy:'abdo' });
      add({ type:'expense', cat:'allowance', amount, forWhom:who, date:d(m,5), note:'n_allowance' });
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
    ['gifts',     2500,  d(4,14), 'n_eid_gifts',    'grandma'],
    ['gifts',     3500,  d(6,21), 'n_wedding_gift', 'marwa'],
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

  /* ---- the car (§3.4, decisions D1 and D2) -----------------------------
     Joe drives and submits each working day himself, picking the date —
     there are days off, so the date cannot be assumed to be today.

     Every expense carries a class:
       direct   — fuel, tolls: the cost of earning that day's fares
       indirect — administration, the كارتة permit, a traffic fine
     Both come off the gross before Joe's third. The classification is what
     the family reports on, not a different split.

     The label only SUGGESTS a class. Joe sets `kind` himself on every row
     and can override the suggestion — a toll can be indirect if that is
     how he sees it, and "Other" has no sensible default at all, so it
     carries a free-text note instead. ------------------------------------ */
  const DEFAULT_KIND = {
    fuel:   'direct',
    tolls:  'direct',
    permit: 'indirect',
    admin:  'indirect',
    ticket: 'indirect',
    other:  'indirect'
  };
  const EXPENSE_LABELS = Object.keys(DEFAULT_KIND);
  const kindOf = e => e.kind || DEFAULT_KIND[e.label] || 'direct';

  function settleDay(gross, items) {
    const of = k => items.filter(e => kindOf(e) === k)
                         .reduce((s, e) => s + e.amount, 0);
    const direct = of('direct'), indirect = of('indirect');
    const net    = Math.max(0, gross - direct - indirect);
    const uncle  = Math.round(net / 3);
    const rest   = net - uncle;
    const family = Math.round(rest * 0.75);
    return { direct, indirect, net, uncle, rest, family, marwa: rest - family };
  }

  const carDays = [];
  for (let m = 3; m <= 9; m++) {
    const lastDay = m === 9 ? 1 : new Date(2026, m, 0).getDate();
    for (let day = 1; day <= lastDay; day++) {
      if (m !== 9 && rand() < 0.17) continue;                 // a day off
      const gross = 520 + Math.round(rand() * 460);
      const exp = (label, amount, note) => ({
        id: uid('ce'), label, amount, kind: DEFAULT_KIND[label], note: note || null
      });
      const items = [exp('fuel', 90 + Math.round(rand() * 110))];
      if (rand() < 0.12) items.push(exp('tolls',  20 + Math.round(rand() * 40)));
      if (day === 3)     items.push(exp('permit', 200));
      if (rand() < 0.05) items.push(exp('ticket', 150 + Math.round(rand() * 150)));
      if (rand() < 0.07) items.push(exp('admin',  80 + Math.round(rand() * 90)));
      if (rand() < 0.04) items.push(exp('other',  40 + Math.round(rand() * 90), 'n_carwash'));
      const open = (m === 9);                                 // today is still open
      carDays.push(Object.assign({
        id: uid('cd'), date: d(m, day), gross, expenses: items,
        status: open ? 'open' : 'settled', submittedBy: 'uncle', settledBy: open ? null : 'abdo'
      }, settleDay(gross, items)));
    }
  }
  carDays.filter(c => c.status === 'settled').forEach(function (c) {
    add({ type:'income', cat:'carprofit', amount:c.family, date:c.date, note:'n_car_share', src:c.id });
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

  /* ---- member sub-ledger (§3.3, decision D5) ---------------------------
     What Zeyad and Rewan log against their allowance. Kept apart from the
     family ledger — the family already expensed the disbursement, so
     counting the kid's spending again would double-count it.

     Every submission needs Abdo's approval. Pending rows are visible to the
     member who filed them but do not move their balance until approved. --- */
  const memberTx = [];
  const zeyadPlan = [[6,'food',260,'n_canteen'],[8,'other',150,'n_transport'],[13,'food',320,'n_eating_out'],
                     [17,'education',480,'n_books'],[21,'other',180,'n_transport'],[26,'food',290,'n_eating_out']];
  const rewanPlan = [[7,'food',210,'n_canteen'],[11,'other',140,'n_transport'],[15,'gifts',350,'n_gift_friend'],
                     [19,'education',400,'n_stationery'],[23,'food',260,'n_eating_out'],[28,'medical',180,'n_pharmacy']];
  for (let i = 0; i < 6; i++) {
    const m = 3 + i;
    zeyadPlan.forEach(function (p, k) {
      memberTx.push({ id:uid('mx'), person:'zeyad', cat:p[1],
        amount: p[2] + Math.round(drift[(i + k) % 6] / 4), date:d(m, p[0]), note:p[3],
        status:'approved', decidedBy:'abdo' });
    });
    rewanPlan.forEach(function (p, k) {
      memberTx.push({ id:uid('mx'), person:'rewan', cat:p[1],
        amount: p[2] + Math.round(drift[(i + k) % 6] / 5), date:d(m, p[0]), note:p[3],
        status:'approved', decidedBy:'abdo' });
    });
  }
  // A few still waiting on Abdo, so the approvals queue has something in it.
  [ ['zeyad','food',    340, d(8,30), 'n_eating_out'],
    ['zeyad','other',   220, d(8,31), 'n_transport'],
    ['rewan','education',560, d(8,31), 'n_books'],
    ['rewan','food',    185, d(9,1),  'n_canteen']
  ].forEach(function (r) {
    memberTx.push({ id:uid('mx'), person:r[0], cat:r[1], amount:r[2], date:r[3], note:r[4],
                    status:'pending', decidedBy:null });
  });

  return { TODAY, RATES, FAMILY, people, categories, tx, remittances, carDays,
           DEFAULT_KIND, EXPENSE_LABELS, kindOf, settleDay, loans, allowances, allowanceRates, rateOn,
           memberTx, add, uid };
})();
