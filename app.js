import { createStore } from './data.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const TITLES = { handle: 'Handle', gjore: 'Gjøre', kalender: 'Kalender' };
const PLACEHOLDER = { handle: 'Legg til vare… (f.eks. melk, egg)', gjore: 'Legg til gjøremål…' };
const EMPTY = { handle: 'Handlelista er tom. Skriv inn det som mangler.', gjore: 'Ingenting å gjøre. Nyt det!' };

const S = {
  store: null, user: null, hh: null, members: [], items: [], tab: ls.get('hl-tab', 'handle'),
  showDone: false, signUpMode: false, setupMode: 'new', cal: ls.get('hl-cal', null), calLoaded: 0,
};

function show(view) {
  for (const v of ['login', 'setup', 'main']) $('view-' + v).hidden = v !== view;
  $('tabbar').hidden = view !== 'main';
}
let toastT;
function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
const fail = (e) => toast(e?.message || String(e), 6000);

// ---------- Oppstart ----------
async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  S.store = await createStore();
  S.store.onAuth((u) => { if (!u && S.user) { S.user = null; S.hh = null; show('login'); } });
  S.user = await S.store.user();
  if (!S.user) return show('login');
  await afterLogin();
}

async function afterLogin() {
  try { S.hh = await S.store.household(); } catch (e) { fail(e); }
  if (!S.hh) {
    $('setup-name').value = ls.get('hl-name', '');
    return show('setup');
  }
  show('main');
  setTab(S.tab);
  S.store.subscribe(S.hh.id, () => reloadSoon(), (st) => {
    $('sync').classList.toggle('off', st !== 'SUBSCRIBED');
    if (st === 'SUBSCRIBED') reloadSoon(0);
  });
  await reload();
  S.store.members(S.hh.id).then((m) => { S.members = m; render(); }).catch(() => {});
}

// ---------- Innlogging ----------
$('login-toggle').onclick = () => {
  S.signUpMode = !S.signUpMode;
  $('login-submit').textContent = S.signUpMode ? 'Lag konto' : 'Logg inn';
  $('login-toggle').textContent = S.signUpMode ? 'Har konto? Logg inn' : 'Ny bruker? Lag konto';
  $('login-password').autocomplete = S.signUpMode ? 'new-password' : 'current-password';
};
$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('login-error'); err.hidden = true;
  const email = $('login-email').value.trim(), pw = $('login-password').value;
  $('login-submit').disabled = true;
  try {
    if (S.signUpMode) {
      const r = await S.store.signUp(email, pw);
      if (r.needsConfirm) { err.textContent = 'Sjekk e-posten din og trykk på lenken, så kan du logge inn.'; err.hidden = false; return; }
    } else await S.store.signIn(email, pw);
    S.user = await S.store.user();
    await afterLogin();
  } catch (x) { err.textContent = x.message; err.hidden = false; }
  finally { $('login-submit').disabled = false; }
};

// ---------- Oppsett av husstand ----------
document.querySelectorAll('.seg-btn').forEach((b) => b.onclick = () => {
  S.setupMode = b.dataset.mode;
  document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('setup-hh-wrap').hidden = S.setupMode !== 'new';
  $('setup-code-wrap').hidden = S.setupMode !== 'join';
  $('setup-code').required = S.setupMode === 'join';
  $('setup-submit').textContent = S.setupMode === 'new' ? 'Lag liste' : 'Bli med';
});
$('setup-form').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('setup-error'); err.hidden = true;
  const name = $('setup-name').value.trim();
  ls.set('hl-name', name);
  $('setup-submit').disabled = true;
  try {
    S.hh = S.setupMode === 'new'
      ? await S.store.createHousehold($('setup-hh').value.trim(), name)
      : await S.store.joinHousehold($('setup-code').value.trim(), name);
    await afterLogin();
  } catch (x) { err.textContent = x.message; err.hidden = false; }
  finally { $('setup-submit').disabled = false; }
};
$('setup-logout').onclick = () => logout();

async function logout() {
  await S.store.signOut().catch(() => {});
  S.user = null; S.hh = null; S.items = [];
  $('settings').close?.();
  show('login');
}

// ---------- Faner ----------
document.querySelectorAll('.tab').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
function setTab(tab) {
  S.tab = tab; ls.set('hl-tab', tab);
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('title').textContent = TITLES[tab];
  $('pane-list').hidden = tab === 'kalender';
  $('pane-cal').hidden = tab !== 'kalender';
  if (tab === 'kalender') { renderCal(); if (Date.now() - S.calLoaded > 5 * 60e3) loadCal(); }
  else { $('add-input').placeholder = PLACEHOLDER[tab]; S.showDone = false; render(); }
  window.scrollTo(0, 0);
}

// ---------- Lister ----------
let reloadT;
function reloadSoon(ms = 250) { clearTimeout(reloadT); reloadT = setTimeout(reload, ms); }
async function reload() {
  if (!S.hh) return;
  try { S.items = await S.store.items(S.hh.id); render(); }
  catch (e) { fail(e); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.hh) { reloadSoon(0); if (S.tab === 'kalender') loadCal(); } });
setInterval(() => { if (!document.hidden && S.hh) reload(); }, 60e3);

function nameOf(uid) {
  if (!uid || uid === S.user?.id) return '';
  return S.members.find((m) => m.user_id === uid)?.display_name || '';
}
function itemHTML(it) {
  const who = nameOf(it.created_by);
  return `<li class="item${it.done ? ' is-done' : ''}" data-id="${it.id}">
    <button class="check" aria-label="${it.done ? 'Angre' : 'Kryss av'}"></button>
    <span class="txt">${esc(it.text)}${who ? `<small>${esc(who)}</small>` : ''}</span>
    <button class="del" aria-label="Slett">✕</button>
  </li>`;
}
function render() {
  for (const l of ['handle', 'gjore']) {
    const n = S.items.filter((i) => i.list === l && !i.done).length;
    $('badge-' + l).textContent = n || '';
  }
  if (S.tab === 'kalender') return;
  const mine = S.items.filter((i) => i.list === S.tab);
  const open = mine.filter((i) => !i.done).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const done = mine.filter((i) => i.done).sort((a, b) => ((a.done_at || '') < (b.done_at || '') ? 1 : -1));
  $('items').innerHTML = open.map(itemHTML).join('');
  $('empty').textContent = EMPTY[S.tab];
  $('empty').hidden = open.length > 0;
  $('done-wrap').hidden = done.length === 0;
  $('done-toggle').textContent = `${S.showDone ? '▾' : '▸'} Avkrysset (${done.length})`;
  $('done-items').hidden = !S.showDone;
  $('done-items').innerHTML = S.showDone ? done.map(itemHTML).join('') : '';
  renderSuggest();
}

function onListClick(e) {
  const li = e.target.closest('.item'); if (!li) return;
  const it = S.items.find((x) => x.id === li.dataset.id); if (!it) return;
  if (e.target.closest('.del')) {
    S.items = S.items.filter((x) => x !== it); render();
    S.store.remove(it.id).catch((x) => { fail(x); reload(); });
    return;
  }
  // Trykk på raden krysser av / angrer
  it.done = !it.done; it.done_at = it.done ? new Date().toISOString() : null;
  if (it.done) { li.classList.add('is-done', 'leaving'); setTimeout(render, 280); } else render();
  if (navigator.vibrate) navigator.vibrate(10);
  S.store.setDone(it.id, it.done).catch((x) => { fail(x); reload(); });
}
$('items').onclick = onListClick;
$('done-items').onclick = onListClick;
$('done-toggle').onclick = () => { S.showDone = !S.showDone; render(); };
$('clear-done').onclick = async () => {
  const list = S.tab;
  S.items = S.items.filter((i) => !(i.list === list && i.done)); render();
  try { await S.store.clearDone(S.hh.id, list); } catch (x) { fail(x); reload(); }
};

// Legg til (flere på en gang med komma eller linjeskift)
$('add-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('add-input');
  const parts = input.value.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return;
  input.value = '';
  await addItems(parts);
  input.focus();
};
async function addItems(texts) {
  const list = S.tab;
  for (const raw of texts) {
    const text = raw.charAt(0).toUpperCase() + raw.slice(1);
    const existing = S.items.find((i) => i.list === list && i.text.toLowerCase() === text.toLowerCase());
    remember(list, text);
    if (existing && !existing.done) { toast(`«${text}» står allerede på lista`); continue; }
    if (existing && existing.done) {
      existing.done = false; existing.done_at = null; existing.created_at = new Date().toISOString(); render();
      S.store.setDone(existing.id, false).catch(fail);
      continue;
    }
    const tmp = { id: 'tmp-' + Math.random(), list, text, done: false, created_by: S.user?.id, created_at: new Date().toISOString() };
    S.items.push(tmp); render();
    try { const row = await S.store.add(S.hh.id, list, text); Object.assign(tmp, row); render(); }
    catch (x) { S.items = S.items.filter((i) => i !== tmp); render(); fail(x); }
  }
}

// Forslag basert på det dere har lagt inn før
function remember(list, text) {
  const h = ls.get('hl-hist-' + list, {});
  const k = text.toLowerCase();
  h[k] = { t: text, n: (h[k]?.n || 0) + 1, at: Date.now() };
  ls.set('hl-hist-' + list, h);
}
function renderSuggest() {
  const box = $('suggest');
  const q = $('add-input').value.trim().toLowerCase();
  const focused = document.activeElement === $('add-input');
  if (!focused || S.tab === 'kalender') { box.hidden = true; return; }
  const onList = new Set(S.items.filter((i) => i.list === S.tab && !i.done).map((i) => i.text.toLowerCase()));
  const h = Object.values(ls.get('hl-hist-' + S.tab, {}));
  // Også varer som er krysset av tidligere
  for (const i of S.items) if (i.list === S.tab && !h.some((x) => x.t.toLowerCase() === i.text.toLowerCase())) h.push({ t: i.text, n: 1, at: 0 });
  const last = q.split(',').pop().trim();
  const hits = h.filter((x) => !onList.has(x.t.toLowerCase()) && (!last || x.t.toLowerCase().includes(last)) && x.t.toLowerCase() !== last)
    .sort((a, b) => (b.n - a.n) || (b.at - a.at)).slice(0, 8);
  box.innerHTML = hits.map((x) => `<button type="button" class="chip">${esc(x.t)}</button>`).join('');
  box.hidden = hits.length === 0;
}
$('add-input').addEventListener('input', renderSuggest);
$('add-input').addEventListener('focus', renderSuggest);
$('add-input').addEventListener('blur', () => setTimeout(renderSuggest, 150));
$('suggest').addEventListener('pointerdown', (e) => e.preventDefault()); // behold fokus
$('suggest').onclick = async (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  const input = $('add-input');
  const parts = input.value.split(',').slice(0, -1).map((s) => s.trim()).filter(Boolean);
  input.value = parts.length ? parts.join(', ') + ', ' : '';
  await addItems([c.textContent]);
  input.focus(); renderSuggest();
};

// ---------- Kalender ----------
async function loadCal() {
  if (!S.hh) return;
  if (!S.cal) $('cal').innerHTML = '<p class="empty">Henter kalenderen…</p>';
  try {
    S.cal = { ...(await S.store.calendar(S.hh.id, CAL_DAYS)), at: Date.now() };
    S.calLoaded = Date.now();
    ls.set('hl-cal', S.cal);
    renderCal();
  } catch (e) {
    if (S.cal?.events?.length) { renderCal(); toast('Fikk ikke oppdatert kalenderen: ' + e.message, 6000); }
    else $('cal').innerHTML = `<div class="card empty-card"><p>${esc(e.message)}</p><button class="btn" id="cal-retry">Prøv igjen</button></div>`;
    const r = $('cal-retry'); if (r) r.onclick = loadCal;
  }
}
const dayKey = (d) => d.toLocaleDateString('sv-SE');
function dayLabel(key) {
  const today = new Date(); const t = dayKey(today);
  const tm = new Date(today); tm.setDate(tm.getDate() + 1);
  if (key === t) return 'I dag';
  if (key === dayKey(tm)) return 'I morgen';
  const d = new Date(key + 'T12:00:00');
  const s = d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const hm = (d) => d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
const CAL_DAYS = 60; // så langt fram kalenderfunksjonen henter
function calDays() {
  // Fordel avtaler på dager (heldagsavtaler over flere dager vises hver dag)
  const days = new Map();
  const todayKey = dayKey(new Date());
  const add = (k, ev) => { if (k < todayKey) return; if (!days.has(k)) days.set(k, []); days.get(k).push(ev); };
  const feed = S.cal?.events || [];
  const same = (a, b) => a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
    && (a.allDay ? a.start === b.start : Math.abs(new Date(a.start) - new Date(b.start)) < 60e3);
  // Nye avtaler fra appen vises til Google har tatt dem med (maks ett døgn)
  const pending = ls.get('hl-pending', []).filter((p) => Date.now() - p.created < 864e5 && !feed.some((f) => same(f, p)));
  ls.set('hl-pending', pending);
  for (const ev of [...feed, ...pending]) {
    if (ev.allDay) {
      const d = new Date(ev.start + 'T12:00:00'), end = new Date((ev.end || ev.start) + 'T12:00:00');
      do { add(dayKey(d), ev); d.setDate(d.getDate() + 1); } while (d < end);
    } else {
      const s = new Date(ev.start), e = new Date(ev.end);
      if (e < new Date()) continue; // ferdig
      add(dayKey(s), ev);
    }
  }
  for (const list of days.values()) list.sort((a, b) => (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || (a.start < b.start ? -1 : 1));
  return days;
}
const evListHTML = (evs) => `<ul class="cal-list card">${evs.map((ev) => `<li>
      <span class="cal-time">${ev.allDay ? 'Hele dagen' : hm(new Date(ev.start))}</span>
      <span class="cal-title">${esc(ev.title)}${ev.location ? `<small>${esc(ev.location)}</small>` : ''}${ev.pending ? '<small class="pend">Lagt til fra appen · venter på Google</small>' : ''}</span>
    </li>`).join('')}</ul>`;

S.calView = ls.get('hl-calview', 'liste');
S.calMonth = 0; // 0 = denne måneden
S.calSel = null;
function renderCal() {
  const box = $('cal');
  if (!S.cal) return;
  if (S.cal.missing) {
    box.innerHTML = `<div class="card empty-card"><p>Koble til familiekalenderen ved å lime inn den hemmelige iCal-adressen i innstillingene.</p>
      <button class="btn primary" id="cal-setup">Åpne innstillinger</button></div>`;
    $('cal-setup').onclick = openSettings; return;
  }
  const days = calDays();
  const todayKey = dayKey(new Date());
  const seg = `<div class="seg cal-seg">
    <button class="seg-btn${S.calView === 'liste' ? ' active' : ''}" data-view="liste">Liste</button>
    <button class="seg-btn${S.calView === 'maned' ? ' active' : ''}" data-view="maned">Måned</button></div>`;
  const foot = `<p class="hint center-text">Viser to måneder fram · oppdatert ${hm(new Date(S.cal.at || Date.now()))}${S.cal.demo ? ' · demodata' : ''}
    · <button class="link inline" id="cal-refresh">Oppdater nå</button></p>`;

  let body;
  if (S.calView === 'maned') {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + S.calMonth, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + S.calMonth + 1, 0);
    const limit = new Date(); limit.setDate(limit.getDate() + CAL_DAYS);
    const canNext = new Date(first.getFullYear(), first.getMonth() + 1, 1) < limit;
    const title = first.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
    const lead = (first.getDay() + 6) % 7; // mandag først
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="mc empty"></span>';
    for (let d = 1; d <= last.getDate(); d++) {
      const k = dayKey(new Date(first.getFullYear(), first.getMonth(), d));
      const evs = days.get(k) || [];
      const past = k < todayKey;
      const cls = ['mc', past && 'past', k === todayKey && 'today', k === S.calSel && 'sel', evs.length && 'has'].filter(Boolean).join(' ');
      cells += `<button class="${cls}" data-day="${k}"${past ? ' disabled' : ''}><span class="mn">${d}</span>${
        evs.slice(0, 2).map((e) => `<span class="mt">${esc(e.title)}</span>`).join('')}${evs.length > 2 ? `<span class="mm">+${evs.length - 2}</span>` : ''}</button>`;
    }
    const sel = S.calSel && S.calSel >= dayKey(first) && S.calSel <= dayKey(last) ? S.calSel : null;
    const selEvs = sel ? days.get(sel) || [] : [];
    body = `<div class="month card">
        <div class="month-head">
          <button class="icon-btn" id="m-prev" ${S.calMonth <= 0 ? 'disabled' : ''} aria-label="Forrige måned">‹</button>
          <b>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</b>
          <button class="icon-btn" id="m-next" ${canNext ? '' : 'disabled'} aria-label="Neste måned">›</button>
        </div>
        <div class="mgrid">${['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'].map((w) => `<span class="wd">${w}</span>`).join('')}${cells}</div>
      </div>
      ${sel ? `<h4 class="cal-day">${esc(dayLabel(sel))}</h4>${selEvs.length ? evListHTML(selEvs) : '<p class="empty small">Ingen avtaler denne dagen.</p>'}`
        : '<p class="hint center-text">Trykk på en dag for å se avtalene.</p>'}`;
  } else if (!days.size) {
    body = '<p class="empty">Ingen avtaler de neste to månedene.</p>';
  } else {
    body = [...days.keys()].sort().map((k) => `<h4 class="cal-day${k === todayKey ? ' today' : ''}">${esc(dayLabel(k))}</h4>${evListHTML(days.get(k))}`).join('');
  }
  box.innerHTML = seg + body + foot;

  box.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { S.calView = b.dataset.view; ls.set('hl-calview', S.calView); renderCal(); });
  box.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => {
    S.calSel = b.dataset.day; renderCal();
    document.querySelector('.month + .cal-day')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('cal-refresh').onclick = () => { toast('Henter kalenderen…', 1500); loadCal(); };
  const pv = $('m-prev'), nx = $('m-next');
  if (pv) pv.onclick = () => { S.calMonth = Math.max(0, S.calMonth - 1); renderCal(); };
  if (nx) nx.onclick = () => { S.calMonth++; renderCal(); };
}

// ---------- Innstillinger ----------
$('open-settings').onclick = () => openSettings();
function openSettings() {
  $('set-hh').textContent = S.hh?.name || '';
  $('set-code').textContent = S.hh?.invite_code || '';
  $('set-members').textContent = S.members.map((m) => m.display_name || '(uten navn)').join(', ') || '–';
  $('set-email').textContent = S.user?.email || '';
  $('set-ical').value = S.hh?.ical_url || '';
  $('ical-msg').hidden = true;
  $('settings').showModal();
}
$('share-code').onclick = async () => {
  const text = `Bli med i huskelista vår! Åpn ${location.origin + location.pathname}, lag konto, velg «Jeg har en kode» og skriv inn: ${S.hh.invite_code}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Kopiert. Lim inn i en melding.'); }
  } catch {}
};
$('save-ical').onclick = async () => {
  const url = $('set-ical').value.trim();
  const msg = $('ical-msg');
  if (url && !/^(https|webcal):\/\/.+/i.test(url)) { msg.textContent = 'Adressen må starte med https:// eller webcal://'; msg.hidden = false; return; }
  try {
    await S.store.setIcal(S.hh.id, url);
    S.hh.ical_url = url || null;
    S.cal = null; S.calLoaded = 0; ls.set('hl-cal', null);
    msg.textContent = url ? 'Lagret. Kalenderen vises under «Kalender».' : 'Kalenderen er koblet fra.'; msg.hidden = false;
  } catch (e) { msg.textContent = e.message; msg.hidden = false; }
};
$('logout').onclick = () => logout();

// ---------- Ny avtale (åpner Google Kalender ferdig utfylt) ----------
$('new-event').onclick = () => {
  $('event-form').reset();
  $('ev-date').value = dayKey(new Date());
  $('ev-times').hidden = false;
  $('event-dlg').showModal();
  setTimeout(() => $('ev-title').focus(), 50);
};
$('ev-allday').onchange = () => { $('ev-times').hidden = $('ev-allday').checked; };
$('ev-from').onchange = () => {
  const [h, m] = $('ev-from').value.split(':').map(Number);
  if (!isNaN(h)) $('ev-to').value = `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
function calendarIdFromIcal(url) {
  const m = /\/calendar\/ical\/([^/]+)\//.exec(url || '');
  return m ? decodeURIComponent(m[1]) : '';
}
$('event-form').onsubmit = (e) => {
  e.preventDefault();
  const date = $('ev-date').value.replaceAll('-', '');
  let dates;
  if ($('ev-allday').checked) {
    const d = new Date($('ev-date').value + 'T12:00:00'); d.setDate(d.getDate() + 1);
    dates = `${date}/${dayKey(d).replaceAll('-', '')}`;
  } else {
    const from = ($('ev-from').value || '12:00').replace(':', '') + '00';
    let to = ($('ev-to').value || $('ev-from').value || '13:00').replace(':', '') + '00';
    let endDate = date;
    if (to <= from) { const d = new Date($('ev-date').value + 'T12:00:00'); d.setDate(d.getDate() + 1); endDate = dayKey(d).replaceAll('-', ''); }
    dates = `${date}T${from}/${endDate}T${to}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: $('ev-title').value.trim(), dates, ctz: 'Europe/Oslo' });
  const loc = $('ev-loc').value.trim(); if (loc) p.set('location', loc);
  const cal = calendarIdFromIcal(S.hh?.ical_url); if (cal) p.set('src', cal);
  // Vis avtalen i appen med en gang, til den dukker opp i Google-kalenderen
  const allDay = $('ev-allday').checked;
  const toIso = (dt) => new Date(dt).toISOString();
  const pend = {
    title: $('ev-title').value.trim(), location: loc, allDay, pending: true, created: Date.now(),
    start: allDay ? $('ev-date').value : toIso(`${$('ev-date').value}T${$('ev-from').value || '12:00'}`),
    end: allDay ? dayKey(new Date(new Date($('ev-date').value + 'T12:00:00').getTime() + 864e5))
      : toIso(`${$('ev-date').value}T${$('ev-to').value || $('ev-from').value || '13:00'}`),
  };
  ls.set('hl-pending', [...ls.get('hl-pending', []), pend]);
  renderCal();
  $('event-dlg').close();
  S.calLoaded = 0; // hent kalenderen på nytt når du kommer tilbake
  window.open('https://calendar.google.com/calendar/render?' + p.toString(), '_blank');
};

boot().catch((e) => {
  show('login');
  $('login-error').textContent = 'Fikk ikke startet appen. Sjekk nettforbindelsen og åpne appen på nytt. (' + (e?.message || e) + ')';
  $('login-error').hidden = false;
});
