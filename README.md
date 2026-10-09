# WanWay Multi-Account Monitor

Pantau semua kendaraan dari banyak akun WanWay/IOPGPS dalam satu peta.

**Stateless**: akun (AppID + Secret Key) disimpan di browser (localStorage), dikirim ke backend per-request. Server tidak menyimpan secret.

## Setup lokal

```bash
bun install
bun run build:client   # build UI
PORT=3000 bun src/index.ts
```

Buka http://localhost:3000, tambahkan akun (AppID + Secret Key Open API).

## Environment

| Var | Wajib | Keterangan |
|-----|-------|------------|
| `PORT` | tidak | Port lokal (default 3000). |

Tidak ada env wajib di Vercel — deploy zero-config (framework Elysia, `bunVersion: 1.x`).

## Cara dapatkan Secret Key

Secret Key = kunci akses Open API IOPGPS (`open.iopgps.com`). Didapat dengan mengajukan akses API ke WanWay ("apply for access to API"). Bukan password login app.
