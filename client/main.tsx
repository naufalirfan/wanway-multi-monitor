import { createRoot } from "react-dom/client";
import { Component, type FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import L from "leaflet";

type Vehicle = {
  imei: string; name: string; account: string; accountName: string;
  status: string; vin: string; licenseNumber: string;
  lng: number | null; lat: number | null; address: string; gpsTime: number | null; error?: boolean;
};
type Account = { appid: string; secret: string; name?: string };
type State = "online" | "offline" | "idle";
type TrackPoint = { lat: number; lng: number; t: number | null; speed: number | null; address: string };
type Alarm = { t: number | null; type: string; content: string; lng: number | null; lat: number | null; address: string };
type Tab = "veh" | "hist" | "alarm";

const LS_KEY = "wanway_accounts";
const LS_PASS = "wanway_pass_hash";
const SS_OK = "wanway_ok";

function loadAccounts(): Account[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function saveAccounts(a: Account[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(a));
}
async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function stateOf(v: Vehicle): State {
  if (v.error) return "offline";
  if (/离线|offline|未启用|disable|expire/i.test(v.status || "")) return "offline";
  return v.lat != null && v.lng != null ? "online" : "idle";
}

const STATUS_ID: Record<string, string> = {
  "离线": "Offline", "在线": "Online", "静止": "Statis", "静态": "Statis",
  "行驶": "Bergerak", "运动": "Bergerak", "未启用": "Belum aktif",
  "未定位": "Tanpa lokasi", "已过期": "Kedaluwarsa", "休眠": "Tidur", "报警": "Alarm",
  "Static": "Statis", "Moving": "Bergerak", "Expired": "Kedaluwarsa", "Sleep": "Tidur",
};

function statusLabel(v: Vehicle): string {
  if (v.error) return "gagal";
  const s = (v.status || "").trim();
  if (!s) return "—";
  return STATUS_ID[s] ?? s.replace(/离线|在线|静止|静态|行驶|运动|未启用|未定位|已过期|休眠|报警/g, (m) => STATUS_ID[m] ?? m);
}

function relTime(ts: number | null): string {
  if (!ts) return "—";
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return "baru saja";
  if (d < 3600) return `${Math.floor(d / 60)} mnt lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  return `${Math.floor(d / 86400)} hr lalu`;
}
const clock = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—");

const STATUS_COLOR: Record<State, string> = { online: "#4cc38a", offline: "#e5534b", idle: "#7d8a94" };

function markerIcon(state: State, small = false) {
  const c = STATUS_COLOR[state];
  const s = small ? 11 : 15;
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:${s}px;height:${s}px;border-radius:50%;background:${c};border:2.5px solid #0a0c0d;box-shadow:0 0 0 1px ${c},0 2px 6px rgba(0,0,0,.6)"></span>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    popupAnchor: [0, -8],
  });
}

// --- error boundary: never show a blank page ---
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Terjadi kesalahan</h1>
          <p>Aplikasi gagal dimuat. Coba muat ulang halaman.</p>
          <pre>{String(this.state.err.message).slice(0, 300)}</pre>
          <button type="button" onClick={() => location.reload()}>Muat ulang</button>
        </div>
      </div>
    );
  }
}

// --- password gate (client-side; not a server auth — see ponytail note) ---
// ponytail: gate ini menyembunyikan UI dari pemakai biasa, bukan keamanan server.
// Ganti ke sesi server + env var bila butuh proteksi nyata.
function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [setup] = useState(() => !localStorage.getItem(LS_PASS));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const p1 = (f.querySelector("#g-pass") as HTMLInputElement).value;
    setErr("");
    if (setup) {
      const p2 = (f.querySelector("#g-pass2") as HTMLInputElement).value;
      if (p1.length < 4) return setErr("Minimal 4 karakter.");
      if (p1 !== p2) return setErr("Password tidak sama.");
      setBusy(true);
      localStorage.setItem(LS_PASS, await sha256(p1));
      sessionStorage.setItem(SS_OK, "1");
      onUnlock();
      return;
    }
    setBusy(true);
    if ((await sha256(p1)) === localStorage.getItem(LS_PASS)) {
      sessionStorage.setItem(SS_OK, "1");
      onUnlock();
    } else {
      setErr("Password salah.");
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <span className="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" />
            <circle cx="12" cy="10" r="2.6" />
          </svg>
        </span>
        <h1>WanWay Monitor</h1>
        <p>{setup ? "Buat password untuk melindungi halaman ini." : "Masukkan password untuk membuka monitor."}</p>
        <label htmlFor="g-pass">{setup ? "Password baru" : "Password"}</label>
        <input id="g-pass" type="password" autoComplete={setup ? "new-password" : "current-password"} autoFocus required />
        {setup && (
          <>
            <label htmlFor="g-pass2">Ulangi password</label>
            <input id="g-pass2" type="password" autoComplete="new-password" required />
          </>
        )}
        {err && <p className="gate-err">{err}</p>}
        <button type="submit" disabled={busy}>{setup ? "Buat & buka" : "Masuk"}</button>
        {!setup && (
          <button
            type="button"
            className="link"
            onClick={() => { if (confirm("Hapus password halaman ini?")) { localStorage.removeItem(LS_PASS); location.reload(); } }}
          >
            lupa password
          </button>
        )}
      </form>
    </div>
  );
}

function App() {
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [status, setStatus] = useState("memuat…");
  const [live, setLive] = useState(false);
  const [tab, setTab] = useState<Tab>("veh");
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const trackRef = useRef<L.LayerGroup | null>(null);
  const accRef = useRef<Account[]>(accounts);
  const fitRef = useRef(true);
  accRef.current = accounts;

  useEffect(() => {
    const map = L.map("map", { zoomControl: true }).setView([-2.2, 117.5], 5);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri &middot; &copy; OpenStreetMap contributors",
      maxZoom: 16,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    trackRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setInterval(() => refreshVehicles(accRef.current, false), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { fitRef.current = true; refreshVehicles(accounts, true); }, [accounts]);

  async function refreshVehicles(accs: Account[], fit: boolean) {
    if (accs.length === 0) {
      setVehicles([]); setLive(false);
      setStatus("belum ada akun — tambahkan di panel kiri");
      renderMarkers([], false);
      return;
    }
    try {
      const r = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: accs }),
      });
      const j = await r.json();
      const vs: Vehicle[] = j.vehicles ?? [];
      setVehicles(vs);
      setLive(true);
      setStatus(`${vs.length} kendaraan · ${j.accounts ?? 0} akun · ${new Date().toLocaleTimeString("id-ID")}`);
      renderMarkers(vs, fit);
    } catch {
      setLive(false);
      setStatus("gagal memuat kendaraan — coba lagi");
    }
  }

  function renderMarkers(vs: Vehicle[], fit: boolean) {
    const layer = layerRef.current!;
    layer.clearLayers();
    const withLoc = vs.filter((v) => v.lat != null && v.lng != null);
    if (fit && fitRef.current && withLoc.length > 0) {
      mapRef.current!.fitBounds(withLoc.map((v) => [v.lat!, v.lng!]), { padding: [48, 48], maxZoom: 15 });
      fitRef.current = false;
    }
    for (const v of vs) {
      if (v.lat == null || v.lng == null) continue;
      L.marker([v.lat, v.lng], { icon: markerIcon(stateOf(v)) })
        .addTo(layer)
        .bindPopup(
          `<b>${v.name || v.imei}</b><br/>` +
          `<span class="k">IMEI</span> ${v.imei}<br/>` +
          `<span class="k">Akun</span> ${v.account}<br/>` +
          `<span class="k">Status</span> ${statusLabel(v)}<br/>` +
          `<span class="k">Waktu</span> ${relTime(v.gpsTime)}<br/>` +
          (v.address ? `${v.address}` : "")
        );
    }
  }

  function addAccount(e: FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const appid = (form.querySelector("#f-appid") as HTMLInputElement).value.trim();
    const secret = (form.querySelector("#f-secret") as HTMLInputElement).value.trim();
    if (!appid || !secret) return;
    if (accounts.some((a) => a.appid === appid)) { setStatus(`akun ${appid} sudah ada`); return; }
    const next = [...accounts, { appid, secret }];
    saveAccounts(next);
    setAccounts(next);
    form.reset();
  }

  function removeAccount(appid: string) {
    const next = accounts.filter((a) => a.appid !== appid);
    saveAccounts(next);
    setAccounts(next);
  }

  const grouped = new Map<string, Vehicle[]>();
  for (const v of vehicles) {
    const k = v.error ? "⚠ error" : v.account;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(v);
  }
  const counts = vehicles.reduce(
    (a, v) => { a[stateOf(v)]++; return a; },
    { online: 0, offline: 0, idle: 0 } as Record<State, number>
  );
  const tracked = vehicles.filter((v) => !v.error);

  return (
    <div className="shell">
      <aside className="panel">
        <header className="brand">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" />
              <circle cx="12" cy="10" r="2.6" />
            </svg>
          </span>
          <div>
            <h1>WanWay Monitor</h1>
            <p>Pemantauan multi-akun IOPGPS</p>
          </div>
          <button
            type="button"
            className="lock"
            title="Kunci"
            onClick={() => { sessionStorage.removeItem(SS_OK); location.reload(); }}
          >kunci</button>
        </header>

        <form className="add" onSubmit={addAccount} id="add-form">
          <label htmlFor="f-appid">AppID</label>
          <input id="f-appid" placeholder="appid Open API" autoComplete="off" required />
          <label htmlFor="f-secret">Secret Key</label>
          <input id="f-secret" type="password" placeholder="login key Open API" autoComplete="off" required />
          <button type="submit">Tambah akun</button>
        </form>

        {accounts.length > 0 && (
          <div className="stats">
            <div><b>{vehicles.length}</b><span>Total</span></div>
            <div className="s-on"><b>{counts.online}</b><span>Online</span></div>
            <div className="s-off"><b>{counts.offline}</b><span>Offline</span></div>
          </div>
        )}

        <nav className="tabs">
          <button type="button" className={tab === "veh" ? "on" : ""} onClick={() => setTab("veh")}>Kendaraan</button>
          <button type="button" className={tab === "hist" ? "on" : ""} onClick={() => setTab("hist")}>Riwayat</button>
          <button type="button" className={tab === "alarm" ? "on" : ""} onClick={() => setTab("alarm")}>Alarm</button>
        </nav>

        <div className={`accounts${tab === "veh" && accounts.length === 0 ? " is-empty" : ""}`}>
          {tab === "veh" && accounts.length === 0 && (
            <div className="empty">
              <b>Belum ada akun.</b><br />
              Masukkan <b>AppID</b> dan <b>Secret Key</b> dari Open API WanWay/IOPGPS.
              Kunci ini tidak ada di aplikasi ponsel — harus diminta ke WanWay.
            </div>
          )}
          {tab === "veh" && [...grouped.entries()].map(([acc, vs]) => (
            <section className="acc" key={acc}>
              <div className="acc-head">
                <b>{acc}</b>
                <small>{vs.length}</small>
                {accounts.some((a) => a.appid === acc) && (
                  <button type="button" onClick={() => removeAccount(acc)}>hapus</button>
                )}
              </div>
              {vs.map((v) => (
                <div className={`veh${v.error ? " err" : ""}`} data-state={stateOf(v)} key={v.imei}>
                  <span className="dot" aria-hidden="true" />
                  <div>
                    <span className="veh-name">{v.error ? v.name : v.name || v.imei}</span>
                    <span className="veh-imei">{v.imei}</span>
                  </div>
                  <div className="veh-meta">
                    {statusLabel(v)}
                    <em>{relTime(v.gpsTime)}</em>
                  </div>
                </div>
              ))}
            </section>
          ))}
          {tab === "hist" && (
            <TrackPanel accounts={accounts} tracked={tracked} trackRef={trackRef} mapRef={mapRef} layerRef={layerRef} />
          )}
          {tab === "alarm" && <AlarmPanel accounts={accounts} tracked={tracked} />}
        </div>

        <footer className="status" data-live={live ? "1" : "0"}>{status}</footer>
      </aside>

      <main className="mapwrap">
        <div id="map" />
      </main>
    </div>
  );
}

// --- Riwayat (playback jejak) ---
function TrackPanel({ accounts, tracked, trackRef, mapRef, layerRef }: {
  accounts: Account[]; tracked: Vehicle[];
  trackRef: RefObject<L.LayerGroup | null>; mapRef: RefObject<L.Map | null>;
  layerRef: RefObject<L.LayerGroup | null>;
}) {
  const [imei, setImei] = useState("");
  const [hours, setHours] = useState(24);
  const [pts, setPts] = useState<TrackPoint[] | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => { if (!imei && tracked[0]) setImei(tracked[0].imei); }, [tracked, imei]);

  async function run() {
    const v = tracked.find((x) => x.imei === imei);
    const acc = accounts.find((a) => a.appid === v?.account);
    if (!v || !acc) return setMsg("pilih kendaraan");
    setMsg("memuat riwayat…");
    const end = Math.floor(Date.now() / 1000);
    const start = end - hours * 3600;
    try {
      const r = await fetch("/api/history", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appid: acc.appid, secret: acc.secret, imei, start, end }),
      });
      const j = await r.json();
      if (j.error) { setPts([]); setMsg(j.error); trackRef.current?.clearLayers(); return; }
      const points: TrackPoint[] = j.points ?? [];
      setPts(points);
      setMsg(points.length ? `${points.length} titik` : "tidak ada jejak pada rentang ini");
      draw(points);
    } catch {
      setMsg("gagal memuat riwayat");
    }
  }

  function draw(points: TrackPoint[]) {
    const layer = trackRef.current!;
    layer.clearLayers();
    if (points.length === 0) return;
    const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
    L.polyline(latlngs, { color: "#f5b544", weight: 3, opacity: 0.9 }).addTo(layer);
    L.marker(latlngs[0], { icon: markerIcon("idle", true) }).addTo(layer).bindPopup("Awal");
    L.marker(latlngs[latlngs.length - 1], { icon: markerIcon("online", true) }).addTo(layer).bindPopup("Akhir");
    mapRef.current!.fitBounds(L.latLngBounds(latlngs), { padding: [48, 48], maxZoom: 16 });
  }

  function clear() {
    trackRef.current?.clearLayers();
    setPts(null); setMsg("");
    if (layerRef.current && mapRef.current) {
      const vs = tracked.filter((v) => v.lat != null && v.lng != null);
      if (vs.length) mapRef.current.fitBounds(vs.map((v) => [v.lat!, v.lng!]), { padding: [48, 48], maxZoom: 15 });
    }
  }

  return (
    <div className="tool">
      <label htmlFor="t-veh">Kendaraan</label>
      <select id="t-veh" value={imei} onChange={(e) => setImei(e.target.value)}>
        {tracked.length === 0 && <option value="">— belum ada kendaraan —</option>}
        {tracked.map((v) => <option key={v.imei} value={v.imei}>{v.name || v.imei} · {v.imei}</option>)}
      </select>
      <label htmlFor="t-range">Rentang</label>
      <div className="seg" id="t-range">
        {[1, 6, 24, 168].map((h) => (
          <button key={h} type="button" className={hours === h ? "on" : ""} onClick={() => setHours(h)}>
            {h < 24 ? `${h} jam` : `${h / 24} hari`}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" onClick={run} disabled={tracked.length === 0}>Tampilkan jejak</button>
        <button type="button" className="ghost" onClick={clear}>Bersihkan</button>
      </div>
      {msg && <p className="hint">{msg}</p>}
      {pts && pts.length > 0 && (
        <ul className="points">
          <li><span>Mulai</span><em>{clock(pts[0].t)}</em></li>
          <li><span>Akhir</span><em>{clock(pts[pts.length - 1].t)}</em></li>
          <li><span>Kecepatan maks</span><em>{Math.max(...pts.map((p) => p.speed ?? 0)).toFixed(0)} km/j</em></li>
        </ul>
      )}
    </div>
  );
}

// --- Alarm ---
function AlarmPanel({ accounts, tracked }: { accounts: Account[]; tracked: Vehicle[] }) {
  const [imei, setImei] = useState("");
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Alarm[] | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => { if (!imei && tracked[0]) setImei(tracked[0].imei); }, [tracked, imei]);

  async function run() {
    const v = tracked.find((x) => x.imei === imei);
    const acc = accounts.find((a) => a.appid === v?.account);
    if (!v || !acc) return setMsg("pilih kendaraan");
    setMsg("memuat alarm…");
    const end = Math.floor(Date.now() / 1000);
    const start = end - days * 86400;
    try {
      const r = await fetch("/api/alarms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appid: acc.appid, secret: acc.secret, imei, start, end }),
      });
      const j = await r.json();
      if (j.error) { setRows([]); setMsg(j.error); return; }
      const a: Alarm[] = j.alarms ?? [];
      setRows(a);
      setMsg(a.length ? `${a.length} alarm` : "tidak ada alarm pada rentang ini");
    } catch {
      setMsg("gagal memuat alarm");
    }
  }

  return (
    <div className="tool">
      <label htmlFor="a-veh">Kendaraan</label>
      <select id="a-veh" value={imei} onChange={(e) => setImei(e.target.value)}>
        {tracked.length === 0 && <option value="">— belum ada kendaraan —</option>}
        {tracked.map((v) => <option key={v.imei} value={v.imei}>{v.name || v.imei} · {v.imei}</option>)}
      </select>
      <label htmlFor="a-range">Rentang</label>
      <div className="seg" id="a-range">
        {[1, 7, 30].map((d) => (
          <button key={d} type="button" className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d} hari</button>
        ))}
      </div>
      <button type="button" onClick={run} disabled={tracked.length === 0}>Muat alarm</button>
      {msg && <p className="hint">{msg}</p>}
      {rows && rows.length > 0 && (
        <ul className="alarms">
          {rows.map((a, i) => (
            <li key={i}>
              <b>{a.content || a.type || "Alarm"}</b>
              <em>{clock(a.t)}</em>
              {a.address && <span>{a.address}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Root() {
  const [ok, setOk] = useState(() => sessionStorage.getItem(SS_OK) === "1");
  return <Boundary>{ok ? <App /> : <Gate onUnlock={() => setOk(true)} />}</Boundary>;
}

createRoot(document.getElementById("app")!).render(<Root />);
