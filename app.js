import { icon, ICON_CHOICES } from './icons.js';
import { supabaseDB, memoryDB } from './db.js';
import { demoSeed, DEFAULT_CATEGORIES } from './demo.js';

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
  people: { me: 'Me', trisha: 'Trisha' }, skipWords: [],
  cats: [], goals: [], entries: [], presets: [], rules: [],
  view: ls.get('view2', 'home'), month: thisMonth(),
  tab: 'home', q: '', kindFilter: 'all', catFilter: '', whoFilter: '',
  imp: null, anim: true
};
const TABS = ['home', 'entries', 'insights', 'import', 'more'];
const VIEWS = () => [['home', 'Household'], ['business', 'Yoga business']];
const whoName = w => w === 'me' ? S.people.me : w === 'trisha' ? S.people.trisha : 'Both';
const UNCAT = { id: '', name: 'No category', icon: 'dots', color: '#8A90AD', kind: 'spent', scope: 'home', budget: 0 };
const catOf = id => S.cats.find(c => c.id === id) || UNCAT;
const goalOf = id => S.goals.find(g => g.id === id);
const scopeOfView = (v = S.view) => v === 'business' ? 'business' : 'home';
const inView = (e, v = S.view) => (e.scope || 'home') === scopeOfView(v);
const monthEntries = (m = S.month, v = S.view) => S.entries.filter(e => (e.date || '').startsWith(m) && inView(e, v));
function totals(list) {
  const t = { in: 0, spent: 0, saved: 0, byCat: {}, byWho: { me: 0, trisha: 0, joint: 0 } };
  for (const e of list) { const a = +e.amount || 0; t[e.kind] += a; if (e.kind === 'spent') { t.byCat[e.category_id || ''] = (t.byCat[e.category_id || ''] || 0) + a; t.byWho[e.who || 'joint'] = (t.byWho[e.who || 'joint'] || 0) + a; } }
  return t;
}
const goalSaved = g => (+g.start_amount || 0) + S.entries.filter(e => e.kind === 'saved' && e.goal_id === g.id).reduce((s, e) => s + (+e.amount || 0), 0);
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || String(b.created_at || '').localeCompare(String(a.created_at || ''));
const activeCats = (kind, scope) => S.cats.filter(c => !c.archived && c.kind === kind && c.scope === scope).sort((a, b) => (a.sort || 0) - (b.sort || 0));
const daysIn = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const NEEDS = new Set(['rent', 'groceries', 'bills', 'transport', 'health', 'milo']);

/* ---------- boot ---------- */
async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  const params = new URLSearchParams(location.search);
  const h = location.hash.slice(1); if (TABS.includes(h)) S.tab = h;
  if (window.NEST_PREVIEW) { const seed = { categories: DEFAULT_CATEGORIES, members: [], ...window.NEST_PREVIEW }; S.db = memoryDB(seed); S.mode = 'demo'; S.email = 'preview'; await loadAll(); return; }
  if (params.has('demo')) { S.db = memoryDB(demoSeed()); S.mode = 'demo'; S.email = 'demo'; await loadAll(); return; }
  const cfg = window.NEST_CONFIG || {};
  const url = cfg.supabaseUrl || ls.get('sbUrl', ''), key = cfg.supabaseKey || ls.get('sbKey', '');
  if (!url || !key) { S.mode = 'setup'; return drawShell(); }
  if (!window.supabase) { S.mode = 'error'; S.error = 'Could not load the sign-in library. Check your internet connection and reload.'; return drawShell(); }
  S.client = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  S.db = supabaseDB(S.client);
  const { data } = await S.client.auth.getSession();
  if (!data.session) { S.mode = 'login'; return drawShell(); }
  if (LOCK.get()) { S.locked = true; drawShell(); setTimeout(() => tryUnlock(true), 350); }
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
  maybeOfferLock();
}
async function loadAll() {
  try {
    const [cats, goals, entries, presets, rules, settings] = await Promise.all(['categories', 'goals', 'entries', 'presets', 'rules', 'settings'].map(t => S.db.all(t)));
    S.cats = cats; S.goals = goals.sort((a, b) => (a.sort || 0) - (b.sort || 0)); S.entries = entries; S.presets = presets.sort((a, b) => (a.sort || 0) - (b.sort || 0)); S.rules = rules;
    const st = Object.fromEntries(settings.map(s => [s.key, s.value]));
    S.people = { me: 'Me', trisha: 'Trisha', ...(st.people || {}) };
    S.skipWords = st.skip_words || [];
    S.usualHidden = st.usual_hidden || null;
    S.dupOk = st.dup_ok || [];
    if (S.mode !== 'demo') S.mode = 'live';
    if (!VIEWS().some(v => v[0] === S.view)) S.view = 'home';
  } catch (e) { S.mode = 'error'; S.error = 'Could not load your data. ' + (e.message || ''); }
  drawShell();
  if (S.mode === 'live' || S.mode === 'demo') { runAutopay(); learnUsual(); }
}
async function refresh() {
  if (S.mode !== 'live') return;
  try { const [entries, goals, presets] = await Promise.all([S.db.all('entries'), S.db.all('goals'), S.db.all('presets')]); S.entries = entries; S.goals = goals.sort((a, b) => (a.sort || 0) - (b.sort || 0)); S.presets = presets.sort((a, b) => (a.sort || 0) - (b.sort || 0)); render(); runAutopay(); } catch (e) {}
}

/* ---------- render ---------- */
let rq = 0;
function render() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; draw(); }); }
function drawShell() { draw(); }
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function draw() {
  const app = $('#app'), tb = $('#tabbarWrap');
  if (S.locked) { tb.hidden = true; app.className = 'app'; app.innerHTML = lockView(); return; }
  if (['setup', 'login', 'notmember', 'error', 'boot'].includes(S.mode)) { tb.hidden = true; app.innerHTML = gateView(); return; }
  tb.hidden = false;
  let h = topBar();
  if (S.tab === 'home') h += viewHome();
  else if (S.tab === 'entries') h += viewEntries();
  else if (S.tab === 'insights') h += viewInsights();
  else if (S.tab === 'import') h += viewImport();
  else h += viewMore();
  app.className = 'app' + (S.anim && !reduceMotion() ? ' anim' : '');
  app.innerHTML = h;
  $('#tabbar').innerHTML = tabBar();
  if (S.tab === 'import') mountImport();
  if (S.anim) countUp(app);
  S.anim = false;
}
function countUp(root) {
  const els = root.querySelectorAll('[data-count]');
  if (!els.length || reduceMotion()) return;
  const t0 = performance.now(), dur = 750;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    els.forEach(el => { const v = +el.dataset.count * e; el.textContent = el.dataset.fmt === 'k' ? fmtK(v) : el.dataset.fmt === 'pct' ? Math.round(v) + '%' : fmt(v); });
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const cnt = (v, f = 'r') => `<span data-count="${Math.round(v)}" data-fmt="${f}">${f === 'k' ? fmtK(v) : f === 'pct' ? Math.round(v) + '%' : fmt(v)}</span>`;
function gateView() {
  const brand = `<div class="mark">${icon('leaf')}</div>`;
  if (S.mode === 'boot') return `<div class="skel"></div>`;
  if (S.mode === 'setup') return `<div class="login">${nestArt()}<h1>Connect Nest</h1><p>Paste your Supabase project URL and anon key. You'll find both in Supabase under Project Settings → API. This is only needed until they're saved in config.js.</p>
    <div class="field"><label for="su-url">Project URL</label><input class="inp" id="su-url" placeholder="https://xxxx.supabase.co" autocomplete="off"></div>
    <div class="field"><label for="su-key">Anon / publishable key</label><input class="inp" id="su-key" placeholder="eyJ… or sb_publishable_…" autocomplete="off"></div>
    <button class="btn primary block" data-act="setup">Connect</button>
    <a class="link" href="?demo">Try it with example data first</a></div>`;
  if (S.mode === 'login') return `<div class="login">${nestArt()}<h1>Welcome home</h1><p>Your household's money: what came in, what went out, what you put away.</p>
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
  const sub = { home: '', entries: 'Every rupee, in order', insights: 'How the month went', import: 'Import statements', more: 'Settings' }[S.tab];
  let h = `<header class="top"><div class="brand"><h1 class="hand">Our Nest</h1>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    <div class="topr"><span class="avs" aria-hidden="true">${avatar('me')}${avatar('trisha')}</span><button class="iconbtn" data-act="tab" data-tab="import" aria-label="Import a statement or screenshot">${icon('upload')}</button></div></header>`;
  if (S.mode === 'demo' && !window.NEST_PREVIEW) h += `<div class="statusbar warn">Example data. Nothing here is real and nothing you change is saved.</div>`;
  if (S.tab === 'home' || S.tab === 'entries' || S.tab === 'insights') {
    h += `<div class="seg viewseg" role="group" aria-label="Household or business">${VIEWS().map(([k, l]) => `<button data-act="view" data-v="${k}" aria-pressed="${S.view === k}">${icon(k === 'home' ? 'home' : 'lotus', 'sm')} ${esc(l)}</button>`).join('')}</div>`;
    h += `<div class="monthbar"><button data-act="month" data-d="-1" aria-label="Previous month">${icon('chevl', 'sm')}</button><h2 class="hand">${mLabel(S.month)}</h2>
      <button data-act="month" data-d="1" aria-label="Next month" ${S.month >= thisMonth() ? 'disabled' : ''}>${icon('chevr', 'sm')}</button></div>`;
  }
  return h;
}
function tabBar() {
  const t = (k, ic, l) => `<button class="tab" data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></button>`;
  return t('home', 'home', 'Home') + t('entries', 'list', 'Entries') + `<button class="fab" data-act="add" aria-label="Add an entry">${icon('plus')}</button>` + t('insights', 'chart', 'Insights') + t('more', 'gear', 'More');
}
/* pastel of a category colour, for light and dark paper */
function mix(hex, to, k) { const h = (hex || '#8A90AD').replace('#', ''); const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)), t = [0, 2, 4].map(i => parseInt(to.slice(i + 1, i + 3), 16)); return '#' + c.map((v, i) => Math.round(v + (t[i] - v) * k).toString(16).padStart(2, '0')).join(''); }
const tints = c => `--c:${c};--t:${mix(c, '#FFFFFF', 0.66)};--td:${mix(c, '#232838', 0.55)}`;
const under = (cls = '') => `<svg class="und ${cls}" viewBox="0 0 150 12" preserveAspectRatio="none" aria-hidden="true"><path d="M3 8 C30 3 60 10 90 6 S135 4 147 7"/></svg>`;

/* ----- illustrations ----- */
let artId = 0;
function houseArt(pct, over) {
  const id = 'h' + (++artId), p = Math.max(0, Math.min(1, pct || 0)), top = 96 - p * 52;
  return `<svg class="house" viewBox="0 0 110 100" aria-hidden="true">
    <defs><clipPath id="${id}"><path d="M24 44 L24 96 L86 96 L86 44 L55 18 Z"/></clipPath></defs>
    <g clip-path="url(#${id})"><rect class="h-fill ${over ? 'over' : ''}" x="0" y="${top}" width="110" height="100"/></g>
    <path class="h-line" d="M12 50 L55 12 L98 50 M24 42 V96 H86 V42 M48 96 V72 H62 V96 M70 26 V12 H79 V34"/>
    <path class="h-line thin" d="M31 58 h12 v11 h-12z M37 58 v11 M31 63.5 h12"/>
    <path class="h-ground" d="M2 97 C30 92 70 101 108 95"/>
    <path class="h-bird" d="M88 6 q4 -5 8 0 q4 -5 8 0"/>
  </svg>`;
}
function nestArt(small) {
  return `<svg class="nestart${small ? ' sm' : ''}" viewBox="0 0 160 96" aria-hidden="true">
    <ellipse cx="80" cy="44" rx="17" ry="21" class="egg e1"/><ellipse cx="58" cy="50" rx="15" ry="19" class="egg e2"/><ellipse cx="102" cy="50" rx="15" ry="19" class="egg e3"/>
    <path d="M18 56 Q80 104 142 56 Q136 84 80 90 Q24 84 18 56 Z" class="bowl"/>
    <path d="M24 62 Q80 96 136 62 M30 70 Q80 98 130 70 M44 80 Q80 94 116 80" class="twig"/>
    <path d="M20 58 L36 52 M140 58 L124 52 M60 88 L52 96 M104 88 L112 95" class="twig"/>
  </svg>`;
}
function jarArt(pct, color) {
  const id = 'j' + (++artId), p = Math.max(0, Math.min(1, pct || 0)), top = 52 - p * 36;
  return `<svg class="jar" viewBox="0 0 44 56" aria-hidden="true" style="--c:${color}">
    <defs><clipPath id="${id}"><path d="M9 16 h26 q4 0 4 6 v24 q0 6 -6 6 h-22 q-6 0 -6 -6 v-24 q0 -6 4 -6 z"/></clipPath></defs>
    <g clip-path="url(#${id})"><rect class="j-fill" x="0" y="${top}" width="44" height="60"/></g>
    <path d="M9 16 h26 q4 0 4 6 v24 q0 6 -6 6 h-22 q-6 0 -6 -6 v-24 q0 -6 4 -6 z" class="j-line"/>
    <rect x="11" y="8" width="22" height="7" rx="2.5" class="j-lid"/>
  </svg>`;
}
const avatar = w => `<span class="ava ava-${w}">${w === 'joint' ? icon('users', 'sm') : esc((whoName(w) || '?')[0].toUpperCase())}</span>`;

/* ----- home ----- */
function budgetTotal(scope = scopeOfView()) { return activeCats('spent', scope).reduce((s, c) => s + (+c.budget || 0), 0); }
function viewHome() {
  const list = monthEntries(), t = totals(list), biz = S.view === 'business', m = S.month, isCur = m === thisMonth(), mon = MONTHS[+m.slice(5) - 1];
  const B = budgetTotal(), left = biz ? t.in - t.spent : t.in - t.spent - t.saved;
  const fillPct = B ? t.spent / B : t.in ? (t.spent + t.saved) / t.in : 0;
  const fillLbl = B ? `${Math.round(t.spent / B * 100)}% of the budget used` : t.in ? `${Math.round((t.spent + t.saved) / t.in * 100)}% of what came in, used` : '';
  const headline = !t.in ? { l: biz ? 'spent on the business' : 'spent so far', v: t.spent, bad: false } : biz ? { l: left >= 0 ? 'business profit' : 'business loss', v: Math.abs(left), bad: left < 0 } : left >= 0 ? { l: 'left in the nest', v: left, bad: false } : { l: 'over what came in', v: -left, bad: true };
  const inPreset = S.presets.find(p => !p.auto && p.kind === 'in' && (p.scope || 'home') === scopeOfView());
  const addIn = inPreset ? `data-act="preset" data-id="${inPreset.id}"` : `data-act="addin"`;
  let h = `<section class="nbhero">${houseArt(fillPct, fillPct > 1)}
    <div class="hand lbl">${esc(headline.l)}</div>
    <div class="big num${headline.bad ? ' bad' : ''}">${cnt(headline.v)}</div>${under(headline.bad ? 'bad' : '')}
    ${fillLbl ? `<div class="hand fill">${esc(fillLbl)}</div>` : ''}
    <div class="ledger">
      <div><span class="hand">came in</span><b class="num">${t.in ? cnt(t.in) : '—'}</b>${t.in ? '' : `<button class="hand pen" ${addIn}>← add ${biz ? 'income' : 'salary'}</button>`}</div>
      ${t.in ? `<div><span class="hand">spent</span><b class="num">${cnt(t.spent)}</b></div>` : ''}
      ${biz ? `<div><span class="hand">margin</span><b class="num">${t.in ? cnt(Math.max(0, left / t.in * 100), 'pct') : '—'}</b></div>` : `<div><span class="hand">saved</span><b class="num">${cnt(t.saved)}</b>${!t.saved && list.length ? `<span class="hand pen">← nothing yet!</span>` : ''}</div>`}
    </div></section>`;
  const dn = findDupes(scopeOfView()).length;
  if (dn) h += `<button class="statusbar warn dupbar" data-act="dupes">${icon('copy', 'sm')}<span><b>${dn} possible duplicate${dn === 1 ? '' : 's'}</b> · same amount logged twice. Tap to check.</span>${icon('chevr', 'sm')}</button>`;
  // the month on a sticky note
  const top = Object.entries(t.byCat).sort((a, b) => b[1] - a[1])[0];
  if (t.spent) {
    let tone = 'y', txt;
    if (isCur) {
      const d = new Date().getDate(), proj = t.spent / d * daysIn(m), perDay = t.spent / d, avgPrev = avgMonthlySpend(m);
      tone = B ? (proj > B * 1.05 ? 'p' : proj > B * 0.9 ? 'y' : 'g') : avgPrev ? (proj > avgPrev * 1.1 ? 'p' : 'g') : 'y';
      txt = `${fmt(perDay)} a day so far. At this pace ${mon} ends near ${fmtK(proj)}${B ? `, against a ${fmtK(B)} budget` : avgPrev ? `; usually it's ${fmtK(avgPrev)}` : ''}.`;
    } else {
      txt = `${t.in ? `Spent ${Math.round(t.spent / t.in * 100)}% of what came in. ` : ''}${top ? `${catOf(top[0]).name} was the big one at ${fmtK(top[1])}.` : ''}`;
      if (t.in && t.saved / t.in >= 0.2) { tone = 'g'; txt += ` Saved ${Math.round(t.saved / t.in * 100)}%, nicely done.`; }
    }
    h += `<section class="sticky s-${tone}"><i class="tape" aria-hidden="true"></i><p class="hand">${esc(txt)}</p></section>`;
  }
  // quick add
  const sc = scopeOfView();
  const allPs = S.presets.filter(p => !p.auto && (p.scope || 'home') === sc);
  const done = allPs.filter(p => presetMonthly(p) && presetLogged(p, thisMonth()));
  const ps = allPs.filter(p => !done.includes(p));
  const qbtn = p => { const c = catOf(p.category_id); return `<button class="qbtn" data-act="preset" data-id="${p.id}" style="${tints(c.color)}">${icon(c.icon, 'sm')}<span>${esc(p.label)}</span>${p.amount ? `<small class="num">${fmtK(p.amount)}</small>` : ''}</button>`; };
  if (allPs.length || !S.presets.length) h += `<section class="bare"><div class="card-h"><h2>Quick add</h2><button class="link" data-act="presets">edit</button></div>
    ${ps.length ? `<div class="qchips">${ps.map(qbtn).join('')}</div>` : allPs.length ? `<p class="hand note-l">All the monthly ones are in for ${MONTHS[+thisMonth().slice(5) - 1]}. Nice.</p>` : `<p class="hand note-l">Make one-tap buttons for things you log often, like rent or groceries.</p>`}
    ${done.length ? `<p class="qdone"><span class="hand">done for ${MONTHS[+thisMonth().slice(5) - 1]}:</span> ${done.map(p => `<button data-act="preset" data-id="${p.id}" aria-label="Add ${esc(p.label)} again">${esc(p.label)}<i>✓</i></button>`).join('')}</p>` : ''}
  </section>`;
  if (!list.length) {
    h += `<div class="card"><div class="empty">${nestArt(true)}<b>The nest is quiet in ${mon}</b><p>Tap + to add what came in or went out, or import a statement.</p><div class="btnrow" style="width:100%"><button class="btn primary" data-act="add">${icon('plus', 'sm')} Add</button><button class="btn" data-act="tab" data-tab="import">${icon('upload', 'sm')} Import</button></div></div></div>`;
    return h + goalsStrip();
  }
  // where it went: highlighter strokes
  const cats = Object.entries(t.byCat).map(([id, v]) => ({ c: catOf(id), v })).sort((a, b) => b.v - a.v);
  for (const c of activeCats('spent', sc)) if (c.budget > 0 && !t.byCat[c.id]) cats.push({ c, v: 0 });
  const max = Math.max(...cats.map(x => x.v), 1);
  h += `<section class="bare"><div class="card-h"><h2>Where it went</h2><button class="link" data-act="budgets">${B ? 'budgets' : 'set budgets'}</button></div><div class="hls">
    ${cats.slice(0, 7).map(({ c, v }, i) => {
      const b = +c.budget || 0, over = b && v > b;
      const note = over ? `${fmtK(v - b)} over!` : i === 0 && t.spent && v / t.spent > 0.3 ? 'big one!' : '';
      return `<button class="crow" data-act="catlist" data-id="${esc(c.id)}" style="${tints(over ? '#D9483B' : c.color)};--i:${i}"><span class="cn">${esc(c.name)}</span>
        <span class="hl"><i style="width:${Math.max(2, Math.min(100, (b ? v / b : v / max) * 100))}%"></i>${b && !over ? `<em style="left:100%"></em>` : ''}</span>
        <span class="ca"><b class="num">${fmt(v)}</b>${b ? `<small>of ${fmtK(b)}</small>` : ''}</span>${note ? `<span class="side hand">← ${note}</span>` : ''}</button>`;
    }).join('')}</div>${cats.length > 7 ? `<button class="link" data-act="tab" data-tab="insights">see all ${cats.length} →</button>` : ''}</section>`;
  // coming up (autopays already placed in this month, still ahead)
  if (isCur) {
    const up = list.filter(e => e.source === 'auto' && e.date > today()).sort((a, b) => a.date.localeCompare(b.date));
    if (up.length) h += `<section class="bare"><div class="card-h"><h2>Coming up</h2><span class="small muted">${fmt(up.reduce((s, e) => s + +e.amount, 0))} on autopay</span></div>
      <div class="clip">${up.slice(0, 6).map(e => { const c = catOf(e.category_id); return `<button class="up" data-act="edit" data-id="${e.id}"><span class="up-d"><b>${+e.date.slice(8)}</b>${mShort(e.date)}</span><span class="up-n">${esc(e.note || c.name)}</span><span class="num">${fmt(e.amount)}</span></button>`; }).join('')}</div></section>`;
  }
  // who spent
  if (!biz && t.spent) {
    const W = t.byWho, tot = t.spent;
    h += `<section class="bare"><div class="card-h"><h2>Who spent it</h2><span class="small muted">all of it is household</span></div><div class="clip who">
      <div class="whobar">${['me', 'joint', 'trisha'].filter(w => W[w]).map(w => `<i class="w-${w}" style="flex:${W[w]}"></i>`).join('')}</div>
      <div class="wholist">${['me', 'joint', 'trisha'].map(w => `<button class="whoi" data-act="whof" data-w="${w}">${avatar(w)}<span><b>${esc(whoName(w))}</b><small class="num">${fmtK(W[w] || 0)} · ${Math.round((W[w] || 0) / tot * 100)}%</small></span></button>`).join('')}</div></div></section>`;
  }
  h += goalsStrip();
  const rec = list.filter(e => e.date <= today()).sort(byDateDesc).slice(0, 5);
  if (rec.length) h += `<section class="bare"><div class="card-h"><h2>Latest</h2><button class="link" data-act="tab" data-tab="entries">see all →</button></div><div class="clip rows">${rec.map(entryRow).join('')}</div></section>`;
  return h;
}
function avgMonthlySpend(m, n = 3, v = S.view) {
  const vals = [1, 2, 3, 4, 5, 6].map(k => totals(monthEntries(addM(m, -k), v)).spent).filter(x => x > 0).slice(0, n);
  return vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; // needs two months to call it "usual"
}
/* a quick-add is "monthly" (hides once logged) unless it's a thing you buy many times a month */
const FREQUENT_CATS = new Set(['groceries', 'food', 'transport', 'shopping', 'fun', 'b_travel']);
function presetMonthly(p) {
  if (FREQUENT_CATS.has(p.category_id)) return false;
  for (let k = 1; k <= 3; k++) if (presetCount(p, addM(thisMonth(), -k)) >= 2) return false;
  return true;
}
function presetCount(p, m) {
  const note = (p.note || '').trim().toLowerCase();
  return S.entries.filter(e => (e.date || '').startsWith(m) && (e.preset_id === p.id || (e.kind === p.kind && note && (e.note || '').trim().toLowerCase() === note))).length;
}
function presetLogged(p, m = thisMonth()) {
  const note = (p.note || '').trim().toLowerCase();
  const same = e => e.kind === p.kind && note && (e.note || '').trim().toLowerCase() === note && (!p.auto || Math.abs(+e.amount - +p.amount) < 0.01);
  return S.entries.filter(e => (e.date || '').startsWith(m) && (e.preset_id === p.id || same(e))).sort(byDateDesc)[0];
}
/* how often an autopay comes round: every month, 3 months, 6 months or once a year */
const EVERY = { month: [1, 'Monthly'], quarter: [3, 'Every 3 months'], half: [6, 'Every 6 months'], year: [12, 'Yearly'] };
const everyOf = p => EVERY[p.every] ? p.every : 'month';
const anchorMonth = p => +p.due_month || +(p.starts_on || today()).slice(5, 7);
function isDue(p, m) { const step = EVERY[everyOf(p)][0]; if (step === 1) return true; const mo = +m.slice(5, 7); return ((mo - anchorMonth(p)) % step + step) % step === 0; }
function everyText(p) {
  const d = p.due_day || 1, e = everyOf(p), mon = MONTHS[anchorMonth(p) - 1].slice(0, 3);
  if (e === 'month') return `Every month on day ${d}`;
  if (e === 'year') return `Every year on ${d} ${mon}`;
  return `${EVERY[e][1]} from ${mon}, on day ${d}`;
}
const perMonth = p => (+p.amount || 0) / EVERY[everyOf(p)][0];
function dueDate(p, m = thisMonth()) { const last = daysIn(m); return `${m}-${pad(Math.min(p.due_day || 1, last))}`; }
function goalsStrip() {
  if (S.view === 'business') return '';
  const gs = S.goals.filter(g => !g.archived);
  return `<section class="bare"><div class="card-h"><h2>Saving for</h2><button class="link" data-act="goals">${gs.length ? 'all goals' : 'add a goal'}</button></div>
  ${gs.length ? `<div class="hscroll postrow">${gs.map((g, i) => goalCard(g, i, true)).join('')}</div>` : `<p class="hand note-l">Log money as Saved → towards a goal, and it shows up here.</p>`}</section>`;
}
function goalMeta(g, s) {
  if (!g.target) return 'tap to set a target';
  const left = Math.max(0, g.target - s);
  if (!left) return 'done! well saved';
  if (g.target_date) { const [y, m] = g.target_date.split('-').map(Number), [y0, m0] = thisMonth().split('-').map(Number); const n = (y - y0) * 12 + (m - m0) + 1;
    return n > 0 ? `${fmtK(Math.ceil(left / n / 100) * 100)} a month to make it by ${mShort(g.target_date.slice(0, 7))} ${y}` : `${fmtK(left)} still to go`; }
  return `${fmtK(left)} to go`;
}
function goalArt(g) {
  const k = 'class="ga"';
  const A = {
    car: `<path ${k} d="M12 64 l10 -20 h46 l10 20 v12 h-66z" fill="#fff"/><path ${k} d="M28 46 h32 l7 14 h-46z" fill="#CFE3F7"/><circle cx="30" cy="77" r="7" fill="#2A3352"/><circle cx="66" cy="77" r="7" fill="#2A3352"/><path ${k} d="M4 86 H92"/>`,
    home: `<path ${k} d="M16 50 L48 24 L80 50 V86 H16Z" fill="#fff"/><rect ${k} x="40" y="62" width="16" height="24" fill="#FFE27A"/><rect ${k} x="22" y="56" width="12" height="10" fill="#CFE3F7"/><path ${k} d="M66 34 V22 h8 v19" fill="#fff"/>`,
    key: `<path ${k} d="M16 50 L48 24 L80 50 V86 H16Z" fill="#fff"/><rect ${k} x="40" y="62" width="16" height="24" fill="#FFE27A"/><rect ${k} x="22" y="56" width="12" height="10" fill="#CFE3F7"/>`,
    plane: `<circle ${k} cx="70" cy="28" r="10" fill="#FFE27A"/><path ${k} d="M2 86 C18 70 34 74 48 80 S80 72 94 82 V96 H2Z" fill="#9ED8FF"/><path ${k} d="M30 76 V44 M30 44 c-10 -2 -16 4 -18 8 M30 44 c8 -6 16 -2 18 4 M30 44 c-4 -8 2 -14 8 -14" fill="none"/>`,
    heart: `<path ${k} d="M48 80 C20 60 14 44 22 34 C30 24 44 28 48 38 C52 28 66 24 74 34 C82 44 76 60 48 80Z" fill="#fff"/><path ${k} d="M30 40 q4 -6 10 -4" fill="none"/>`,
    gift: `<rect ${k} x="18" y="42" width="60" height="42" fill="#fff"/><rect ${k} x="14" y="32" width="68" height="12" fill="#FFE27A"/><path ${k} d="M48 32 V84 M48 32 c-6 -12 -22 -12 -18 -2 c2 4 12 2 18 2 c6 0 16 2 18 -2 c4 -10 -12 -10 -18 2" fill="none"/>`,
    book: `<path ${k} d="M14 30 Q32 24 48 32 Q64 24 82 30 V78 Q64 72 48 80 Q32 72 14 78Z" fill="#fff"/><path ${k} d="M48 32 V80" fill="none"/>`
  };
  const art = A[g.icon] || `<g transform="translate(24 24) scale(2)" style="color:#2A3352">${icon(g.icon || 'target')}</g>`;
  return `<svg viewBox="0 0 96 96" aria-hidden="true">${art}</svg>`;
}
const dots = (p, n = 10) => `<span class="dots" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i < Math.round(p * n) ? 'f' : ''}" style="--i:${i}"></i>`).join('')}</span>`;
function goalCard(g, i, mini) {
  const s = goalSaved(g), p = g.target ? Math.min(1, s / g.target) : 0, rot = [-1.4, 1.1, -0.7, 1.5][i % 4];
  return `<button class="pcard${mini ? ' mini' : ''}" data-${mini ? 'act="goal" data-id' : 'gid'}="${g.id}" style="--r:${rot}deg;${tints(g.color)}"><i class="tape" aria-hidden="true"></i>
    <span class="pic" style="background:${mix(g.color, '#FFFFFF', 0.6)}">${goalArt(g)}${g.target ? `<span class="stampd">${Math.round(p * 100)}%</span>` : ''}</span>
    <span class="pt"><b class="gname">${esc(g.name)}</b><span class="amt"><b class="num">${fmtK(s)}</b>${g.target ? ` <span>of ${fmtK(g.target)}</span>` : ''}</span>${g.target ? dots(p) : ''}<span class="gmeta">${esc(goalMeta(g, s))}</span></span></button>`;
}
function entryRow(e) {
  const c = catOf(e.category_id), g = e.goal_id ? goalOf(e.goal_id) : null;
  const title = e.note || (g ? g.name : c.name);
  const sub = [e.note ? c.name + (g ? ' · ' + g.name : '') : (g ? c.name : ''), whoName(e.who)].filter(Boolean).join(' · ');
  const sign = e.kind === 'in' ? '+' : e.kind === 'saved' ? '' : '−', up = e.date > today();
  return `<button class="row${up ? ' later' : ''}" data-act="edit" data-id="${e.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon)}</span>
    <div class="r-main"><div class="r-name"><span class="r-t">${esc(title)}</span>${e.source === 'auto' ? `<span class="tag auto">${up ? 'upcoming' : 'auto'}</span>` : ''}${e.kind === 'saved' ? '<span class="tag">saved</span>' : ''}</div><div class="r-sub">${esc(sub)}</div></div>
    <div class="r-amt num ${e.kind}">${sign}${fmt(e.amount).replace('−', '')}</div></button>`;
}

/* ----- entries ----- */
function viewEntries() {
  const f = (k, l) => `<button class="chip" data-act="kf" data-k="${k}" aria-pressed="${S.kindFilter === k}">${l}</button>`;
  const w = (k, l) => `<button class="chip" data-act="whof" data-w="${k}" aria-pressed="${S.whoFilter === k}">${l}</button>`;
  return `<label class="search">${icon('search', 'sm')}<input id="q" type="search" placeholder="Search what for, category, who" value="${esc(S.q)}" aria-label="Search entries"></label>
    <div class="chips">${f('all', 'All')}${f('spent', 'Spent')}${f('in', 'Came in')}${f('saved', 'Saved')}<span class="chipsep"></span>${w('', 'Anyone')}${w('me', esc(S.people.me))}${w('trisha', esc(S.people.trisha))}${w('joint', 'Both')}${S.catFilter ? `<button class="chip" data-act="catclear" aria-pressed="true">${esc(catOf(S.catFilter).name)} ${icon('x', 'sm')}</button>` : ''}</div>
    <div id="elist">${entriesList()}</div>`;
}
function entriesList() {
  let list = monthEntries();
  if (S.kindFilter !== 'all') list = list.filter(e => e.kind === S.kindFilter);
  if (S.whoFilter) list = list.filter(e => (e.who || 'joint') === S.whoFilter);
  if (S.catFilter) list = list.filter(e => (e.category_id || '') === S.catFilter);
  const q = S.q.trim().toLowerCase();
  if (q) list = list.filter(e => [e.note, catOf(e.category_id).name, whoName(e.who), goalOf(e.goal_id)?.name].join(' ').toLowerCase().includes(q));
  list.sort(byDateDesc);
  if (!list.length) return `<div class="card"><div class="empty">${nestArt(true)}<b>Nothing here</b><p>${q || S.kindFilter !== 'all' || S.catFilter || S.whoFilter ? 'Try another search or filter, or another month.' : 'No entries this month yet.'}</p></div></div>`;
  const t = totals(list);
  const groups = {}; for (const e of list) (groups[e.date] = groups[e.date] || []).push(e);
  let h = `<div class="sumline"><span><i class="dot in"></i>${fmt(t.in)} in</span><span><i class="dot spent"></i>${fmt(t.spent)} spent</span><span><i class="dot saved"></i>${fmt(t.saved)} saved</span></div><section class="card" style="padding-top:2px">`;
  for (const [d, es] of Object.entries(groups)) {
    const sp = es.filter(e => e.kind === 'spent').reduce((s, e) => s + (+e.amount), 0);
    h += `<div class="dayh"><span>${d > today() ? 'Coming up · ' : ''}${dayLabel(d)}</span><span>${sp ? fmt(sp) : ''}</span></div><div class="rows">${es.map(entryRow).join('')}</div>`;
  }
  return h + `</section><p class="small muted" style="text-align:center;margin:0">Tap any entry to change or delete it.</p>`;
}

/* ----- insights ----- */
function viewInsights() {
  const m = S.month, biz = S.view === 'business', list = monthEntries(m), t = totals(list);
  const months = [5, 4, 3, 2, 1, 0].map(k => addM(m, -k)).map(mm => ({ m: mm, ...totals(monthEntries(mm)) }));
  const avg = avgMonthlySpend(m), prevCats = avgCatSpend(m);
  if (!months.some(x => x.spent || x.in)) return `<div class="card"><div class="empty">${nestArt(true)}<b>No numbers yet</b><p>Insights appear once a few entries are in. Add some, or import a statement.</p></div></div>`;
  let h = '';
  // the month in a sentence
  const topCat = Object.entries(t.byCat).sort((a, b) => b[1] - a[1])[0];
  const jumps = Object.entries(t.byCat).map(([id, v]) => ({ id, v, d: v - (prevCats[id] || 0) })).filter(x => prevCats[x.id] !== undefined).sort((a, b) => b.d - a.d);
  const diff = avg ? (t.spent - avg) / avg : 0;
  h += `<section class="bare story"><p class="hand">${t.spent ? `${m === thisMonth() ? 'So far' : MONTHS[+m.slice(5) - 1]} cost <u>${fmtK(t.spent)}</u>${avg ? `, ${Math.abs(Math.round(diff * 100))}% ${diff >= 0 ? 'more' : 'less'} than usual (${fmtK(avg)})` : ''}.` : `Nothing spent in ${MONTHS[+m.slice(5) - 1]} yet.`}
    ${topCat ? ` ${esc(catOf(topCat[0]).name)} took the most, ${fmtK(topCat[1])}.` : ''}${jumps[0] && jumps[0].d > 1000 ? ` Biggest jump: ${esc(catOf(jumps[0].id).name)}, up ${fmtK(jumps[0].d)}.` : ''}</p></section>`;
  // trend
  h += `<section class="card graph"><div class="card-h"><h2>Six months</h2><span class="legend-inline"><i class="dot spent"></i>Spent${biz ? '' : '<i class="dot saved"></i>Saved'}<i class="dot in"></i>Came in</span></div>${trendChart(months, biz)}</section>`;
  // categories
  const ents = Object.entries(t.byCat).sort((a, b) => b[1] - a[1]);
  if (ents.length) {
    h += `<section class="card"><div class="card-h"><h2>By category</h2><span class="small muted">vs your 3-month average</span></div>
      <div class="donutwrap">${donut(ents.map(([id, v]) => ({ c: mix(catOf(id).color, '#FFFFFF', 0.35), v })), t.spent)}<div class="donut-c"><b class="num">${fmtK(t.spent)}</b><span>spent</span></div></div>
      <div class="rows">${ents.map(([id, v]) => { const c = catOf(id), a = prevCats[id], ch = a ? (v - a) / a : null;
        return `<button class="row slim" data-act="catlist" data-id="${esc(id)}"><span class="bub" style="--c:${c.color}">${icon(c.icon, 'sm')}</span><div class="r-main"><div class="r-name">${esc(c.name)}</div><div class="r-sub">${Math.round(v / t.spent * 100)}% of spending${a ? ` · usually ${fmt(a)}` : ''}</div></div>
          <div class="r-amt num">${fmt(v)}${ch != null && Math.abs(ch) >= 0.1 ? `<span class="delta ${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(Math.round(ch * 100))}%</span>` : ''}</div></button>`; }).join('')}</div></section>`;
  }
  // insights to act on
  const ins = insightsFor(m);
  if (ins.length) h += `<section class="sticky s-p todo"><i class="tape" aria-hidden="true"></i><h2 class="hand">Things to try</h2>${ins.map(i => `<div class="td t-${i.tone}"><span class="box" aria-hidden="true">${i.tone === 'good' ? '✓' : i.tone === 'bad' ? '!' : ''}</span><div><b>${esc(i.title)}</b><p>${esc(i.body)}</p></div></div>`).join('')}</section>`;
  // budget plan
  if (!biz) h += budgetPlan(m, t);
  // daily rhythm
  if (t.spent) h += `<section class="card"><div class="card-h"><h2>Daily rhythm</h2><span class="small muted">darker = more spent</span></div>${heatmap(m, list)}${weekendLine(list)}</section>`;
  // top places
  const places = {}; for (const e of list) if (e.kind === 'spent' && e.note) { const k = e.note.trim(); (places[k] = places[k] || { n: 0, v: 0, c: e.category_id }).n++; places[k].v += +e.amount; }
  const tp = Object.entries(places).sort((a, b) => b[1].v - a[1].v).slice(0, 6);
  if (tp.length) { const mx = tp[0][1].v;
    h += `<section class="card"><div class="card-h"><h2>Where the money goes most</h2></div><div>${tp.map(([n, x], i) => `<div class="place"><span class="rank">${i + 1}</span><div style="min-width:0"><div class="c-top"><b>${esc(n)}</b><span>${fmt(x.v)} · ${x.n}×</span></div><div class="bar thin" style="--c:${catOf(x.c).color}"><i style="width:${x.v / mx * 100}%"></i></div></div></div>`).join('')}</div></section>`; }
  return h;
}
function avgCatSpend(m, v = S.view) {
  const ms = [1, 2, 3].map(k => monthEntries(addM(m, -k), v)).filter(l => l.some(e => e.kind === 'spent'));
  const out = {}; if (ms.length < 2) return out;
  for (const l of ms) for (const [k, val] of Object.entries(totals(l).byCat)) out[k] = (out[k] || 0) + val / ms.length;
  return out;
}
function trendChart(months, biz) {
  const W = 320, H = 170, L = 34, B = 22, T = 18, cw = (W - L - 6) / months.length;
  const max = Math.max(1, ...months.map(x => Math.max(x.in, x.spent + (biz ? 0 : x.saved)))) * 1.1;
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max].map(v => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="tc-grid"/><text x="${L - 4}" y="${y(v) + 3}" class="tc-ax" text-anchor="end">${v ? fmtK(v).replace('₹', '') : '0'}</text>`).join('');
  const bars = months.map((x, i) => { const x0 = L + i * cw + cw * 0.2, bw = cw * 0.6, ys = y(x.spent), ysv = y(x.spent + (biz ? 0 : x.saved)), cur = x.m === S.month;
    return `<g class="tc-col${cur ? ' cur' : ''}" data-act="pickmonth" data-m="${x.m}" style="--i:${i}"><rect x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent"/>
      ${biz ? '' : `<rect x="${x0}" y="${ysv}" width="${bw}" height="${Math.max(0, ys - ysv)}" rx="3" class="tc-saved"/>`}
      <rect x="${x0}" y="${ys}" width="${bw}" height="${Math.max(0, H - B - ys)}" rx="3" class="tc-spent"/>
      ${x.spent ? `<text x="${x0 + bw / 2}" y="${ysv - 4}" class="tc-val" text-anchor="middle">${fmtK(x.spent).replace('₹', '')}</text>` : ''}
      <text x="${x0 + bw / 2}" y="${H - 5}" class="tc-ax${cur ? ' cur' : ''}" text-anchor="middle">${mShort(x.m)}</text>${cur ? `<ellipse cx="${x0 + bw / 2}" cy="${H - 10}" rx="${cw * 0.42}" ry="10" class="tc-circ" transform="rotate(-6 ${x0 + bw / 2} ${H - 10})"/>` : ''}</g>`; }).join('');
  const pts = months.map((x, i) => [L + i * cw + cw / 2, y(x.in), x.in]).filter(p => p[2] > 0);
  const line = pts.length > 1 ? `<polyline points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}" class="tc-line"/>` : '';
  const dots = pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="tc-dot"/>`).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Spending by month">${ticks}${bars}${line}${dots}</svg></div><p class="hand note-s">tap a month to see it</p>`;
}
function donut(segs, total) {
  const C = 2 * Math.PI * 42; let off = 0;
  const arcs = segs.map((s, i) => { const L = s.v / total * C, g = segs.length > 1 ? Math.min(2, L * 0.3) : 0; const a = `<circle cx="50" cy="50" r="42" fill="none" stroke="${s.c}" stroke-width="12" stroke-dasharray="${Math.max(0, L - g)} ${C}" stroke-dashoffset="${-off}" class="arc" style="--i:${i}"/>`; off += L; return a; }).join('');
  return `<svg class="donut" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" class="d-track" stroke-width="12"/>${arcs}</svg>`;
}
function heatmap(m, list) {
  const days = daysIn(m), first = (new Date(m + '-01T00:00:00').getDay() + 6) % 7, per = {};
  for (const e of list) if (e.kind === 'spent') per[+e.date.slice(8)] = (per[+e.date.slice(8)] || 0) + +e.amount;
  const vals = Object.values(per), mx = Math.max(1, ...vals.map(v => Math.min(v, percentile(vals, 0.9) || v)));
  let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span class="hm-h">${d}</span>`).join('') + '<span></span>'.repeat(first);
  for (let d = 1; d <= days; d++) { const v = per[d] || 0, k = v ? 0.18 + 0.82 * Math.min(1, v / mx) : 0, fut = `${m}-${pad(d)}` > today();
    cells += `<span class="hm${fut ? ' fut' : ''}" style="--k:${k}" title="${d}: ${fmt(v)}"><em>${d}</em></span>`; }
  const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
  return `<div class="heat">${cells}</div>${top ? `<p class="small muted" style="margin:0">Biggest day: ${dayLabel(`${m}-${pad(top[0])}`)} with ${fmt(top[1])}.</p>` : ''}`;
}
function percentile(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function weekendLine(list) {
  let we = 0, all = 0; for (const e of list) if (e.kind === 'spent') { const d = new Date(e.date + 'T00:00:00').getDay(); all += +e.amount; if (d === 0 || d === 6) we += +e.amount; }
  return all ? `<p class="small muted" style="margin:0">Weekends: ${Math.round(we / all * 100)}% of spending (${fmt(we)}).</p>` : '';
}
function insightsFor(m) {
  const out = [], t = totals(monthEntries(m)), isCur = m === thisMonth(), avgC = avgCatSpend(m), list = monthEntries(m);
  const frac = isCur ? new Date().getDate() / daysIn(m) : 1;
  for (const c of activeCats('spent', scopeOfView())) {
    const s = t.byCat[c.id] || 0;
    if (c.budget > 0 && s > c.budget) out.push({ tone: 'bad', icon: 'alert', r: 0, title: `${c.name} is over budget`, body: `${fmt(s)} against ${fmt(c.budget)}, ${fmt(s - c.budget)} over.${isCur ? ' Hold off on extras here for the rest of the month.' : ''}` });
    else if (c.budget > 0 && isCur && s / c.budget > frac + 0.25 && s / c.budget > 0.6) out.push({ tone: 'warn', icon: 'up', r: 1, title: `${c.name} is running fast`, body: `${Math.round(s / c.budget * 100)}% of the budget used with ${daysIn(m) - new Date().getDate()} days to go.` });
  }
  Object.entries(t.byCat).map(([k, s]) => ({ k, s, a: avgC[k] })).filter(x => x.a && x.s > x.a * 1.25 && x.s - x.a >= 1500 && !out.some(o => o.title.startsWith(catOf(x.k).name))).sort((x, y) => (y.s - y.a) - (x.s - x.a)).slice(0, 3)
    .forEach(({ k, s, a }) => out.push({ tone: 'warn', icon: 'up', r: 2, title: `${catOf(k).name}: ${fmt(s - a)} more than usual`, body: `${fmt(s)} this month against a usual ${fmt(a)}. Is this a one-off, or a new normal to budget for?` }));
  for (const [k, s] of Object.entries(avgC)) { const v = t.byCat[k] || 0; if (!isCur && s >= 2000 && v < s * 0.7) out.push({ tone: 'good', icon: 'down', r: 6, title: `${catOf(k).name} down ${Math.round((1 - v / s) * 100)}%`, body: `${fmt(v)} against a usual ${fmt(s)}. Nice.` }); }
  const deliv = list.filter(e => e.kind === 'spent' && /zomato|swiggy|delivery|eternal/i.test(e.note || ''));
  if (deliv.length >= 4) { const v = deliv.reduce((s, e) => s + +e.amount, 0); out.push({ tone: 'info', icon: 'food', r: 3, title: `${deliv.length} food deliveries, ${fmt(v)}`, body: `About ${fmt(v / deliv.length)} each. Cooking two of those at home saves roughly ${fmt(v / deliv.length * 2 * 0.6)}.` }); }
  const subs = list.filter(e => e.kind === 'spent' && (e.source === 'auto' || e.category_id === 'bills'));
  if (subs.length >= 3) { const v = subs.reduce((s, e) => s + +e.amount, 0); out.push({ tone: 'info', icon: 'refund', r: 5, title: `Bills and subscriptions: ${fmt(v)}`, body: `${[...new Set(subs.map(e => e.note).filter(Boolean))].slice(0, 5).join(', ')}. Check yearly plans or ones you rarely use.` }); }
  const big = list.filter(e => e.kind === 'spent').sort((a, b) => b.amount - a.amount)[0];
  if (big && t.spent && big.amount / t.spent > 0.15) out.push({ tone: 'info', icon: 'receipt', r: 7, title: `Biggest single spend: ${fmt(big.amount)}`, body: `${big.note || catOf(big.category_id).name} on ${dayLabel(big.date)}, ${Math.round(big.amount / t.spent * 100)}% of the month.` });
  if (scopeOfView() === 'home') {
    if (t.in > 0) { const r = t.saved / t.in; out.push(r >= 0.2 ? { tone: 'good', icon: 'piggy', r: 4, title: `Saved ${Math.round(r * 100)}% of what came in`, body: 'Twenty percent or more is a healthy savings rate. Keep it up.' } : { tone: 'warn', icon: 'piggy', r: 4, title: `Saved ${Math.round(r * 100)}% of what came in`, body: `Aim for 20% (${fmt(t.in * 0.2)}). Setting your SIPs under Autopay makes this automatic.` }); }
    else out.push({ tone: 'info', icon: 'wallet', r: 8, title: 'Add what came in', body: 'Log your salary (Quick add → Salary) to see your savings rate and what is left each month.' });
  }
  if (!budgetTotal()) out.push({ tone: 'info', icon: 'chart', r: 9, title: 'No budgets set yet', body: 'Budgets turn these numbers into a plan. More → Monthly budgets can fill them from your averages in one tap.' });
  return out.sort((a, b) => a.r - b.r).slice(0, 7);
}
function budgetPlan(m, t) {
  let income = t.in;
  if (!income) { const v = [1, 2, 3].map(k => totals(monthEntries(addM(m, -k))).in).filter(x => x > 0); income = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
  const needs = Object.entries(t.byCat).filter(([k]) => NEEDS.has(k)).reduce((s, [, v]) => s + v, 0), wants = t.spent - needs;
  const rows = [['Needs', 'Rent, groceries, bills, transport, health, Milo', needs, 0.5, 'needs'], ['Wants', 'Eating out, shopping, travel, fun, gifts', wants, 0.3, 'wants'], ['Saved', 'SIPs, FDs, goals', t.saved, 0.2, 'save']];
  const tips = [];
  if (income) {
    if (needs / income > 0.55) tips.push('Needs are above half of income. Rent is the big fixed cost, so look at bills and groceries for small wins.');
    if (wants / income > 0.3) tips.push(`Wants are ${Math.round(wants / income * 100)}% of income. Trimming ${fmt(wants - income * 0.3)} brings them to 30%.`);
    if (t.saved / income < 0.2) tips.push(`Move ${fmt(Math.max(0, income * 0.2 - t.saved))} more into savings to reach 20%. Doing it on payday makes it stick.`);
    if (!tips.length) tips.push('Nicely balanced. If income grows, raise savings first.');
  }
  return `<section class="card paper"><div class="card-h"><h2>Budget plan</h2><span class="small muted">the 50 / 30 / 20 rule</span></div>
    ${income ? `<p class="small muted" style="margin:0">Based on ${t.in ? 'this month\'s' : 'your average'} income of ${fmt(income)}.</p>
      ${rows.map(([n, d, v, tgt, cls]) => { const pct = v / income; return `<div class="plan"><div class="c-top"><b>${n} <em>${d}</em></b><span class="${pct > tgt + 0.02 && cls !== 'save' ? 'over' : ''}">${Math.round(pct * 100)}% <em>/ ${tgt * 100}%</em></span></div>
        <div class="bar plan-${cls}"><i style="width:${Math.min(100, pct * 100)}%"></i><span class="mark" style="left:${tgt * 100}%"></span></div></div>`; }).join('')}
      <ul class="tips">${tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="small muted" style="margin:0">Log what came in this month to see how spending splits between needs, wants and savings.</p>`}
    <button class="btn" data-act="budgets">${icon('chart', 'sm')} ${budgetTotal() ? 'Adjust budgets' : 'Set budgets from my averages'}</button></section>`;
}

/* ----- more ----- */
function viewMore() {
  const li = (act, ic, t, s) => `<button class="li" data-act="${act}"><span class="ic-wrap">${icon(ic)}</span><div><b>${t}</b><span>${s}</span></div>${icon('chevr', 'sm')}</button>`;
  return `<section class="card morehero">${nestArt(true)}<div><b>Our nest</b><p class="small muted" style="margin:0">${esc(S.people.me)} and ${esc(S.people.trisha)} · ${S.entries.length} entries</p></div></section>
    <section class="card"><div class="card-h"><h2>Plan</h2></div><div class="list">
      ${li('budgets', 'chart', 'Monthly budgets', budgetTotal() ? `${fmt(budgetTotal())} a month across categories` : 'Not set yet')}
      ${li('goals', 'target', 'Saving for', `${S.goals.filter(g => !g.archived).length} goals`)}
    </div></section>
    <section class="card"><div class="card-h"><h2>Logging</h2></div><div class="list">
      ${li('autopay', 'refund', 'Autopay & SIPs', `${autoItems().filter(p => !p.paused && +p.amount > 0).length} added automatically each month`)}
      ${li('presets', 'star', 'Usual ones & quick-adds', `${S.presets.filter(p => !p.auto).length} on Home and in Add`)}
      ${li('tab-import', 'upload', 'Import a statement', 'Screenshots, PDFs, CSV or Excel')}
      ${li('dupes', 'copy', 'Find duplicates', (n => n ? `${n} to check` : 'Nothing doubled up')(findDupes(scopeOfView()).length))}
      ${li('cats', 'tag', 'Categories', `${S.cats.filter(c => !c.archived).length} categories`)}
      ${li('rules', 'rule', 'Import rules', `${S.rules.length} words that pick a category`)}
      ${li('people', 'users', 'Names', `${esc(S.people.me)} and ${esc(S.people.trisha)}`)}
    </div></section>
    <section class="card"><div class="card-h"><h2>Data</h2></div><div class="list">
      ${li('export', 'download', 'Export to CSV', 'All entries, for Excel or Google Sheets')}
      ${S.mode === 'live' ? li('lock', 'lock', `${bioName()} lock`, LOCK.get() ? 'On · no password needed on this phone' : 'Off · turn on to skip the password') : ''}
      ${li('install', 'phone', 'Put Nest on your home screen', 'Install it like an app')}
      ${S.mode === 'live' ? li('signout', 'logout', 'Sign out', esc(S.email)) : window.NEST_PREVIEW ? '' : li('leavedemo', 'logout', 'Leave the example', 'Go to sign in')}
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
function errText(e) { const m = (e && (e.message || e.error_description)) || '';
  if (/'(every|due_month)' column/i.test(m)) return 'Run 002-autopay-frequency.sql in Supabase once, then try again.'; if (/jwt|auth|permission|policy|row-level/i.test(m)) return 'Not allowed. Sign out and in again.'; if (/fetch|network/i.test(m)) return 'No connection. Try again.'; return 'Could not save. ' + m.slice(0, 80); }
async function save(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r || true; } catch (e) { console.error(e); toast(errText(e)); return null; } }

/* ---------- duplicates ---------- */
async function deleteEntry(ex, msg) {
  if (!await save(() => S.db.remove('entries', ex.id), msg)) return false;
  S.entries = S.entries.filter(x => x.id !== ex.id);
  const ap = ex.source === 'auto' && S.presets.find(x => x.id === ex.preset_id);
  if (ap) { const m = ex.date.slice(0, 7), skip = [...new Set([...(ap.skip_months || []), m])]; const r = await save(() => S.db.update('presets', ap.id, { skip_months: skip })); if (r) S.presets = S.presets.map(x => x.id === ap.id ? r : x); }
  return true;
}
const dayGap = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;
const normNote = n => (n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sameMoney = (a, b) => a.kind === b.kind && Math.abs(+a.amount - +b.amount) < 0.01;
const SRC = { import: 'From a statement', auto: 'Autopay', quick: 'Quick add', manual: 'Added by hand' };
const srcOf = e => SRC[e.source] || SRC.manual;
const pairKey = (a, b) => [a.id, b.id].sort().join('|');
/* pairs that look like the same money logged twice: same type and amount, within 3 days,
   and either logged two different ways (statement vs by hand, autopay vs statement) or identical on the same day */
function findDupes(scope) {
  const ok = new Set(S.dupOk), list = S.entries.filter(e => e.date && e.date <= today() && (!scope || (e.scope || 'home') === scope)).sort((a, b) => a.date.localeCompare(b.date));
  const cand = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], gap = dayGap(a.date, b.date); if (gap > 3) break;
    if (!sameMoney(a, b) || (a.scope || 'home') !== (b.scope || 'home') || ok.has(pairKey(a, b))) continue;
    const srcA = a.source || 'manual', srcB = b.source || 'manual';
    if (srcA === 'auto' && srcB === 'auto') continue;
    const differ = srcA !== srcB, twin = gap === 0 && normNote(a.note) === normNote(b.note);
    if (!differ && !twin) continue;
    cand.push({ a, b, days: gap, gap: gap + (normNote(a.note) === normNote(b.note) ? 0 : 0.5) });
  }
  // each entry is in one pair at most, closest first
  const used = new Set(), out = [];
  for (const p of cand.sort((x, y) => x.gap - y.gap)) {
    if (used.has(p.a.id) || used.has(p.b.id)) continue;
    used.add(p.a.id); used.add(p.b.id);
    out.push({ ...p, drop: suggestDrop(p.a, p.b) });
  }
  return out.sort((x, y) => y.a.date.localeCompare(x.a.date));
}
/* which one to suggest removing: keep what you logged yourself, drop the statement copy */
function suggestDrop(a, b) {
  const rank = e => ({ manual: 3, quick: 3, auto: 2, import: 1 })[e.source || 'manual'] || 3;
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? a : b;
  return (a.created_at || '') > (b.created_at || '') ? a : b;
}
function dupesSheet() {
  const P = findDupes(scopeOfView());
  const card = (x, i) => { const one = e => { const c = catOf(e.category_id), drop = x.drop.id === e.id;
      return `<div class="dupe-e${drop ? ' drop' : ''}"><span class="bub" style="--c:${c.color}">${icon(c.icon, 'sm')}</span><div class="r-main"><div class="r-name">${esc(e.note || c.name)}</div><div class="r-sub">${esc(dayLabel(e.date))} · ${esc(srcOf(e))} · ${esc(whoName(e.who))}</div></div>
        <button class="btn sm${drop ? ' danger' : ''}" data-dd="${e.id}">Remove</button></div>`; };
    return `<div class="dupe" data-di="${i}"><div class="dupe-h"><b class="num ${x.a.kind}">${fmt(x.a.amount)}</b><span class="small muted">${!x.days ? 'same day' : Math.round(x.days) + ' day' + (Math.round(x.days) === 1 ? '' : 's') + ' apart'}</span></div>${one(x.a)}${one(x.b)}
      <button class="link" data-dk="${i}">Not a duplicate, keep both</button></div>`; };
  openSheet(`${shHead('Possible duplicates')}<p class="small muted" style="margin:0">${P.length ? `These look like the same money logged twice: same amount, a few days apart, added in different ways. The one we'd remove is marked. Nothing is removed until you tap.` : 'Nothing looks doubled up. Nice.'}</p>
    ${P.length ? `<div class="dupes">${P.map(card).join('')}</div>
    ${P.length > 1 ? `<button class="btn danger block" id="dd-all">Remove the ${P.length} marked ones</button>` : ''}` : ''}`, p => {
    p.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dd) { const ex = S.entries.find(x => x.id === b.dataset.dd); b.disabled = true; if (ex && await deleteEntry(ex, 'Duplicate removed')) { render(); dupesSheet(); } else b.disabled = false; }
      else if (b.dataset.dk != null) { const x = P[+b.dataset.dk], v = [...S.dupOk, pairKey(x.a, x.b)]; if (await save(() => S.db.upsert('settings', { key: 'dup_ok', value: v }, 'key'))) { S.dupOk = v; render(); dupesSheet(); } }
      else if (b.id === 'dd-all') {
        if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = `Tap again to remove ${P.length} entries`; return; }
        b.disabled = true; let n = 0; for (const x of P) if (await deleteEntry(x.drop)) n++;
        toast(`Deleted ${n} duplicate${n === 1 ? '' : 's'}`); render(); dupesSheet();
      }
    };
  });
}

/* entry sheet */
function usageOrder(kind, scope) {
  const cut = addM(thisMonth(), -4) + '-01', cnt = {};
  for (const e of S.entries) if (e.kind === kind && e.date >= cut) cnt[e.category_id] = (cnt[e.category_id] || 0) + 1;
  return activeCats(kind, scope).sort((a, b) => (cnt[b.id] || 0) - (cnt[a.id] || 0) || (a.sort || 0) - (b.sort || 0));
}
/* what you usually log: groups of category + note from the last 6 months */
function historyGroups(kind, scope) {
  const cut = addM(thisMonth(), -6) + '-01', G = {};
  for (const e of S.entries) {
    if (e.kind !== kind || (e.scope || 'home') !== scope || e.date < cut || !e.category_id) continue;
    const note = (e.note || '').trim(), k = e.category_id + '|' + note.toLowerCase();
    const g = G[k] = G[k] || { category_id: e.category_id, note, amounts: [], last: '', whos: {} };
    g.amounts.push(+e.amount); if (e.date > g.last) g.last = e.date; g.whos[e.who] = (g.whos[e.who] || 0) + 1;
  }
  return Object.values(G).map(g => { const a = g.amounts.slice().sort((x, y) => x - y), med = a[Math.floor(a.length / 2)];
    const fixed = a.length >= 2 && a.every(x => Math.abs(x - med) <= Math.max(1, med * 0.02));
    const who = Object.entries(g.whos).sort((x, y) => y[1] - x[1])[0][0];
    return { category_id: g.category_id, note: g.note, count: a.length, amount: fixed ? med : Math.round(med / 10) * 10, fixed, last: g.last, who }; });
}
/* "your usual ones" are the quick-add buttons, most used first */
function suggestions(kind, scope) {
  const cut = addM(thisMonth(), -6), used = p => { let n = 0; for (let m = cut; m <= thisMonth(); m = addM(m, 1)) n += presetCount(p, m); return n; };
  return S.presets.filter(p => !p.auto && p.kind === kind && (p.scope || 'home') === scope).map(p => [p, used(p)]).sort((a, b) => b[1] - a[1] || (a[0].sort || 0) - (b[0].sort || 0)).map(x => x[0]).slice(0, 12);
}
/* learn new usual ones: anything logged 3+ times in 6 months under the same name becomes a quick-add, unless you removed it */
const usualKey = (kind, scope, note) => `${kind}|${scope || 'home'}|${(note || '').trim().toLowerCase()}`;
async function learnUsual() {
  if (!S.db || S._learning || S.mode === 'error') return;
  S._learning = true;
  try {
    const autoIds = new Set(S.presets.filter(p => p.auto).map(p => p.id));
    if (!S.usualHidden) { // first run: hide what was never a usual one
      const hide = [];
      for (const sc of ['home', 'business']) for (const k of Object.keys(KIND)) for (const g of historyGroups(k, sc)) if (/sanjay/i.test(g.note)) hide.push(usualKey(k, sc, g.note));
      S.usualHidden = hide;
      await S.db.upsert('settings', { key: 'usual_hidden', value: hide }, 'key');
    }
    const have = new Set(S.presets.flatMap(p => [usualKey(p.kind, p.scope, p.note), usualKey(p.kind, p.scope, p.label)]));
    const hidden = new Set(S.usualHidden);
    const add = [];
    for (const sc of ['home', 'business']) for (const k of Object.keys(KIND)) for (const g of historyGroups(k, sc)) {
      const key = usualKey(k, sc, g.note);
      if (!g.note || g.count < 3 || have.has(key) || hidden.has(key)) continue;
      if (S.entries.some(e => e.source === 'auto' && autoIds.has(e.preset_id) && (e.note || '').trim().toLowerCase() === g.note.toLowerCase())) continue;
      have.add(key);
      add.push({ label: g.note, kind: k, amount: g.fixed ? g.amount : null, category_id: g.category_id, goal_id: null, note: g.note, who: 'joint', scope: sc, sort: S.presets.length + add.length + 1, auto: false });
    }
    for (const row of add) { const r = await S.db.insert('presets', row); S.presets.push(r); }
    if (add.length) render();
  } catch (e) { console.error(e); }
  S._learning = false;
}
async function hideUsual(p) {
  const keys = [usualKey(p.kind, p.scope, p.note), usualKey(p.kind, p.scope, p.label)];
  const v = [...new Set([...(S.usualHidden || []), ...keys])];
  if (await save(() => S.db.upsert('settings', { key: 'usual_hidden', value: v }, 'key'))) S.usualHidden = v;
}
const catChip = (c, on) => `<button type="button" class="cp" data-c="${c.id}" aria-pressed="${on}" style="${tints(c.color)}">${icon(c.icon, 'sm')}<span>${esc(c.name)}</span></button>`;
function entrySheet(id, preset, presetDate) {
  const ex = id ? S.entries.find(e => e.id === id) : null;
  const defWho = 'joint';
  const F = ex ? { ...ex } : { kind: 'spent', amount: '', category_id: '', goal_id: null, note: '', who: defWho, scope: scopeOfView(), paid_with: '', date: today() };
  if (preset) Object.assign(F, { kind: preset.kind, amount: preset.amount || '', category_id: preset.category_id || '', goal_id: preset.goal_id || null, note: preset.note || '', who: preset.who || F.who, scope: preset.scope || 'home', preset_id: preset.id && S.presets.some(x => x.id === preset.id) ? preset.id : null });
  if (presetDate) F.date = presetDate;
  openSheet(`${shHead(ex ? 'Edit entry' : preset ? esc(preset.label) : 'Add an entry')}
    ${ex && ex.source === 'auto' ? `<div class="statusbar">Added automatically by Autopay. Change anything here; deleting skips this month.</div>` : ''}
    <div class="seg kindseg" id="f-kind"></div>
    <div class="amount"><span>₹</span><input id="f-amt" inputmode="decimal" enterkeyhint="done" placeholder="0" value="${esc(F.amount)}" ${!ex && !F.amount ? 'autofocus' : ''} aria-label="Amount" autocomplete="off"></div>
    <div class="amt-und">${under('ink')}</div>
    <div class="field" id="f-suggw"></div>
    <div class="field"><span class="flabel">Category</span><div class="catpick" id="f-cats"></div></div>
    <div class="field" id="f-goalw"></div>
    <div class="field"><label for="f-note">What for</label><input class="inp" id="f-note" list="f-notes" value="${esc(F.note)}" placeholder="e.g. Blinkit, dinner with friends" autocomplete="off"><datalist id="f-notes"></datalist></div>
    <div class="field"><span class="flabel">When</span><div class="chips" id="f-when"></div><input class="inp" type="date" id="f-date" value="${esc(F.date)}"></div>
    <div class="field"><span class="flabel">Who ${F.kind === 'in' ? 'got it' : 'paid'}</span><div class="seg" id="f-who"></div></div>
    <label class="check"><input type="checkbox" id="f-biz" ${F.scope === 'business' ? 'checked' : ''}> Yoga business (kept out of household totals)</label>
    <div class="btnrow">${ex ? '' : `<button class="btn" id="f-again">Add + next</button>`}<button class="btn primary" id="f-save">${ex ? 'Save changes' : 'Save'}</button></div>
    ${ex ? '' : `<button class="link" data-close data-go="import" style="align-self:center">${icon('upload', 'sm')} Or import a statement or screenshot</button>`}
    ${ex ? `<div class="btnrow"><button class="btn" id="f-preset">${icon('star', 'sm')} Make quick-add</button><button class="btn danger" id="f-del">Delete</button></div>` : ''}`, p => {
    const drawS = () => {
      $('#f-kind', p).innerHTML = Object.entries(KIND).map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${F.kind === k}">${l}</button>`).join('');
      const cats = usageOrder(F.kind, F.scope);
      if (F.category_id && !cats.some(c => c.id === F.category_id)) F.category_id = '';
      $('#f-cats', p).innerHTML = cats.length ? cats.map(c => catChip(c, F.category_id === c.id)).join('') : `<p class="small muted" style="margin:0">No ${KIND[F.kind].toLowerCase()} categories${F.scope === 'business' ? ' for the business' : ''} yet. Add one under More → Categories.</p>`;
      const gs = S.goals.filter(g => !g.archived);
      $('#f-goalw', p).innerHTML = F.kind === 'saved' && gs.length ? `<span class="flabel">Towards a goal${F.category_id === 'goal' ? '' : ' (optional)'}</span><div class="chips wrap">${gs.map(g => `<button type="button" class="chip" data-g="${g.id}" aria-pressed="${F.goal_id === g.id}">${esc(g.name)}</button>`).join('')}</div>` : '';
      $('#f-when', p).innerHTML = [[today(), 'Today'], [yesterday(), 'Yesterday']].map(([d, l]) => `<button type="button" class="chip" data-d="${d}" aria-pressed="${F.date === d}">${l}</button>`).join('');
      $('#f-who', p).innerHTML = ['me', 'trisha', 'joint'].map(k => `<button type="button" data-w="${k}" aria-pressed="${F.who === k}">${avatar(k)} ${esc(whoName(k))}</button>`).join('');
      const notes = [...new Set(S.entries.filter(e => e.category_id === F.category_id && e.note).sort(byDateDesc).map(e => e.note))].slice(0, 12);
      $('#f-notes', p).innerHTML = notes.map(n => `<option value="${esc(n)}">`).join('');
      // suggestions from what you usually log
      const sg = ex ? [] : suggestions(F.kind, F.scope);
      const curNote = ($('#f-note', p)?.value ?? F.note).trim().toLowerCase();
      $('#f-suggw', p).innerHTML = sg.length ? `<div class="card-h" style="margin:0"><span class="flabel">Your usual ones</span><button type="button" class="link" data-usualedit>edit</button></div><div class="sugg">${sg.map((x, i) => { const c = catOf(x.category_id), on = F.category_id === x.category_id && curNote === (x.note || x.label).toLowerCase();
        return `<button type="button" class="sg" data-sg="${i}" aria-pressed="${on}" style="${tints(c.color)}">${icon(c.icon, 'sm')}<span style="min-width:0"><b>${esc(x.label || x.note || c.name)}</b><small>${esc(c.name)}${x.amount ? ' · ' + fmtK(x.amount) : ''}</small></span></button>`; }).join('')}</div>` : '';
      p._sugg = sg;
    };
    drawS();
    p.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if ('usualedit' in b.dataset) { presetsSheet(); return; }
      if (b.dataset.k) { F.kind = b.dataset.k; if (F.kind !== 'saved') F.goal_id = null; drawS(); }
      else if (b.dataset.c) { F.category_id = b.dataset.c; drawS(); }
      else if (b.dataset.g) { F.goal_id = F.goal_id === b.dataset.g ? null : b.dataset.g; if (F.goal_id && !F.category_id) F.category_id = 'goal'; drawS(); }
      else if (b.dataset.d) { F.date = b.dataset.d; $('#f-date', p).value = F.date; drawS(); }
      else if (b.dataset.w) { F.who = b.dataset.w; drawS(); }
      else if (b.dataset.sg != null) { const x = p._sugg[+b.dataset.sg], nt = x.note || x.label; F.category_id = x.category_id; F.goal_id = x.goal_id || null; F.note = nt; F.preset_id = x.id; $('#f-note', p).value = nt; if (x.who) F.who = x.who; if (x.amount && !num($('#f-amt', p).value)) { $('#f-amt', p).value = x.amount; fit(); } drawS(); if (!num($('#f-amt', p).value)) $('#f-amt', p).focus(); }
    });
    const fit = () => { const el = $('#f-amt', p); el.style.width = Math.max(1, (el.value || el.placeholder).length) + 0.6 + 'ch'; };
    fit(); $('#f-amt', p).addEventListener('input', fit);
    $('#f-note', p).addEventListener('change', () => { F.note = $('#f-note', p).value; drawS(); });
    $('#f-date', p).onchange = e => { F.date = e.target.value || today(); drawS(); };
    $('#f-biz', p).onchange = e => { F.scope = e.target.checked ? 'business' : 'home'; F.category_id = ''; drawS(); };
    const doSave = async (again) => {
      const amount = Math.round(num($('#f-amt', p).value) * 100) / 100;
      if (!(amount > 0)) { toast('Enter an amount.'); $('#f-amt', p).focus(); return; }
      if (!F.category_id) { toast('Pick a category.'); return; }
      if (F.category_id === 'goal' && !F.goal_id) { toast('Pick which goal.'); return; }
      const row = { date: F.date || today(), kind: F.kind, amount, category_id: F.category_id, goal_id: F.kind === 'saved' ? F.goal_id : null, note: $('#f-note', p).value.trim(), who: F.who, scope: F.scope };
      $('#f-save', p).disabled = true;
      const r = await save(async () => ex ? S.db.update('entries', ex.id, row) : S.db.insert('entries', { ...row, source: preset ? 'quick' : 'manual', preset_id: F.preset_id || null }));
      $('#f-save', p).disabled = false;
      if (!r) return;
      if (ex) S.entries = S.entries.map(x => x.id === ex.id ? r : x); else S.entries.push(r);
      toast(`${ex ? 'Saved' : 'Added'} ${fmt(amount)} ${F.kind === 'in' ? 'in' : F.kind === 'saved' ? 'saved' : 'spent'}`);
      if (!ex && !S.month.startsWith(row.date.slice(0, 7)) && row.date.slice(0, 7) <= thisMonth()) S.month = row.date.slice(0, 7);
      render(); if (!ex) learnUsual();
      if (again) { $('#f-amt', p).value = ''; fit(); $('#f-note', p).value = ''; F.note = ''; F.preset_id = null; drawS(); $('#f-amt', p).focus(); } else closeSheet();
    };
    $('#f-save', p).onclick = () => doSave(false);
    $('#f-again', p) && ($('#f-again', p).onclick = () => doSave(true));
    if (ex) {
      let armed = false;
      $('#f-del', p).onclick = async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Tap again to delete'; return; }
        if (!await deleteEntry(ex, 'Deleted')) return;
        closeSheet(); render(); };
      $('#f-preset', p).onclick = () => presetEdit(null, { label: ex.note || catOf(ex.category_id).name, kind: ex.kind, amount: ex.amount, category_id: ex.category_id, goal_id: ex.goal_id, note: ex.note, who: ex.who, scope: ex.scope });
    } else if (!F.amount) { const a = $('#f-amt', p); try { a.focus({ preventScroll: true }); } catch (e) { a.focus(); } setTimeout(() => { if (document.activeElement !== a) a.focus({ preventScroll: true }); }, 300); }
  });
}

/* ---------- autopay & SIPs: added automatically on their day ---------- */
const autoItems = () => S.presets.filter(p => p.auto).sort((a, b) => (a.due_day || 1) - (b.due_day || 1));
function nextDue(p) { const t = today(); let m = thisMonth(); for (let k = 0; k < 14; k++, m = addM(m, 1)) { if (!isDue(p, m) || (p.skip_months || []).includes(m)) continue; const e = presetLogged(p, m), d = e ? e.date : dueDate(p, m); if (d >= t) return d; } return null; }
const autoRow = (p, m) => ({ date: dueDate(p, m), kind: p.kind, amount: +p.amount, category_id: p.category_id, goal_id: p.kind === 'saved' ? p.goal_id || null : null, note: p.note || p.label, who: p.who || 'joint', scope: p.scope || 'home', source: 'auto', preset_id: p.id, import_key: `auto:${p.id}:${m}` });
const startMonth = p => (p.starts_on || today()).slice(0, 7);
async function runAutopay() {
  if (!S.db || S._autoRunning) return;
  S._autoRunning = true;
  S.autoErr = S.autoErr || {};
  try {
    const rows = [];
    for (const p of autoItems()) {
      if (p.paused || !(+p.amount > 0) || !p.category_id) continue;
      // from the month it started (the day inside that month doesn't matter), up to this month
      for (let m = startMonth(p), guard = 0; m <= thisMonth() && guard < 36; m = addM(m, 1), guard++) {
        if (!isDue(p, m) || (p.skip_months || []).includes(m) || presetLogged(p, m)) continue;
        rows.push({ p, row: autoRow(p, m) });
      }
    }
    if (rows.length) {
      let added = [];
      try { added = await S.db.insertMany('entries', rows.map(x => x.row), 'import_key'); }
      catch (e) { // one bad row should not stop the rest: try them one at a time and note what failed
        console.error(e);
        for (const { p, row } of rows) {
          try { added = added.concat(await S.db.insertMany('entries', [row], 'import_key')); delete S.autoErr[p.id]; }
          catch (er) { console.error(er); S.autoErr[p.id] = er.message || String(er); }
        }
        const bad = autoItems().filter(p => S.autoErr[p.id]);
        if (bad.length) toast(`Autopay couldn't add ${bad.map(p => p.label).join(', ')}. Open More → Autopay & SIPs.`);
      }
      // an entry that already existed with the same key (but wasn't loaded) still counts: reload so nothing goes missing
      if (added.length < rows.length) { try { S.entries = await S.db.all('entries'); } catch (e) {} }
      else S.entries = S.entries.concat(added);
      render();
    }
  } catch (e) { console.error(e); }
  finally { S._autoRunning = false; }
}
/* where an autopay stands this month, so a missing one says why */
function autoStatus(p, m = thisMonth()) {
  if (p.paused) return { s: 'off', t: 'Paused' };
  if (!(+p.amount > 0)) return { s: 'off', t: 'Add the amount to start' };
  if (!isDue(p, m)) return { s: 'none' };
  if (m < startMonth(p)) return { s: 'none' };
  const e = presetLogged(p, m), mon = MONTHS[+m.slice(5) - 1];
  if (e) return { s: 'ok', e, t: e.date > today() ? `${mon}: coming ${dayLabel(e.date).replace(/^[A-Z][a-z]{2}, /, '')}` : `${mon}: in entries on ${dayLabel(e.date).replace(/^[A-Z][a-z]{2}, /, '')}` };
  if ((p.skip_months || []).includes(m)) return { s: 'skip', t: `${mon}: skipped (its entry was deleted)` };
  if (S.autoErr && S.autoErr[p.id]) return { s: 'err', t: `${mon}: couldn't be added` };
  return { s: 'miss', t: `${mon}: not in entries yet` };
}
async function addAutoNow(p, m = thisMonth()) {
  if ((p.skip_months || []).includes(m)) { const skip = (p.skip_months || []).filter(x => x !== m); const r = await save(() => S.db.update('presets', p.id, { skip_months: skip })); if (!r) return false; S.presets = S.presets.map(x => x.id === p.id ? r : x); p = r; }
  const row = autoRow(p, m); row.import_key = `auto:${p.id}:${m}:${Date.now().toString(36)}`;
  const r = await save(() => S.db.insert('entries', row), `Added ${fmt(row.amount)} on ${dayLabel(row.date)}`);
  if (!r) return false;
  if (S.autoErr) delete S.autoErr[p.id];
  S.entries.push(r); render(); return true;
}
function autopaySheet() {
  const items = autoItems();
  const live = items.filter(p => !p.paused && +p.amount > 0 && p.kind === 'spent'), pm = live.reduce((a, p) => a + perMonth(p), 0);
  openSheet(`${shHead('Autopay & SIPs')}<p class="small muted" style="margin:0">Subscriptions, bills and SIPs that go out on their own, monthly or yearly. Nest puts each one into Entries on its date, so you never log them. Edit them there like anything else; delete one and that time is skipped.</p>
    ${pm ? `<p class="hand note-l" style="margin:0">About ${fmt(pm)} a month goes out on its own${live.some(p => everyOf(p) !== 'month') ? ', counting yearly ones spread over the year' : ''}.</p>` : ''}
    <div class="rows">${items.map(p => { const c = catOf(p.category_id), nd = nextDue(p);
      const st = autoStatus(p), warn = st.s === 'miss' || st.s === 'err';
      const status = st.s === 'off' ? st.t : `${everyText(p)}${st.t ? ' · ' + st.t : nd ? ' · next ' + dayLabel(nd).replace(/^[A-Z][a-z]{2}, /, '') : ''}`;
      return `<button class="row" data-ap="${p.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon)}</span><div class="r-main"><div class="r-name">${esc(p.label)}</div><div class="r-sub${warn ? ' ap-warn' : ''}">${esc(status)}${p.who === 'trisha' ? ' · ' + esc(S.people.trisha) : ''}</div></div><div class="r-amt num ${p.kind}">${+p.amount > 0 ? fmt(p.amount) : '–'}</div></button>`; }).join('') || '<p class="small muted">Nothing set up yet.</p>'}</div>
    <button class="btn primary block" data-ap="">${icon('plus', 'sm')} Add an autopay or SIP</button>`, p => {
    p.onclick = e => { const b = e.target.closest('[data-ap]'); if (b) autopayEdit(b.dataset.ap || null); };
  });
}
function autopayEdit(id) {
  const ex = id ? S.presets.find(x => x.id === id) : null;
  const F = ex ? { ...ex } : { label: '', kind: 'spent', amount: null, category_id: 'bills', goal_id: null, note: '', who: S.person, scope: 'home', due_day: new Date().getDate(), paid_with: '', paused: false, auto: true, sort: 100 + S.presets.length, skip_months: [] };
  F.every = everyOf(F); F.due_month = anchorMonth(F);
  openSheet(`${shHead(ex ? 'Edit autopay' : 'New autopay or SIP')}
    <div class="field"><label for="ap-l">Name</label><input class="inp" id="ap-l" value="${esc(F.label)}" placeholder="e.g. Netflix, SIP – Axis Bluechip"></div>
    <div class="seg kindseg" id="ap-kind"></div>
    <div class="grid2"><div class="field"><label for="ap-a">Amount (₹)</label><input class="inp" id="ap-a" inputmode="decimal" value="${F.amount || ''}" placeholder="0"></div>
      <div class="field"><label for="ap-d">Day of the month</label><input class="inp" id="ap-d" inputmode="numeric" value="${F.due_day || ''}" placeholder="1"></div></div>
    <div class="field"><span class="flabel">How often</span><div class="seg" id="ap-every"></div></div>
    <div class="field" id="ap-monw"></div>
    <div class="field"><span class="flabel">Category</span><div class="catpick" id="ap-cats"></div></div>
    <div class="field" id="ap-goalw"></div>
    <div class="field"><span class="flabel">Whose</span><div class="seg" id="ap-who"></div></div>
    ${ex ? `<label class="check"><input type="checkbox" id="ap-pause" ${F.paused ? 'checked' : ''}> Paused (stop adding it for now)</label>` : ''}
    ${ex ? (st => st.s === 'none' || st.s === 'off' ? '' : `<div class="statusbar${st.s === 'ok' ? '' : ' warn'}" id="ap-month"><b>This month.</b> ${esc(st.t)}${st.s === 'err' ? `<br><span class="small">${esc(S.autoErr[ex.id])}</span>` : ''}${st.s === 'ok' ? '' : `<br><button type="button" class="btn sm" id="ap-now" style="margin-top:6px">Add it for ${MONTHS[+thisMonth().slice(5) - 1]} (${esc(dayLabel(dueDate(ex)))})</button>`}</div>`)(autoStatus(ex)) : ''}
    <p class="small muted" style="margin:0">${ex ? 'Changes apply from the next time it is due. To fix an entry already added, edit the entry itself.' : 'It goes into Entries on its date, from this month on, including a date earlier this month.'}</p>
    <button class="btn primary block" id="ap-save">${ex ? 'Save' : 'Add autopay'}</button>
    ${ex ? `<button class="btn danger block" id="ap-del">Remove autopay</button>` : ''}<button class="btn block" id="ap-back">Back</button>`, p => {
    const d = () => {
      $('#ap-kind', p).innerHTML = [['spent', 'Spent'], ['saved', 'Saved'], ['in', 'Came in']].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${F.kind === k}">${l}</button>`).join('');
      $('#ap-cats', p).innerHTML = activeCats(F.kind, F.scope).map(c => catChip(c, F.category_id === c.id)).join('');
      const gs = S.goals.filter(g => !g.archived);
      $('#ap-goalw', p).innerHTML = F.kind === 'saved' && F.category_id === 'goal' && gs.length ? `<span class="flabel">Which goal</span><div class="chips wrap">${gs.map(g => `<button type="button" class="chip" data-g="${g.id}" aria-pressed="${F.goal_id === g.id}">${esc(g.name)}</button>`).join('')}</div>` : '';
      $('#ap-every', p).innerHTML = Object.entries(EVERY).map(([k, [, l]]) => `<button type="button" data-ev="${k}" aria-pressed="${F.every === k}">${l.replace('Every ', '')}</button>`).join('');
      $('#ap-monw', p).innerHTML = F.every === 'month' ? '' : `<label for="ap-m">${F.every === 'year' ? 'Which month' : 'First month it comes due'}</label><select class="inp" id="ap-m">${MONTHS.map((n, i) => `<option value="${i + 1}" ${F.due_month === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
      $('#ap-who', p).innerHTML = ['me', 'trisha', 'joint'].map(k => `<button type="button" data-w="${k}" aria-pressed="${F.who === k}">${esc(whoName(k))}</button>`).join('');
    };
    d();
    p.addEventListener('change', e => { if (e.target.id === 'ap-m') F.due_month = +e.target.value; });
    p.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.k) { F.kind = b.dataset.k; F.category_id = F.kind === 'saved' ? 'sip' : F.kind === 'in' ? 'salary' : 'bills'; d(); }
      else if (b.dataset.ev) { F.due_month = +($('#ap-m', p)?.value || F.due_month); F.every = b.dataset.ev; d(); }
      else if (b.dataset.c) { F.category_id = b.dataset.c; d(); } else if (b.dataset.g) { F.goal_id = b.dataset.g; d(); } else if (b.dataset.w) { F.who = b.dataset.w; d(); } });
    $('#ap-back', p).onclick = autopaySheet;
    $('#ap-now', p) && ($('#ap-now', p).onclick = async e => { e.currentTarget.disabled = true; if (await addAutoNow(ex)) autopaySheet(); else e.currentTarget.disabled = false; });
    $('#ap-save', p).onclick = async () => {
      const label = $('#ap-l', p).value.trim(); if (!label) { toast('Give it a name.'); return; }
      const amount = num($('#ap-a', p).value), day = Math.round(num($('#ap-d', p).value));
      if (!(day >= 1 && day <= 31)) { toast('Day must be between 1 and 31.'); return; }
      if (!F.category_id) { toast('Pick a category.'); return; }
      const row = { label, note: label, kind: F.kind, amount: amount > 0 ? amount : null, category_id: F.category_id, goal_id: F.kind === 'saved' ? F.goal_id || null : null, who: F.who, scope: F.scope, due_day: day, auto: true, paused: $('#ap-pause', p) ? $('#ap-pause', p).checked : false, sort: F.sort };
      if (!ex) row.starts_on = today().slice(0, 8) + '01';
      if (F.every !== 'month' || (ex && 'every' in ex)) { row.every = F.every; row.due_month = F.every === 'month' ? null : +($('#ap-m', p)?.value || F.due_month); }
      const r = await save(() => ex ? S.db.update('presets', ex.id, row) : S.db.insert('presets', { ...row, skip_months: [] }), ex ? 'Saved' : 'Autopay added');
      if (!r) return; S.presets = ex ? S.presets.map(x => x.id === ex.id ? r : x) : [...S.presets, r];
      await runAutopay(); autopaySheet();
    };
    if (ex) { let armed = false; $('#ap-del', p).onclick = async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Tap again to remove (past entries stay)'; return; } if (await save(() => S.db.remove('presets', ex.id), 'Autopay removed')) { S.presets = S.presets.filter(x => x.id !== ex.id); autopaySheet(); } }; }
  });
}

/* presets */
function presetsSheet() {
  openSheet(`${shHead('Usual ones & quick-adds')}<p class="small muted" style="margin:0">These sit on Home and under “Your usual ones” when you add something. Anything you log three times under the same name gets added here on its own; remove one and it stays gone. Leave the amount empty for things that change each time. Autopays and SIPs live under More → Autopay & SIPs.</p>
    <div class="rows">${S.presets.filter(pr => !pr.auto).map(pr => { const c = catOf(pr.category_id); return `<button class="row" data-pe="${pr.id}"><span class="bub" style="--c:${c.color}">${icon(c.icon)}</span><div class="r-main"><div class="r-name">${esc(pr.label)}</div><div class="r-sub">${esc(c.name)} · ${esc(whoName(pr.who))}${pr.scope === 'business' ? ' · Business' : ''}</div></div><div class="r-amt num">${pr.amount ? fmt(pr.amount) : ''}</div></button>`; }).join('') || '<p class="small muted">No buttons yet.</p>'}</div>
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
    <div class="field"><span class="flabel">Category</span><div class="catpick" id="pe-cats"></div></div>
    <div class="grid2"><div class="field"><label for="pe-a">Amount (optional)</label><input class="inp" id="pe-a" inputmode="decimal" value="${F.amount || ''}" placeholder="Ask each time"></div>
    <div class="field"><label for="pe-n">What for</label><input class="inp" id="pe-n" value="${esc(F.note)}" placeholder="e.g. Rent – flat"></div></div>
    <div class="field"><span class="flabel">Whose</span><div class="seg" id="pe-who"></div></div>
    <label class="check"><input type="checkbox" id="pe-biz" ${F.scope === 'business' ? 'checked' : ''}> Yoga business</label>
    <button class="btn primary block" id="pe-save">${ex ? 'Save' : 'Add button'}</button>
    ${ex ? `<button class="btn danger block" id="pe-del">Remove button</button>` : ''}<button class="btn block" id="pe-back">Back</button>`, p => {
    const d = () => {
      $('#pe-kind', p).innerHTML = Object.entries(KIND).map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${F.kind === k}">${l}</button>`).join('');
      $('#pe-cats', p).innerHTML = activeCats(F.kind, F.scope).map(c => catChip(c, F.category_id === c.id)).join('');
      $('#pe-who', p).innerHTML = ['me', 'trisha', 'joint'].map(k => `<button type="button" data-w="${k}" aria-pressed="${F.who === k}">${esc(whoName(k))}</button>`).join('');
    };
    d();
    p.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.k) { F.kind = b.dataset.k; F.category_id = ''; d(); } else if (b.dataset.c) { F.category_id = b.dataset.c; d(); } else if (b.dataset.w) { F.who = b.dataset.w; d(); } });
    $('#pe-biz', p).onchange = e => { F.scope = e.target.checked ? 'business' : 'home'; F.category_id = ''; d(); };
    $('#pe-back', p).onclick = presetsSheet;
    $('#pe-save', p).onclick = async () => {
      const label = $('#pe-l', p).value.trim(); if (!label) { toast('Give the button a name.'); return; }
      if (!F.category_id) { toast('Pick a category.'); return; }
      const a = num($('#pe-a', p).value);
      const row = { label, kind: F.kind, amount: a > 0 ? a : null, category_id: F.category_id, goal_id: F.kind === 'saved' ? F.goal_id || null : null, note: $('#pe-n', p).value.trim(), who: F.who, scope: F.scope, sort: F.sort || 0, auto: false };
      const r = await save(() => ex ? S.db.update('presets', ex.id, row) : S.db.insert('presets', row), ex ? 'Button saved' : 'Button added');
      if (!r) return;
      S.presets = ex ? S.presets.map(x => x.id === ex.id ? r : x) : [...S.presets, r];
      render(); presetsSheet();
    };
    if (ex) { let armed = false; $('#pe-del', p).onclick = async e => { if (!armed) { armed = true; e.currentTarget.textContent = 'Tap again to remove'; return; } if (await save(() => S.db.remove('presets', ex.id), 'Button removed')) { S.presets = S.presets.filter(x => x.id !== ex.id); await hideUsual(ex); render(); presetsSheet(); } }; }
  });
}

/* goals */
function goalsSheet() {
  const gs = S.goals.filter(g => !g.archived);
  openSheet(`${shHead('Saving for')}<p class="hand note-l" style="margin:0">Every SIP or saving you log towards a goal fills its postcard up.</p>
    <div class="postlist">${gs.map((g, i) => goalCard(g, i)).join('') || '<p class="small muted">No goals yet.</p>'}</div>
    <button class="btn dashed block" data-gid="">${icon('plus', 'sm')} Add a goal</button>`, p => { p.onclick = e => { const b = e.target.closest('[data-gid]'); if (b) goalEdit(b.dataset.gid || null); }; });
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
  const sc = scopeOfView();
  const cats = activeCats('spent', sc);
  const avg = {}; const ms = [1, 2, 3].map(k => addM(thisMonth(), -k));
  for (const c of cats) { const v = ms.map(m => totals(monthEntries(m, sc === 'business' ? 'business' : 'home')).byCat[c.id] || 0); const n = v.filter(x => x > 0).length; avg[c.id] = n ? v.reduce((a, b) => a + b, 0) / n : 0; }
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
  openSheet(`${shHead('Names')}
    <div class="grid2"><div class="field"><label for="pp-me">Your name</label><input class="inp" id="pp-me" value="${esc(S.people.me)}"></div><div class="field"><label for="pp-tr">Wife's name</label><input class="inp" id="pp-tr" value="${esc(S.people.trisha)}"></div></div>
    <button class="btn primary block" id="pp-save">Save</button>`, p => {
    $('#pp-save', p).onclick = async () => {
      const people = { me: $('#pp-me', p).value.trim() || 'Me', trisha: $('#pp-tr', p).value.trim() || 'Trisha' };
      if (await save(() => S.db.upsert('settings', { key: 'people', value: people }, 'key'))) { S.people = people; toast('Saved'); closeSheet(); render(); }
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
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Goal', 'What for', 'Who', 'Household or business', 'Source']];
  for (const e of S.entries.slice().sort(byDateDesc)) rows.push([e.date, KIND[e.kind], e.amount, catOf(e.category_id).name, goalOf(e.goal_id)?.name || '', e.note, whoName(e.who), e.scope === 'business' ? 'Business' : 'Household', e.source]);
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
    <div class="field"><span class="flabel">Whose money is this</span><div class="seg" id="im-who">${['me', 'trisha', 'joint'].map(k => `<button data-act="imwho" data-w="${k}" aria-pressed="${who === k}">${esc(whoName(k))}</button>`).join('')}</div></div>
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
  const biz = $('#im-biz'); if (biz) biz.onchange = () => { impState().scope = biz.checked ? 'business' : 'home'; if (S.imp.rows) { S.imp._taken = new Set(); S.imp.rows.forEach(prepRow); } render(); };
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
  const taken = I._taken || (I._taken = new Set());
  if (r.dupOf) { taken.delete(r.dupOf); r.dupOf = null; }
  const dup = r.date && S.entries.filter(e => !taken.has(e.id) && e.date && sameMoney(e, r) && dayGap(e.date, r.date) <= 3 && (e.scope || 'home') === I.scope)
    .sort((x, y) => dayGap(x.date, r.date) - dayGap(y.date, r.date))[0];
  if (dup && r.on) { r.on = false; r.dupOf = dup.id; taken.add(dup.id); r.flag = `Already in Nest: ${dup.note || catOf(dup.category_id).name}, ${fmt(dup.amount)} on ${dayLabel(dup.date)} (${srcOf(dup).toLowerCase()}). Unticked so it isn't counted twice; tick it if it's a separate payment.`; }
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
    I._taken = new Set();
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
  const nd = findDupes(I.scope).filter(x => res.some(e => e.id === x.a.id || e.id === x.b.id)).length;
  toast(`Saved ${res.length} entr${res.length === 1 ? 'y' : 'ies'}${skipped ? `, ${skipped} already imported before` : ''}${nd ? `. ${nd} may be duplicates, check Home` : ''}`);
  const months = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort();
  S.imp = { stage: 'pick', who: I.who, scope: I.scope, learn: I.learn };
  if (months.length) S.month = months[months.length - 1] <= thisMonth() ? months[months.length - 1] : thisMonth();
  S.tab = 'entries'; location.hash = 'entries'; render();
}

/* ---------- toast ---------- */
let tt = 0;
function toast(msg) {
  const t = $('#toast'), ok = /^(Added|Saved|Deleted|Button|Goal|Budgets|Category|Rule|Autopay|Export)/.test(msg);
  t.innerHTML = (ok ? `<span class="t-ok">${icon('check', 'sm')}</span>` : '') + `<span>${esc(msg)}</span>`;
  t.hidden = false; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; t.classList.remove('show'); }, 2800);
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const cl = e.target.closest('[data-close]'); if (cl) { closeSheet(); if (cl.dataset.go) go(cl.dataset.go); return; }
  if (e.target.closest('#sheet')) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'tab') go(b.dataset.tab);
  else if (a === 'view') { S.view = b.dataset.v; ls.set('view2', S.view); S.anim = true; render(); }
  else if (a === 'month') { const n = addM(S.month, +b.dataset.d); if (n <= thisMonth()) { S.month = n; S.anim = true; render(); } }
  else if (a === 'pickmonth') { S.month = b.dataset.m; S.anim = true; render(); }
  else if (a === 'whof') { if (S.tab === 'entries') { S.whoFilter = b.dataset.w; render(); } else { S.whoFilter = b.dataset.w; S.kindFilter = 'spent'; go('entries'); } }
  else if (a === 'tab-import') go('import');
  else if (a === 'add') entrySheet(null);
  else if (a === 'addin') entrySheet(null, { kind: 'in', scope: scopeOfView(), who: S.person, label: 'Came in' });
  else if (a === 'edit') entrySheet(b.dataset.id);
  else if (a === 'preset') { const p = S.presets.find(x => x.id === b.dataset.id); if (p) entrySheet(null, p); }
  else if (a === 'presets') presetsSheet();
  else if (a === 'autopay') autopaySheet();
  else if (a === 'dupes') dupesSheet();
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
  else if (a === 'signout') { LOCK.set(null); try { await S.client.auth.signOut(); } catch (err) {} location.reload(); }
  else if (a === 'unlock') tryUnlock(false);
  else if (a === 'lockpw') { try { await S.client.auth.signOut(); } catch (err) {} location.reload(); }
  else if (a === 'lock') lockSheet(false);
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
function go(tab) { if (!TABS.includes(tab)) tab = 'home'; if (tab !== 'entries' && S.tab === 'entries') { S.catFilter = ''; S.whoFilter = ''; } S.anim = tab !== S.tab; S.tab = tab; if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab); render(); window.scrollTo(0, 0); }
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab) { S.tab = h; render(); } });

/* ---------- Face ID / fingerprint lock ----------
   You sign in with the password once; Supabase keeps the session on this phone.
   The lock asks the phone's own Face ID / fingerprint (WebAuthn, platform authenticator)
   before showing anything, and again after Nest has been in the background a few minutes. */
const LOCK = { get: () => ls.get('lock', null), set: v => ls.set('lock', v) };
const RELOCK_MS = 3 * 60 * 1000;
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const bioName = () => /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? 'Face ID' : 'fingerprint';
async function bioAvailable() { try { return !!(window.PublicKeyCredential && window.isSecureContext && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } }
async function bioEnable() {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rnd(32), rp: { name: 'Nest' },
    user: { id: rnd(16), name: S.email, displayName: whoName(S.person) + ' · Nest' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000, attestation: 'none' } });
  LOCK.set({ id: b64u(cred.rawId), email: S.email });
}
async function bioCheck() {
  const L = LOCK.get(); if (!L) return;
  await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: unb64u(L.id), transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
}
let unlocking = false;
async function tryUnlock(auto) {
  if (unlocking || !S.locked) return; unlocking = true;
  try { await bioCheck(); S.locked = false; S.anim = true; draw(); }
  catch (e) { if (!auto) toast(`Couldn't confirm it's you. Try again, or use your password.`); }
  unlocking = false;
}
function lockView() {
  return `<div class="login lockscr">${nestArt()}<h1>Welcome home</h1><p>Nest is locked on this phone.</p>
    <button class="btn primary block" data-act="unlock">${icon('lock', 'sm')} Unlock with ${bioName()}</button>
    <button class="link" data-act="lockpw" style="align-self:center">Use password instead</button></div>`;
}
async function maybeOfferLock() {
  if (S.mode !== 'live' || LOCK.get() || ls.get('lockAsked', false) || !(await bioAvailable())) return;
  ls.set('lockAsked', true);
  setTimeout(() => lockSheet(true), 900);
}
function lockSheet(offer) {
  const on = !!LOCK.get(), n = bioName();
  openSheet(`${shHead(`${n} lock`)}
    <p class="hand note-l" style="margin:0">${offer ? `Skip the password from now on.` : on ? `On. Nest asks for ${n} when you open it.` : 'Off.'}</p>
    <p class="small muted" style="margin:0">You stay signed in on this phone. When you open Nest, or come back after a few minutes away, it asks for ${n} before showing anything. ${n === 'Face ID' ? 'Face ID' : 'Your fingerprint'} never leaves the phone. Set it up on each phone separately.</p>
    <button class="btn primary block" id="lk-go">${on ? `Turn off ${n} lock` : `${icon('lock', 'sm')} Turn on ${n}`}</button>
    ${offer ? `<button class="btn block" data-close>Not now</button>` : ''}`, p => {
    $('#lk-go', p).onclick = async () => {
      if (on) { LOCK.set(null); toast(`${n} lock off`); closeSheet(); render(); return; }
      if (!(await bioAvailable())) { toast(`This phone or browser can't use ${n} here.`); return; }
      try { await bioEnable(); toast(`${n} lock on`); closeSheet(); render(); }
      catch (e) { toast(`${n} wasn't set up. Try again.`); }
    };
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { S.hiddenAt = Date.now(); return; }
  if (LOCK.get() && S.mode === 'live' && !S.locked && S.hiddenAt && Date.now() - S.hiddenAt > RELOCK_MS) { S.locked = true; closeSheet(); draw(); setTimeout(() => tryUnlock(true), 300); }
});

boot();
