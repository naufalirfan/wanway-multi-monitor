# WanWay Multi-Account Monitor

Pantau semua kendaraan dari banyak akun WanWay/IOPGPS dalam satu peta.

## Setup lokal

```bash
bun install
bun run build        # build client
APP_ENC_KEY=<random> PORT=3000 bun src/index.ts
```

Buka http://localhost:3000, tambahkan akun (appid + login key).

## Environment

| Var | Wajib | Keterangan |
|-----|-------|------------|
| `APP_ENC_KEY` | ya | Kunci enkripsi AES secret akun (di Vercel: Settings → Environment Variables). Jangan commit. |
| `DB_FILE` | tidak | Path file JSON penyimpan akun. Vercel: `/tmp/accounts.json` (default `./data/accounts.json` lokal). |
| `PORT` | tidak | Port lokal (default 3000). |

## Cara dapatkan login key

Login key = kunci akses Open API IOPGPS (`open.iopgps.com`). Didapat dengan mengajukan akses API ke WanWay (atau lihat Settings → API Keys di platform). Bukan password login app.