# Huskeliste

Enkel, felles handleliste og gjøremålsliste for familien, med familiekalenderen fra Google ved siden av.
Laget som en web-app (PWA) som legges på hjemskjermen på iPhone/Android. Endringer vises på den andres
telefon med en gang.

- **Handle**: skriv inn varer (flere på en gang med komma: «melk, egg, brød»). Trykk for å krysse av.
  Appen foreslår varer dere har kjøpt før.
- **Gjøre**: samme, for gjøremål.
- **Kalender**: avtaler fra familiekalenderen de neste tre ukene. «+ Ny avtale» åpner Google Kalender med avtalen ferdig utfylt, så du bare trykker Lagre.

Data lagres i samme Supabase-prosjekt som matdagboken (egne tabeller med prefiks `hl_`).
Hver husstand har en invitasjonskode; bare medlemmer ser lista.

## Oppsett (én gang)

1. **Database**: Supabase → SQL Editor → lim inn hele `supabase.sql` → Run.
2. **Kalenderfunksjon**: Supabase → Edge Functions → *Deploy a new function* → *Via Editor*.
   Kall den `kalender`, lim inn innholdet i `supabase/functions/kalender/index.ts` og trykk *Deploy*.
3. **Publiser appen**: GitHub → repoet → Settings → Pages → *Deploy from a branch* → `main` / `(root)`.
   Appen ligger da på `https://<bruker>.github.io/huskeliste/`.
4. **På telefonen**: åpne adressen i Safari → Del → *Legg til på Hjem-skjerm*. Logg inn (samme konto som
   matdagboken går fint), skriv navnet ditt og trykk *Lag liste*.
5. **Inviter**: ⚙︎ → *Send koden til den andre*. Den andre lager konto, velger «Jeg har en kode» og skriver inn koden.
6. **Kalender**: Google Kalender på PC → ⚙︎ Innstillinger → velg familiekalenderen i venstremenyen →
   *Integrer kalender* → kopier **Hemmelig adresse i iCal-format**. Lim den inn i appen under ⚙︎ → Familiekalender.

Den hemmelige adressen gir lesetilgang til kalenderen for den som har den. Den lagres i databasen og er bare
synlig for medlemmene av husstanden. Den kan nullstilles i Google Kalender om den skulle komme på avveie.

## Prøve uten database

Åpne `index.html?demo` (f.eks. med `python3 -m http.server`). Da lagres alt bare i nettleseren.

## Filer

- `index.html`, `styles.css`, `app.js`: selve appen
- `data.js`: snakker med Supabase (og demomodus)
- `config.js`: Supabase-adresse og offentlig nøkkel
- `supabase.sql`: tabeller, tilgangsregler og sanntid
- `supabase/functions/kalender/index.ts`: henter og tolker iCal-kalenderen (med gjentakende avtaler)
- `sw.js`, `manifest.webmanifest`, `icons/`: hjemskjerm-app og fungerer med dårlig nett
