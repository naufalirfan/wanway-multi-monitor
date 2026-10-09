import { createRoot } from "react-dom/client";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";

type Vehicle = {
  imei: string; name: string; account: string; accountName: string;
  status: string; vin: string; licenseNumber: string;
  lng: number | null; lat: number | null; address: string; gpsTime: number | null; error?: boolean;
};
type Account = { appid: string; secret: string; name?: string };
type State = "online" | "offline" | "idle";

const LS_KEY = "wanway_accounts";

function loadAccounts(): Account[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function saveAccounts(a: Account[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(a));
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
  return STATUS_ID[s] ?? s.replace(/离线|在线|静止|静态|行驶|运动|未启用|未定位|已过期|休眠|报警/g, m => STATUS_ID[m] ?? m);
}

function relTime(ts: number | null): string {
  if (!ts) return "—";
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return "baru saja";
  if (d < 3600) return `${Math.floor(d / 60)} mnt lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  return `${Math.floor(d / 86400)} hr lalu`;
}

const STATUS_COLOR: Record<State, string> = { online: "#4cc38a", offline: "#e5534b", idle: "#7d8a94" };

function markerIcon(state: State) {
  const c = STATUS_COLOR[state];
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:15px;height:15px;border-radius:50%;background:${c};border:2.5px solid #0a0c0d;box-shadow:0 0 0 1px ${c},0 2px 6px rgba(0,0,0,.6)"></span>`,
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
    popupAnchor: [0, -8],
  });
}

function App() {
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [status, setStatus] = useState("memuat…");
  const [live, setLive] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
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
    const withLoc = vs.filter(v => v.lat != null && v.lng != null);
    if (fit && fitRef.current && withLoc.length > 0) {
      mapRef.current!.fitBounds(withLoc.map(v => [v.lat!, v.lng!]), { padding: [48, 48], maxZoom: 15 });
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

  function addAccount(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const appid = (form.querySelector("#f-appid") as HTMLInputElement).value.trim();
    const secret = (form.querySelector("#f-secret") as HTMLInputElement).value.trim();
    if (!appid || !secret) return;
    if (accounts.some(a => a.appid === appid)) { setStatus(`akun ${appid} sudah ada`); return; }
    const next = [...accounts, { appid, secret }];
    saveAccounts(next);
    setAccounts(next);
    form.reset();
  }

  function removeAccount(appid: string) {
    const next = accounts.filter(a => a.appid !== appid);
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

        <div className={`accounts${accounts.length === 0 ? " is-empty" : ""}`}>
          {accounts.length === 0 && (
            <div className="empty">
              <b>Belum ada akun.</b><br />
              Masukkan <b>AppID</b> dan <b>Secret Key</b> dari Open API WanWay/IOPGPS.
              Kunci ini tidak ada di aplikasi ponsel — harus diminta ke WanWay.
            </div>
          )}
          {[...grouped.entries()].map(([acc, vs]) => (
            <section className="acc" key={acc}>
              <div className="acc-head">
                <b>{acc}</b>
                <small>{vs.length}</small>
                {accounts.some(a => a.appid === acc) && (
                  <button type="button" onClick={() => removeAccount(acc)}>hapus</button>
                )}
              </div>
              {vs.map(v => (
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
        </div>

        <footer className="status" data-live={live ? "1" : "0"}>{status}</footer>
      </aside>

      <main className="mapwrap">
        <div id="map" />
      </main>
    </div>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
