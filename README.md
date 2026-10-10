# 🛰️ WanWay Multi-Account Monitor

> Pantau semua kendaraan dari banyak akun **WanWay / IOPGPS** (`open.iopgps.com`) dalam **satu peta** — stateless, tanpa simpan secret di server.

[![Vercel Deploy](https://vercelbadge.vercel.app/api/naufalirfan/wanway-multi-monitor)](https://wanway-multi-monitor.vercel.app)
[![Elysia](https://img.shields.io/badge/Elysia-1.x-7B5CFF?logo=bun)](./src/index.ts)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](./client)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet)](./client)
[![Bun](https://img.shields.io/badge/Bun-1.x-black?logo=bun)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](#lisensi)

**Live demo:** **https://wanway-multi-monitor.vercel.app**

---

## ✨ Fitur Utama

| Fitur | Deskripsi |
|---|---|
| **Multi-akun 1 peta** | Gabung kendaraan dari N akun berbeda — Open API maupun akun aplikasi WanWay — tampil bersama di Leaflet |
| **2 cara login** | **Open API** (AppID + Secret Key `open.iopgps.com`) atau **Akun app** (username + password `www.wanwaygps.com`) |
| **Peta gelap + marker status** | Tile Esri Dark Gray, marker Online hijau / Offline merah / Idle abu, auto-fit bounds saat load pertama |
| **Auto-refresh 30 detik** | Poll paralel `/api/vehicles` + `/api/portal/vehicles`, bar status jam update |
| **Riwayat / playback jejak** | Pilih kendaraan → rentang 1/6/24/168 jam → polyline kuning + marker awal/akhir, ringkasan jam & kecepatan maks |
| **Alarm** | Filter per kendaraan 1/7/30 hari, tampil isi + waktu + alamat |
| **Password gate (lokal)** | Gerbang SHA-256 di localStorage + flag session — sembunyikan UI dari pemakai biasa |
| **Stateless & privasi** | Kredensial di `localStorage` browser, kirim per-request; server Vercel tidak simpan secret |
| **Error boundary** | Tidak pernah blank page — fallback "Terjadi kesalahan → Muat ulang" |

---

## 🏗️ Arsitektur

```
Browser (React + Leaflet)                Vercel (Elysia + Bun)
┌─────────────────────┐                  ┌──────────────────────────────┐
│ localStorage:       │  POST /api/…     │ POST /api/vehicles           │──► open.iopgps.com /api/auth
│  wanway_accounts    ├─────────────────►│  getToken(appid,secret)      │    signature md5(md5(secret)+time)
│  wanway_pass_hash   │                  │  /api/device + /status +     │    token cache 1.5 jam
│ sessionStorage: ok  │  POST /api/…     │  /location per device        │
│ Leaflet + 3 tab     ├─────────────────►│ POST /api/portal/vehicles    │──► www.wanwaygps.com /login
│  Kendaraan/Riwayat/ │                  │  portalLogin(user,pass)      │    USER_TOKEN via Set-Cookie
│  Alarm              │  POST /api/…     │  /rest/device/list           │    cache 1 jam
│                     ├─────────────────►│ POST /api/history,/alarms    │──► track/history, alarm
└─────────────────────┘                  └──────────────┬───────────────┘
         ▲                                              │ serve dist/client (Vite)
         └──────── dist/client (Vite build) ◄───────────┘  satu origin — API + UI
```

Normalisasi defensif: field `lng/lat/time/speed/address/type` diambil dari banyak alias (`lon/longitude/latitude/gpsTime/positionTime/...`) karena IOPGPS tidak konsisten — via `numOr()` + `normPoint`/`normAlarm`.

---

## 📁 Struktur Repo

```
wanway-multi-monitor/
├── src/index.ts          # Elysia backend — proxy IOPGPS+portal, serve dist/client
├── client/
│   ├── index.html        # entry HTML (id, dark, IBM Plex, Leaflet CSS)
│   ├── main.tsx          # App + Gate + TrackPanel + AlarmPanel (~560 baris)
│   └── style.css         # tema gelap (ink #0A0C0D, accent #F5B544), panel 348px
├── DESIGN.md             # token desain — sumber style.css
├── vite.config.ts        # root: client, outDir: dist/client, proxy /api → :3000
├── vercel.json           # bunVersion 1.x, buildCommand bun run build:client
└── package.json          # elysia, react, leaflet, vite, concurrently
```

---

## 🚀 Quick Start

**Syarat:** Bun 1.x (atau Node 20+ dengan `bun` via `npm i -g bun`)

```bash
git clone https://github.com/naufalirfan/wanway-multi-monitor.git
cd wanway-multi-monitor
bun install
bun run build:client   # build UI → dist/client
PORT=3000 bun src/index.ts
# dev (watch backend + vite HMR):
bun run dev
```

Buka http://localhost:3000 → tambah akun → kendaraan muncul di peta.

---

## 🔑 Mendapatkan Kredensial

**Opsi A — Open API (disarankan, untuk Riwayat & Alarm):**
1. Login `open.iopgps.com` dengan akun WanWay.
2. Ajukan **"Apply for access to API"** ke WanWay (sales/CS) — dapat **AppID** + **Secret Key** (kunci Open API, bukan password app).
3. Input di tab **Open API**.

Signature: `md5(md5(secret)+time)` ke `/api/auth` → `accessToken` cache 1.5 jam (berlaku 2 jam).

**Opsi B — Akun Aplikasi (tanpa Open API):**
Pakai **username + password** akun **WanWay Track** (`www.wanwaygps.com`) di tab **Akun app** — login via portal web. Riwayat & Alarm hanya untuk Open API; akun portal tampil di tab Kendaraan saja.

---

## 🔌 API (backend `src/index.ts`)

| Method | Path | Body | Balikan |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ ok: true }` |
| `POST` | `/api/vehicles` | `{ accounts: [{ appid, secret }] }` | `{ vehicles, accounts: n }` |
| `POST` | `/api/portal/vehicles` | `{ username, password }` | `{ vehicles, accounts: 1 }` (auto-relogin jika expired) |
| `POST` | `/api/history` | `{ appid, secret, imei, start, end }` unix sec | `{ points: TrackPoint[] }` |
| `POST` | `/api/alarms` | `{ appid, secret, imei, start, end }` | `{ alarms: Alarm[] }` |
| `GET` | `*` | — | `dist/client` static + SPA fallback `index.html` |

`POST /api/vehicles` fan-out per akun: `/api/device` → per device `/api/device/status` + `/location`. Error per akun tidak gagalkan akun lain — dikembalikan sebagai `vehicle` dengan `error: true`.

---

## 🧰 Tech Stack

| Lapisan | Teknologi |
|---|---|
| Backend | **Bun** + **Elysia 1.x**, `node:crypto` md5, `fetch` native |
| Frontend | **React 19**, **Leaflet 1.9**, **Vite 8**, TypeScript 5.8 |
| Peta | Esri `World_Dark_Gray_Base` (tanpa API key), `L.divIcon` marker |
| Desain | `DESIGN.md` tokens → `client/style.css` (ink `#0A0C0D`, accent `#F5B544`, IBM Plex) |
| Deploy | **Vercel** — Elysia, `bunVersion: 1.x`, build `bun run build:client`, serve `dist/client` satu origin |

---

## ☁️ Deploy — Vercel

| Item | Nilai |
|---|---|
| Project | `wanway-multi-monitor` — ID `prj_icV8airvZIrs3SDhWjoGr7Kg1H1n` |
| Team | `team_z4dCt5o3TVVjz12tpTW2b0Ew` (`naufal6`) |
| Framework | `Elysia` |
| Build | `bun run build:client` → `dist/client` |
| Runtime | Bun 1.x |
| Prod URL | **https://wanway-multi-monitor.vercel.app** |
| Auto-deploy | `git push origin main` → build otomatis |

```bash
vercel deploy --prod --yes
vercel ls
```

Tidak ada env wajib — `PORT` hanya lokal (default 3000). Di Vercel `process.env.VERCEL=true` → `app.listen` tidak dipanggil, export `default app` dipakai serverless.

---

## 🔒 Keamanan & Privasi

- **Stateless:** `appid/secret` & `username/password` hanya di `localStorage` browser — tidak ke DB/file server. Vercel FS read-only + `/tmp` ephemeral.
- **Gate bukan auth server:** gerbang `client/main.tsx` (`LS_PASS` SHA-256 + `SS_OK`) hanya sembunyikan UI — bukan proteksi server. Ganti ke sesi server + env var bila butuh proteksi nyata (`ponytail:` di kode).
- **Portal secret tertanam:** `PORTAL_APP_ID`/`PORTAL_SECRET_KEY` di `src/index.ts` kredensial aplikasi portal publik (dari bundle `www.wanwaygps.com`) — bukan secret akunmu; bisa berubah saat portal update.
- **Jangan commit kredensial** — `accounts` tak pernah di-log; error message di-slice 80–160 char.

---

## 🤝 Kontribusi

```bash
git checkout -b feat/nama-fitur
# edit src/ atau client/
git commit -m "feat: deskripsi"
git push origin feat/nama-fitur
# buka PR ke main — Vercel buat Preview deployment
```

---

## Lisensi

MIT — bebas pakai. Kredensial IOPGPS/WanWay milik WanWay; ikuti ToS `open.iopgps.com` & `www.wanwaygps.com`.
