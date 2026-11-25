// Supabase Edge Function «kalender»
// Henter familiekalenderen (hemmelig iCal-adresse lagret på husstanden) og
// returnerer avtalene de neste dagene som JSON. Bare innloggede medlemmer av
// husstanden får svar, fordi oppslaget går gjennom databasens tilgangsregler.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import ICAL from 'npm:ical.js@2.1.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!u?.user) return json({ error: 'Ikke logget inn' }, 401);

    let body: { household_id?: string; days?: number } = {};
    try { body = await req.json(); } catch { /* tom body */ }
    const { data: hh, error } = await sb.from('hl_households').select('ical_url')
      .eq('id', body.household_id ?? '').maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!hh) return json({ error: 'Fant ikke husstanden' }, 404);
    if (!hh.ical_url) return json({ events: [], missing: true });

    const url = String(hh.ical_url).replace(/^webcal:/i, 'https:');
    const res = await fetch(url, { headers: { 'User-Agent': 'huskeliste-kalender' } });
    if (!res.ok) return json({ error: `Kalenderen svarte ${res.status}. Sjekk iCal-adressen.` }, 502);
    const text = await res.text();

    const days = Math.min(Math.max(Number(body.days) || 14, 1), 400);
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + days * 86400000);
    return json({ events: expand(ICAL, text, from, to), days });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

// Gjør om iCal-tekst til en liste med avtaler i perioden, med gjentakelser utvidet.
// deno-lint-ignore no-explicit-any
export function expand(ICAL: any, text: string, from: Date, to: Date) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
  // deno-lint-ignore no-explicit-any
  const masters = new Map<string, any>();
  // deno-lint-ignore no-explicit-any
  const exceptions: any[] = [];
  for (const v of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(v);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const m = masters.get(ex.uid);
    if (m) m.relateException(ex); else masters.set(ex.uid + ex.recurrenceId, ex);
  }

  const out: { title: string; start: string; end: string; allDay: boolean; location: string }[] = [];
  // deno-lint-ignore no-explicit-any
  const push = (item: any, s: any, e: any) => {
    if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const sd = s.toJSDate(), ed = (e ?? s).toJSDate();
    const allDay = !!s.isDate;
    if (ed <= from && !(allDay && +ed === +sd && sd >= from) || sd >= to) return;
    out.push({
      title: item.summary || '(uten tittel)',
      start: allDay ? s.toString() : sd.toISOString(),
      end: allDay ? (e ?? s).toString() : ed.toISOString(),
      allDay,
      location: item.location || '',
    });
  };

  for (const ev of masters.values()) {
    if (!ev.isRecurring()) { push(ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    let next, n = 0;
    while ((next = it.next()) && n++ < 20000) {
      if (next.toJSDate() >= to) break;
      const d = ev.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate);
    }
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}
