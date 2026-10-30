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
> Il registro vive nel `localStorage` del browser: usa *Esporta registro* per conservarne una copia.

## Avvio

```bash
npm start          # oppure: python3 -m http.server 8080
# apri http://localhost:8080
```

In alternativa basta aprire `index.html` nel browser.

## Test

```bash
npm test
```

## Struttura

- `js/targa-rules.js` — regole di composizione, validazione, serie progressiva, generatore, rendering SVG
- `js/ledger.js` — SHA-256, wallet, registro a blocchi e operazioni sui token (mint, transfer, update, burn)
- `js/game.js` — rarità, XP, livelli e trofei (ricavati dal registro)
- `js/app.js` — interfaccia della dashboard e animazioni
- `test/` — test con `node --test`
