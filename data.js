// Datalag: Supabase når nøkkel finnes, ellers lokal lagring (demomodus).
import { CONFIG } from './config.js';

export async function createStore() {
  if (CONFIG.SUPABASE_ANON_KEY && !/[?&]demo\b/.test(location.search)) return createSupabaseStore();
  return createLocalStore();
}

async function createSupabaseStore() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'huskeliste-auth' },
  });
  const check = ({ data, error }) => { if (error) throw new Error(norskFeil(error.message)); return data; };
  let channel = null;

  return {
    demo: false,
    async user() { const { data } = await sb.auth.getSession(); return data.session?.user ?? null; },
    onAuth(cb) { sb.auth.onAuthStateChange((_e, s) => cb(s?.user ?? null)); },
    async signIn(email, password) { check(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password) {
      const data = check(await sb.auth.signUp({ email, password }));
      return { needsConfirm: !data.session };
    },
    async signOut() { await sb.auth.signOut(); },

    async household() {
      const rows = check(await sb.from('hl_households').select('*').order('created_at').limit(1));
      return rows[0] ?? null;
    },
    async members(hid) { return check(await sb.from('hl_members').select('user_id,display_name').eq('household_id', hid)); },
    async createHousehold(name, display) { return check(await sb.rpc('hl_create_household', { p_name: name, p_display: display })); },
    async joinHousehold(code, display) { return check(await sb.rpc('hl_join_household', { p_code: code, p_display: display })); },
    async setIcal(hid, url) { check(await sb.from('hl_households').update({ ical_url: url || null }).eq('id', hid)); },

    async items(hid) {
      return check(await sb.from('hl_items').select('*').eq('household_id', hid).order('created_at', { ascending: true }));
    },
    async add(hid, list, text) {
      return check(await sb.from('hl_items').insert({ household_id: hid, list, text }).select().single());
    },
    async setDone(id, done) {
      check(await sb.from('hl_items').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', id));
    },
    async rename(id, text) { check(await sb.from('hl_items').update({ text }).eq('id', id)); },
    async remove(id) { check(await sb.from('hl_items').delete().eq('id', id)); },
    async clearDone(hid, list) { check(await sb.from('hl_items').delete().eq('household_id', hid).eq('list', list).eq('done', true)); },

    // Sanntid: kaller cb når noe endres i lista (av deg eller den andre)
    subscribe(hid, cb, onStatus) {
      if (channel) sb.removeChannel(channel);
      channel = sb.channel('hl-' + hid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hl_items' }, () => cb())
        .subscribe((status) => onStatus?.(status));
    },

    async calendar(hid, days = 14) {
      const { data, error } = await sb.functions.invoke('kalender', { body: { household_id: hid, days } });
      if (error) {
        let msg = error.message;
        try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch {}
        if (/Failed to send|not found|404/i.test(msg)) msg = `Fikk ikke kontakt med kalenderfunksjonen «kalender» i Supabase. Sjekk at den er laget og heter akkurat «kalender». (${msg})`;
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
  };
}

function norskFeil(msg) {
  if (/Invalid login credentials/i.test(msg)) return 'Feil e-post eller passord.';
  if (/Email not confirmed/i.test(msg)) return 'E-posten er ikke bekreftet ennå. Sjekk innboksen.';
  if (/already registered/i.test(msg)) return 'Det finnes allerede en konto med denne e-posten.';
  if (/Password should be/i.test(msg)) return 'Passordet må ha minst 6 tegn.';
  if (/rate limit/i.test(msg)) return 'For mange forsøk. Vent litt og prøv igjen.';
  if (/Ukjent kode/i.test(msg)) return 'Fant ingen liste med den koden. Sjekk at den er skrevet riktig.';
  if (/permission denied/i.test(msg)) return 'Databasen mangler tilgang. Kjør supabase.sql i Supabase (SQL Editor).';
  if (/row-level security/i.test(msg)) return 'Databasen avviste endringen. Logg ut og inn igjen.';
  if (/relation .* does not exist|Could not find the (table|function)/i.test(msg)) return 'Databasen er ikke satt opp ennå (kjør supabase.sql i Supabase).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Ingen nettforbindelse. Prøv igjen.';
  return msg;
}

// Demomodus: alt lagres i nettleseren på denne enheten.
function createLocalStore() {
  const K = 'huskeliste-demo';
  const load = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch { return {}; } };
  const db = Object.assign({ hh: null, items: [] }, load());
  const save = () => { try { localStorage.setItem(K, JSON.stringify(db)); } catch {} };
  let cb = null; const fire = () => cb?.();
  const me = { id: 'demo', email: 'demo (lagres bare her)' };
  return {
    demo: true,
    async user() { return me; }, onAuth() {}, async signIn() {}, async signUp() { return {}; }, async signOut() {},
    async household() { return db.hh; },
    async members() { return [{ user_id: 'demo', display_name: db.name || 'Meg' }]; },
    async createHousehold(name, display) {
      db.hh = { id: 'demo', name: name || 'Hjemme', invite_code: 'DEMO00', ical_url: null }; db.name = display; save(); return db.hh;
    },
    async joinHousehold() { throw new Error('Deling virker ikke i demomodus.'); },
    async setIcal(_h, url) { db.hh.ical_url = url; save(); },
    async items() { return db.items.slice(); },
    async add(_h, list, text) {
      const it = { id: crypto.randomUUID(), list, text, done: false, created_by: 'demo', created_at: new Date().toISOString() };
      db.items.push(it); save(); fire(); return it;
    },
    async setDone(id, done) { const it = db.items.find((x) => x.id === id); if (it) { it.done = done; it.done_at = done ? new Date().toISOString() : null; } save(); fire(); },
    async rename(id, text) { const it = db.items.find((x) => x.id === id); if (it) it.text = text; save(); fire(); },
    async remove(id) { db.items = db.items.filter((x) => x.id !== id); save(); fire(); },
    async clearDone(_h, list) { db.items = db.items.filter((x) => !(x.list === list && x.done)); save(); fire(); },
    subscribe(_h, c, onStatus) { cb = c; onStatus?.('SUBSCRIBED'); },
    async calendar() {
      const d = (n, h) => { const x = new Date(); x.setDate(x.getDate() + n); x.setHours(h, 0, 0, 0); return x.toISOString(); };
      const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
      return { events: [
        { title: 'Fotballtrening', start: d(0, 17), end: d(0, 18), allDay: false, location: 'Kunstgresset' },
        { title: 'Tannlege', start: d(1, 9), end: d(1, 10), allDay: false, location: '' },
        { title: 'Bursdag mormor', start: day(3), end: day(4), allDay: true, location: '' },
      ], demo: true };
    },
  };
}
