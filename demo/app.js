/* Samboza Family Finance — demo app.
   Everything is in memory. Reload restores the sample ledger. */
(function () {
  'use strict';

  const D = window.DEMO, I = window.I18N, Ch = window.Charts;
  const root = document.getElementById('root');

  const state = {
    user: null,
    screen: 'dashboard',
    addType: 'expense',
    addCat: null,
    addCurrency: 'EGP',
    filters: { q: '', type: 'all', cat: 'all', person: 'all' },
    tables: {}
  };

  /* ── helpers ───────────────────────────────────────────────────────── */
  const t = I.t;
  const person = id => D.people.find(p => p.id === id);
  const pname = id => id ? t('p_' + id) : '';
  const cat = id => D.categories.find(c => c.id === id);
  const cname = id => t('c_' + id);

  /* Dark is a selected palette, not an inversion: every person and category
     carries its own dark step, picked for the dark surface. */
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  function resolvedTheme() {
    const set = document.documentElement.dataset.theme;
    return (set === 'dark' || set === 'light') ? set : (prefersDark.matches ? 'dark' : 'light');
  }
  const hue = o => (o && (resolvedTheme() === 'dark' && o.dark ? o.dark : o.color)) || '#8a9490';
  const ccolor = id => hue(cat(id));
  const money = (v, o) => I.money(v, o);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const short = v => v >= 1000 ? I.n(Math.round(v / 1000)) + 'k' : I.n(v);
  const byDateDesc = (a, b) => b.date - a.date;
  const sum = list => list.reduce((s, x) => s + x.amount, 0);
  const dayKey = d => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();

  function relDay(d) {
    const k = dayKey(d), today = dayKey(D.TODAY);
    const y = new Date(D.TODAY); y.setDate(y.getDate() - 1);
    if (k === today) return t('today');
    if (k === dayKey(y)) return t('yesterday');
    return I.date(d, true);
  }

  const MONTHS = [3, 4, 5, 6, 7, 8];                     // March–August 2026, the six complete months
  const income  = () => D.tx.filter(x => x.type === 'income');
  const expense = () => D.tx.filter(x => x.type === 'expense');
  const cashOnHand = () => sum(income()) - sum(expense());
  const inWindow = (x, days) => (D.TODAY - x.date) / 864e5 <= days && x.date <= D.TODAY;
  const daysSinceRemittance = () =>
    Math.round((D.TODAY - D.remittances.map(r => r.date).sort((a, b) => b - a)[0]) / 864e5);

  function monthTotals() {
    return MONTHS.map(m => ({
      m,
      income:  sum(income().filter(x => x.date.getMonth() + 1 === m)),
      expense: sum(expense().filter(x => x.date.getMonth() + 1 === m))
    }));
  }

  function catTotals(list) {
    const map = {};
    list.forEach(x => { map[x.cat] = (map[x.cat] || 0) + x.amount; });
    return map;
  }

  /* Top five "major" categories in fixed colour order, everything else folded
     into one neutral Other slice — six segments maximum. */
  function donutSlices(map) {
    const majors = D.categories.filter(c => c.kind === 'expense' && c.major);
    const slices = majors
      .map(c => ({ label: cname(c.id), value: map[c.id] || 0, color: hue(c) }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value);
    const rest = Object.keys(map)
      .filter(k => !majors.some(c => c.id === k))
      .reduce((s, k) => s + map[k], 0);
    if (rest > 0) slices.push({ label: t('c_other'), value: rest, color: hue(cat('other')) });
    return slices;
  }

  const can = {
    write:  () => state.user && state.user.role === 'admin',
    member: () => state.user && state.user.role === 'member',
    viewer: () => state.user && state.user.role === 'viewer'
  };

  /* ── icons ─────────────────────────────────────────────────────────── */
  const ICON = {
    dashboard:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    add:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    remittance:'<path d="M3 12h18M3 12l6-6M3 12l6 6"/><path d="M21 5v14"/>',
    allowance:'<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 14.5h2"/>',
    myspending:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.6 3.8-5.5 7-5.5s6 1.9 7 5.5"/>',
    car:'<path d="M5 16v2M19 16v2M3.5 15h17l-1.2-4.5a2 2 0 0 0-1.9-1.5H6.6a2 2 0 0 0-1.9 1.5L3.5 15Z"/><circle cx="7.5" cy="15" r="1.6"/><circle cx="16.5" cy="15" r="1.6"/>',
    loans:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9.5 8h5M9.5 12h5"/>',
    history:'<path d="M4 6h16M4 12h16M4 18h10"/>',
    reports:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    people:'<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.8-3.2 3.2-4.8 6-4.8s5.2 1.6 6 4.8"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6M17.5 14.6c2 .7 3.4 2.2 3.9 4.4"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon:'<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"/>'
  };
  const icon = (k, cls) => '<svg class="' + (cls || 'ico') + '" viewBox="0 0 24 24">' + ICON[k] + '</svg>';

  /* ── navigation ────────────────────────────────────────────────────── */
  const NAV = [
    { group:'nav_group_money',  items:['dashboard','add','remittance','allowance','car','loans'] },
    { group:'nav_group_family', items:['myspending','history','reports','people'] },
    { group:'nav_group_admin',  items:['settings'] }
  ];
  const ACCESS = {
    dashboard:['admin','member','viewer'], add:['admin','member'], remittance:['admin','viewer'],
    allowance:['admin','viewer'], car:['admin','viewer'], loans:['admin','viewer'],
    myspending:['member'], history:['admin','member','viewer'], reports:['admin','viewer'],
    people:['admin'], settings:['admin']
  };
  const allowed = s => ACCESS[s].indexOf(state.user.role) >= 0;

  /* ── auth ──────────────────────────────────────────────────────────── */
  function renderAuth() {
    const users = D.people.filter(p => p.isUser);
    root.innerHTML =
      '<div class="auth"><div class="auth-card">' +
        '<div class="brandmark">S</div>' +
        '<h1>' + esc(t('auth_title')) + '</h1>' +
        '<p class="sub">' + esc(t('auth_sub')) + '</p>' +
        '<div class="who">' + users.map(u =>
          '<button data-action="signin" data-id="' + u.id + '">' +
            '<span class="avatar lg" style="background:' + hue(u) + '">' + esc(u.initials) + '</span>' +
            '<span><span class="n">' + esc(pname(u.id)) +
              (t('r_' + u.rel) === pname(u.id) ? '' : ' · ' + esc(t('r_' + u.rel))) + '</span><br>' +
            '<span class="w">' + esc(t('role_' + u.role)) + ' — ' + esc(t('role_' + u.role + '_note')) + '</span></span>' +
          '</button>').join('') +
        '</div>' +
        '<p class="hint">' + esc(t('auth_hint')) + ' · ' + esc(t('demo_note')) + '</p>' +
        '<div class="controls">' + langToggle() + themeToggle() + '</div>' +
      '</div></div>';
  }

  const themeToggle = () =>
    '<button class="themetoggle" data-action="theme" aria-label="' + esc(t('theme_toggle')) +
      '" title="' + esc(t('theme_toggle')) + '">' +
      icon(resolvedTheme() === 'dark' ? 'sun' : 'moon', '') + '</button>';

  const langToggle = () =>
    '<div class="langtoggle">' +
      '<button data-action="lang" data-l="en" class="' + (I.lang === 'en' ? 'on' : '') + '">EN</button>' +
      '<button data-action="lang" data-l="ar" class="' + (I.lang === 'ar' ? 'on' : '') + '">ع</button>' +
    '</div>';

  /* ── shell ─────────────────────────────────────────────────────────── */
  function renderShell() {
    const u = state.user;
    const nav = NAV.map(g => {
      const items = g.items.filter(allowed);
      if (!items.length) return '';
      return '<div class="navgroup">' + esc(t(g.group)) + '</div>' + items.map(s =>
        '<button class="navitem ' + (state.screen === s ? 'on' : '') + '" data-action="go" data-s="' + s + '">' +
          icon(s) + '<span>' + esc(t('nav_' + s)) + '</span></button>').join('');
    }).join('');

    root.innerHTML =
      '<div class="shell">' +
        '<aside class="sidebar">' +
          '<div class="brand"><div class="brandmark">S</div>' +
            '<div><div class="t">' + esc(t('family')) + '</div><div class="s">' + esc(t('tagline')) + '</div></div></div>' +
          nav +
          '<div class="foot"><div class="demo-chip">' + icon('info') +
            '<span><b>' + esc(t('demo_badge')) + '</b><br>' + esc(t('demo_note')) + '</span></div></div>' +
        '</aside>' +
        '<div class="main">' +
          '<header class="topbar">' +
            '<h1>' + esc(t('nav_' + state.screen)) + '</h1><div class="spacer"></div>' +
            langToggle() + themeToggle() +
            '<button class="userchip" data-action="signout" title="' + esc(t('switch_user')) + '">' +
              '<span><span class="n">' + esc(pname(u.id)) + '</span><br><span class="r">' + esc(t('role_' + u.role)) + '</span></span>' +
              '<span class="avatar" style="background:' + hue(u) + '">' + esc(u.initials) + '</span>' +
            '</button>' +
          '</header>' +
          '<div class="page" id="page"></div>' +
        '</div>' +
      '</div>';

    const page = document.getElementById('page');
    const screen = SCREENS[state.screen] || SCREENS.dashboard;
    page.innerHTML = (can.viewer() ? readonlyBanner() : '') + screen.html();
    if (screen.after) screen.after(page);
  }

  const readonlyBanner = () =>
    '<div class="banner">' + icon('info') + '<span>' + esc(t('readonly_banner')) + '</span></div>';

  /* ── shared fragments ──────────────────────────────────────────────── */
  function txRow(x) {
    const c = x.type === 'income' ? ccolor(x.cat) : ccolor(x.cat);
    const who = x.forWhom ? pname(x.forWhom) : '';
    return '<div class="tx">' +
      '<div class="dot" style="background:' + c + '">' + esc(cname(x.cat).slice(0, 2)) + '</div>' +
      '<div class="m"><div class="n">' + esc(t(x.note) || x.note) + '</div>' +
        '<div class="w"><span>' + esc(cname(x.cat)) + '</span>' +
          (who ? '<span>' + esc(who) + '</span>' : '') +
          '<span>' + esc(I.date(x.date)) + '</span>' +
          (x.currency !== 'EGP' ? '<span>' + I.n(x.amountOriginal) + ' ' + esc(x.currency) + ' @ ' + x.fx + '</span>' : '') +
        '</div></div>' +
      '<div class="amt ' + (x.type === 'income' ? 'plus' : 'minus') + '">' +
        (x.type === 'income' ? '+' : '−') + money(x.amount) + '</div>' +
    '</div>';
  }

  function groupedByDay(list) {
    if (!list.length) return '<div class="empty">' + esc(t('results_none')) + '</div>';
    const groups = [];
    list.slice().sort(byDateDesc).forEach(x => {
      const k = dayKey(x.date);
      let g = groups.find(g => g.k === k);
      if (!g) { g = { k, date: x.date, items: [] }; groups.push(g); }
      g.items.push(x);
    });
    return groups.map(g => {
      const net = g.items.reduce((s, x) => s + (x.type === 'income' ? x.amount : -x.amount), 0);
      return '<div class="dayhead"><span>' + esc(relDay(g.date)) + '</span>' +
             '<span>' + money(net, { signed: true }) + '</span></div>' +
             '<div class="txlist">' + g.items.map(txRow).join('') + '</div>';
    }).join('');
  }

  function tableToggle(id) {
    return '<button class="btn ghost sm" data-action="table" data-id="' + id + '">' +
      esc(t(state.tables[id] ? 'hide_table' : 'show_table')) + '</button>';
  }
  const tableBox = (id, html) => '<div class="tablewrap" style="margin-top:14px" ' +
    (state.tables[id] ? '' : 'hidden') + '>' + html + '</div>';

  /* ── screens ───────────────────────────────────────────────────────── */
  const SCREENS = {};

  /* Dashboard — admin and viewer */
  SCREENS.dashboard = {
    html: function () {
      if (can.member()) return memberDashboard();
      const inc30 = sum(income().filter(x => inWindow(x, 30)));
      const exp30 = sum(expense().filter(x => inWindow(x, 30)));
      const net = inc30 - exp30;
      const pct = inc30 > 0 ? Math.max(0, Math.min(100, (net / inc30) * 100)) : 0;
      const last = D.remittances.slice().sort(byDateDesc)[0];
      const recent = D.tx.slice().sort(byDateDesc).slice(0, 8);
      const slices = donutSlices(catTotals(expense().filter(x => MONTHS.indexOf(x.date.getMonth() + 1) >= 0)));

      return '<div class="grid k4">' +
          '<div class="card hero kpi"><div class="k">' + esc(t('cash_on_hand')) + '</div>' +
            '<div class="v">' + money(cashOnHand()) + '</div>' +
            '<div class="w">' + esc(t('kpi_hint_cash')) + '</div>' +
            (pct > 0 ? '<div class="netbar"><i style="width:' + pct.toFixed(0) + '%"></i></div>' : '') + '</div>' +
          '<div class="card kpi"><div class="k">' + esc(t('period_income')) + '</div>' +
            '<div class="v plus">' + money(inc30) + '</div><div class="w">' + esc(t('net_period')) + ': ' + money(net, { signed: true }) + '</div></div>' +
          '<div class="card kpi"><div class="k">' + esc(t('period_expense')) + '</div>' +
            '<div class="v minus">' + money(exp30) + '</div><div class="w">' + esc(t('recent_activity')) + ': ' +
            I.n(D.tx.filter(x => inWindow(x, 30)).length) + '</div></div>' +
          '<div class="card kpi"><div class="k">' + esc(t('since_remittance')) + '</div>' +
            '<div class="v">' + I.n(daysSinceRemittance()) + ' <span style="font-size:14px;font-weight:600;color:var(--sub)">' + esc(t('days')) + '</span></div>' +
            '<div class="w">' + esc(t('last_arrived')) + ': ' + esc(I.date(last.date, true)) + ' · ' + money(last.amount) + '</div></div>' +
        '</div>' +
        '<div class="grid split" style="margin-top:16px">' +
          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('recent_activity')) + '</h2>' +
            '<div class="sub">' + esc(t('family')) + '</div></div><div class="spacer"></div>' +
            '<button class="btn ghost sm" data-action="go" data-s="history">' + esc(t('view_all')) + '</button></div>' +
            '<div class="txlist">' + recent.map(txRow).join('') + '</div></div>' +
          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('rep_cat')) + '</h2>' +
            '<div class="sub">' + esc(t('rep_cat_sub')) + '</div></div></div>' +
            '<div id="dashDonut"></div>' + legendHtml(slices) + '</div>' +
        '</div>';
    },
    after: function () {
      if (can.member()) return afterMemberDashboard();
      const slices = donutSlices(catTotals(expense().filter(x => MONTHS.indexOf(x.date.getMonth() + 1) >= 0)));
      Ch.donut(document.getElementById('dashDonut'), {
        slices, fmt: v => money(v), centerLabel: t('total')
      });
    }
  };

  function legendHtml(slices) {
    const total = slices.reduce((s, x) => s + x.value, 0);
    return '<div class="legend" style="margin-top:14px">' + slices.map(s =>
      '<div class="row"><i style="background:' + s.color + '"></i>' + esc(s.label) +
      '<b>' + money(s.value) + '</b><span class="pct">' + Math.round(s.value / total * 100) + '%</span></div>').join('') +
    '</div>';
  }

  /* Dashboard — member */
  function memberSummary(id) {
    const received = D.allowances.filter(a => a.person === id).reduce((s, a) => s + a.amount, 0);
    const spent = sum(D.memberTx.filter(m => m.person === id));
    return { received, spent, balance: received - spent };
  }

  function memberDashboard() {
    const id = state.user.id, s = memberSummary(id);
    const monthly = person(id).allowance;
    const thisMonthSpent = sum(D.memberTx.filter(m => m.person === id && inWindow(m, 30)));
    const pct = monthly ? Math.min(100, thisMonthSpent / monthly * 100) : 0;
    const recent = D.memberTx.filter(m => m.person === id).sort(byDateDesc).slice(0, 8);
    return '<div class="grid k3">' +
        '<div class="card hero kpi"><div class="k">' + esc(t('my_balance')) + '</div>' +
          '<div class="v">' + money(s.balance) + '</div>' +
          '<div class="w">' + esc(t('of_allowance')) + ': ' + money(monthly) + ' · ' + Math.round(pct) + '% ' + esc(t('my_spent')).toLowerCase() + '</div>' +
          '<div class="netbar"><i style="width:' + pct.toFixed(0) + '%"></i></div></div>' +
        '<div class="card kpi"><div class="k">' + esc(t('my_received')) + '</div><div class="v plus">' + money(s.received) + '</div>' +
          '<div class="w">' + I.n(D.allowances.filter(a => a.person === id).length) + ' × ' + money(monthly) + '</div></div>' +
        '<div class="card kpi"><div class="k">' + esc(t('my_spent')) + '</div><div class="v minus">' + money(s.spent) + '</div>' +
          '<div class="w">' + I.n(D.memberTx.filter(m => m.person === id).length) + ' ' + esc(t('results_count', { n: '' })).trim() + '</div></div>' +
      '</div>' +
      '<div class="grid split" style="margin-top:16px">' +
        '<div class="card"><div class="cardhead"><div><h2>' + esc(t('my_history')) + '</h2></div><div class="spacer"></div>' +
          '<button class="btn sm" data-action="go" data-s="add">' + esc(t('log_expense')) + '</button></div>' +
          '<div class="txlist">' + recent.map(memberRow).join('') + '</div></div>' +
        '<div class="card"><div class="cardhead"><div><h2>' + esc(t('habits')) + '</h2>' +
          '<div class="sub">' + esc(t('rep_cat_sub')) + '</div></div></div>' +
          '<div id="dashDonut"></div>' +
          legendHtml(donutSlices(catTotals(D.memberTx.filter(m => m.person === id)))) + '</div>' +
      '</div>';
  }

  function afterMemberDashboard() {
    const id = state.user.id;
    Ch.donut(document.getElementById('dashDonut'), {
      slices: donutSlices(catTotals(D.memberTx.filter(m => m.person === id))),
      fmt: v => money(v), centerLabel: t('total')
    });
  }

  const memberRow = m =>
    '<div class="tx"><div class="dot" style="background:' + ccolor(m.cat) + '">' + esc(cname(m.cat).slice(0, 2)) + '</div>' +
      '<div class="m"><div class="n">' + esc(t(m.note)) + '</div>' +
        '<div class="w"><span>' + esc(cname(m.cat)) + '</span><span>' + esc(I.date(m.date)) + '</span></div></div>' +
      '<div class="amt minus">−' + money(m.amount) + '</div></div>';

  /* Add transaction */
  SCREENS.add = {
    html: function () {
      const isMember = can.member();
      const type = isMember ? 'expense' : state.addType;
      const cats = D.categories.filter(c => c.kind === type &&
        (!isMember || ['food','education','medical','gifts','other'].indexOf(c.id) >= 0));
      const others = D.people.filter(p => p.id !== 'uncle');

      return '<p class="lead">' + esc(isMember ? t('member_add_note') : t('add_title')) + '</p>' +
        '<div class="grid split"><div class="card">' +
          (isMember ? '' :
            '<div class="seg ' + type + '" style="margin-bottom:6px">' +
              '<button data-action="type" data-v="expense" class="' + (type === 'expense' ? 'on' : '') + '">' + esc(t('expense')) + '</button>' +
              '<button data-action="type" data-v="income" class="' + (type === 'income' ? 'on' : '') + '">' + esc(t('income')) + '</button>' +
            '</div>') +
          '<div class="bigamount"><div class="cur">' + esc(state.addCurrency === 'EGP' ? t('egp') : state.addCurrency) + '</div>' +
            '<input id="fAmount" class="amtin" inputmode="decimal" placeholder="0" autocomplete="off"></div>' +
          '<div id="fxLine" class="fxline"></div>' +
          '<div class="errmsg" id="fErr" hidden></div>' +
          '<div style="margin-top:16px" class="field"><label>' + esc(t('category')) + '</label>' +
            '<div class="catgrid">' + cats.map(c =>
              '<button class="catbtn ' + (state.addCat === c.id ? 'on' : '') + '" data-action="cat" data-c="' + c.id + '">' +
                '<i style="background:' + hue(c) + '"></i>' + esc(cname(c.id)) + '</button>').join('') + '</div></div>' +
          '<div class="grid k2" style="margin-top:14px">' +
            '<div class="field"><label>' + esc(t('date')) + '</label>' +
              '<input id="fDate" class="input" type="date" value="2026-09-01" max="2026-09-01"></div>' +
            (isMember ? '' :
              '<div class="field"><label>' + esc(t('currency')) + '</label>' +
                '<select id="fCur" class="input" ' + (type === 'expense' ? 'disabled' : '') + '>' +
                  ['EGP','SAR','USD'].map(c => '<option ' + (state.addCurrency === c ? 'selected' : '') + '>' + c + '</option>').join('') +
                '</select></div>') +
          '</div>' +
          (isMember ? '' :
            '<div class="field" style="margin-top:14px"><label>' + esc(t('on_behalf')) + '</label>' +
              '<select id="fWhom" class="input"><option value="">' + esc(t('nobody')) + '</option>' +
              others.map(p => '<option value="' + p.id + '">' + esc(pname(p.id)) + '</option>').join('') + '</select></div>') +
          '<div class="field" style="margin-top:14px"><label>' + esc(t('note')) + '</label>' +
            '<input id="fNote" class="input" placeholder="' + esc(t('note_ph')) + '"></div>' +
          '<button class="btn" style="width:100%; margin-top:18px" data-action="save">' + esc(t('save_tx')) + '</button>' +
        '</div>' +
        '<div class="card"><div class="cardhead"><div><h2>' + esc(t('recent_activity')) + '</h2></div></div>' +
          '<div class="txlist">' + (isMember
            ? D.memberTx.filter(m => m.person === state.user.id).sort(byDateDesc).slice(0, 7).map(memberRow).join('')
            : D.tx.slice().sort(byDateDesc).slice(0, 7).map(txRow).join('')) + '</div></div></div>';
    },
    after: function (page) {
      const amt = page.querySelector('#fAmount');
      if (amt) { amt.focus(); amt.addEventListener('input', updateFx); }
      const cur = page.querySelector('#fCur');
      if (cur) cur.addEventListener('change', function () { state.addCurrency = this.value; renderShell(); });
      updateFx();
    }
  };

  function updateFx() {
    const line = document.getElementById('fxLine');
    if (!line) return;
    const c = state.addCurrency;
    const v = parseFloat((document.getElementById('fAmount') || {}).value) || 0;
    line.textContent = (c === 'EGP' || !v) ? '' :
      t('rate_line', { r: D.RATES[c], v: money(Math.round(v * D.RATES[c])) });
  }

  /* Remittance */
  SCREENS.remittance = {
    html: function () {
      const rows = D.remittances.slice().sort(byDateDesc);
      const total = rows.reduce((s, r) => s + r.amount, 0);
      return '<p class="lead">' + esc(t('rem_sub')) + '</p>' +
        '<div class="grid k3">' +
          '<div class="card hero kpi"><div class="k">' + esc(t('rem_total')) + '</div><div class="v">' + money(total) + '</div>' +
            '<div class="w">' + I.n(rows.length) + ' × ' + esc(t('visit')) + '</div></div>' +
          '<div class="card kpi"><div class="k">' + esc(t('since_remittance')) + '</div>' +
            '<div class="v">' + I.n(daysSinceRemittance()) + ' <span style="font-size:14px;font-weight:600;color:var(--sub)">' + esc(t('days')) + '</span></div>' +
            '<div class="w">' + esc(t('last_arrived')) + ': ' + esc(I.date(rows[0].date, true)) + '</div></div>' +
          '<div class="card kpi"><div class="k">' + esc(t('rate')) + '</div>' +
            '<div class="v" style="font-size:19px">1 SAR = ' + D.RATES.SAR + ' · 1 USD = ' + D.RATES.USD + '</div>' +
            '<div class="w">' + esc(t('set_fx_sub')) + '</div></div>' +
        '</div>' +
        (can.write() ? '<div class="card" style="margin-top:16px"><div class="cardhead"><div><h2>' + esc(t('rem_log')) + '</h2></div></div>' +
          '<div class="grid k4">' +
            '<div class="field"><label>' + esc(t('original')) + '</label><input id="rAmt" class="input" inputmode="decimal" placeholder="5000"></div>' +
            '<div class="field"><label>' + esc(t('currency')) + '</label><select id="rCur" class="input"><option>SAR</option><option>USD</option><option>EGP</option></select></div>' +
            '<div class="field"><label>' + esc(t('rate')) + '</label><input id="rFx" class="input" inputmode="decimal" value="' + D.RATES.SAR + '"></div>' +
            '<div class="field"><label>' + esc(t('received_on')) + '</label><input id="rDate" class="input" type="date" value="2026-09-01"></div>' +
          '</div>' +
          '<div class="calcrow total"><span class="l">' + esc(t('in_egp')) + '</span><b id="rOut">' + money(0) + '</b></div>' +
          '<button class="btn" style="margin-top:12px" data-action="saveRem">' + esc(t('rem_log')) + '</button></div>' : '') +
        '<div class="card" style="margin-top:16px"><div class="tablewrap"><table>' +
          '<thead><tr><th>' + esc(t('received_on')) + '</th><th>' + esc(t('visit')) + '</th>' +
            '<th class="num">' + esc(t('original')) + '</th><th class="num">' + esc(t('rate')) + '</th>' +
            '<th class="num">' + esc(t('in_egp')) + '</th></tr></thead><tbody>' +
          rows.map(r => '<tr><td>' + esc(I.date(r.date, true)) + '</td><td>' + esc(t(r.visit)) + '</td>' +
            '<td class="num">' + I.n(r.amountOriginal) + ' ' + esc(r.currency) + '</td>' +
            '<td class="num">' + r.fx + '</td><td class="num"><b>' + money(r.amount) + '</b></td></tr>').join('') +
          '</tbody><tfoot><tr><td colspan="4">' + esc(t('total')) + '</td><td class="num">' + money(total) + '</td></tr></tfoot>' +
        '</table></div></div>';
    },
    after: function (page) {
      const calc = function () {
        const a = parseFloat((page.querySelector('#rAmt') || {}).value) || 0;
        const f = parseFloat((page.querySelector('#rFx') || {}).value) || 1;
        const out = page.querySelector('#rOut');
        if (out) out.textContent = money(Math.round(a * f));
      };
      ['#rAmt', '#rFx'].forEach(s => { const e = page.querySelector(s); if (e) e.addEventListener('input', calc); });
      const cur = page.querySelector('#rCur');
      if (cur) cur.addEventListener('change', function () {
        page.querySelector('#rFx').value = D.RATES[this.value]; calc();
      });
    }
  };

  /* Allowance */
  SCREENS.allowance = {
    html: function () {
      const recips = D.people.filter(p => p.allowance > 0);
      const monthNow = 9;
      const totalMonthly = recips.reduce((s, p) => s + p.allowance, 0);
      const paidThis = id => D.allowances.some(a => a.person === id && a.month === monthNow);
      const anyDue = recips.some(p => !paidThis(p.id));

      return '<p class="lead">' + esc(t('allow_sub')) + '</p>' +
        '<div class="grid k3">' +
          '<div class="card hero kpi"><div class="k">' + esc(t('total_monthly')) + '</div><div class="v">' + money(totalMonthly) + '</div>' +
            '<div class="w">' + I.n(recips.length) + ' × ' + esc(t('recipient')) + '</div></div>' +
          '<div class="card kpi"><div class="k">' + esc(t('this_month')) + ' · ' + esc(I.monthLabel(monthNow, true)) + '</div>' +
            '<div class="v">' + I.n(recips.filter(p => paidThis(p.id)).length) + ' / ' + I.n(recips.length) + '</div>' +
            '<div class="w">' + esc(anyDue ? t('mark_paid') : t('all_paid')) + '</div></div>' +
          '<div class="card kpi"><div class="k">' + esc(t('logs_spending')) + '</div><div class="v">2 / ' + I.n(recips.length) + '</div>' +
            '<div class="w">' + esc(pname('zeyad')) + ' · ' + esc(pname('rewan')) + '</div></div>' +
        '</div>' +
        (can.write() && anyDue ? '<button class="btn" style="margin-top:16px" data-action="payAll">' + esc(t('pay_all')) + '</button>' : '') +
        '<div class="card" style="margin-top:16px"><div class="tablewrap"><table>' +
          '<thead><tr><th>' + esc(t('recipient')) + '</th><th>' + esc(t('person')) + '</th>' +
            '<th class="num">' + esc(t('monthly')) + '</th><th>' + esc(t('this_month')) + '</th>' +
            '<th class="num">' + esc(t('balance')) + '</th>' + (can.write() ? '<th></th>' : '') + '</tr></thead><tbody>' +
          recips.map(p => {
            const logs = p.role === 'member';
            const s = logs ? memberSummary(p.id) : null;
            const done = paidThis(p.id);
            return '<tr><td><span style="display:inline-flex;align-items:center;gap:8px">' +
                '<span class="avatar sm" style="background:' + hue(p) + '">' + esc(p.initials) + '</span>' + esc(pname(p.id)) + '</span></td>' +
              '<td><span class="pill">' + esc(t('r_' + p.rel)) + '</span> ' +
                '<span class="pill">' + esc(logs ? t('logs_spending') : t('receives_only')) + '</span></td>' +
              '<td class="num">' + money(p.allowance) + '</td>' +
              '<td><span class="pill ' + (done ? 'ok' : 'due') + '">' + esc(done ? t('paid') : t('mark_paid')) + '</span></td>' +
              '<td class="num">' + (s ? money(s.balance) : '—') + '</td>' +
              (can.write() ? '<td>' + (done ? '' :
                '<button class="btn ghost sm" data-action="pay" data-id="' + p.id + '">' + esc(t('mark_paid')) + '</button>') + '</td>' : '') +
            '</tr>';
          }).join('') +
          '</tbody><tfoot><tr><td colspan="2">' + esc(t('total_monthly')) + '</td><td class="num">' + money(totalMonthly) + '</td>' +
            '<td colspan="' + (can.write() ? 3 : 2) + '"></td></tr></tfoot></table></div></div>';
    }
  };

  /* My spending */
  SCREENS.myspending = {
    html: function () {
      const id = state.user.id, s = memberSummary(id);
      const mine = D.memberTx.filter(m => m.person === id).sort(byDateDesc);
      const slices = donutSlices(catTotals(mine));
      return '<p class="lead">' + esc(t('my_sub')) + '</p>' +
        '<div class="grid k3">' +
          '<div class="card hero kpi"><div class="k">' + esc(t('my_balance')) + '</div><div class="v">' + money(s.balance) + '</div>' +
            '<div class="w">' + esc(t('my_received')) + ' − ' + esc(t('my_spent')) + '</div></div>' +
          '<div class="card kpi"><div class="k">' + esc(t('my_received')) + '</div><div class="v plus">' + money(s.received) + '</div></div>' +
          '<div class="card kpi"><div class="k">' + esc(t('my_spent')) + '</div><div class="v minus">' + money(s.spent) + '</div></div>' +
        '</div>' +
        '<div class="grid split" style="margin-top:16px">' +
          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('my_history')) + '</h2></div><div class="spacer"></div>' +
            '<button class="btn sm" data-action="go" data-s="add">' + esc(t('log_expense')) + '</button></div>' +
            '<div class="txlist">' + mine.slice(0, 18).map(memberRow).join('') + '</div></div>' +
          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('habits')) + '</h2></div></div>' +
            '<div id="mineDonut"></div>' + legendHtml(slices) + '</div>' +
        '</div>';
    },
    after: function () {
      const id = state.user.id;
      Ch.donut(document.getElementById('mineDonut'), {
        slices: donutSlices(catTotals(D.memberTx.filter(m => m.person === id))),
        fmt: v => money(v), centerLabel: t('total')
      });
    }
  };

  /* Car */
  SCREENS.car = {
    html: function () {
      const open = D.settlements.filter(s => s.status === 'open')[0] || D.settlements[D.settlements.length - 1];
      const done = D.settlements.filter(s => s.status === 'settled').sort((a, b) => b.month - a.month);
      const row = (label, value, cls) =>
        '<div class="calcrow ' + (cls || '') + '"><span class="l">' + esc(label) + '</span><b>' + money(value) + '</b></div>';

      return '<p class="lead">' + esc(t('car_sub')) + '</p>' +
        '<div class="grid split">' +
          '<div class="card"><div class="cardhead"><div><h2>' + esc(I.monthLabel(open.month, true)) + ' 2026</h2>' +
            '<div class="sub">' + esc(t('car_calc')) + '</div></div><div class="spacer"></div>' +
            '<span class="pill ' + (open.status === 'open' ? 'warn' : 'ok') + '">' +
              esc(open.status === 'open' ? t('open_period') : t('settled')) + '</span></div>' +
            (can.write() && open.status === 'open'
              ? '<div class="field"><label>' + esc(t('gross')) + '</label>' +
                  '<input id="cGross" class="input" inputmode="decimal" value="' + open.gross + '"></div>'
              : row(t('gross'), open.gross)) +
            '<div id="cCalc">' + carCalc(open) + '</div>' +
            (can.write() && open.status === 'open'
              ? '<button class="btn" style="width:100%;margin-top:14px" data-action="settle" data-id="' + open.id + '">' + esc(t('settle')) + '</button>'
              : '') +
          '</div>' +
          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('car_expenses')) + '</h2>' +
            '<div class="sub">' + esc(I.monthLabel(open.month, true)) + ' 2026</div></div></div>' +
            '<div class="stack">' + open.expenses.map(e =>
              '<div class="rowline"><div class="dot" style="background:var(--neutral)">' + esc(t(e.kind).slice(0, 2)) + '</div>' +
                '<div class="m"><div class="n">' + esc(t(e.kind)) + '</div><div class="w">' + esc(I.date(e.date)) + '</div></div>' +
                '<div class="amt minus">−' + money(e.amount) + '</div></div>').join('') + '</div>' +
            '<div class="calcrow total"><span class="l">' + esc(t('car_expenses')) + '</span><b>' + money(open.spent) + '</b></div>' +
          '</div>' +
        '</div>' +
        '<div class="card" style="margin-top:16px"><div class="cardhead"><div><h2>' + esc(t('car_history')) + '</h2></div></div>' +
          '<div class="tablewrap"><table><thead><tr><th>' + esc(t('period')) + '</th>' +
            '<th class="num">' + esc(t('gross')) + '</th><th class="num">' + esc(t('uncle_share')) + '</th>' +
            '<th class="num">' + esc(t('car_expenses')) + '</th><th class="num">' + esc(t('profit')) + '</th>' +
            '<th class="num">' + esc(t('family_share')) + '</th><th class="num">' + esc(t('marwa_share')) + '</th>' +
            '<th>' + esc(t('status')) + '</th></tr></thead><tbody>' +
          done.map(s => '<tr><td>' + esc(I.monthLabel(s.month, true)) + ' 2026</td>' +
            '<td class="num">' + money(s.gross) + '</td><td class="num">' + money(s.uncle) + '</td>' +
            '<td class="num">' + money(s.spent) + '</td><td class="num">' + money(s.profit) + '</td>' +
            '<td class="num"><b>' + money(s.family) + '</b></td><td class="num">' + money(s.marwa) + '</td>' +
            '<td><span class="pill ok">' + esc(t('settled')) + '</span></td></tr>').join('') +
          '</tbody></table></div></div>';
    },
    after: function (page) {
      const g = page.querySelector('#cGross');
      if (!g) return;
      const open = D.settlements.filter(s => s.status === 'open')[0];
      g.addEventListener('input', function () {
        const gross = Math.max(0, parseFloat(this.value) || 0);
        page.querySelector('#cCalc').innerHTML = carCalc(Object.assign({}, open, recompute(open, gross)));
      });
    }
  };

  function recompute(s, gross) {
    const uncle = Math.round(gross / 3), pool = gross - uncle;
    const profit = pool - s.spent, family = Math.round(profit * 0.75);
    return { gross, uncle, pool, profit, family, marwa: profit - family };
  }

  function carCalc(s) {
    const row = (label, value, cls) =>
      '<div class="calcrow ' + (cls || '') + '"><span class="l">' + esc(label) + '</span><b>' + money(value) + '</b></div>';
    return row(t('uncle_share'), s.uncle, 'out') +
           row(t('operating_pool'), s.pool) +
           row(t('car_expenses'), s.spent, 'out') +
           row(t('profit'), s.profit) +
           '<div class="calcrow total in"><span class="l">' + esc(t('family_share')) + '</span><b>' + money(s.family) + '</b></div>' +
           row(t('marwa_share'), s.marwa, 'out');
  }

  /* Loans */
  SCREENS.loans = {
    html: function () {
      const owed = D.loans.reduce((s, l) => s + (l.amount - l.payments.reduce((a, p) => a + p.amount, 0)), 0);
      return '<p class="lead">' + esc(t('loan_sub')) + '</p>' +
        '<div class="grid k3"><div class="card hero kpi"><div class="k">' + esc(t('total_owed')) + '</div>' +
          '<div class="v">' + money(owed) + '</div><div class="w">' + I.n(D.loans.length) + ' × ' + esc(t('borrowed')) + '</div></div></div>' +
        (D.loans.length ? D.loans.map(loanCard).join('') :
          '<div class="card" style="margin-top:16px"><div class="empty">' + esc(t('no_loans')) + '</div></div>');
    }
  };

  function loanCard(l) {
    const repaid = l.payments.reduce((s, p) => s + p.amount, 0);
    const left = l.amount - repaid;
    const status = left <= 0 ? 'repaid' : (repaid > 0 ? 'partial' : 'outstanding');
    return '<div class="card" style="margin-top:16px"><div class="cardhead">' +
      '<div><h2>' + esc(l.lender) + '</h2><div class="sub">' + esc(t(l.note)) + ' · ' +
        esc(t('taken_on')) + ' ' + esc(I.date(l.date, true)) + '</div></div><div class="spacer"></div>' +
      '<span class="pill ' + (status === 'repaid' ? 'ok' : 'warn') + '">' + esc(t(status)) + '</span></div>' +
      '<div class="grid k3">' +
        '<div class="kpi"><div class="k">' + esc(t('borrowed')) + '</div><div class="v" style="font-size:20px">' + money(l.amount) + '</div></div>' +
        '<div class="kpi"><div class="k">' + esc(t('repayments')) + '</div><div class="v plus" style="font-size:20px">' + money(repaid) + '</div></div>' +
        '<div class="kpi"><div class="k">' + esc(t('remaining')) + '</div><div class="v minus" style="font-size:20px">' + money(left) + '</div></div>' +
      '</div>' +
      '<div class="stack" style="margin-top:16px">' + (l.payments.length ? l.payments.map(p =>
        '<div class="rowline"><div class="m"><div class="n">' + esc(t('add_repayment')) + '</div>' +
          '<div class="w">' + esc(I.date(p.date, true)) + '</div></div>' +
          '<div class="amt plus">' + money(p.amount) + '</div></div>').join('') :
        '<div class="empty">' + esc(t('none')) + '</div>') + '</div>' +
      (can.write() && left > 0 ?
        '<div class="grid k3" style="margin-top:14px;align-items:end">' +
          '<div class="field"><label>' + esc(t('amount_egp')) + '</label>' +
            '<input class="input" id="lp_' + l.id + '" inputmode="decimal" placeholder="5000"></div>' +
          '<div><button class="btn" data-action="repay" data-id="' + l.id + '">' + esc(t('add_repayment')) + '</button></div>' +
        '</div>' : '') +
    '</div>';
  }

  /* History */
  SCREENS.history = {
    html: function () {
      const f = state.filters;
      const mine = can.member();
      const source = mine
        ? D.memberTx.filter(m => m.person === state.user.id)
            .map(m => ({ id:m.id, type:'expense', cat:m.cat, amount:m.amount, date:m.date, note:m.note, forWhom:state.user.id, currency:'EGP' }))
        : D.tx;

      let list = source.filter(x => {
        if (f.type !== 'all' && x.type !== f.type) return false;
        if (f.cat !== 'all' && x.cat !== f.cat) return false;
        if (f.person !== 'all' && x.forWhom !== f.person) return false;
        if (f.q) {
          const hay = (t(x.note) + ' ' + cname(x.cat) + ' ' + (x.forWhom ? pname(x.forWhom) : '')).toLowerCase();
          if (hay.indexOf(f.q.toLowerCase()) < 0) return false;
        }
        return true;
      });

      const cats = D.categories.filter(c => source.some(x => x.cat === c.id));
      const persons = D.people.filter(p => source.some(x => x.forWhom === p.id));
      const chip = (action, val, cur, label) =>
        '<button class="chip ' + (cur === val ? 'on' : '') + '" data-action="' + action + '" data-v="' + val + '">' + esc(label) + '</button>';

      return '<div class="card"><input id="fq" class="input" placeholder="' + esc(t('search_ph')) + '" value="' + esc(f.q) + '">' +
          '<div style="margin-top:12px" class="chips">' +
            chip('fType','all',f.type,t('all')) + chip('fType','income',f.type,t('income')) + chip('fType','expense',f.type,t('expense')) +
          '</div>' +
          '<div style="margin-top:8px" class="chips">' + chip('fCat','all',f.cat,t('filter_cat')) +
            cats.map(c => chip('fCat', c.id, f.cat, cname(c.id))).join('') + '</div>' +
          (mine ? '' : '<div style="margin-top:8px" class="chips">' + chip('fPerson','all',f.person,t('filter_person')) +
            persons.map(p => chip('fPerson', p.id, f.person, pname(p.id))).join('') + '</div>') +
          '<div style="margin-top:12px;display:flex;align-items:center;gap:10px">' +
            '<span class="pill">' + esc(t('results_count', { n: I.n(list.length) })) + '</span>' +
            '<span class="pill">' + esc(t('total')) + ': ' + money(sum(list)) + '</span>' +
            '<button class="btn ghost sm" data-action="clearF">' + esc(t('clear_filters')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="card" style="margin-top:16px">' + groupedByDay(list) + '</div>';
    },
    after: function (page) {
      const q = page.querySelector('#fq');
      q.addEventListener('input', function () {
        state.filters.q = this.value;
        const pos = this.selectionStart;
        renderShell();
        const n = document.getElementById('fq');
        n.focus(); n.setSelectionRange(pos, pos);
      });
    }
  };

  /* Reports */
  SCREENS.reports = {
    html: function () {
      const m = monthTotals();
      const labels = m.map(x => I.monthLabel(x.m));
      const slices = donutSlices(catTotals(expense().filter(x => MONTHS.indexOf(x.date.getMonth() + 1) >= 0)));

      const byPerson = {};
      expense().forEach(x => {
        const k = x.forWhom || '_household';
        byPerson[k] = (byPerson[k] || 0) + x.amount;
      });
      const rows = Object.keys(byPerson).map(k => ({
        k, label: k === '_household' ? t('household') : pname(k),
        value: byPerson[k], color: k === '_household' ? hue(cat('other')) : hue(person(k))
      })).sort((a, b) => b.value - a.value);
      const peak = rows[0].value;

      let run = 0;
      const trend = m.map(x => { run += x.income - x.expense; return Math.max(0, run); });

      return '<div class="grid k2">' +
          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('rep_inc_exp')) + '</h2>' +
            '<div class="sub">' + esc(t('rep_inc_exp_sub')) + '</div></div><div class="spacer"></div>' + tableToggle('inc') + '</div>' +
            '<div class="chartlegend" style="margin-bottom:8px">' +
              '<span><i style="background:' + Ch.theme().income + '"></i>' + esc(t('income')) + '</span>' +
              '<span><i style="background:' + Ch.theme().expense + '"></i>' + esc(t('expense')) + '</span></div>' +
            '<div id="cIncExp"></div>' +
            tableBox('inc', '<table><thead><tr><th>' + esc(t('period')) + '</th><th class="num">' + esc(t('income')) +
              '</th><th class="num">' + esc(t('expense')) + '</th><th class="num">' + esc(t('net_period')) + '</th></tr></thead><tbody>' +
              m.map(x => '<tr><td>' + esc(I.monthLabel(x.m, true)) + '</td><td class="num">' + money(x.income) +
                '</td><td class="num">' + money(x.expense) + '</td><td class="num">' + money(x.income - x.expense, { signed: true }) + '</td></tr>').join('') +
              '</tbody></table>') + '</div>' +

          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('rep_cat')) + '</h2>' +
            '<div class="sub">' + esc(t('rep_cat_sub')) + '</div></div></div>' +
            '<div id="cDonut"></div>' + legendHtml(slices) + '</div>' +

          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('rep_trend')) + '</h2>' +
            '<div class="sub">' + esc(t('rep_trend_sub')) + '</div></div><div class="spacer"></div>' + tableToggle('tr') + '</div>' +
            '<div id="cTrend"></div>' +
            tableBox('tr', '<table><thead><tr><th>' + esc(t('period')) + '</th><th class="num">' + esc(t('cash_on_hand')) +
              '</th></tr></thead><tbody>' + m.map((x, i) => '<tr><td>' + esc(I.monthLabel(x.m, true)) +
              '</td><td class="num">' + money(trend[i]) + '</td></tr>').join('') + '</tbody></table>') + '</div>' +

          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('rep_person')) + '</h2>' +
            '<div class="sub">' + esc(t('rep_person_sub')) + '</div></div></div>' +
            '<div class="bars">' + rows.map(r =>
              '<div class="barrow"><span class="who">' + esc(r.label) + '</span>' +
                '<span class="track"><i style="width:' + (r.value / peak * 100).toFixed(1) + '%;background:' + r.color + '"></i></span>' +
                '<b>' + money(r.value) + '</b></div>').join('') + '</div></div>' +
        '</div>';
    },
    after: function () {
      const m = monthTotals();
      const labels = m.map(x => I.monthLabel(x.m));
      Ch.columns(document.getElementById('cIncExp'), {
        labels, income: m.map(x => x.income), expense: m.map(x => x.expense),
        fmt: v => money(v), tick: v => short(v),
        legend: { income: t('income'), expense: t('expense') }
      });
      Ch.donut(document.getElementById('cDonut'), {
        slices: donutSlices(catTotals(expense().filter(x => MONTHS.indexOf(x.date.getMonth() + 1) >= 0))),
        fmt: v => money(v), centerLabel: t('total')
      });
      let run = 0;
      Ch.line(document.getElementById('cTrend'), {
        labels, values: m.map(x => { run += x.income - x.expense; return Math.max(0, run); }),
        fmt: v => money(v), tick: v => short(v), name: t('cash_on_hand')
      });
    }
  };

  /* People */
  SCREENS.people = {
    html: function () {
      return '<p class="lead">' + esc(t('ppl_sub')) + '</p>' +
        '<div class="grid split">' +
          '<div class="card"><div class="tablewrap"><table><thead><tr>' +
            '<th>' + esc(t('person')) + '</th><th>' + esc(t('r_mother')) + '</th><th>' + esc(t('role_admin')) + '</th>' +
            '<th>' + esc(t('can_sign_in')) + '</th><th class="num">' + esc(t('gets_allowance')) + '</th></tr></thead><tbody>' +
            D.people.map(p => '<tr>' +
              '<td><span style="display:inline-flex;align-items:center;gap:8px">' +
                '<span class="avatar sm" style="background:' + hue(p) + '">' + esc(p.initials) + '</span>' + esc(pname(p.id)) + '</span></td>' +
              '<td>' + esc(t('r_' + p.rel)) + '</td>' +
              '<td>' + (p.role ? '<span class="pill ' + p.role + '">' + esc(t('role_' + p.role)) + '</span>' :
                '<span class="pill">' + esc(t('beneficiary')) + '</span>') + '</td>' +
              '<td>' + (p.isUser ? '<span class="pill ok">' + esc(t('can_sign_in')) + '</span>' : '—') + '</td>' +
              '<td class="num">' + (p.allowance ? money(p.allowance) : '—') + '</td></tr>').join('') +
          '</tbody></table></div></div>' +
          '<div><div class="invite"><div class="c">SMBZ-7420</div><div class="t">' + esc(t('invite_hint')) + '</div></div>' +
            '<div class="card" style="margin-top:16px"><div class="cardhead"><div><h2>' + esc(t('add_person')) + '</h2>' +
              '<div class="sub">' + esc(t('ppl_sub')).slice(0, 90) + '…</div></div></div>' +
              '<div class="field"><label>' + esc(t('person')) + '</label><input class="input" placeholder="' + esc(t('add_person')) + '"></div>' +
              '<div class="field" style="margin-top:12px"><label>' + esc(t('role_admin')) + '</label>' +
                '<select class="input"><option>' + esc(t('role_member')) + '</option><option>' + esc(t('role_viewer')) + '</option>' +
                '<option>' + esc(t('beneficiary')) + '</option></select></div>' +
              '<button class="btn" style="margin-top:14px;width:100%" disabled>' + esc(t('add_person')) + '</button></div></div>' +
        '</div>';
    }
  };

  /* Settings */
  SCREENS.settings = {
    html: function () {
      const qs = ['q1','q2','q3','q4','q5','q6','q7','q8','q9'];
      return '<div class="grid split">' +
        '<div class="card"><div class="cardhead"><div><h2>' + esc(t('set_open')) + '</h2>' +
          '<div class="sub">' + esc(t('set_open_sub')) + '</div></div></div>' +
          '<div class="qlist">' + qs.map((q, i) =>
            '<div class="qitem"><span class="no">' + (i + 1) + '</span><span>' + esc(t(q)) + '</span></div>').join('') + '</div></div>' +
        '<div>' +
          '<div class="card"><div class="cardhead"><div><h2>' + esc(t('set_cats')) + '</h2>' +
            '<div class="sub">' + esc(t('set_cats_sub')) + '</div></div></div>' +
            '<div class="chips">' + D.categories.filter(c => c.kind === 'expense').map(c =>
              '<span class="chip"><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' +
              hue(c) + ';margin-inline-end:6px"></i>' + esc(cname(c.id)) + '</span>').join('') + '</div></div>' +
          '<div class="card" style="margin-top:16px"><div class="cardhead"><div><h2>' + esc(t('set_fx')) + '</h2>' +
            '<div class="sub">' + esc(t('set_fx_sub')) + '</div></div></div>' +
            '<div class="calcrow"><span class="l">1 SAR</span><b>' + I.n(D.RATES.SAR * 100) / 100 + ' ' + esc(t('egp')) + '</b></div>' +
            '<div class="calcrow"><span class="l">1 USD</span><b>' + D.RATES.USD + ' ' + esc(t('egp')) + '</b></div></div>' +
          '<div class="card" style="margin-top:16px"><div class="cardhead"><div><h2>' + esc(t('set_lang')) + '</h2></div>' +
            '<div class="spacer"></div>' + langToggle() + '</div>' +
            '<div class="calcrow"><span class="l">' + esc(t('set_export')) + '</span>' +
              '<span class="pill warn">' + esc(t('set_export_sub')) + '</span></div></div>' +
        '</div></div>';
    }
  };

  /* ── actions ───────────────────────────────────────────────────────── */
  const parseDate = v => { const p = String(v).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };

  const ACTIONS = {
    theme: function () {
      const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('samboza-theme', next); } catch (e) { /* private mode */ }
      render();
    },
    lang: function (el) {
      I.set(el.dataset.l);
      document.documentElement.lang = I.lang;
      document.documentElement.dir = I.isRTL() ? 'rtl' : 'ltr';
      render();
    },
    signin: function (el) { state.user = person(el.dataset.id); state.screen = 'dashboard'; render(); },
    signout: function () { state.user = null; render(); },
    go: function (el) { state.screen = el.dataset.s; state.filters = { q:'', type:'all', cat:'all', person:'all' }; renderShell(); },
    type: function (el) { state.addType = el.dataset.v; state.addCat = null; state.addCurrency = 'EGP'; renderShell(); },
    cat: function (el) { state.addCat = el.dataset.c; renderShell(); },
    table: function (el) { state.tables[el.dataset.id] = !state.tables[el.dataset.id]; renderShell(); },
    fType: function (el) { state.filters.type = el.dataset.v; renderShell(); },
    fCat: function (el) { state.filters.cat = el.dataset.v; renderShell(); },
    fPerson: function (el) { state.filters.person = el.dataset.v; renderShell(); },
    clearF: function () { state.filters = { q:'', type:'all', cat:'all', person:'all' }; renderShell(); },

    save: function () {
      const err = document.getElementById('fErr');
      const amtEl = document.getElementById('fAmount');
      const v = parseFloat(amtEl.value);
      const fail = msg => { err.hidden = false; err.textContent = msg; amtEl.classList.add('err'); };
      err.hidden = true; amtEl.classList.remove('err');
      if (!(v > 0)) return fail(t('err_amount'));
      if (!state.addCat) return fail(t('err_cat'));

      const date = parseDate(document.getElementById('fDate').value);
      const note = document.getElementById('fNote').value.trim();

      if (can.member()) {
        D.memberTx.push({ id: D.uid('mx'), person: state.user.id, cat: state.addCat,
                          amount: Math.round(v), date, note: note || 'n_other_note' });
      } else {
        const cur = state.addCurrency, fx = D.RATES[cur];
        D.add({ type: state.addType, cat: state.addCat, amount: Math.round(v * fx),
                amountOriginal: Math.round(v), currency: cur, fx, date,
                forWhom: document.getElementById('fWhom').value || null,
                note: note || 'n_other_note' });
      }
      state.addCat = null; state.addCurrency = 'EGP';
      state.screen = can.member() ? 'myspending' : 'history';
      renderShell();
      toast(t('saved'));
    },

    saveRem: function () {
      const a = parseFloat(document.getElementById('rAmt').value);
      if (!(a > 0)) return toast(t('err_amount'));
      const cur = document.getElementById('rCur').value;
      const fx = parseFloat(document.getElementById('rFx').value) || 1;
      const date = parseDate(document.getElementById('rDate').value);
      const r = { id: D.uid('r'), amountOriginal: Math.round(a), currency: cur, fx, date,
                  visit: 'n_visit_new', amount: Math.round(a * fx), by: 'abdo' };
      D.remittances.push(r);
      D.add({ type:'income', cat:'remittance', amount:r.amount, amountOriginal:r.amountOriginal,
              currency:cur, fx, date, note:'n_visit_new', forWhom:'mother', src:r.id });
      renderShell(); toast(t('saved'));
    },

    pay: function (el) { payOne(el.dataset.id); renderShell(); toast(t('saved')); },
    payAll: function () {
      D.people.filter(p => p.allowance > 0).forEach(p => payOne(p.id));
      renderShell(); toast(t('saved'));
    },

    settle: function (el) {
      const s = D.settlements.find(x => x.id === el.dataset.id);
      const g = document.getElementById('cGross');
      if (g) Object.assign(s, recompute(s, Math.max(0, parseFloat(g.value) || 0)));
      s.status = 'settled';
      D.add({ type:'income', cat:'carprofit', amount:s.family, date:D.TODAY, note:'n_car_share', src:s.id });
      renderShell(); toast(t('settled'));
    },

    repay: function (el) {
      const l = D.loans.find(x => x.id === el.dataset.id);
      const input = document.getElementById('lp_' + l.id);
      const v = parseFloat(input.value);
      const left = l.amount - l.payments.reduce((s, p) => s + p.amount, 0);
      if (!(v > 0)) return toast(t('err_amount'));
      const amount = Math.min(Math.round(v), left);
      l.payments.push({ id: D.uid('lp'), amount, date: D.TODAY });
      if (amount >= left) l.status = 'repaid';
      D.add({ type:'expense', cat:'loanrepay', amount, date:D.TODAY, note:'n_loan_out', src:l.id });
      renderShell(); toast(t('saved'));
    }
  };

  function payOne(id) {
    const p = person(id);
    if (D.allowances.some(a => a.person === id && a.month === 9)) return;
    D.allowances.push({ id: D.uid('a'), person: id, amount: p.allowance, month: 9, paidOn: D.TODAY, paidBy: 'abdo' });
    D.add({ type:'expense', cat:'allowance', amount:p.allowance, forWhom:id, date:D.TODAY, note:'n_allowance' });
  }

  let toastTimer;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1900);
  }

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });

  function render() { state.user ? renderShell() : renderAuth(); }

  // Follow the OS only while the viewer has made no explicit choice.
  prefersDark.addEventListener('change', function () {
    if (!document.documentElement.dataset.theme) render();
  });

  render();
})();
