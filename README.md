# Random_Targa
Crea, gestisci e tokenizza la targa del tuo mezzo.

Dashboard web (HTML/CSS/JS, nessuna dipendenza) per:

- **Creare una targa italiana** seguendo le regole di composizione del sistema nazionale (dal 1994):
  - Autoveicoli `AA 000 AA`, Motoveicoli `AA 00000`, Ciclomotori `X` + 5 alfanumerici, Rimorchi `XA 000 AA`
  - solo le 22 lettere ammesse (escluse **I, O, Q, U**), prefisso `EE` riservato, numero `000` non emesso
  - posizione progressiva nella serie (numero → coppia finale → coppia iniziale) e stima dell'anno di emissione
  - banda UE a sinistra e banda destra opzionale con anno e sigla provincia (107 province)
  - anteprima SVG scaricabile
- **Certificarla**: ogni targa diventa un certificato digitale unico (sotto il cofano un token non fungibile
  stile ERC-721 su un registro a blocchi SHA-256 con proof-of-work leggera). Il wallet è invisibile al cliente:
  l'interfaccia parla solo di *garage*, *certificati*, *cessioni* e *rottamazioni*, senza indirizzi o gergo crypto.
- **Gestirla nel garage**: più garage per dispositivo, ricerca, filtri, ordinamento per rarità, personalizzazione,
  cessione ad altri garage, rottamazione, storia della targa, certificato scaricabile, backup/ripristino.
- **Giocare**: punti esperienza, 10 livelli, 12 trofei, missioni, "ruota" che fa scorrere i caratteri come una
  slot machine e 5 livelli di rarità (Comune → Leggendaria) per combinazioni speciali (palindromi, 777, 007, scale,
  coppie gemelle, sigla della tua provincia…). Animazioni: timbro di certificazione, coriandoli, XP fluttuanti,
  level-up, popup dei trofei, effetto 3D sulle targhe (disattivate con `prefers-reduced-motion`).

> In Italia la combinazione della targa stradale non si sceglie: la targa creata qui è digitale/da collezione.

## Due modalità

- **Demo** (`js/config.js` vuoto): tutto resta nel browser, con più garage sullo stesso dispositivo, backup e ripristino.
- **Registro condiviso con Supabase**: ogni targa esiste una sola volta per tutti gli utenti, le cessioni avvengono
  tra persone diverse tramite il *codice garage*, c'è una classifica globale e chi riceve una targa viene avvisato
  in tempo reale. L'accesso è anonimo e automatico (nessuna registrazione); collegando un'email il garage
  si salva e si ritrova su altri dispositivi.

## Collegare Supabase

1. Crea un progetto su [supabase.com](https://supabase.com) (regione consigliata: Europa).
2. In **SQL Editor** incolla ed esegui `supabase/migrations/20261030000000_registro_targhe.sql`
   (oppure, con la CLI di Supabase: `supabase link` e `supabase db push`).
3. In **Authentication → Sign In / Providers** attiva **Allow anonymous sign-ins** (e lascia attivo Email).
4. In **Authentication → URL Configuration** imposta come *Site URL* l'indirizzo del sito pubblicato
   e aggiungi `http://localhost:8080` tra i *Redirect URLs* per lo sviluppo.
5. In **Project Settings → API Keys** copia *Project URL* e la chiave pubblica (*anon* o *publishable*)
   in `js/config.js`. Non usare mai la chiave *service_role* / *secret* nel sito.
6. Consigliato: attiva il CAPTCHA in **Authentication → Attack Protection**, per limitare gli account anonimi automatici.

Sicurezza: le tabelle sono in sola lettura per il browser; ogni scrittura passa da funzioni del database che
verificano proprietario e regole di composizione. Le operazioni sono concatenate da impronte SHA-256 e
`verify_chain()` rileva qualsiasi modifica successiva.

Limite attuale: il sito scarica tutto il registro per calcolare XP e classifica; va benissimo fino a
qualche migliaio di operazioni, oltre conviene spostare i calcoli in viste del database.

## Avvio

```bash
npm start          # oppure: python3 -m http.server 8080
# apri http://localhost:8080
```

## Test

```bash
npm test           # regole, registro locale, gioco
npm run test:db    # schema Supabase su un Postgres locale (PGHOST/PGPORT/PGUSER), incluso il client JS
```

## Struttura

- `js/targa-rules.js` — regole di composizione, validazione, serie progressiva, generatore, rendering SVG
- `js/ledger.js` — registro locale a blocchi (SHA-256, proof-of-work leggera) per la modalità demo
- `js/game.js` — rarità, XP, livelli e trofei (ricavati dagli eventi del registro)
- `js/store-local.js`, `js/store-supabase.js` — archivio locale e condiviso, stessa interfaccia
- `js/config.js` — configurazione di Supabase
- `js/app.js` — interfaccia della dashboard e animazioni
- `supabase/migrations/` — schema, regole di sicurezza e funzioni del registro condiviso
- `test/`, `supabase/tests/` — test
