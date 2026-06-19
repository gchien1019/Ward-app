import React, { useState, useEffect, useCallback, useRef } from "react";
import { Bed, Check, AlertTriangle, Clock, ChevronRight, X, Plus, Minus, LogIn, Loader2 } from "lucide-react";

const BED_COUNT = 32;
const ZONES = [
  { id: "nurse_station", name: "護理站", icon: "🩺" },
  { id: "treatment_room", name: "治療室", icon: "💉" },
  { id: "corridor", name: "走廊", icon: "🚪" },
];

const ITEM_DEFS = [
  { id: "iv_pump", name: "IV Pump", unit: "台" },
  { id: "ear_thermo", name: "耳溫槍", unit: "支" },
  { id: "turn_pillow", name: "翻身枕", unit: "個" },
  { id: "ice_pillow", name: "冰枕", unit: "個" },
  { id: "dressing_kit", name: "換藥包", unit: "包" },
];

const SHIFTS = [
  { id: "day", name: "白班", time: "07:00–15:00" },
  { id: "evening", name: "小夜", time: "15:00–23:00" },
  { id: "night", name: "大夜", time: "23:00–07:00" },
];

// 使用 localStorage 做持久化（所有人共用同一台裝置時有效；
// 若要跨裝置共享，需接後端，可找 IT 協助）
const SK_LOC = "ward-locations";
const SK_LOG = "ward-log";
const SK_CHK = "ward-shift-checks";
const SK_USR = "ward-user";

function todayStr() { return new Date().toISOString().slice(0, 10); }
function nowTimeStr() { return new Date().toTimeString().slice(0, 5); }
function locKey(type, id) { return type === "bed" ? `bed-${id}` : `zone-${id}`; }
function allLocations() {
  const beds = Array.from({ length: BED_COUNT }, (_, i) => ({ type: "bed", id: i + 1, label: `${i + 1}床` }));
  const zones = ZONES.map(z => ({ type: "zone", id: z.id, label: z.name, icon: z.icon }));
  return [...beds, ...zones];
}

function lsGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.error(e); }
}

export default function WardInventory() {
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [locations, setLocations] = useState({});
  const [log, setLog] = useState([]);
  const [shiftChecks, setShiftChecks] = useState({});
  const [view, setView] = useState("map");
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [currentShift, setCurrentShift] = useState("day");
  const [showHistory, setShowHistory] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    const u = lsGet(SK_USR);
    if (u) setUser(u);
    setLocations(lsGet(SK_LOC) || {});
    setLog(lsGet(SK_LOG) || []);
    setShiftChecks(lsGet(SK_CHK) || {});
    setLoadingUser(false);
  }, []);

  useEffect(() => {
    const h = new Date().getHours();
    if (h >= 7 && h < 15) setCurrentShift("day");
    else if (h >= 15 && h < 23) setCurrentShift("evening");
    else setCurrentShift("night");
  }, []);

  function showToast(msg, kind = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  function handleLogin(name) {
    const u = { name, loggedInAt: new Date().toISOString() };
    setUser(u);
    lsSet(SK_USR, u);
  }

  function handleLogout() {
    setUser(null);
    lsSet(SK_USR, null);
  }

  function updateQty(locType, locId, itemId, newQty) {
    const key = locKey(locType, locId);
    const prevQty = locations[key]?.[itemId] ?? 0;
    if (newQty === prevQty) return;
    const nextLocations = { ...locations, [key]: { ...(locations[key] || {}), [itemId]: newQty } };
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      locLabel: locType === "bed" ? `${locId}床` : ZONES.find(z => z.id === locId)?.name || locId,
      itemName: ITEM_DEFS.find(i => i.id === itemId)?.name || itemId,
      qty: newQty, prevQty,
      user: user?.name || "未知",
      shift: SHIFTS.find(s => s.id === currentShift)?.name || currentShift,
      time: nowTimeStr(), date: todayStr(), ts: Date.now(),
    };
    const nextLog = [entry, ...log].slice(0, 500);
    setLocations(nextLocations);
    setLog(nextLog);
    lsSet(SK_LOC, nextLocations);
    lsSet(SK_LOG, nextLog);
  }

  function confirmShift() {
    const ckKey = `${todayStr()}-${currentShift}`;
    const entry = { user: user?.name, time: nowTimeStr(), date: todayStr() };
    const next = { ...shiftChecks, [ckKey]: entry };
    setShiftChecks(next);
    lsSet(SK_CHK, next);
    showToast("已完成本班點班確認 ✓");
  }

  if (loadingUser) return <CenterSpinner />;
  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div style={{ minHeight: "100vh", background: "#F6F7F5", color: "#1B2B26", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <TopBar user={user} onLogout={handleLogout} currentShift={currentShift} setCurrentShift={setCurrentShift} view={view} setView={setView} />
      <ShiftConfirmBar currentShift={currentShift} shiftChecks={shiftChecks} onConfirm={confirmShift} />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "12px 16px 120px" }}>
        {view === "map"
          ? <MapView locations={locations} onSelectLocation={setSelectedLocation} />
          : <ItemView locations={locations} onSelectItem={setSelectedItem} />
        }
      </div>

      <button
        onClick={() => setShowHistory(true)}
        style={{ position: "fixed", bottom: 24, right: 24, width: 56, height: 56, borderRadius: "50%", background: "#1B2B26", color: "white", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.18)", zIndex: 20 }}
      >
        <Clock size={22} />
      </button>

      {selectedLocation && (
        <LocationDrawer
          location={selectedLocation}
          quantities={locations[locKey(selectedLocation.type, selectedLocation.id)] || {}}
          onClose={() => setSelectedLocation(null)}
          onUpdate={(itemId, qty) => updateQty(selectedLocation.type, selectedLocation.id, itemId, qty)}
        />
      )}
      {selectedItem && (
        <ItemDrawer
          item={selectedItem}
          locations={locations}
          onClose={() => setSelectedItem(null)}
          onUpdate={(locType, locId, qty) => updateQty(locType, locId, selectedItem.id, qty)}
        />
      )}
      {showHistory && <HistoryDrawer log={log} onClose={() => setShowHistory(false)} />}
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [name, setName] = useState("");
  return (
    <div style={{ minHeight: "100vh", background: "#F6F7F5", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#1B2B26", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Bed size={22} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>病房物品點班</div>
            <div style={{ fontSize: 13, color: "#5C6B66" }}>常威科病房財產即時稽核</div>
          </div>
        </div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>姓名 / 工號</label>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder="例：王小美"
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) onLogin(name.trim()); }}
          style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1.5px solid #D8DED9", background: "white", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 12 }}
        />
        <button
          disabled={!name.trim()} onClick={() => onLogin(name.trim())}
          style={{ width: "100%", padding: 13, borderRadius: 12, background: name.trim() ? "#2F6F5E" : "#B5C5BF", color: "white", border: "none", fontSize: 15, fontWeight: 600, cursor: name.trim() ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          <LogIn size={17} /> 登入
        </button>
      </div>
    </div>
  );
}

function TopBar({ user, onLogout, currentShift, setCurrentShift, view, setView }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 30, background: "white", borderBottom: "1px solid #E3E7E2" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "12px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#1B2B26", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bed size={15} color="white" />
            </div>
            <span style={{ fontWeight: 600, fontSize: 15 }}>病房物品點班</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "#5C6B66" }}>{user.name}</span>
            <button onClick={onLogout} style={{ fontSize: 12, color: "#9BADA6", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>登出</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, paddingBottom: 10 }}>
          <SegControl options={SHIFTS.map(s => ({ id: s.id, label: s.name }))} value={currentShift} onChange={setCurrentShift} />
          <SegControl options={[{ id: "map", label: "🗺 床位圖" }, { id: "item", label: "📦 物品覽" }]} value={view} onChange={setView} />
        </div>
      </div>
    </div>
  );
}

function SegControl({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, background: "#F0F2EF", borderRadius: 9, padding: 3 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          style={{ padding: "6px 10px", borderRadius: 7, border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer", background: value === o.id ? "white" : "transparent", color: value === o.id ? "#1B2B26" : "#7A8780", boxShadow: value === o.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ShiftConfirmBar({ currentShift, shiftChecks, onConfirm }) {
  const ckKey = `${todayStr()}-${currentShift}`;
  const checked = shiftChecks[ckKey];
  const shiftName = SHIFTS.find(s => s.id === currentShift)?.name;
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "8px 16px 0" }}>
      <div style={{ borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: checked ? "#E7F2EC" : "#FFF6E5", border: `1px solid ${checked ? "#BFE0CC" : "#F3DDA0"}`, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {checked ? <Check size={17} color="#2F6F5E" /> : <AlertTriangle size={17} color="#B8860B" />}
          <span style={{ fontSize: 13 }}>
            {checked
              ? <><b>{shiftName}已完成點班</b>　{checked.user} · {checked.time}</>
              : <><b>{shiftName}尚未完成點班確認</b>　<span style={{ color: "#8B7340" }}>請完成清點後按下確認</span></>}
          </span>
        </div>
        {!checked && (
          <button onClick={onConfirm} style={{ padding: "6px 12px", borderRadius: 8, background: "#1B2B26", color: "white", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            確認本班點班
          </button>
        )}
      </div>
    </div>
  );
}

function itemSummary(qtyMap) {
  return ITEM_DEFS.map(def => ({ def, qty: qtyMap[def.id] || 0 })).filter(x => x.qty > 0);
}

function MapView({ locations, onSelectLocation }) {
  const beds = Array.from({ length: BED_COUNT }, (_, i) => i + 1);
  return (
    <div>
      <SectionTitle>公共區域</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
        {ZONES.map(z => {
          const items = itemSummary(locations[locKey("zone", z.id)] || {});
          return (
            <button key={z.id} onClick={() => onSelectLocation({ type: "zone", id: z.id })}
              style={{ borderRadius: 14, padding: 12, textAlign: "left", border: "1.5px solid #E3E7E2", background: "white", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{z.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{z.name}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {items.length === 0 && <span style={{ fontSize: 11, color: "#B5BDB8" }}>無登記</span>}
                {items.map(it => <ItemBadge key={it.def.id} label={`${it.def.name.slice(0, 2)}×${it.qty}`} />)}
              </div>
            </button>
          );
        })}
      </div>
      <SectionTitle>病床（共 {BED_COUNT} 床）</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 8 }}>
        {beds.map(b => {
          const items = itemSummary(locations[locKey("bed", b)] || {});
          const hasAny = items.length > 0;
          return (
            <button key={b} onClick={() => onSelectLocation({ type: "bed", id: b })}
              style={{ borderRadius: 12, padding: "10px 8px", textAlign: "left", border: `1.5px solid ${hasAny ? "#CFE3D8" : "#E8EBE7"}`, background: hasAny ? "white" : "#FAFAF9", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{b}</span>
                <Bed size={12} color={hasAny ? "#2F6F5E" : "#C3CBC6"} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {items.length === 0 && <span style={{ fontSize: 10, color: "#C3CBC6" }}>空</span>}
                {items.map(it => <ItemBadge key={it.def.id} label={`${it.def.name.slice(0, 2)}${it.qty}`} small />)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ItemBadge({ label, small }) {
  return (
    <span style={{ fontSize: small ? 9 : 11, padding: small ? "2px 5px" : "3px 7px", borderRadius: 6, background: "#EEF5F1", color: "#2F6F5E", fontWeight: 600, lineHeight: 1.2 }}>
      {label}
    </span>
  );
}

function ItemView({ locations, onSelectItem }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {ITEM_DEFS.map(def => {
        let total = 0, locCount = 0;
        Object.values(locations).forEach(qtyMap => {
          const q = qtyMap[def.id] || 0;
          if (q > 0) { total += q; locCount++; }
        });
        return (
          <button key={def.id} onClick={() => onSelectItem(def)}
            style={{ background: "white", border: "1.5px solid #E3E7E2", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "left" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{def.name}</div>
              <div style={{ fontSize: 12, color: "#8B9892", marginTop: 3 }}>
                分布於 {locCount} 個位置・共 <b style={{ color: "#2F6F5E" }}>{total} {def.unit}</b>
              </div>
            </div>
            <ChevronRight size={18} color="#C3CBC6" />
          </button>
        );
      })}
    </div>
  );
}

function LocationDrawer({ location, quantities, onClose, onUpdate }) {
  const isZone = location.type === "zone";
  const zone = isZone ? ZONES.find(z => z.id === location.id) : null;
  const title = isZone ? zone?.name : `${location.id} 床`;
  return (
    <Drawer onClose={onClose}>
      <DrawerHeader icon={isZone ? zone?.icon : null} title={title} onClose={onClose} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ITEM_DEFS.map(def => (
          <QtyRow key={def.id} label={def.name} unit={def.unit} qty={quantities[def.id] || 0} onChange={q => onUpdate(def.id, q)} />
        ))}
      </div>
    </Drawer>
  );
}

function ItemDrawer({ item, locations, onClose, onUpdate }) {
  const entries = Object.entries(locations)
    .map(([key, qtyMap]) => ({ key, qty: qtyMap[item.id] || 0 }))
    .filter(e => e.qty > 0)
    .sort((a, b) => {
      const pa = a.key.startsWith("bed-") ? parseInt(a.key.split("-")[1]) : 9999;
      const pb = b.key.startsWith("bed-") ? parseInt(b.key.split("-")[1]) : 9999;
      return pa - pb;
    });

  function labelFor(key) {
    if (key.startsWith("bed-")) return `${key.split("-")[1]}床`;
    return ZONES.find(z => z.id === key.replace("zone-", ""))?.name || key;
  }
  function parseKey(key) {
    if (key.startsWith("bed-")) return { type: "bed", id: parseInt(key.split("-")[1]) };
    return { type: "zone", id: key.replace("zone-", "") };
  }
  const total = entries.reduce((s, e) => s + e.qty, 0);

  return (
    <Drawer onClose={onClose}>
      <DrawerHeader title={item.name} onClose={onClose} />
      <p style={{ fontSize: 12, color: "#8B9892", marginBottom: 16, marginTop: -4 }}>
        分布於 {entries.length} 個位置，共 <b style={{ color: "#2F6F5E" }}>{total} {item.unit}</b>
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {entries.length === 0 && <p style={{ fontSize: 13, color: "#C3CBC6", textAlign: "center", padding: "20px 0" }}>尚無登記位置</p>}
        {entries.map(e => {
          const loc = parseKey(e.key);
          return <QtyRow key={e.key} label={labelFor(e.key)} unit={item.unit} qty={e.qty} onChange={q => onUpdate(loc.type, loc.id, q)} />;
        })}
      </div>
      <AddLocationPicker onAdd={(loc, qty) => onUpdate(loc.type, loc.id, qty)} existingKeys={entries.map(e => e.key)} />
    </Drawer>
  );
}

function AddLocationPicker({ onAdd, existingKeys }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const options = allLocations().filter(l => !existingKeys.includes(locKey(l.type, l.id)));

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1.5px dashed #C3CBC6", background: "none", fontSize: 13, color: "#5C6B66", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <Plus size={14} /> 新增登記位置
    </button>
  );

  return (
    <div style={{ border: "1.5px solid #E3E7E2", borderRadius: 10, padding: 12, background: "#FAFAF9" }}>
      <select value={selected} onChange={e => setSelected(e.target.value)}
        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #D8DED9", background: "white", fontSize: 13, marginBottom: 10 }}>
        <option value="">選擇床位或區域…</option>
        {options.map(l => <option key={locKey(l.type, l.id)} value={locKey(l.type, l.id)}>{l.label}</option>)}
      </select>
      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={!selected} onClick={() => { const loc = options.find(l => locKey(l.type, l.id) === selected); if (loc) onAdd(loc, 1); setOpen(false); setSelected(""); }}
          style={{ flex: 1, padding: 9, borderRadius: 8, background: selected ? "#2F6F5E" : "#B5C5BF", color: "white", border: "none", fontSize: 13, fontWeight: 600, cursor: selected ? "pointer" : "not-allowed" }}>
          新增（數量 1）
        </button>
        <button onClick={() => setOpen(false)}
          style={{ padding: "9px 14px", borderRadius: 8, border: "1.5px solid #D8DED9", background: "white", fontSize: 13, cursor: "pointer", color: "#5C6B66" }}>
          取消
        </button>
      </div>
    </div>
  );
}

function QtyRow({ label, unit, qty, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F6F7F5", borderRadius: 12, padding: "10px 12px" }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <RoundBtn onClick={() => onChange(Math.max(0, qty - 1))} disabled={qty <= 0}><Minus size={13} /></RoundBtn>
        <span style={{ minWidth: 44, textAlign: "center", fontSize: 14, fontWeight: 700 }}>
          {qty}<span style={{ fontSize: 10, fontWeight: 400, color: "#8B9892", marginLeft: 2 }}>{unit}</span>
        </span>
        <RoundBtn onClick={() => onChange(qty + 1)}><Plus size={13} /></RoundBtn>
      </div>
    </div>
  );
}

function RoundBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #D8DED9", background: "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.3 : 1 }}>
      {children}
    </button>
  );
}

function HistoryDrawer({ log, onClose }) {
  return (
    <Drawer onClose={onClose}>
      <DrawerHeader title="異動紀錄" onClose={onClose} />
      <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
        {log.length === 0 && <p style={{ fontSize: 13, color: "#C3CBC6", textAlign: "center", padding: "32px 0" }}>尚無異動紀錄</p>}
        {log.map((entry, i) => (
          <div key={entry.id} style={{ padding: "10px 0", borderBottom: i < log.length - 1 ? "1px solid #EEF0EE" : "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{entry.locLabel}・{entry.itemName}</span>
              <span style={{ fontSize: 11, color: "#9BADA6" }}>{entry.date} {entry.time}</span>
            </div>
            <div style={{ fontSize: 11, color: "#8B9892", marginTop: 3 }}>
              {entry.prevQty} → {entry.qty}　·　{entry.user}　·　{entry.shift}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function Drawer({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.28)" }} />
      <div style={{ position: "relative", background: "white", width: "100%", maxWidth: 480, borderRadius: "20px 20px 0 0", padding: "20px 20px 32px", maxHeight: "85vh", overflowY: "auto", zIndex: 10 }}>
        {children}
      </div>
    </div>
  );
}

function DrawerHeader({ icon, title, onClose }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{title}</h3>
      </div>
      <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "#F0F2EF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <X size={15} />
      </button>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 style={{ fontSize: 12, fontWeight: 600, color: "#7A8780", letterSpacing: "0.06em", marginBottom: 10, marginTop: 4 }}>{children}</h2>;
}

function CenterSpinner({ label }) {
  return (
    <div style={{ minHeight: "40vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#9BADA6" }}>
      <Loader2 size={26} />
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
    </div>
  );
}

function Toast({ msg, kind }) {
  return (
    <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", padding: "10px 18px", borderRadius: 12, background: kind === "error" ? "#C0432F" : "#1B2B26", color: "white", fontSize: 13, fontWeight: 500, boxShadow: "0 4px 16px rgba(0,0,0,0.18)", zIndex: 50, whiteSpace: "nowrap" }}>
      {msg}
    </div>
  );
}
