import { icon, ICON_CHOICES } from './icons.js';
import { supabaseDB, memoryDB } from './db.js';
import { demoSeed } from './demo.js';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const fmt = n => (n < 0 ? '−' : '') + '₹' + INR.format(Math.abs(Math.round(n || 0)));
const fmtK = n => { const a = Math.abs(n), s = n < 0 ? '−' : ''; if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr'; if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L'; return fmt(n); };
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoOf(new Date());
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d); };
const thisMonth = () => today().slice(0, 7);
const addM = (m, k) => { let [y, mo] = m.split('-').map(Number); mo += k; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return `${y}-${pad(mo)}`; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const mLabel = m => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
const mShort = m => { const [, mo] = m.split('-').map(Number); return MONTHS[mo - 1].slice(0, 3); };
const dayLabel = d => { if (d === today()) return 'Today'; if (d === yesterday()) return 'Yesterday'; return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); };
const num = v => { const n = parseFloat(String(v ?? '').replace(/[,₹\s]/g, '')); return isNaN(n) ? 0 : n; };
const ls = { get(k, d) { try { const v = localStorage.getItem('nest.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('nest.' + k, JSON.stringify(v)); } catch (e) {} } };
const KIND = { spent: 'Spent', in: 'Came in', saved: 'Saved' };
const SWATCHES = ['#5A4FF0', '#2F7BEA', '#0E9F9A', '#1F9D55', '#C99412', '#EA6C2B', '#DF4652', '#D2459B', '#8D5CF6', '#6B7394', '#0A95C9', '#9C6B2E'];

/* ---------- state ---------- */
const S = {
  db: null, client: null, mode: 'boot', email: '', person: 'me',
  people: { me: 'Me', trisha: 'Trisha' }, paidWith: [], skipWords: [],
  cats: [], goals: [], entries: [], presets: [], rules: [],
  view: ls.get('view', 'together'), month: thisMonth(),
  tab: 'home', q: '', kindFilter: 'all', catFilter: '',
  imp: null
};
const TABS = ['home', 'entries', 'import', 'more'];
const VIEWS = () => [['together', 'Together'], ['me', S.people.me], ['trisha', S.people.trisha], ['business', 'Business']];
const whoName = w => w === 'me' ? S.people.me : w === 'trisha' ? S.people.trisha : 'Joint';
const UNCAT = { id: '', name: 'No category', icon: 'dots', color: '#8A90AD', kind: 'spent', scope: 'home', budget: 0 };
const catOf = id => S.cats.find(c => c.id === id) || UNCAT;
const goalOf = id => S.goals.find(g => g.id === id);
const scopeOfView = (v = S.view) => v === 'business' ? 'business' : 'home';
function inView(e, v = S.view) {
  if (v === 'business') return e.scope === 'business';
  if (e.scope === 'business') return false;
  if (v === 'together') return true;
  return e.who === v;
}
const monthEntries = (m = S.month, v = S.view) => S.entries.filter(e => (e.date || '').startsWith(m) && inView(e, v));
function totals(list) {
  const t = { in: 0, spent: 0, saved: 0, byCat: {} };
  for (const e of list) { const a = +e.amount || 0; t[e.kind] += a; if (e.kind === 'spent') t.byCat[e.category_id || ''] = (t.byCat[e.category_id || ''] || 0) + a; }
  return t;
}
const goalSaved = g => (+g.start_amount || 0) + S.entries.filter(e => e.kind === 'saved' && e.goal_id === g.id).reduce((s, e) => s + (+e.amount || 0), 0);
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || String(b.created_at || '').localeCompare(String(a.created_at || ''));
const activeCats = (kind, scope) => S.cats.filter(c => !c.archived && c.kind === kind && c.scope === scope).sort((a, b) => (a.sort || 0) - (b.sort || 0));

/* ---------- boot ---------- */
async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  const params = new URLSearchParams(location.search);
  const h = location.hash.slice(1); if (TABS.includes(h)) S.tab = h;
  if (params.has('demo')) { S.db = memoryDB(demoSeed()); S.mode = 'demo'; S.email = 'demo'; await loadAll(); return; }
  const cfg = window.NEST_CONFIG || {};
  const url = cfg.supabaseUrl || ls.get('sbUrl', ''), key = cfg.supabaseKey || ls.get('sbKey', '');
  if (!url || !key) { S.mode = 'setup'; return drawShell(); }
  if (!window.supabase) { S.mode = 'error'; S.error = 'Could not load the sign-in library. Check your internet connection and reload.'; return drawShell(); }
  S.client = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  S.db = supabaseDB(S.client);
  const { data } = await S.client.auth.getSession();
  if (!data.session) { S.mode = 'login'; return drawShell(); }
  await afterLogin(data.session);
}
async function afterLogin(session) {
  S.email = (session.user.email || '').toLowerCase();
  try {
    const me = (await S.db.all('members')).find(m => m.email.toLowerCase() === S.email);
    if (!me) { S.mode = 'notmember'; return drawShell(); }
    S.person = me.person;
  } catch (e) { S.mode = 'error'; S.error = 'Could not reach your database. ' + (e.message || ''); return drawShell(); }
  await loadAll();
  S.db.subscribe(() => { clearTimeout(S._rt); S._rt = setTimeout(refresh, 400); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}
async function loadAll() {
  try {
    const [cats, goals, entries, presets, rules, settings] = await Promise.all(['categories', 'goals', 'entries', 'presets', 'rules', 'settings'].map(t => S.db.all(t)));
    S.cats = cats; S.goals = goals.sort((a, b) => (a.sort || 0) - (b.sort || 0)); S.entries = entries; S.presets = presets.sort((a, b) => (a.sort || 0) - (b.sort || 0)); S.rules = rules;
    const st = Object.fromEntries(settings.map(s => [s.key, s.value]));
    S.people = { me: 'Me', trisha: 'Trisha', ...(st.people || {}) };
    S.paidWith = st.paid_with || []; S.skipWords = st.skip_words || [];
    if (S.mode !== 'demo') S.mode = 'live';
    if (!VIEWS().some(v => v[0] === S.view)) S.view = 'together';
  } catch (e) { S.mode = 'error'; S.error = 'Could not load your data. ' + (e.message || ''); }
  drawShell();
}
async function refresh() {
  if (S.mode !== 'live') return;
  try { const [entries, goals] = await Promise.all([S.db.all('entries'), S.db.all('goals')]); S.entries = entries; S.goals = goals.sort((a, b) => (a.sort || 0) - (b.sort || 0)); render(); } catch (e) {}
}

/* ---------- render ---------- */
let rq = 0;
function render() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; draw(); }); }
function drawShell() { draw(); }
function draw() {
  const app = $('#app'), tb = $('#tabbarWrap');
  if (['setup', 'login', 'notmember', 'error', 'boot'].includes(S.mode)) { tb.hidden = true; app.innerHTML = gateView(); return; }
  tb.hidden = false;
  let h = topBar();
  if (S.tab === 'home') h += viewHome();
  else if (S.tab === 'entries') h += viewEntries();
  else if (S.tab === 'import') h += viewImport();
  else h += viewMore();
  app.innerHTML = h;
  $('#tabbar').innerHTML = tabBar();
  if (S.tab === 'import') mountImport();
}
function gateView() {
  const brand = `<div class="mark">${icon('leaf')}</div>`;
  if (S.mode === 'boot') return `<div class="skel"></div>`;
  if (S.mode === 'setup') return `<div class="login">${brand}<h1>Connect Nest</h1><p>Paste your Supabase project URL and anon key. You'll find both in Supabase under Project Settings → API. This is only needed until they're saved in config.js.</p>
    <div class="field"><label for="su-url">Project URL</label><input class="inp" id="su-url" placeholder="https://xxxx.supabase.co" autocomplete="off"></div>
    <div class="field"><label for="su-key">Anon / publishable key</label><input class="inp" id="su-key" placeholder="eyJ… or sb_publishable_…" autocomplete="off"></div>
    <button class="btn primary block" data-act="setup">Connect</button>
    <a class="link" href="?demo">Try it with example data first</a></div>`;
  if (S.mode === 'login') return `<div class="login">${brand}<h1>Nest</h1><p>What came in, what we spent, what we saved.</p>
    <form id="login" class="field" style="gap:10px">
      <div class="field"><label for="li-email">Email</label><input class="inp" id="li-email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="li-pass">Password</label><input class="inp" id="li-pass" type="password" autocomplete="current-password" required></div>
      <button class="btn primary block" type="submit" id="li-go">Sign in</button>
      <p class="small" id="li-err" role="alert"></p>
    </form></div>`;
  if (S.mode === 'notmember') return `<div class="login">${brand}<h1>Not on the list</h1><p>${esc(S.email)} can sign in but isn't on Nest's members list, so no data is shown. Add this email to the members table in Supabase, then sign in again.</p><button class="btn block" data-act="signout">Sign out</button></div>`;
  return `<div class="login">${brand}<h1>Something went wrong</h1><p>${esc(S.error || '')}</p><button class="btn primary block" onclick="location.reload()">Try again</button></div>`;
}
function topBar() {
  const sub = { home: 'Overview', entries: 'All entries', import: 'Import statements', more: 'Settings' }[S.tab];
  let h = `<header class="top"><div class="brand"><div class="mark">${icon('leaf', 'sm')}</div><div><b>Nest</b><small>${sub}</small></div></div>
    <button class="iconbtn" data-act="add" aria-label="Add an entry">${icon('plus')}</button></header>`;
  if (S.mode === 'demo') h += `<div class="statusbar warn">Example data. Nothing here is real and nothing you change is saved.</div>`;
  if (S.tab === 'home' || S.tab === 'entries') {
    h += `<div class="seg" role="group" aria-label="Whose money">${VIEWS().map(([k, l]) => `<button data-act="view" data-v="${k}" aria-pressed="${S.view === k}">${esc(l)}</button>`).join('')}</div>`;
    h += `<div class="monthbar"><h1>${mLabel(S.month)}</h1><div class="monthnav">
      <button data-act="month" data-d="-1" aria-label="Previous month">${icon('chevl', 'sm')}</button>
      <button data-act="month" data-d="1" aria-label="Next month" ${S.month >= thisMonth() ? 'disabled' : ''}>${icon('chevr', 'sm')}</button></div></div>`;
  }
  return h;
}
function tabBar() {
  const t = (k, ic, l) => `<button class="tab" data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></button>`;
  return t('home', 'home', 'Home') + t('entries', 'list', 'Entries') + `<button class="fab" data-act="add" aria-label="Add an entry">${icon('plus')}</button>` + t('import', 'upload', 'Import') + t('more', 'gear', 'More');
}

/* ----- home ----- */
function viewHome() {
  const list = monthEntries(), t = totals(list), biz = S.view === 'business';
  const left = biz ? t.in - t.spent : t.in - t.spent - t.saved;
  const base = Math.max(t.in, t.spent + t.saved, 1);
  let h = `<section class="hero">
    <div class="lbl">${biz ? (left >= 0 ? 'Business profit' : 'Business loss') : left >= 0 ? 'Left after spending and saving' : 'Spent and saved more than came in'}</div>
    <div class="big num">${fmt(Math.abs(left))}</div>
    <div class="trio">
      <div><span>${icon('in', 'sm')} Came in</span><b class="num">${fmtK(t.in)}</b></div>
      <div><span>${icon('out', 'sm')} Spent</span><b class="num">${fmtK(t.spent)}</b></div>
      ${biz ? `<div><span>${icon('chart', 'sm')} Margin</span><b class="num">${t.in ? Math.round(left / t.in * 100) + '%' : '–'}</b></div>` : `<div><span>${icon('piggy', 'sm')} Saved</span><b class="num">${fmtK(t.saved)}</b></div>`}
    </div>
    <div class="splitbar" aria-hidden="true"><i style="width:${t.spent / base * 100}%;background:#FF9AA0"></i>${biz ? '' : `<i style="width:${t.saved / base * 100}%;background:#C9C2FF"></i>`}<i style="width:${Math.max(0, left) / base * 100}%;background:#fff"></i></div>
    <div class="foot">${t.in ? `${biz ? '' : `Saved ${Math.round(t.saved / t.in * 100)}% of what came in. `}Pink is spent${biz ? '' : ', lilac is saved'}, white is left.` : S.view === 'me' || S.view === 'trisha' ? 'Shared costs marked Joint show under Together.' : 'Add your salary or income to see what is left.'}</div>
  </section>`;
  // quick add
  const sc = scopeOfView();
  const ps = S.presets.filter(p => (p.scope || 'home') === sc);
  h += `<section class="card"><div class="card-h"><h2>Quick add</h2><button class="link" data-act="presets">Edit</button></div>
    ${ps.length ? `<div class="quick">${ps.map(p => { const c = catOf(p.category_id); return `<button class="qbtn" data-act="preset" data-id="${p.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon, 'sm')}</span><span><b>${esc(p.label)}</b><small>${p.amount ? fmt(p.amount) : KIND[p.kind]}</small></span></button>`; }).join('')}</div>`
      : `<p class="small muted" style="margin:0">Make one-tap buttons for things you log often, like rent or groceries.</p>`}
  </section>`;
  if (!list.length) {
    h += `<div class="card"><div class="empty"><span class="bub lg">${icon('wallet')}</span><b>Nothing logged for ${MONTHS[+S.month.slice(5) - 1]}</b><p>Tap + to add an entry, or import a statement or screenshot.</p><div class="btnrow" style="width:100%"><button class="btn primary" data-act="add">${icon('plus', 'sm')} Add</button><button class="btn" data-act="tab" data-tab="import">${icon('upload', 'sm')} Import</button></div></div></div>`;
    return h + goalsStrip();
  }
  // spent by category (+ budgets)
  const withBudget = S.view === 'together' || S.view === 'business';
  const cats = Object.entries(t.byCat).map(([id, v]) => ({ c: catOf(id), v })).sort((a, b) => b.v - a.v);
  if (withBudget) for (const c of activeCats('spent', sc)) if (c.budget > 0 && !t.byCat[c.id]) cats.push({ c, v: 0 });
  const max = Math.max(...cats.map(x => x.v), 1);
  const totalBudget = withBudget ? activeCats('spent', sc).reduce((s, c) => s + (+c.budget || 0), 0) : 0;
  h += `<section class="card"><div class="card-h"><h2>Where it went</h2>${withBudget ? `<button class="link" data-act="budgets">${totalBudget ? 'Budgets' : 'Set budgets'}</button>` : ''}</div><div>
    ${cats.map(({ c, v }) => {
      const b = withBudget ? +c.budget || 0 : 0, over = b && v > b;
      const right = b ? (over ? `<span class="over">${fmt(v - b)} over</span>` : `<span>${fmt(v)} of ${fmt(b)}</span>`) : `<span>${fmt(v)}</span>`;
      return `<button class="crow" data-act="catlist" data-id="${esc(c.id)}"><span class="bub" style="--c:${c.color}">${icon(c.icon, 'sm')}</span><div style="min-width:0"><div class="c-top"><b>${esc(c.name)}</b>${right}</div>
        <div class="bar" style="--c:${over ? 'var(--out)' : c.color}"><i style="width:${Math.min(100, (b ? v / b : v / max) * 100)}%"></i></div></div></button>`;
    }).join('')}</div></section>`;
  h += goalsStrip();
  const rec = list.slice().sort(byDateDesc).slice(0, 6);
  h += `<section class="card"><div class="card-h"><h2>Latest</h2><button class="link" data-act="tab" data-tab="entries">See all</button></div><div class="rows">${rec.map(entryRow).join('')}</div></section>`;
  return h;
}
function goalsStrip() {
  if (S.view === 'business') return '';
  const gs = S.goals.filter(g => !g.archived);
  return `<section class="card"><div class="card-h"><h2>Goals</h2><button class="link" data-act="goals">${gs.length ? 'All goals' : 'Add a goal'}</button></div>
  ${gs.length ? `<div class="hscroll">${gs.map(g => { const s = goalSaved(g), p = g.target ? Math.min(100, s / g.target * 100) : 0;
    return `<button class="gmini" data-act="goal" data-id="${g.id}"><div class="g-top"><span class="bub" style="--c:${g.color}">${icon(g.icon)}</span><div style="min-width:0"><b>${esc(g.name)}</b><div class="small muted">${g.target ? `${fmtK(s)} of ${fmtK(g.target)}` : `${fmtK(s)} saved · set a target`}</div></div></div>
    <div class="bar" style="--c:${g.color}"><i style="width:${p}%"></i></div></button>`; }).join('')}</div>` : `<p class="small muted" style="margin:0">Log money as Saved → Towards a goal and it fills these up.</p>`}</section>`;
}
function entryRow(e) {
  const c = catOf(e.category_id), g = e.goal_id ? goalOf(e.goal_id) : null;
  const title = e.note || (g ? g.name : c.name);
  const sub = [e.note ? c.name + (g ? ' · ' + g.name : '') : (g ? c.name : ''), whoName(e.who), e.paid_with].filter(Boolean).join(' · ');
  const sign = e.kind === 'in' ? '+' : e.kind === 'saved' ? '' : '−';
  return `<button class="row" data-act="edit" data-id="${e.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon)}</span>
    <div class="r-main"><div class="r-name">${esc(title)}${e.kind === 'saved' ? '<span class="tag">saved</span>' : ''}</div><div class="r-sub">${esc(sub)}</div></div>
    <div class="r-amt num ${e.kind}">${sign}${fmt(e.amount).replace('−', '')}</div></button>`;
}

/* ----- entries ----- */
function viewEntries() {
  const f = (k, l) => `<button class="chip" data-act="kf" data-k="${k}" aria-pressed="${S.kindFilter === k}">${l}</button>`;
  return `<label class="search">${icon('search', 'sm')}<input id="q" type="search" placeholder="Search notes and categories" value="${esc(S.q)}" aria-label="Search entries"></label>
    <div class="chips">${f('all', 'All')}${f('spent', 'Spent')}${f('in', 'Came in')}${f('saved', 'Saved')}${S.catFilter ? `<button class="chip" data-act="catclear" aria-pressed="true">${esc(catOf(S.catFilter).name)} ${icon('x', 'sm')}</button>` : ''}</div>
    <div id="elist">${entriesList()}</div>`;
}
function entriesList() {
  let list = monthEntries();
  if (S.kindFilter !== 'all') list = list.filter(e => e.kind === S.kindFilter);
  if (S.catFilter) list = list.filter(e => (e.category_id || '') === S.catFilter);
  const q = S.q.trim().toLowerCase();
  if (q) list = list.filter(e => [e.note, catOf(e.category_id).name, whoName(e.who), e.paid_with, goalOf(e.goal_id)?.name].join(' ').toLowerCase().includes(q));
  list.sort(byDateDesc);
  if (!list.length) return `<div class="card"><div class="empty"><span class="bub lg">${icon('search')}</span><b>Nothing here</b><p>${q || S.kindFilter !== 'all' || S.catFilter ? 'Try another search or filter, or another month.' : 'No entries this month yet.'}</p></div></div>`;
  const t = totals(list);
  const groups = {}; for (const e of list) (groups[e.date] = groups[e.date] || []).push(e);
  let h = `<p class="small muted" style="margin:0">${list.length} entr${list.length > 1 ? 'ies' : 'y'} · in ${fmt(t.in)} · spent ${fmt(t.spent)} · saved ${fmt(t.saved)}</p><section class="card" style="padding-top:2px">`;
  for (const [d, es] of Object.entries(groups)) {
    const sp = es.filter(e => e.kind === 'spent').reduce((s, e) => s + (+e.amount), 0);
    h += `<div class="dayh"><span>${dayLabel(d)}</span><span>${sp ? fmt(sp) + ' spent' : ''}</span></div><div class="rows">${es.map(entryRow).join('')}</div>`;
  }
  return h + `</section>`;
}

/* ----- more ----- */
function viewMore() {
  const li = (act, ic, t, s) => `<button class="li" data-act="${act}"><span class="ic-wrap">${icon(ic)}</span><div><b>${t}</b><span>${s}</span></div>${icon('chevr', 'sm')}</button>`;
  return `<section class="card"><div class="card-h"><h2>Plan</h2></div><div class="list">
      ${li('goals', 'target', 'Goals', `${S.goals.filter(g => !g.archived).length} goals`)}
      ${li('budgets', 'chart', 'Monthly budgets', 'Limits for household spending')}
    </div></section>
    <section class="card"><div class="card-h"><h2>Set up</h2></div><div class="list">
      ${li('presets', 'star', 'Quick-add buttons', `${S.presets.length} buttons on Home`)}
      ${li('cats', 'tag', 'Categories', `${S.cats.filter(c => !c.archived).length} categories`)}
      ${li('rules', 'rule', 'Import rules', `${S.rules.length} words that pick a category`)}
      ${li('people', 'users', 'Names and cards', `${esc(S.people.me)}, ${esc(S.people.trisha)} · ${S.paidWith.length} cards and accounts`)}
    </div></section>
    <section class="card"><div class="card-h"><h2>Data</h2></div><div class="list">
      ${li('export', 'download', 'Export to CSV', 'All entries, for Excel or Google Sheets')}
      ${li('install', 'phone', 'Put Nest on your home screen', 'Install it like an app')}
      ${S.mode === 'live' ? li('signout', 'logout', 'Sign out', esc(S.email)) : li('leavedemo', 'logout', 'Leave the example', 'Go to sign in')}
    </div></section>`;
}

/* ---------- sheets ---------- */
function openSheet(html, mount) {
  const o = $('#sheet');
  o.innerHTML = `<div class="scrim" data-close></div><div class="panel sheet-body" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  o.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => o.classList.add('open')));
  mount && mount($('.panel', o));
}
function closeSheet() { const o = $('#sheet'); o.classList.remove('open'); setTimeout(() => { if (!o.classList.contains('open')) { o.hidden = true; o.innerHTML = ''; } }, 230); }
const shHead = t => `<div class="sh-h"><h2>${t}</h2><button class="iconbtn" data-close aria-label="Close">${icon('x', 'sm')}</button></div>`;
function errText(e) { const m = (e && (e.message || e.error_description)) || ''; if (/jwt|auth|permission|policy|row-level/i.test(m)) return 'Not allowed. Sign out and in again.'; if (/fetch|network/i.test(m)) return 'No connection. Try again.'; return 'Could not save. ' + m.slice(0, 80); }
async function save(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r || true; } catch (e) { console.error(e); toast(errText(e)); return null; } }

/* entry sheet */
function usageOrder(kind, scope) {
  const cut = addM(thisMonth(), -4) + '-01', cnt = {};
  for (const e of S.entries) if (e.kind === kind && e.date >= cut) cnt[e.category_id] = (cnt[e.category_id] || 0) + 1;
  return activeCats(kind, scope).sort((a, b) => (cnt[b.id] || 0) - (cnt[a.id] || 0) || (a.sort || 0) - (b.sort || 0));
}
function entrySheet(id, preset) {
  const ex = id ? S.entries.find(e => e.id === id) : null;
  const defWho = S.view === 'me' || S.view === 'trisha' ? S.view : S.person;
  const F = ex ? { ...ex } : { kind: 'spent', amount: '', category_id: '', goal_id: null, note: '', who: defWho, scope: scopeOfView(), paid_with: '', date: today() };
  if (preset) Object.assign(F, { kind: preset.kind, amount: preset.amount || '', category_id: preset.category_id || '', goal_id: preset.goal_id || null, note: preset.note || '', who: preset.who || F.who, scope: preset.scope || 'home' });
  openSheet(`${shHead(ex ? 'Edit entry' : preset ? esc(preset.label) : 'Add an entry')}
    <div class="seg kindseg" id="f-kind"></div>
    <div class="amount"><span>₹</span><input id="f-amt" inputmode="decimal" placeholder="0" value="${esc(F.amount)}" aria-label="Amount" autocomplete="off"></div>
    <div class="field"><span class="flabel">Category</span><div class="catgrid" id="f-cats"></div></div>
    <div class="field" id="f-goalw"></div>
    <div class="field"><label for="f-note">What for</label><input class="inp" id="f-note" list="f-notes" value="${esc(F.note)}" placeholder="e.g. Blinkit, dinner with friends" autocomplete="off"><datalist id="f-notes"></datalist></div>
    <div class="field"><span class="flabel">When</span><div class="chips" id="f-when"></div><input class="inp" type="date" id="f-date" value="${esc(F.date)}" max="${today()}"></div>
    <div class="field"><span class="flabel">Whose</span><div class="seg" id="f-who"></div></div>
    <details class="more" ${F.paid_with || F.scope === 'business' ? 'open' : ''}><summary>More details</summary>
      <div class="field" style="gap:10px">${S.paidWith.length ? `<span class="flabel">Paid with / into</span><div class="chips wrap" id="f-paid"></div>` : ''}
      <label class="check"><input type="checkbox" id="f-biz" ${F.scope === 'business' ? 'checked' : ''}> Yoga business (kept out of household totals)</label></div>
    </details>
    <div class="btnrow"><button class="btn primary" id="f-save">${ex ? 'Save' : 'Add'}</button>${ex ? '' : `<button class="btn" id="f-again">Add + next</button>`}</div>
    ${ex ? `<div class="btnrow"><button class="btn" id="f-preset">${icon('star', 'sm')} Make quick-add</button><button class="btn danger" id="f-del">Delete</button></div>` : ''}`, p => {
    const drawS = () => {
      $('#f-kind', p).innerHTML = Object.entries(KIND).map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${F.kind === k}">${l}</button>`).join('');
      const cats = usageOrder(F.kind, F.scope);
      if (F.category_id && !cats.some(c => c.id === F.category_id)) F.category_id = '';
      $('#f-cats', p).innerHTML = cats.length ? cats.map(c => `<button type="button" class="cg" data-c="${c.id}" aria-pressed="${F.category_id === c.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon)}</span><span>${esc(c.name)}</span></button>`).join('') : `<p class="small muted" style="grid-column:1/-1;margin:0">No ${KIND[F.kind].toLowerCase()} categories${F.scope === 'business' ? ' for the business' : ''} yet. Add one under More → Categories.</p>`;
      const gs = S.goals.filter(g => !g.archived);
      $('#f-goalw', p).innerHTML = F.kind === 'saved' && gs.length ? `<span class="flabel">Towards a goal${F.category_id === 'goal' ? '' : ' (optional)'}</span><div class="chips wrap">${gs.map(g => `<button type="button" class="chip" data-g="${g.id}" aria-pressed="${F.goal_id === g.id}">${esc(g.name)}</button>`).join('')}</div>` : '';
      $('#f-when', p).innerHTML = [[today(), 'Today'], [yesterday(), 'Yesterday']].map(([d, l]) => `<button type="button" class="chip" data-d="${d}" aria-pressed="${F.date === d}">${l}</button>`).join('');
      $('#f-who', p).innerHTML = [['me', S.people.me], ['trisha', S.people.trisha], ['joint', 'Joint']].map(([k, l]) => `<button type="button" data-w="${k}" aria-pressed="${F.who === k}">${esc(l)}</button>`).join('');
      if ($('#f-paid', p)) $('#f-paid', p).innerHTML = S.paidWith.map(x => `<button type="button" class="chip" data-p="${esc(x)}" aria-pressed="${F.paid_with === x}">${esc(x)}</button>`).join('');
      const notes = [...new Set(S.entries.filter(e => e.category_id === F.category_id && e.note).sort(byDateDesc).map(e => e.note))].slice(0, 12);
      $('#f-notes', p).innerHTML = notes.map(n => `<option value="${esc(n)}">`).join('');
    };
    drawS();
    p.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.k) { F.kind = b.dataset.k; if (F.kind !== 'saved') F.goal_id = null; drawS(); }
      else if (b.dataset.c) { F.category_id = b.dataset.c; drawS(); }
      else if (b.dataset.g) { F.goal_id = F.goal_id === b.dataset.g ? null : b.dataset.g; if (F.goal_id && !F.category_id) F.category_id = 'goal'; drawS(); }
      else if (b.dataset.d) { F.date = b.dataset.d; $('#f-date', p).value = F.date; drawS(); }
      else if (b.dataset.w) { F.who = b.dataset.w; drawS(); }
      else if (b.dataset.p != null) { F.paid_with = F.paid_with === b.dataset.p ? '' : b.dataset.p; drawS(); }
    });
    $('#f-date', p).onchange = e => { F.date = e.target.value || today(); drawS(); };
    $('#f-biz', p).onchange = e => { F.scope = e.target.checked ? 'business' : 'home'; F.category_id = ''; drawS(); };
    const doSave = async (again) => {
      const amount = Math.round(num($('#f-amt', p).value) * 100) / 100;
      if (!(amount > 0)) { toast('Enter an amount.'); $('#f-amt', p).focus(); return; }
      if (!F.category_id) { toast('Pick a category.'); return; }
      if (F.category_id === 'goal' && !F.goal_id) { toast('Pick which goal.'); return; }
      const row = { date: F.date || today(), kind: F.kind, amount, category_id: F.category_id, goal_id: F.kind === 'saved' ? F.goal_id : null, note: $('#f-note', p).value.trim(), who: F.who, scope: F.scope, paid_with: F.paid_with || '' };
      $('#f-save', p).disabled = true;
      const r = await save(async () => ex ? S.db.update('entries', ex.id, row) : S.db.insert('entries', { ...row, source: preset ? 'quick' : 'manual' }));
      $('#f-save', p).disabled = false;
      if (!r) return;
      if (ex) S.entries = S.entries.map(x => x.id === ex.id ? r : x); else S.entries.push(r);
      toast(`${ex ? 'Saved' : 'Added'} ${fmt(amount)} ${F.kind === 'in' ? 'in' : F.kind === 'saved' ? 'saved' : 'spent'}`);
      if (!ex && !S.month.startsWith(row.date.slice(0, 7)) && row.date.slice(0, 7) <= thisMonth()) S.month = row.date.slice(0, 7);
      render();
      if (again) { $('#f-amt', p).value = ''; $('#f-note', p).value = ''; $('#f-amt', p).focus(); } else closeSheet();
    };
    $('#f-save', p).onclick = () => doSave(false);
    $('#f-again', p) && ($('#f-again', p).onclick = () => doSave(true));
    if (ex) {
      let armed = false;
      $('#f-del', p).onclick = async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Tap again to delete'; return; } if (await save(() => S.db.remove('entries', ex.id), 'Deleted')) { S.entries = S.entries.filter(x => x.id !== ex.id); closeSheet(); render(); } };
      $('#f-preset', p).onclick = () => presetEdit(null, { label: ex.note || catOf(ex.category_id).name, kind: ex.kind, amount: ex.amount, category_id: ex.category_id, goal_id: ex.goal_id, note: ex.note, who: ex.who, scope: ex.scope });
    } else if (!F.amount) setTimeout(() => $('#f-amt', p)?.focus(), 280);
  });
}

/* presets */
function presetsSheet() {
  openSheet(`${shHead('Quick-add buttons')}<p class="small muted" style="margin:0">These sit on Home. Tap one to log it in a second. Leave the amount empty for things that change each time.</p>
    <div class="rows">${S.presets.map(pr => { const c = catOf(pr.category_id); return `<button class="row" data-pe="${pr.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon)}</span><div class="r-main"><div class="r-name">${esc(pr.label)}</div><div class="r-sub">${KIND[pr.kind]} · ${esc(c.name)} · ${esc(whoName(pr.who))}${pr.scope === 'business' ? ' · Business' : ''}</div></div><div class="r-amt num">${pr.amount ? fmt(pr.amount) : ''}</div></button>`; }).join('') || '<p class="small muted">No buttons yet.</p>'}</div>
    <button class="btn primary block" data-pe="">${icon('plus', 'sm')} New button</button>`, p => {
    p.onclick = e => { const b = e.target.closest('[data-pe]'); if (b) presetEdit(b.dataset.pe || null); };
  });
}
function presetEdit(id, from) {
  const ex = id ? S.presets.find(x => x.id === id) : null;
  const F = ex ? { ...ex } : { label: '', kind: 'spent', amount: null, category_id: '', goal_id: null, note: '', who: 'joint', scope: 'home', sort: S.presets.length + 1, ...(from || {}) };
  openSheet(`${shHead(ex ? 'Edit button' : 'New button')}
    <div class="field"><label for="pe-l">Button name</label><input class="inp" id="pe-l" value="${esc(F.label)}" placeholder="e.g. Rent"></div>
    <div class="seg kindseg" id="pe-kind"></div>
    <div class="field"><span class="flabel">Category</span><div class="catgrid" id="pe-cats"></div></div>
    <div class="grid2"><div class="field"><label for="pe-a">Amount (optional)</label><input class="inp" id="pe-a" inputmode="decimal" value="${F.amount || ''}" placeholder="Ask each time"></div>
    <div class="field"><label for="pe-n">What for</label><input class="inp" id="pe-n" value="${esc(F.note)}" placeholder="e.g. Rent – flat"></div></div>
    <div class="field"><span class="flabel">Whose</span><div class="seg" id="pe-who"></div></div>
    <label class="check"><input type="checkbox" id="pe-biz" ${F.scope === 'business' ? 'checked' : ''}> Yoga business</label>
    <button class="btn primary block" id="pe-save">${ex ? 'Save' : 'Add button'}</button>
    ${ex ? `<button class="btn danger block" id="pe-del">Remove button</button>` : ''}<button class="btn block" id="pe-back">Back</button>`, p => {
    const d = () => {
      $('#pe-kind', p).innerHTML = Object.entries(KIND).map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${F.kind === k}">${l}</button>`).join('');
      $('#pe-cats', p).innerHTML = activeCats(F.kind, F.scope).map(c => `<button type="button" class="cg" data-c="${c.id}" aria-pressed="${F.category_id === c.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon)}</span><span>${esc(c.name)}</span></button>`).join('');
      $('#pe-who', p).innerHTML = [['me', S.people.me], ['trisha', S.people.trisha], ['joint', 'Joint']].map(([k, l]) => `<button type="button" data-w="${k}" aria-pressed="${F.who === k}">${esc(l)}</button>`).join('');
    };
    d();
    p.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.k) { F.kind = b.dataset.k; F.category_id = ''; d(); } else if (b.dataset.c) { F.category_id = b.dataset.c; d(); } else if (b.dataset.w) { F.who = b.dataset.w; d(); } });
    $('#pe-biz', p).onchange = e => { F.scope = e.target.checked ? 'business' : 'home'; F.category_id = ''; d(); };
    $('#pe-back', p).onclick = presetsSheet;
    $('#pe-save', p).onclick = async () => {
      const label = $('#pe-l', p).value.trim(); if (!label) { toast('Give the button a name.'); return; }
      if (!F.category_id) { toast('Pick a category.'); return; }
      const a = num($('#pe-a', p).value);
      const row = { label, kind: F.kind, amount: a > 0 ? a : null, category_id: F.category_id, goal_id: F.kind === 'saved' ? F.goal_id || null : null, note: $('#pe-n', p).value.trim(), who: F.who, scope: F.scope, sort: F.sort || 0 };
      const r = await save(() => ex ? S.db.update('presets', ex.id, row) : S.db.insert('presets', row), ex ? 'Button saved' : 'Button added');
      if (!r) return;
      S.presets = ex ? S.presets.map(x => x.id === ex.id ? r : x) : [...S.presets, r];
      render(); presetsSheet();
    };
    if (ex) { let armed = false; $('#pe-del', p).onclick = async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Tap again to remove'; return; } if (await save(() => S.db.remove('presets', ex.id), 'Button removed')) { S.presets = S.presets.filter(x => x.id !== ex.id); render(); presetsSheet(); } }; }
  });
}

/* goals */
function goalsSheet() {
  const gs = S.goals.filter(g => !g.archived);
  openSheet(`${shHead('Goals')}${gs.map(g => { const s = goalSaved(g), p = g.target ? Math.min(100, s / g.target * 100) : 0, C = 2 * Math.PI * 25;
    let meta = 'Set a target to see progress.';
    if (g.target) { const left = Math.max(0, g.target - s); if (!left) meta = 'Reached. Well done.'; else if (g.target_date) { const [y, m] = g.target_date.split('-').map(Number), [y0, m0] = thisMonth().split('-').map(Number); const n = (y - y0) * 12 + (m - m0) + 1; meta = n > 0 ? `${fmt(Math.ceil(left / n))} a month reaches it by ${mShort(g.target_date.slice(0, 7))} ${y}` : `${fmt(left)} still to go`; } else meta = `${fmt(left)} to go`; }
    return `<button class="goal" data-gid="${g.id}" style="text-align:left;width:100%"><div class="ring"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="25" fill="none" stroke="var(--surface-2)" stroke-width="7"/><circle cx="30" cy="30" r="25" fill="none" stroke="${g.color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C * p / 100} ${C}"/></svg><span class="num">${Math.round(p)}%</span></div>
    <div style="min-width:0"><b>${esc(g.name)}</b><div class="num" style="font-weight:600">${fmt(s)}${g.target ? ` <span class="muted" style="font-weight:500">of ${fmt(g.target)}</span>` : ''}</div><div class="small muted">${esc(meta)}</div></div></button>`; }).join('<hr style="border:0;border-top:1px solid var(--line);margin:0">') || '<p class="small muted">No goals yet.</p>'}
    <button class="btn primary block" data-gid="">${icon('plus', 'sm')} New goal</button>`, p => { p.onclick = e => { const b = e.target.closest('[data-gid]'); if (b) goalEdit(b.dataset.gid || null); }; });
}
function goalEdit(id) {
  const ex = id ? S.goals.find(g => g.id === id) : null;
  const F = ex ? { ...ex } : { name: '', target: 0, start_amount: 0, target_date: null, icon: 'target', color: SWATCHES[S.goals.length % SWATCHES.length], sort: S.goals.length };
  const logged = ex ? goalSaved(ex) - (+ex.start_amount || 0) : 0;
  openSheet(`${shHead(ex ? 'Edit goal' : 'New goal')}
    <div class="field"><label for="g-n">Name</label><input class="inp" id="g-n" value="${esc(F.name)}" placeholder="e.g. New car"></div>
    <div class="grid2"><div class="field"><label for="g-t">Target (₹)</label><input class="inp" id="g-t" inputmode="numeric" value="${F.target || ''}" placeholder="0"></div>
    <div class="field"><label for="g-d">Reach by</label><input class="inp" type="month" id="g-d" value="${F.target_date ? F.target_date.slice(0, 7) : ''}"></div></div>
    <div class="field"><label for="g-s">Already saved before Nest (₹)</label><input class="inp" id="g-s" inputmode="numeric" value="${F.start_amount || ''}" placeholder="0">${logged ? `<span class="small muted">Plus ${fmt(logged)} logged in Nest as Saved towards this goal.</span>` : '<span class="small muted">After this, log money as Saved → Towards a goal and it adds up here.</span>'}</div>
    <div class="field"><span class="flabel">Icon</span><div class="icopick" id="g-ic"></div></div>
    <div class="field"><span class="flabel">Colour</span><div class="swatches" id="g-col"></div></div>
    <button class="btn primary block" id="g-save">${ex ? 'Save goal' : 'Create goal'}</button>
    ${ex ? `<button class="btn" id="g-add">${icon('plus', 'sm')} Log money saved for this goal</button><button class="btn danger block" id="g-del">Remove goal</button>` : ''}<button class="btn block" id="g-back">Back</button>`, p => {
    const d = () => { $('#g-ic', p).innerHTML = ['target', 'car', 'home', 'key', 'plane', 'heart', 'gift', 'book', 'lotus', 'paw', 'wallet', 'sparkle', 'briefcase', 'leaf'].map(k => `<button type="button" data-i="${k}" aria-pressed="${F.icon === k}" aria-label="${k}">${icon(k)}</button>`).join('');
      $('#g-col', p).innerHTML = SWATCHES.map(c => `<button type="button" class="sw" style="--c:${c}" data-col="${c}" aria-pressed="${F.color === c}" aria-label="Colour ${c}"></button>`).join(''); };
    d();
    p.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.i) { F.icon = b.dataset.i; d(); } else if (b.dataset.col) { F.color = b.dataset.col; d(); } });
    $('#g-back', p).onclick = goalsSheet;
    $('#g-save', p).onclick = async () => {
      const name = $('#g-n', p).value.trim(); if (!name) { toast('Give the goal a name.'); return; }
      const m = $('#g-d', p).value;
      const row = { name, target: num($('#g-t', p).value), start_amount: num($('#g-s', p).value), target_date: m ? m + '-01' : null, icon: F.icon, color: F.color, sort: F.sort || 0 };
      const r = await save(() => ex ? S.db.update('goals', ex.id, row) : S.db.insert('goals', row), ex ? 'Goal saved' : 'Goal created');
      if (!r) return; S.goals = ex ? S.goals.map(g => g.id === ex.id ? r : g) : [...S.goals, r]; render(); goalsSheet();
    };
    if (ex) {
      $('#g-add', p).onclick = () => entrySheet(null, { kind: 'saved', category_id: 'goal', goal_id: ex.id, note: ex.name, who: S.person, scope: 'home', label: 'Save for ' + ex.name });
      let armed = false; $('#g-del', p).onclick = async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Tap again to remove (entries stay)'; return; } if (await save(() => S.db.update('goals', ex.id, { archived: true }), 'Goal removed')) { S.goals = S.goals.map(g => g.id === ex.id ? { ...g, archived: true } : g); render(); goalsSheet(); } };
    }
  });
}

/* budgets */
function budgetsSheet() {
  const sc = scopeOfView(S.view === 'business' ? 'business' : 'together');
  const cats = activeCats('spent', sc);
  const avg = {}; const ms = [1, 2, 3].map(k => addM(thisMonth(), -k));
  for (const c of cats) { const v = ms.map(m => totals(monthEntries(m, sc === 'business' ? 'business' : 'together')).byCat[c.id] || 0); const n = v.filter(x => x > 0).length; avg[c.id] = n ? v.reduce((a, b) => a + b, 0) / n : 0; }
  openSheet(`${shHead(sc === 'business' ? 'Business budgets' : 'Monthly budgets')}<p class="small muted" style="margin:0">Set a monthly limit per category, or leave it empty. The grey hint is your average over the last 3 months.</p>
    <div class="rows">${cats.map(c => `<div class="row" style="grid-template-columns:36px 1fr 7.5em"><span class="bub" style="--c:${c.color};width:36px;height:36px">${icon(c.icon, 'sm')}</span><div class="r-main"><div class="r-name">${esc(c.name)}</div><div class="r-sub">${avg[c.id] ? 'Usually ' + fmt(avg[c.id]) : 'No history yet'}</div></div><input class="inp" data-b="${c.id}" inputmode="numeric" value="${c.budget || ''}" placeholder="${avg[c.id] ? Math.ceil(avg[c.id] / 500) * 500 : '–'}" aria-label="${esc(c.name)} budget"></div>`).join('')}</div>
    <button class="btn block" id="b-fill">Fill empty ones from my averages</button>
    <button class="btn primary block" id="b-save">Save budgets</button>`, p => {
    $('#b-fill', p).onclick = () => { p.querySelectorAll('[data-b]').forEach(i => { if (!i.value && avg[i.dataset.b]) i.value = Math.ceil(avg[i.dataset.b] / 500) * 500; }); };
    $('#b-save', p).onclick = async () => {
      const changes = [...p.querySelectorAll('[data-b]')].map(i => ({ id: i.dataset.b, budget: Math.max(0, Math.round(num(i.value))) })).filter(x => (+catOf(x.id).budget || 0) !== x.budget);
      for (const ch of changes) { const r = await save(() => S.db.update('categories', ch.id, { budget: ch.budget })); if (!r) return; S.cats = S.cats.map(c => c.id === ch.id ? { ...c, budget: ch.budget } : c); }
      toast(changes.length ? 'Budgets saved' : 'No changes'); closeSheet(); render();
    };
  });
}

/* categories */
let catScope = 'home';
function catsSheet() {
  const body = () => ['spent', 'in', 'saved'].filter(k => !(catScope === 'business' && k === 'saved')).map(k => {
    const cs = S.cats.filter(c => c.kind === k && c.scope === catScope && !c.archived).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    return `<div><div class="flabel" style="margin:4px 0 0">${KIND[k]}</div><div class="rows">${cs.map(c => `<button class="row" data-ce="${c.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon)}</span><div class="r-main"><div class="r-name">${esc(c.name)}</div></div><span class="r-amt num muted" style="font-size:13px">${c.budget ? fmtK(c.budget) + '/mo' : ''}</span></button>`).join('')}</div>
      <button class="btn" data-cnew="${k}">${icon('plus', 'sm')} Add to ${KIND[k]}</button></div>`;
  }).join('');
  openSheet(`${shHead('Categories')}<div class="chips"><button class="chip" data-sc="home" aria-pressed="${catScope === 'home'}">Household</button><button class="chip" data-sc="business" aria-pressed="${catScope === 'business'}">Yoga business</button></div><div id="cbody" style="display:flex;flex-direction:column;gap:14px">${body()}</div>`, p => {
    p.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.sc) { catScope = b.dataset.sc; catsSheet(); } else if (b.dataset.ce) catEdit(b.dataset.ce); else if (b.dataset.cnew) catEdit(null, b.dataset.cnew); };
  });
}
function catEdit(id, kind) {
  const ex = id ? S.cats.find(c => c.id === id) : null;
  const F = ex ? { ...ex } : { name: '', kind, scope: catScope, icon: 'tag', color: SWATCHES[Math.floor(Math.random() * SWATCHES.length)], budget: 0, sort: 100 };
  const used = ex ? S.entries.filter(e => e.category_id === ex.id).length : 0;
  openSheet(`${shHead(ex ? 'Edit category' : 'New category')}
    <div style="display:flex;justify-content:center"><span class="bub lg" id="ce-prev"></span></div>
    <div class="field"><label for="ce-n">Name</label><input class="inp" id="ce-n" value="${esc(F.name)}" placeholder="e.g. Pharmacy"></div>
    <div class="field"><span class="flabel">Icon</span><div class="icopick" id="ce-ic"></div></div>
    <div class="field"><span class="flabel">Colour</span><div class="swatches" id="ce-col"></div></div>
    <button class="btn primary block" id="ce-save">${ex ? 'Save' : 'Add category'}</button>
    ${ex && ex.id !== 'goal' ? `<button class="btn danger block" id="ce-del">Hide category</button><p class="small muted" style="margin:-6px 0 0;text-align:center">${used ? `${used} entr${used > 1 ? 'ies keep' : 'y keeps'} it, it just won't be offered for new ones.` : 'It will no longer be offered.'}</p>` : ''}
    <button class="btn block" id="ce-back">Back</button>`, p => {
    const d = () => { const pv = $('#ce-prev', p); pv.style.setProperty('--c', F.color); pv.innerHTML = icon(F.icon);
      $('#ce-ic', p).innerHTML = ICON_CHOICES.map(k => `<button type="button" data-i="${k}" aria-pressed="${F.icon === k}" aria-label="${k}">${icon(k)}</button>`).join('');
      $('#ce-col', p).innerHTML = SWATCHES.map(c => `<button type="button" class="sw" style="--c:${c}" data-col="${c}" aria-pressed="${F.color === c}" aria-label="Colour ${c}"></button>`).join(''); };
    d();
    p.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.i) { F.icon = b.dataset.i; d(); } else if (b.dataset.col) { F.color = b.dataset.col; d(); } });
    $('#ce-back', p).onclick = catsSheet;
    $('#ce-save', p).onclick = async () => {
      const name = $('#ce-n', p).value.trim(); if (!name) { toast('Give it a name.'); return; }
      const row = { name, icon: F.icon, color: F.color };
      let r;
      if (ex) r = await save(() => S.db.update('categories', ex.id, row), 'Saved');
      else { const nid = (F.scope === 'business' ? 'b_' : '') + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) + '_' + Math.random().toString(36).slice(2, 5);
        r = await save(() => S.db.insert('categories', { id: nid, ...row, kind: F.kind, scope: F.scope, budget: 0, sort: 100 + S.cats.length, archived: false }), 'Category added'); }
      if (!r) return; S.cats = ex ? S.cats.map(c => c.id === ex.id ? r : c) : [...S.cats, r]; render(); catsSheet();
    };
    if ($('#ce-del', p)) { let armed = false; $('#ce-del', p).onclick = async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Tap again to hide'; return; } if (await save(() => S.db.update('categories', ex.id, { archived: true }), 'Category hidden')) { S.cats = S.cats.map(c => c.id === ex.id ? { ...c, archived: true } : c); render(); catsSheet(); } }; }
  });
}

/* rules */
function rulesSheet() {
  const opts = S.cats.filter(c => !c.archived).sort((a, b) => a.kind.localeCompare(b.kind) || (a.sort || 0) - (b.sort || 0)).map(c => `<option value="${c.id}">${esc(c.name)} (${KIND[c.kind]}${c.scope === 'business' ? ', business' : ''})</option>`).join('');
  openSheet(`${shHead('Import rules')}<p class="small muted" style="margin:0">When an imported line contains a word on the left, Nest picks the category on the right. New rules are added when you change a category while importing.</p>
    <div class="rows">${S.rules.slice().sort((a, b) => a.match.localeCompare(b.match)).map(r => { const c = catOf(r.category_id); return `<div class="row"><span class="bub" style="--c:${c.color}">${icon(c.icon, 'sm')}</span><div class="r-main"><div class="r-name">"${esc(r.match)}"</div><div class="r-sub">${esc(c.name)}</div></div><button class="iconbtn" data-rd="${r.id}" aria-label="Remove rule">${icon('x', 'sm')}</button></div>`; }).join('') || '<p class="small muted">No rules yet.</p>'}</div>
    <div class="field"><label for="ru-m">If the text contains</label><input class="inp" id="ru-m" placeholder="e.g. zepto"></div>
    <div class="field"><label for="ru-c">Use category</label><select class="inp" id="ru-c">${opts}</select></div>
    <button class="btn primary block" id="ru-add">${icon('plus', 'sm')} Add rule</button>
    <div class="field"><label for="ru-skip">Skip lines that mention (one per line)</label><textarea class="inp" id="ru-skip" rows="3" placeholder="your own name, for transfers between your accounts">${esc(S.skipWords.join('\n'))}</textarea><span class="small muted">Card bill payments and transfers between your own accounts aren't spending, so imports leave these unticked.</span></div>
    <button class="btn block" id="ru-skipsave">Save skip list</button>`, p => {
    p.onclick = async e => { const b = e.target.closest('[data-rd]'); if (!b) return; if (await save(() => S.db.remove('rules', b.dataset.rd), 'Rule removed')) { S.rules = S.rules.filter(r => r.id !== b.dataset.rd); rulesSheet(); } };
    $('#ru-add', p).onclick = async () => { const m = $('#ru-m', p).value.trim().toLowerCase(); if (m.length < 3) { toast('Use at least 3 letters.'); return; }
      const old = S.rules.find(r => r.match === m);
      const r = await save(() => old ? S.db.update('rules', old.id, { category_id: $('#ru-c', p).value }) : S.db.insert('rules', { match: m, category_id: $('#ru-c', p).value }), 'Rule saved');
      if (r) { S.rules = old ? S.rules.map(x => x.id === old.id ? r : x) : [...S.rules, r]; rulesSheet(); } };
    $('#ru-skipsave', p).onclick = async () => { const v = $('#ru-skip', p).value.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (await save(() => S.db.upsert('settings', { key: 'skip_words', value: v }, 'key'), 'Skip list saved')) S.skipWords = v; };
  });
}

/* names and cards */
function peopleSheet() {
  openSheet(`${shHead('Names and cards')}
    <div class="grid2"><div class="field"><label for="pp-me">Your name</label><input class="inp" id="pp-me" value="${esc(S.people.me)}"></div><div class="field"><label for="pp-tr">Wife's name</label><input class="inp" id="pp-tr" value="${esc(S.people.trisha)}"></div></div>
    <div class="field"><label for="pp-paid">Cards and accounts (one per line)</label><textarea class="inp" id="pp-paid" rows="7">${esc(S.paidWith.join('\n'))}</textarea><span class="small muted">These show under "More details" when you add an entry.</span></div>
    <button class="btn primary block" id="pp-save">Save</button>`, p => {
    $('#pp-save', p).onclick = async () => {
      const people = { me: $('#pp-me', p).value.trim() || 'Me', trisha: $('#pp-tr', p).value.trim() || 'Trisha' };
      const paid = $('#pp-paid', p).value.split('\n').map(s => s.trim()).filter(Boolean);
      const a = await save(() => S.db.upsert('settings', { key: 'people', value: people }, 'key'));
      const b = a && await save(() => S.db.upsert('settings', { key: 'paid_with', value: paid }, 'key'));
      if (b) { S.people = people; S.paidWith = paid; toast('Saved'); closeSheet(); render(); }
    };
  });
}

function installSheet() {
  openSheet(`${shHead('Put Nest on your home screen')}
    <div class="field"><b>iPhone (Safari)</b><ol class="small muted" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px"><li>Open Nest in Safari.</li><li>Tap the Share button, then <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Nest gets its own icon and opens full-screen.</li></ol></div>
    <div class="field"><b>Android (Chrome)</b><ol class="small muted" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px"><li>Open Nest in Chrome.</li><li>Tap <b>⋮</b>, then <b>Install app</b> or <b>Add to Home screen</b>.</li></ol></div>
    <p class="small muted" style="margin:0">You stay signed in, so after the first sign-in it opens straight to your numbers.</p>`);
}

/* export */
function exportCsv() {
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Goal', 'What for', 'Whose', 'Household or business', 'Paid with', 'Source']];
  for (const e of S.entries.slice().sort(byDateDesc)) rows.push([e.date, KIND[e.kind], e.amount, catOf(e.category_id).name, goalOf(e.goal_id)?.name || '', e.note, whoName(e.who), e.scope === 'business' ? 'Business' : 'Household', e.paid_with, e.source]);
  const csv = rows.map(r => r.map(x => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `nest-${today()}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('Export ready');
}

/* ---------- import ---------- */
const BUILTIN = [
  ['groceries', ['blinkit', 'blink commerce', 'zepto', 'bigbasket', 'instamart', 'dmart', 'grocery', 'supermarket', 'more retail', 'reliance fresh', 'nature basket', 'milk', 'dairy', 'country delight', 'licious']],
  ['food', ['zomato', 'swiggy', 'eternal ltd', 'eternal limited', 'starbucks', 'eazydiner', 'eazy diner', 'restaurant', 'cafe', 'coffee', 'kitchen', 'domino', 'pizza', 'mcdonald', 'kfc', 'burger', 'bakery', 'chai', 'biryani']],
  ['travel', ['irctc', 'makemytrip', 'goibibo', 'cleartrip', 'indigo', 'air india', 'akasa', 'spicejet', 'hotel', 'oyo', 'airbnb', 'booking.com', 'agoda', 'zoomcar', 'redbus', 'ixigo', 'resort']],
  ['transport', ['uber', ' ola ', 'olacabs', 'rapido', 'petrol', 'fuel', 'hpcl', 'bpcl', 'indian oil', 'iocl', 'fastag', 'parking', 'metro', 'namma yatri']],
  ['bills', ['airtel', ' jio', 'vodafone', 'bescom', 'electricity', 'water bill', 'gas bill', 'broadband', 'act fibernet', 'tata play', 'netflix', 'youtube', 'hotstar', 'prime video', 'spotify', 'anthropic', 'claude.ai', 'google one', 'icloud', 'apple.com', 'recharge', 'postpaid']],
  ['shopping', ['amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'meesho', 'decathlon', 'ikea', 'croma', 'reliance digital', 'mr diy', 'crossword', 'tata cliq', 'westside', 'zudio']],
  ['health', ['pharmacy', 'apollo', 'medplus', '1mg', 'pharmeasy', 'netmeds', 'hospital', 'clinic', 'diagnostic', 'doctor', 'practo']],
  ['fun', ['bookmyshow', 'book my show', 'bigtree', 'pvr', 'inox', 'cinepolis', 'district']],
  ['isha', ['isha', 'sadhguru']],
  ['milo', ['supertails', 'heads up for tails', 'vet ', 'pet ']],
  ['rent', ['rent', 'maintenance', 'society', 'urbanclap', 'urban company']],
  ['salary', ['salary', 'payroll']],
  ['interest', ['interest', 'int.pd', 'int pd', 'dividend']],
  ['refunds', ['refund', 'reversal', 'cashback']],
  ['sip', [' sip', 'mutual fund', 'bse star', 'bsestarmf', 'cams', 'kfintech', 'groww', 'sodhani']],
  ['stocks', ['icici direct', 'icicidirect', 'zerodha', 'upstox', 'demat']],
  ['fd', ['fixed deposit', ' fd ', 'recurring deposit', 'ppf', ' nps']]
];
const SKIP_RE = /(credit card|card payment|cc payment|cc bill|\bcc\b.*(autopay|si-|bill)|payment received|thank you for (your )?payment|autopay.*card|card.*autopay|self transfer|own account|to self|neft.*self|imps.*self)/i;
function classify(desc, kind, scope) {
  const s = ' ' + String(desc || '').toLowerCase() + ' ';
  const ok = id => { const c = S.cats.find(x => x.id === id && !x.archived); return c && c.scope === scope && c.kind === kind; };
  for (const r of S.rules.slice().sort((a, b) => b.match.length - a.match.length)) if (s.includes(r.match.toLowerCase()) && ok(r.category_id)) return { id: r.category_id, how: 'rule' };
  if (scope === 'home') for (const [id, words] of BUILTIN) if (words.some(w => s.includes(w)) && ok(id)) return { id, how: 'auto' };
  // a "saved"-looking debit should be logged as Saved
  if (kind === 'spent' && scope === 'home') for (const id of ['sip', 'stocks', 'fd']) { const w = BUILTIN.find(b => b[0] === id)[1]; if (w.some(x => s.includes(x))) return { id, how: 'auto', kind: 'saved' }; }
  const fallback = { spent: scope === 'business' ? 'b_other' : 'other', in: scope === 'business' ? 'b_other_in' : 'other_in', saved: 'sip' }[kind];
  return { id: ok(fallback) ? fallback : '', how: 'none' };
}

function viewImport() {
  const I = S.imp;
  const who = I?.who || S.person;
  let h = `<section class="card"><div class="card-h"><h2>Import from a statement or screenshot</h2></div>
    <p class="small muted" style="margin:0">Your phone reads the file itself. Nothing is uploaded until you tick the entries you want and tap Save.</p>
    <div class="field"><span class="flabel">Whose money is this</span><div class="seg" id="im-who">${[['me', S.people.me], ['trisha', S.people.trisha], ['joint', 'Joint']].map(([k, l]) => `<button data-act="imwho" data-w="${k}" aria-pressed="${who === k}">${esc(l)}</button>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="im-biz" ${I?.scope === 'business' ? 'checked' : ''}> Yoga business statement</label>
  </section>`;
  if (!I || I.stage === 'pick' || I.stage === 'error') {
    h += `<label class="drop" id="drop" for="im-file"><span class="bub lg">${icon('upload')}</span><b>Choose a file</b>
      <p>A screenshot from GPay, PhonePe or your bank app, a PDF statement, or a CSV / Excel download.</p>
      <span class="btn primary">${icon('file', 'sm')} Choose file</span></label>
      <input type="file" id="im-file" accept="image/*,application/pdf,.pdf,.csv,.xls,.xlsx,text/csv" hidden>
      ${I?.stage === 'error' ? `<div class="statusbar warn">${esc(I.error)}</div>` : ''}
      <section class="card"><div class="card-h"><h2>Tips</h2></div><ul class="small muted" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">
        <li>Bank and card PDFs give the best results. Most banks let you download one from their app or net banking.</li>
        <li>For screenshots, crop to the list of transactions and keep the dates visible.</li>
        <li>Card bill payments and transfers between your own accounts are left unticked, so nothing is counted twice.</li></ul></section>`;
  } else if (I.stage === 'password') {
    h += `<section class="card"><div class="card-h"><h2>${esc(I.file.name)}</h2></div><p class="small muted" style="margin:0">${I.wrong ? 'That password did not work. ' : ''}This PDF is locked. Banks usually use part of your name and date of birth, or your customer ID. The password stays on your phone.</p>
      <input class="inp" id="im-pass" type="password" placeholder="PDF password" autocomplete="off"><div class="btnrow"><button class="btn" data-act="imreset">Cancel</button><button class="btn primary" data-act="impass">Open</button></div></section>`;
  } else if (I.stage === 'reading') {
    h += `<section class="card"><div class="card-h"><h2>${esc(I.file.name)}</h2></div><p class="small muted" style="margin:0" id="im-msg">${esc(I.msg || 'Reading…')}</p><div class="progress"><i id="im-bar" style="width:${I.pct || 5}%"></i></div>
      <p class="small muted" style="margin:0">Screenshots take 10–30 seconds the first time while the reader downloads.</p></section>`;
  } else if (I.stage === 'review') {
    const rows = I.rows, on = rows.filter(r => r.on);
    const t = { in: 0, spent: 0, saved: 0 }; for (const r of on) t[r.kind] += r.amount;
    h += `<section class="card"><div class="card-h"><h2>Check ${rows.length} line${rows.length === 1 ? '' : 's'}</h2><button class="link" data-act="imreset">Start over</button></div>
      <p class="small muted" style="margin:0">${esc(I.file.name)}. Fix anything that looks wrong and untick what you don't want.</p>
      ${rows.length ? `<div class="chips"><button class="chip" data-act="imall" data-v="1">Tick all</button><button class="chip" data-act="imall" data-v="0">Untick all</button></div>` : ''}
      <div id="im-rows">${rows.map((r, i) => importRow(r, i)).join('') || `<div class="empty"><p>No transactions found in this file. ${I.method === 'screenshot' ? 'Try a sharper screenshot, cropped to the list.' : 'If it is a scanned PDF, take a screenshot instead.'}</p></div>`}</div>
      <label class="check"><input type="checkbox" id="im-learn" ${I.learn ? 'checked' : ''}> Remember my category changes for next time</label>
    </section>
    ${rows.length ? `<div class="stick"><button class="btn primary block" data-act="imsave" ${on.length ? '' : 'disabled'}>Save ${on.length} entr${on.length === 1 ? 'y' : 'ies'} · ${t.spent ? fmt(t.spent) + ' spent' : ''}${t.in ? (t.spent ? ', ' : '') + fmt(t.in) + ' in' : ''}${t.saved ? ((t.spent || t.in) ? ', ' : '') + fmt(t.saved) + ' saved' : ''}</button></div>` : ''}`;
  }
  return h;
}
function importRow(r, i) {
  const opts = activeCats(r.kind, S.imp.scope).map(c => `<option value="${c.id}" ${r.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<div class="irow ${r.on ? '' : 'off'}" data-i="${i}"><input type="checkbox" data-f="on" ${r.on ? 'checked' : ''} aria-label="Include this line">
    <div class="i-main"><div class="i-top"><input class="inp i-date" type="date" data-f="date" value="${esc(r.date || '')}"><input class="inp i-amt" data-f="amount" inputmode="decimal" value="${r.amount}" aria-label="Amount"></div>
    <input class="inp" data-f="note" value="${esc(r.note)}" aria-label="What for" style="padding:8px 10px;font-size:15px">
    <div class="i-sel"><select class="inp kind" data-f="kind" aria-label="Type">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${r.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select><select class="inp" data-f="category_id" aria-label="Category"><option value="">Pick a category</option>${opts}</select></div>
    ${r.flag ? `<div class="i-flag">${esc(r.flag)}</div>` : ''}<div class="i-desc">${esc(r.desc)}</div></div></div>`;
}
function mountImport() {
  const fi = $('#im-file'), drop = $('#drop');
  if (fi) fi.onchange = () => { const f = fi.files && fi.files[0]; if (f) startImport(f); };
  if (drop) {
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) startImport(f); };
  }
  const biz = $('#im-biz'); if (biz) biz.onchange = () => { impState().scope = biz.checked ? 'business' : 'home'; if (S.imp.rows) S.imp.rows.forEach(prepRow); render(); };
  const rows = $('#im-rows');
  if (rows) {
    rows.oninput = rows.onchange = e => {
      const el = e.target, wrap = el.closest('[data-i]'); if (!wrap) return;
      const r = S.imp.rows[+wrap.dataset.i], f = el.dataset.f;
      if (f === 'on') r.on = el.checked;
      else if (f === 'amount') r.amount = Math.round(num(el.value) * 100) / 100;
      else if (f === 'kind') { r.kind = el.value; const c = classify(r.desc, r.kind, S.imp.scope); r.category_id = c.id; r.autoCat = c.id; }
      else if (f === 'category_id') { r.category_id = el.value; r.touched = true; }
      else r[f] = el.value;
      if (e.type === 'change' && (f === 'on' || f === 'kind' || f === 'category_id')) render();
      else if (e.type === 'change' && f === 'amount') render();
    };
  }
  const learn = $('#im-learn'); if (learn) learn.onchange = () => { S.imp.learn = learn.checked; };
  const pass = $('#im-pass'); if (pass) { pass.focus(); pass.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-act="impass"]').click(); } }; }
}
function impState() { if (!S.imp) S.imp = { stage: 'pick', who: S.person, scope: 'home', learn: true }; return S.imp; }
function prepRow(r) {
  const I = S.imp, s = (r.desc || '').toLowerCase();
  const c = classify(r.desc, r.kind, I.scope);
  if (c.kind) r.kind = c.kind;
  r.category_id = c.id; r.autoCat = c.id;
  r.note = r.note || (c.how !== 'none' ? catNoteFrom(r.desc) : catNoteFrom(r.desc));
  r.flag = ''; r.on = true;
  const skipList = S.skipWords.filter(Boolean);
  if (SKIP_RE.test(s) || skipList.some(w => s.includes(w.toLowerCase()))) { r.on = false; r.flag = 'Looks like a card bill payment or a transfer between your accounts, so it is unticked.'; }
  const dup = S.entries.find(e => e.kind === r.kind && Math.abs(+e.amount - r.amount) < 0.01 && e.date && r.date && Math.abs(new Date(e.date) - new Date(r.date)) <= 2 * 864e5);
  if (dup && r.on) { r.on = false; r.flag = `Looks already logged: ${dup.note || catOf(dup.category_id).name} on ${dayLabel(dup.date)}.`; }
  if (!r.date) { r.on = false; r.flag = (r.flag ? r.flag + ' ' : '') + 'No date found. Add one to include it.'; }
  return r;
}
let impMod = null;
const catNoteFrom = d => impMod ? impMod.prettyMerchant(d) : String(d || '').slice(0, 40);
async function startImport(file, password) {
  const I = impState();
  I.file = file; I.stage = 'reading'; I.msg = 'Opening the file'; I.pct = 5; I.rows = null; render();
  try {
    impMod = impMod || await import('./import.js');
    const res = await impMod.extractFromFile(file, { password, onProgress: (pct, msg) => { if (pct != null) I.pct = pct; if (msg) I.msg = msg; const b = $('#im-bar'), m = $('#im-msg'); if (b) b.style.width = (I.pct || 5) + '%'; if (m) m.textContent = I.msg; } });
    I.method = res.method;
    I.rows = res.rows.map(r => prepRow({ ...r }));
    I.stage = 'review';
  } catch (e) {
    if (impMod && e instanceof impMod.PasswordNeeded) { I.stage = 'password'; I.wrong = e.wrong; }
    else { I.stage = 'error'; I.error = e.message || 'This file could not be read.'; }
  }
  render();
}
async function saveImport() {
  const I = S.imp; if (!I || !I.rows) return;
  const on = I.rows.filter(r => r.on);
  const bad = on.find(r => !(r.amount > 0) || !r.date || !r.category_id);
  if (bad) { toast(!bad.category_id ? 'Pick a category for every ticked line.' : 'Every ticked line needs a date and an amount.'); return; }
  const seen = {};
  const rows = on.map(r => {
    const base = `${r.date}|${r.amount}|${r.kind}|${(r.desc || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`;
    seen[base] = (seen[base] || 0) + 1;
    return { date: r.date, kind: r.kind, amount: r.amount, category_id: r.category_id, goal_id: null, note: (r.note || '').trim(), who: I.who || S.person, scope: I.scope, paid_with: '', source: 'import', import_key: base + '#' + seen[base] };
  });
  const btn = $('[data-act="imsave"]'); if (btn) btn.disabled = true;
  const res = await save(() => S.db.insertMany('entries', rows, 'import_key'));
  if (!res) { if (btn) btn.disabled = false; return; }
  S.entries = S.entries.concat(res);
  // learn rules from category changes
  if (I.learn) {
    const newRules = [];
    for (const r of on) if (r.touched && r.category_id && r.category_id !== r.autoCat) {
      const key = impMod.merchantKey(r.desc);
      if (key.length >= 3 && !S.rules.some(x => x.match === key) && !newRules.some(x => x.match === key)) newRules.push({ match: key, category_id: r.category_id });
    }
    if (newRules.length) { const rr = await save(() => S.db.insertMany('rules', newRules, 'match')); if (rr) S.rules = S.rules.concat(rr); }
  }
  const skipped = rows.length - res.length;
  toast(`Saved ${res.length} entr${res.length === 1 ? 'y' : 'ies'}${skipped ? `, ${skipped} already imported before` : ''}`);
  const months = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort();
  S.imp = { stage: 'pick', who: I.who, scope: I.scope, learn: I.learn };
  if (months.length) S.month = months[months.length - 1] <= thisMonth() ? months[months.length - 1] : thisMonth();
  S.tab = 'entries'; location.hash = 'entries'; render();
}

/* ---------- toast ---------- */
let tt = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2800); }

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) { closeSheet(); return; }
  if (e.target.closest('#sheet')) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'tab') go(b.dataset.tab);
  else if (a === 'view') { S.view = b.dataset.v; ls.set('view', S.view); render(); }
  else if (a === 'month') { const n = addM(S.month, +b.dataset.d); if (n <= thisMonth()) { S.month = n; render(); } }
  else if (a === 'add') entrySheet(null);
  else if (a === 'edit') entrySheet(b.dataset.id);
  else if (a === 'preset') { const p = S.presets.find(x => x.id === b.dataset.id); if (p) entrySheet(null, p); }
  else if (a === 'presets') presetsSheet();
  else if (a === 'catlist') { S.catFilter = b.dataset.id; S.kindFilter = 'spent'; go('entries'); }
  else if (a === 'catclear') { S.catFilter = ''; render(); }
  else if (a === 'kf') { S.kindFilter = b.dataset.k; render(); }
  else if (a === 'goals') goalsSheet();
  else if (a === 'goal') goalEdit(b.dataset.id);
  else if (a === 'budgets') budgetsSheet();
  else if (a === 'cats') catsSheet();
  else if (a === 'rules') rulesSheet();
  else if (a === 'people') peopleSheet();
  else if (a === 'install') installSheet();
  else if (a === 'export') exportCsv();
  else if (a === 'imwho') { impState().who = b.dataset.w; render(); }
  else if (a === 'imreset') { S.imp = { stage: 'pick', who: S.imp?.who || S.person, scope: S.imp?.scope || 'home', learn: S.imp?.learn ?? true }; render(); }
  else if (a === 'impass') { const pw = $('#im-pass')?.value || ''; if (pw) startImport(S.imp.file, pw); }
  else if (a === 'imall') { S.imp.rows.forEach(r => { if (b.dataset.v === '1') { if (r.date) r.on = true; } else r.on = false; }); render(); }
  else if (a === 'imsave') saveImport();
  else if (a === 'signout') { try { await S.client.auth.signOut(); } catch (err) {} location.reload(); }
  else if (a === 'leavedemo') { location.href = location.pathname; }
  else if (a === 'setup') {
    const url = $('#su-url').value.trim().replace(/\/$/, ''), key = $('#su-key').value.trim();
    if (!/^https:\/\/.+/.test(url) || key.length < 20) { toast('Check the URL and key.'); return; }
    ls.set('sbUrl', url); ls.set('sbKey', key); location.reload();
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'login') return;
  e.preventDefault();
  const btn = $('#li-go'), err = $('#li-err');
  btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
  const { data, error } = await S.client.auth.signInWithPassword({ email: $('#li-email').value.trim(), password: $('#li-pass').value });
  if (error) { btn.disabled = false; btn.textContent = 'Sign in'; err.textContent = /invalid/i.test(error.message) ? 'Email or password is wrong.' : error.message; return; }
  S.mode = 'boot'; draw(); await afterLogin(data.session);
});
document.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; const l = $('#elist'); if (l) l.innerHTML = entriesList(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
function go(tab) { if (!TABS.includes(tab)) tab = 'home'; if (tab !== 'entries' && S.tab === 'entries') S.catFilter = ''; S.tab = tab; if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab); render(); window.scrollTo(0, 0); }
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab) { S.tab = h; render(); } });

boot();
