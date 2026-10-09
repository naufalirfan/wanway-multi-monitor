import { createRoot } from "react-dom/client";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";

type Vehicle = {
  imei: string; name: string; account: string; accountName: string;
  status: string; vin: string; licenseNumber: string;
  lng: number | null; lat: number | null; address: string; gpsTime: number | null; error?: boolean;
};
type Account = { appid: string; secret: string; name?: string };

const LS_KEY = "wanway_accounts";

function loadAccounts(): Account[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function saveAccounts(a: Account[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(a));
}

function App() {
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [status, setStatus] = useState("memuat…");
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const accRef = useRef<Account[]>(accounts);
  accRef.current = accounts;

  useEffect(() => {
    const map = L.map("map").setView([-7.25, 112.75], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setInterval(() => refreshVehicles(accRef.current), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { refreshVehicles(accounts); }, [accounts]);

  async function refreshVehicles(accs: Account[]) {
    if (accs.length === 0) { setVehicles([]); setStatus("belum ada akun — tambahkan di panel kiri"); renderMarkers([]); return; }
    try {
      const r = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: accs }),
      });
      const j = await r.json();
      setVehicles(j.vehicles ?? []);
      setStatus(`diperbarui ${new Date().toLocaleTimeString("id-ID")} · ${j.vehicles?.length ?? 0} kendaraan · ${j.accounts ?? 0} akun`);
      renderMarkers(j.vehicles ?? []);
    } catch { setStatus("gagal memuat kendaraan"); }
  }
  function renderMarkers(vs: Vehicle[]) {
    const layer = layerRef.current!;
    layer.clearLayers();
    const withLoc = vs.filter(v => v.lat != null && v.lng != null);
    if (withLoc.length > 0) mapRef.current!.fitBounds(withLoc.map(v => [v.lat!, v.lng!]), { padding: [40, 40] });
    for (const v of vs) {
      if (v.lat == null || v.lng == null) continue;
      const color = v.status === "离线" || /off|disable|未启用/i.test(v.status) ? "#ef4444" : "#22c55e";
      const icon = L.divIcon({ className: "", html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 4px #000"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
      L.marker([v.lat, v.lng], { icon }).addTo(layer).bindPopup(
        `<b>${v.name}</b><br/>IMEI: ${v.imei}<br/>Akun: ${v.account}<br/>Status: ${v.status}<br/>${v.address || "—"}`
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
    const k = v.error ? "⚠ Error" : v.account;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(v);
  }

  return (
    <>
      <div id="sidebar">
        <h1>🚗 WanWay Monitor</h1>
        <form onSubmit={addAccount} id="add-form">
          <input id="f-appid" placeholder="AppID (username login)" required />
          <input id="f-secret" type="password" placeholder="Secret Key (Open API)" required />
          <button type="submit">+ Tambah Akun</button>
        </form>
        {accounts.length === 0 && <div className="empty">Belum ada akun. AppID + Secret Key dari Open API WanWay/IOPGPS.</div>}
        {[...grouped.entries()].map(([acc, vs]) => (
          <div className="acc" key={acc}>
            <div><b>{acc}</b> <small>{vs.length} kendaraan</small>
              {!vs.some(v => v.error) && accounts.some(a => a.appid === acc) &&
                <button className="danger" style={{ float: "right" }} onClick={() => removeAccount(acc)}>hapus</button>}
            </div>
            {vs.map(v => (
              <div className="v" key={v.imei}>
                {v.error ? <span className="err">⚠ {v.name}</span> : (
                  <>
                    <span className={`dot ${v.lat != null && !/未启用|离线/i.test(v.status) ? "on" : "off"}`} />
                    <b>{v.name}</b> · {v.imei}<br />
                    <small>{v.status || "—"}{v.gpsTime ? ` · ${new Date(v.gpsTime * 1000).toLocaleString("id-ID")}` : ""}</small>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
        <div id="status">{status}</div>
      </div>
    </>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
