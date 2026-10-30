# Random_Targa
Crea, gestisci e tokenizza la targa del tuo mezzo.

Dashboard web (HTML/CSS/JS, nessuna dipendenza) per:

- **Creare una targa italiana** seguendo le regole di composizione del sistema nazionale (dal 1994):
  - Autoveicoli `AA 000 AA`, Motoveicoli `AA 00000`, Ciclomotori `X` + 5 alfanumerici, Rimorchi `XA 000 AA`
  - solo le 22 lettere ammesse (escluse **I, O, Q, U**), prefisso `EE` riservato, numero `000` non emesso
  - posizione progressiva nella serie (numero → coppia finale → coppia iniziale) e stima dell'anno di emissione
  - banda UE a sinistra e banda destra opzionale con anno e sigla provincia (107 province)
  - anteprima SVG scaricabile
- **Tokenizzarla**: ogni targa diventa un token non fungibile (stile ERC-721) coniato su un registro a blocchi
  concatenati (SHA-256 + proof-of-work leggera). Una targa può esistere una sola volta nel registro.
- **Gestirla nel garage**: wallet multipli, ricerca e filtri, modifica dei dati del veicolo, trasferimento
  ad altri indirizzi, burn, storico delle operazioni, metadati JSON scaricabili, verifica d'integrità,
  esportazione/importazione del registro.

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
- `js/app.js` — interfaccia della dashboard
- `test/` — test con `node --test`
