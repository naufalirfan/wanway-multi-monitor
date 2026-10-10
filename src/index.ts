// WanWay Multi-Account Monitor — backend proxy Elysia (stateless).
// Kredensial akun disimpan di browser client & dikirim per-request — server tidak
// menyimpan secret (Vercel serverless: FS read-only, /tmp ephemeral).
// Token IOPGPS di-cache 1.5 jam per appid (masa berlaku 2 jam).
import { Elysia } from "elysia";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";

// --- IOPGPS client ---
const IOP = "https://open.iopgps.com";
const tokenCache = new Map<string, { token: string; exp: number }>(); // appid -> token

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

async function getToken(appid: string, secret: string): Promise<string> {
  const cached = tokenCache.get(appid);
  if (cached && cached.exp > Date.now()) return cached.token;
  const time = Math.floor(Date.now() / 1000);
  const signature = md5(md5(secret) + String(time));
  const res = await fetch(`${IOP}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appid, time, signature }),
  });
  const j = (await res.json()) as { code?: number; accessToken?: string; expiresIn?: number; message?: string };
  if (j.code !== 0 || !j.accessToken) throw new Error(`auth gagal: ${JSON.stringify(j)}`);
  tokenCache.set(appid, { token: j.accessToken, exp: Date.now() + (j.expiresIn ?? 7200000) - 1800000 });
  return j.accessToken;
}

async function iopGet<T>(token: string, path: string, qs: Record<string, string | number> = {}): Promise<T> {
  const q = new URLSearchParams({ accessToken: token, ...Object.fromEntries(Object.entries(qs).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`${IOP}${path}?${q}`);
  const j = (await res.json()) as T & { code?: number };
  if (j.code !== 0) throw new Error(`IOP ${path}: ${JSON.stringify(j)}`);
  return j;
}

type Cred = { appid: string; secret: string; name?: string };

// IOPGPS tidak mendokumentasikan nama field isi track/alarm — normalisasi defensif.
const numOr = (...c: unknown[]): number | null => {
  for (const v of c) {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isFinite(n)) return n;
  }
  return null;
};
const normPoint = (p: Record<string, unknown>) => ({
  lng: numOr(p.lng, p.lon, p.longitude),
  lat: numOr(p.lat, p.latitude),
  t: numOr(p.gpsTime, p.time, p.positionTime, p.ts, p.createTime),
  speed: numOr(p.speed),
  address: String(p.address ?? ""),
});
const normAlarm = (a: Record<string, unknown>) => ({
  t: numOr(a.gpsTime, a.time, a.alarmTime, a.createTime, a.ts),
  type: String(a.type ?? a.alarmType ?? a.alarmCode ?? ""),
  content: String(a.content ?? a.desc ?? a.alarmContent ?? a.message ?? a.typeName ?? ""),
  lng: numOr(a.lng, a.lon, a.longitude),
  lat: numOr(a.lat, a.latitude),
  address: String(a.address ?? ""),
});

// --- WanWay portal client (login user+pass) ---
// Portal web www.wanwaygps.com: POST /login → accessToken → /rest/device/list.
// Password dikirim sebagai md5(pass)+md5(nonce10), header sign md5(md5(md5(secret)+appId)+ts).
// Diambil dari bundle login portal (tidak didokumentasikan — bisa berubah sewaktu-waktu).
const PORTAL = "https://www.wanwaygps.com";
const PORTAL_APP_ID = "19ee34fd3c24e7ca";
const PORTAL_SECRET_KEY = "4b866ab922b64af4a46cf8e8f7836d4c";

function deepFind(o: unknown, key: string): unknown {
  if (!o || typeof o !== "object") return undefined;
  const rec = o as Record<string, unknown>;
  if (rec[key] !== undefined && rec[key] !== null) return rec[key];
  for (const v of Object.values(rec)) {
    const r = deepFind(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

type PortalSession = { token: string; accountId: number; exp: number };
const portalCache = new Map<string, PortalSession>(); // username -> session

async function portalLogin(username: string, password: string): Promise<PortalSession> {
  const hit = portalCache.get(username);
  if (hit && hit.exp > Date.now()) return hit;
  const ts = Date.now().toString();
  const nonce = randomBytes(5).toString("hex");
  const sign = md5(md5(md5(PORTAL_SECRET_KEY) + PORTAL_APP_ID) + ts);
  const res = await fetch(`${PORTAL}/login?v=${Math.floor(Date.now() / 1000)}&lang=en&source=25`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      appId: PORTAL_APP_ID,
      secretKey: PORTAL_SECRET_KEY,
      timestamp: ts,
      sign,
      serviceName: "gps-web",
      lang: "en",
      isDev: "0",
      localVersion: "",
    },
    body: new URLSearchParams({
      username,
      password: md5(password) + md5(nonce),
      loginType: "ADMIN",
      rememberMe: "false",
      domain: "www.wanwaygps.com",
    }).toString(),
  });
  const j = (await res.json()) as Record<string, unknown>;
  // Token dikirim via Set-Cookie (USER_TOKEN), bukan body. accountId ada di body.
  const setCookies: string[] = typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const m = setCookies.join("; ").match(/USER_TOKEN=([^;]+)/);
  const token = m?.[1] ?? (deepFind(j, "accessToken") as string | undefined);
  if (!token) throw new Error(String(deepFind(j, "message") ?? "login gagal"));
  let accountId = Number(deepFind(j, "accountId") ?? 0);
  if (!accountId) {
    const a = (await fetch(`${PORTAL}/rest/account?accessToken=${token}&v=${Date.now()}&lang=en&source=25`).then((x) => x.json()).catch(() => null)) as Record<string, unknown> | null;
    accountId = Number(deepFind(a, "accountId") ?? deepFind(a, "id") ?? 0);
  }
  const sess: PortalSession = { token, accountId, exp: Date.now() + 60 * 60 * 1000 };
  portalCache.set(username, sess);
  return sess;
}

async function portalDevices(sess: PortalSession) {
  const url = `${PORTAL}/rest/device/list?accountId=${sess.accountId}&needCount=true&pageSize=500&status=-1&accessToken=${sess.token}&v=${Date.now()}&lang=en&source=25&zoneId=UTC`;
  const res = await fetch(url, { headers: { cookie: `USER_TOKEN=${sess.token}` } });
  const j = (await res.json()) as Record<string, unknown>;
  const list = (deepFind(j, "data") ?? []) as Record<string, any>[];
  if (!Array.isArray(list) || list.length === 0) {
    const msg = String(deepFind(j, "message") ?? "");
    if (msg) throw new Error(msg);
  }
  return list.map((d) => {
    const s = (d.deviceStatusBean ?? {}) as Record<string, any>;
    const gpsMs = Number(s.gpsTime ?? 0);
    const fresh = gpsMs > 0 && Date.now() - gpsMs < 15 * 60 * 1000;
    return {
      imei: String(d.imei ?? ""),
      name: String(d.deviceName ?? d.name ?? d.imei ?? ""),
      account: "",
      accountName: "",
      status: fresh ? ((Number(s.speed ?? 0) > 0 || s.accStatus) ? "Bergerak" : "Statis") : "Offline",
      vin: "",
      licenseNumber: String(d.licenseNumber ?? ""),
      lng: s.lng != null ? parseFloat(String(s.lng)) : null,
      lat: s.lat != null ? parseFloat(String(s.lat)) : null,
      address: "",
      gpsTime: gpsMs > 0 ? Math.floor(gpsMs / 1000) : null,
      speed: Number(s.speed ?? 0),
    };
  });
}

// --- routes ---
const app = new Elysia()
  .get("/api/health", () => ({ ok: true }))
  .post("/api/vehicles", async ({ body }) => {
    const accounts = ((body as { accounts?: Cred[] })?.accounts ?? []).filter((a) => a?.appid && a?.secret);
    if (accounts.length === 0) return { vehicles: [], accounts: 0 };
    const out = [];
    for (const a of accounts) {
      try {
        const token = await getToken(a.appid, a.secret);
        const list = await iopGet<{ data: { imei: string; deviceName?: string }[] }>(token, "/api/device", { currentPage: 1, pageSize: 100 });
        for (const d of list.data) {
          const s = await iopGet<{ data: any[] }>(token, "/api/device/status", { imei: d.imei }).catch(() => ({ data: [] }));
          const loc = await iopGet<{ lng?: string; lat?: string; address?: string; gpsTime?: number }>(token, "/api/device/location", { imei: d.imei }).catch(() => ({ code: 0 })) as { lng?: string; lat?: string; address?: string; gpsTime?: number };
          const st = s.data?.[0];
          out.push({
            imei: d.imei,
            name: d.deviceName ?? d.imei,
            account: a.appid,
            accountName: st?.accountName ?? "",
            status: st?.status ?? "",
            vin: st?.vin ?? "",
            licenseNumber: st?.licenseNumber ?? "",
            lng: loc.lng ? parseFloat(loc.lng) : null,
            lat: loc.lat ? parseFloat(loc.lat) : null,
            address: loc.address ?? "",
            gpsTime: loc.gpsTime ?? null,
          });
        }
      } catch (e) {
        out.push({ imei: `err:${a.appid}`, name: `⚠ ${a.appid} — ${(e as Error).message.slice(0, 80)}`, account: a.appid, error: true });
      }
    }
    return { vehicles: out, accounts: accounts.length };
  })
  .post("/api/portal/vehicles", async ({ body }) => {
    const { username, password } = (body ?? {}) as { username?: string; password?: string };
    if (!username || !password) return { vehicles: [], accounts: 0 };
    try {
      const sess = await portalLogin(username, password);
      const vehicles = await portalDevices(sess).catch(async (e: Error) => {
        // token kedaluwarsa → login ulang sekali
        if (/token|login|auth|expired/i.test(e.message)) {
          portalCache.delete(username);
          return portalDevices(await portalLogin(username, password));
        }
        throw e;
      });
      return { vehicles: vehicles.map((v) => ({ ...v, account: username })), accounts: 1 };
    } catch (e) {
      return { vehicles: [{ imei: `err:${username}`, name: `⚠ ${username} — ${(e as Error).message.slice(0, 80)}`, account: username, error: true }], accounts: 0 };
    }
  })
  .post("/api/history", async ({ body }) => {
    const { appid, secret, imei, start, end } = (body ?? {}) as { appid?: string; secret?: string; imei?: string; start?: number; end?: number };
    if (!appid || !secret || !imei) return { points: [] };
    try {
      const token = await getToken(appid, secret);
      const j = await iopGet<{ data?: Record<string, unknown>[] }>(token, "/api/device/track/history", {
        imei, startTime: start ?? 0, endTime: end ?? Math.floor(Date.now() / 1000), coordType: "wgs84",
      });
      return { points: (j.data ?? []).map(normPoint).filter((p) => p.lat != null && p.lng != null) };
    } catch (e) {
      return { points: [], error: (e as Error).message.slice(0, 160) };
    }
  })
  .post("/api/alarms", async ({ body }) => {
    const { appid, secret, imei, start, end } = (body ?? {}) as { appid?: string; secret?: string; imei?: string; start?: number; end?: number };
    if (!appid || !secret || !imei) return { alarms: [] };
    try {
      const token = await getToken(appid, secret);
      const j = await iopGet<{ details?: Record<string, unknown>[]; data?: Record<string, unknown>[] }>(token, "/api/device/alarm", {
        imei, startTime: start ?? 0, endTime: end ?? Math.floor(Date.now() / 1000),
      });
      return { alarms: (j.details ?? j.data ?? []).map(normAlarm) };
    } catch (e) {
      return { alarms: [], error: (e as Error).message.slice(0, 160) };
    }
  })
// Serve built Vite client (dist/client) — API + UI satu origin.
// ponytail: cwd di Vercel = repo root, output di dist/client. Tambah path lain bila layout berubah.
const CLIENT_DIR = join(process.cwd(), "dist/client");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

app.get("*", async ({ request, set }) => {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const candidate = join(CLIENT_DIR, pathname);
  const file = existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(CLIENT_DIR, "index.html");
  if (!existsSync(file)) {
    set.status = 404;
    return { error: { message: "Client build not found. Run `bun run build:client`." } };
  }
  set.headers["content-type"] = MIME[extname(file)] ?? "application/octet-stream";
  return new Response(await readFile(file));
});

if (!process.env.VERCEL) {
  app.listen(process.env.PORT ?? 3000);
}

export default app;
