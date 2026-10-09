// WanWay Multi-Account Monitor — backend proxy Elysia.
// Akun tersimpan terenkripsi AES-256-GCM (key: env APP_ENC_KEY).
// Token IOPGPS di-cache 1.5 jam per akun (masa berlaku 2 jam, anti-brute auth).
import { Elysia } from "elysia";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, dirname } from "node:path";

// Vercel: FS read-only kecuali /tmp. DB_FILE di-set ke /tmp/accounts.json saat deploy.
const DB = process.env.DB_FILE ?? (process.env.VERCEL ? "/tmp/accounts.json" : "./data/accounts.json");
const ENC_KEY = createHash("sha256").update(process.env.APP_ENC_KEY ?? "wanway-demo-insecure-key").digest();
const OPTS = { algorithm: "aes-256-gcm", iv: "iv", tag: "tag", data: "data" };

// --- storage (JSON file, Vercel pakai /tmp) ---
async function loadAccounts(): Promise<Record<string, unknown>[]> {
  if (!existsSync(DB)) return [];
  return JSON.parse(await readFile(DB, "utf8"));
}
async function saveAccounts(accounts: unknown[]): Promise<void> {
  await mkdir(dirname(DB), { recursive: true });
  await writeFile(DB, JSON.stringify(accounts, null, 2));
}

function enc(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv(OPTS.algorithm, ENC_KEY, iv) as import("node:crypto").CipherGCM;
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return JSON.stringify({ [OPTS.iv]: iv.toString("base64"), [OPTS.tag]: c.getAuthTag().toString("base64"), [OPTS.data]: data.toString("base64") });
}
function dec(payload: string): string {
  const p = JSON.parse(payload);
  const d = createDecipheriv(OPTS.algorithm, ENC_KEY, Buffer.from(p[OPTS.iv], "base64")) as import("node:crypto").DecipherGCM;
  d.setAuthTag(Buffer.from(p[OPTS.tag], "base64"));
  return Buffer.concat([d.update(Buffer.from(p[OPTS.data], "base64")), d.final()]).toString("utf8");
}

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

// --- routes ---
const app = new Elysia()
  .get("/api/health", () => ({ ok: true }))
  .get("/api/accounts", async () => {
    const accounts = await loadAccounts();
    return accounts.map((a: any) => ({ appid: a.appid, name: a.name, createdAt: a.createdAt }));
  })
  .post("/api/accounts", async ({ body }) => {
    const { appid, secret, name } = body as { appid: string; secret: string; name?: string };
    if (!appid || !secret) return { error: "appid dan secret wajib diisi" };
    const accounts = await loadAccounts();
    if (accounts.some((a: any) => a.appid === appid)) return { error: `Akun ${appid} sudah ada` };
    accounts.push({ appid, name: name ?? appid, secret: enc(secret), createdAt: Date.now() });
    await saveAccounts(accounts);
    return { ok: true };
  })
  .delete("/api/accounts/:appid", async ({ params }) => {
    const accounts = await loadAccounts();
    await saveAccounts(accounts.filter((a: any) => a.appid !== params.appid));
    tokenCache.delete(params.appid);
    return { ok: true };
  })
  .get("/api/vehicles", async () => {
    const accounts = await loadAccounts();
    if (accounts.length === 0) return { vehicles: [], accounts: 0 };
    const out = [];
    for (const a of accounts as any[]) {
      try {
        const token = await getToken(a.appid, dec(a.secret));
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

console.log("wanway monitor starting on", process.env.PORT ?? 3000);
if (!process.env.VERCEL) {
  app.listen(process.env.PORT ?? 3000);
}

export default app;