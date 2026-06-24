import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Bed, Check, AlertTriangle, Clock, ChevronRight, X, Plus, Minus,
  LogIn, Loader2, Megaphone, Wrench, Settings, Trash2, Droplets,
  RotateCcw, ChevronDown, UserPlus, KeyRound, Mail
} from 'lucide-react'
import * as api from './lib/api'
import { supabase } from './lib/supabaseClient'
import { todayStr, nowTimeStr, fmtTs, autoShift, SHIFTS, shiftName } from './lib/helpers'

const SK_SHIFT = 'ward-shift-v2' // 只記錄班別+分配床號（不敏感）

function locKey(id) { return id }
function isBed(id) { return id?.startsWith('bed-') }
function bedNumber(id) { return parseInt(id.replace('bed-', ''), 10) }

/* ============================================================
   主程式
============================================================ */
export default function App() {
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({
    items: [], locations: [], inventory: [], repairs: [],
    announcements: [], logins: [], log: [],
  })
  const [authUser, setAuthUser] = useState(null)   // Supabase auth user
  const [profile, setProfile] = useState(null)     // { display_name, email }
  const [shiftInfo, setShiftInfo] = useState(null) // { shift, assignedBeds, loginId, date }
  const [view, setView] = useState('map')
  const [showAllBeds, setShowAllBeds] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  // 合成「user」物件供後續元件使用
  const user = useMemo(() => {
    if (!authUser || !profile || !shiftInfo) return null
    return {
      name: profile.display_name,
      email: profile.email,
      uid: authUser.id,
      shift: shiftInfo.shift,
      assignedBeds: shiftInfo.assignedBeds,
      loginId: shiftInfo.loginId,
    }
  }, [authUser, profile, shiftInfo])

  const refresh = useCallback(async () => {
    const d = await api.fetchAll()
    setData(d)
  }, [])

  // 監聽 Supabase Auth 狀態
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setAuthUser(session.user)
        const p = await api.getProfile(session.user.id)
        setProfile(p)
        // 有登入才載入資料
        setLoading(true)
        await refresh()
        try {
          const saved = JSON.parse(localStorage.getItem(SK_SHIFT) || 'null')
          if (saved && saved.date === todayStr()) setShiftInfo(saved)
        } catch {}
        setLoading(false)
      }
      setAuthLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setAuthUser(session.user)
        const p = await api.getProfile(session.user.id)
        setProfile(p)
        setLoading(true)
        await refresh()
        try {
          const saved = JSON.parse(localStorage.getItem(SK_SHIFT) || 'null')
          if (saved && saved.date === todayStr()) setShiftInfo(saved)
        } catch {}
        setLoading(false)
      } else if (event === 'SIGNED_OUT') {
        setAuthUser(null)
        setProfile(null)
        setShiftInfo(null)
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [refresh])

  function showToast(msg, kind = 'ok') {
    setToast({ msg, kind })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  async function handleShiftSetup({ shift, assignedBeds }) {
    const name = profile?.display_name || '未知'
    const login = await api.createShiftLogin(name, shift, assignedBeds)
    const info = { shift, assignedBeds, loginId: login?.id, date: todayStr() }
    setShiftInfo(info)
    localStorage.setItem(SK_SHIFT, JSON.stringify(info))
    await refresh()
  }

  async function handleLogout() {
    await api.signOut()
    setShiftInfo(null)
    localStorage.removeItem(SK_SHIFT)
  }

  // 庫存 map: { locationId: { itemId: qty } }
  const invMap = useMemo(() => {
    const m = {}
    for (const row of data.inventory) {
      if (!m[row.location_id]) m[row.location_id] = {}
      m[row.location_id][row.item_id] = row.qty_onhand
    }
    return m
  }, [data.inventory])

  const beds = useMemo(
    () => data.locations.filter((l) => l.type === 'bed').sort((a, b) => a.sort_order - b.sort_order),
    [data.locations]
  )
  const zones = useMemo(
    () => data.locations.filter((l) => l.type === 'zone').sort((a, b) => a.sort_order - b.sort_order),
    [data.locations]
  )

  async function updateQty(itemId, locationId, newQty) {
    const prevQty = invMap[locationId]?.[itemId] ?? 0
    if (newQty === prevQty) return
    const item = data.items.find((i) => i.id === itemId)
    const loc = data.locations.find((l) => l.id === locationId)
    setData((d) => ({
      ...d,
      inventory: upsertInv(d.inventory, itemId, locationId, newQty),
    }))
    await api.setQty(itemId, locationId, newQty, user?.name)
    await api.logActivity(
      'qty_change',
      `${loc?.label || locationId}・${item?.name || itemId}　${prevQty} → ${newQty}`,
      user?.name, user?.shift
    )
    refresh()
  }

  async function updateStandardQty(itemId, newQty) {
    const item = data.items.find((i) => i.id === itemId)
    await api.setStandardQty(itemId, newQty)
    await api.logActivity(
      'standard_qty_change',
      `${item?.name || itemId}　應有數量改為 ${newQty}`,
      user?.name, user?.shift
    )
    refresh()
    showToast('已更新應有數量')
  }

  async function handleSendRepair({ itemId, itemName, locationId, locationLabel, assetNo, status, note }) {
    await api.sendForRepair({
      itemId, itemName, locationId, locationLabel, assetNo, status, note, userName: user?.name,
    })
    if (locationId) {
      const prevQty = invMap[locationId]?.[itemId] ?? 0
      const newQty = Math.max(0, prevQty - 1)
      await api.setQty(itemId, locationId, newQty, user?.name)
    }
    await api.logActivity(
      status === 'repair' ? 'send_repair' : 'send_disinfect',
      `${itemName}　財產編號 ${assetNo}　${status === 'repair' ? '送修' : '送消'}${locationLabel ? `（來自 ${locationLabel}）` : ''}`,
      user?.name, user?.shift
    )
    refresh()
    showToast(status === 'repair' ? '已標記送修' : '已標記送消')
  }

  async function handleReturnRepair(record, returnLocationId) {
    await api.returnFromRepair(record.id)
    const loc = data.locations.find((l) => l.id === returnLocationId)
    if (returnLocationId) {
      const prevQty = invMap[returnLocationId]?.[record.item_id] ?? 0
      await api.setQty(record.item_id, returnLocationId, prevQty + 1, user?.name)
    }
    await api.logActivity(
      'return_repair',
      `${record.item_name}　財產編號 ${record.asset_no}　取回${loc ? `（回到 ${loc.label}）` : ''}`,
      user?.name, user?.shift
    )
    refresh()
    showToast('已標記取回')
  }

  async function handleConfirmShift() {
    if (!user?.loginId) return
    await api.confirmShiftLogin(user.loginId)
    await api.logActivity('shift_confirm', `完成本班點班確認`, user.name, user.shift)
    await refresh()
    showToast('已完成本班點班確認 ✓')
  }

  if (authLoading) return <CenterSpinner label="驗證中…" />

  // 未登入 → 顯示帳號登入/注册畫面
  if (!authUser || !profile) return <AuthScreen onDone={() => {}} />

  if (loading) return <CenterSpinner label="載入病房資料…" />

  // 已登入但今天還沒選班別 → 選班別+分配床號
  if (!shiftInfo) return (
    <ShiftSetupScreen
      beds={beds}
      profile={profile}
      onDone={handleShiftSetup}
      onLogout={handleLogout}
    />
  )

  return (
    <div style={{ minHeight: '100vh', background: '#F6F7F5', color: '#1B2B26', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <TopBar user={user} onLogout={handleLogout} view={view} setView={setView} />
      <ShiftRoster
        user={user}
        logins={data.logins}
        beds={beds}
        onConfirm={handleConfirmShift}
      />

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '12px 16px 120px' }}>
        {view === 'map' && (
          <MapView
            beds={beds} zones={zones} invMap={invMap} items={data.items}
            user={user} showAllBeds={showAllBeds} setShowAllBeds={setShowAllBeds}
            onSelectLocation={setSelectedLocation}
          />
        )}
        {view === 'items' && (
          <ItemView items={data.items} invMap={invMap} onSelectItem={setSelectedItem} />
        )}
        {view === 'board' && (
          <BoardView
            repairs={data.repairs} announcements={data.announcements}
            locations={data.locations} user={user}
            onReturn={handleReturnRepair}
            onAddAnnouncement={async (msg) => {
              await api.addAnnouncement(msg, user.name)
              await api.logActivity('announcement_add', `發布公告：${msg}`, user.name, user.shift)
              refresh()
            }}
            onDeleteAnnouncement={async (a) => {
              await api.deleteAnnouncement(a.id)
              await api.logActivity('announcement_delete', `刪除公告：${a.message}`, user.name, user.shift)
              refresh()
            }}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            items={data.items} locations={data.locations} user={user}
            onRefresh={refresh} showToast={showToast}
          />
        )}
      </div>

      <button
        onClick={() => setShowHistory(true)}
        style={{ position: 'fixed', bottom: 24, right: 24, width: 56, height: 56, borderRadius: '50%', background: '#1B2B26', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', zIndex: 20 }}
      >
        <Clock size={22} />
      </button>

      {selectedLocation && (
        <LocationDrawer
          location={selectedLocation}
          items={data.items}
          quantities={invMap[selectedLocation.id] || {}}
          repairs={data.repairs}
          onClose={() => setSelectedLocation(null)}
          onUpdate={(itemId, qty) => updateQty(itemId, selectedLocation.id, qty)}
          onSendRepair={handleSendRepair}
        />
      )}
      {selectedItem && (
        <ItemDrawer
          item={selectedItem}
          locations={data.locations}
          invMap={invMap}
          repairs={data.repairs}
          onClose={() => setSelectedItem(null)}
          onUpdate={(locId, qty) => updateQty(selectedItem.id, locId, qty)}
          onUpdateStandard={(qty) => updateStandardQty(selectedItem.id, qty)}
          onSendRepair={handleSendRepair}
          onReturn={handleReturnRepair}
        />
      )}
      {showHistory && <HistoryDrawer log={data.log} onClose={() => setShowHistory(false)} />}
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}
    </div>
  )
}

function upsertInv(inventory, itemId, locationId, qty) {
  const idx = inventory.findIndex((r) => r.item_id === itemId && r.location_id === locationId)
  if (idx >= 0) {
    const next = [...inventory]
    next[idx] = { ...next[idx], qty_onhand: qty }
    return next
  }
  return [...inventory, { item_id: itemId, location_id: locationId, qty_onhand: qty }]
}

/* ============================================================
   帳號系統：注册 / 登入 / 忘記密碼
============================================================ */
function AuthScreen() {
  const [mode, setMode] = useState('login') // login | register | forgot | resetDone
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [sentReset, setSentReset] = useState(false)

  // 偵測重設密碼連結
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('type=recovery')) setMode('reset')
  }, [])

  async function handleLogin() {
    if (!email || pin.length !== 4) { setErr('請輸入信箱和四碼驗證碼'); return }
    setLoading(true); setErr('')
    try {
      await api.signIn(email, pin)
    } catch (e) {
      setErr('信箱或驗證碼錯誤，請再試一次')
    }
    setLoading(false)
  }

  async function handleRegister() {
    if (!name.trim()) { setErr('請輸入姓名'); return }
    if (!email) { setErr('請輸入信箱'); return }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setErr('驗證碼需為四位數字'); return }
    if (pin !== pin2) { setErr('兩次驗證碼不一致'); return }
    setLoading(true); setErr('')
    try {
      await api.signUp(email, pin, name.trim())
      setErr('')
      setMode('verify')
    } catch (e) {
      setErr(e.message?.includes('already') ? '此信箱已注册，請直接登入' : '注册失敗：' + e.message)
    }
    setLoading(false)
  }

  async function handleForgot() {
    if (!email) { setErr('請輸入你的注册信箱'); return }
    setLoading(true); setErr('')
    try {
      await api.resetPassword(email)
      setSentReset(true)
    } catch (e) { setErr('寄送失敗，請確認信箱是否正確') }
    setLoading(false)
  }

  async function handleReset() {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setErr('請輸入新的四位數字驗證碼'); return }
    if (pin !== pin2) { setErr('兩次驗證碼不一致'); return }
    setLoading(true); setErr('')
    try {
      await api.updatePassword(pin)
      window.location.hash = ''
      setMode('resetDone')
    } catch (e) { setErr('重設失敗，請重新點擊信件中的連結') }
    setLoading(false)
  }

  const Logo = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: '#1B2B26', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Bed size={22} color="white" />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 17 }}>病房物品點班</div>
        <div style={{ fontSize: 13, color: '#5C6B66' }}>A121 病房財產即時稽核</div>
      </div>
    </div>
  )

  const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #D8DED9', background: 'white', fontSize: 15, outline: 'none', boxSizing: 'border-box', marginBottom: 12 }
  const btnStyle = (active) => ({ width: '100%', padding: 13, borderRadius: 12, background: active ? '#2F6F5E' : '#B5C5BF', color: 'white', border: 'none', fontSize: 15, fontWeight: 600, cursor: active ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 })
  const linkStyle = { fontSize: 13, color: '#2F6F5E', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }

  return (
    <div style={{ minHeight: '100vh', background: '#F6F7F5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <Logo />

        {/* ---- 登入 ---- */}
        {mode === 'login' && (
          <>
            <Field label="信箱">
              <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" style={inputStyle} />
            </Field>
            <Field label="四碼驗證碼">
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value.slice(0,4))} placeholder="••••" maxLength={4} inputMode="numeric"
                onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}
                style={{ ...inputStyle, letterSpacing: '0.3em', fontSize: 20, textAlign: 'center' }} />
            </Field>
            {err && <ErrMsg msg={err} />}
            <button disabled={loading} onClick={handleLogin} style={btnStyle(!loading)}>
              {loading ? <Loader2 size={17} /> : <LogIn size={17} />} 登入
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <button onClick={() => { setMode('register'); setErr('') }} style={linkStyle}>
                <UserPlus size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />第一次使用？注册帳號
              </button>
              <button onClick={() => { setMode('forgot'); setErr('') }} style={{ ...linkStyle, color: '#9BADA6' }}>
                忘記驗證碼
              </button>
            </div>
          </>
        )}

        {/* ---- 注册 ---- */}
        {mode === 'register' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 18 }}>建立帳號</div>
            <Field label="姓名">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例：王小美" style={inputStyle} />
            </Field>
            <Field label="信箱（之後登入用）">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" style={inputStyle} />
            </Field>
            <Field label="設定四碼驗證碼（請用數字）">
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value.slice(0,4))} placeholder="••••" maxLength={4} inputMode="numeric"
                style={{ ...inputStyle, letterSpacing: '0.3em', fontSize: 20, textAlign: 'center' }} />
            </Field>
            <Field label="再輸入一次驗證碼">
              <input type="password" value={pin2} onChange={(e) => setPin2(e.target.value.slice(0,4))} placeholder="••••" maxLength={4} inputMode="numeric"
                onKeyDown={(e) => { if (e.key === 'Enter') handleRegister() }}
                style={{ ...inputStyle, letterSpacing: '0.3em', fontSize: 20, textAlign: 'center' }} />
            </Field>
            {err && <ErrMsg msg={err} />}
            <button disabled={loading} onClick={handleRegister} style={btnStyle(!loading)}>
              {loading ? <Loader2 size={17} /> : <UserPlus size={17} />} 注册
            </button>
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button onClick={() => { setMode('login'); setErr('') }} style={linkStyle}>已有帳號，回登入</button>
            </div>
          </>
        )}

        {/* ---- 驗證信箱提示 ---- */}
        {mode === 'verify' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Mail size={40} color="#2F6F5E" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>請確認信箱</div>
            <div style={{ fontSize: 13, color: '#5C6B66', marginBottom: 20, lineHeight: 1.6 }}>
              我們寄了一封確認信到 <b>{email}</b><br />請點擊信中連結，完成帳號驗證後即可登入
            </div>
            <button onClick={() => setMode('login')} style={linkStyle}>回到登入</button>
          </div>
        )}

        {/* ---- 忘記驗證碼 ---- */}
        {mode === 'forgot' && !sentReset && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>重設驗證碼</div>
            <div style={{ fontSize: 13, color: '#5C6B66', marginBottom: 16 }}>輸入你的注册信箱，我們會寄重設連結給你</div>
            <Field label="信箱">
              <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com"
                onKeyDown={(e) => { if (e.key === 'Enter') handleForgot() }}
                style={inputStyle} />
            </Field>
            {err && <ErrMsg msg={err} />}
            <button disabled={loading} onClick={handleForgot} style={btnStyle(!loading)}>
              {loading ? <Loader2 size={17} /> : <Mail size={17} />} 寄送重設連結
            </button>
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button onClick={() => { setMode('login'); setErr('') }} style={linkStyle}>回到登入</button>
            </div>
          </>
        )}

        {mode === 'forgot' && sentReset && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Mail size={40} color="#2F6F5E" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>重設連結已寄出</div>
            <div style={{ fontSize: 13, color: '#5C6B66', marginBottom: 20, lineHeight: 1.6 }}>
              請到 <b>{email}</b> 的信箱<br />點擊連結重設你的四碼驗證碼
            </div>
            <button onClick={() => { setMode('login'); setSentReset(false) }} style={linkStyle}>回到登入</button>
          </div>
        )}

        {/* ---- 重設密碼（從信件連結進來）---- */}
        {mode === 'reset' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>設定新的驗證碼</div>
            <Field label="新的四碼驗證碼">
              <input autoFocus type="password" value={pin} onChange={(e) => setPin(e.target.value.slice(0,4))} placeholder="••••" maxLength={4} inputMode="numeric"
                style={{ ...inputStyle, letterSpacing: '0.3em', fontSize: 20, textAlign: 'center' }} />
            </Field>
            <Field label="再輸入一次">
              <input type="password" value={pin2} onChange={(e) => setPin2(e.target.value.slice(0,4))} placeholder="••••" maxLength={4} inputMode="numeric"
                style={{ ...inputStyle, letterSpacing: '0.3em', fontSize: 20, textAlign: 'center' }} />
            </Field>
            {err && <ErrMsg msg={err} />}
            <button disabled={loading} onClick={handleReset} style={btnStyle(!loading)}>
              {loading ? <Loader2 size={17} /> : <KeyRound size={17} />} 確認更新驗證碼
            </button>
          </>
        )}

        {mode === 'resetDone' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Check size={40} color="#2F6F5E" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>驗證碼已更新！</div>
            <button onClick={() => setMode('login')} style={{ ...btnStyle(true), marginTop: 16 }}>
              <LogIn size={17} /> 返回登入
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   選班別＋分配床號（登入後才做）
============================================================ */
function ShiftSetupScreen({ beds, profile, onDone, onLogout }) {
  const [shift, setShift] = useState(autoShift())
  const [selected, setSelected] = useState(new Set())
  const [rangeText, setRangeText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function applyRange() {
    const text = rangeText.trim()
    if (!text) return
    const next = new Set(selected)
    text.split(',').forEach((part) => {
      part = part.trim()
      if (!part) return
      if (part.includes('-')) {
        const [a, b] = part.split('-').map((n) => parseInt(n.trim(), 10))
        if (!isNaN(a) && !isNaN(b)) {
          for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
            const bed = beds.find((bd) => bedNumber(bd.id) === n)
            if (bed) next.add(bed.id)
          }
        }
      } else {
        const n = parseInt(part, 10)
        const bed = beds.find((bd) => bedNumber(bd.id) === n)
        if (bed) next.add(bed.id)
      }
    })
    setSelected(next)
    setRangeText('')
  }

  function toggleBed(id) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  async function submit() {
    setSubmitting(true)
    await onDone({ shift, assignedBeds: Array.from(selected) })
    setSubmitting(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F6F7F5', padding: '32px 20px' }}>
      <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>早安，{profile.display_name} 👋</div>
            <div style={{ fontSize: 13, color: '#5C6B66', marginTop: 2 }}>今天上哪班？負責哪些床？</div>
          </div>
          <button onClick={onLogout} style={{ fontSize: 12, color: '#9BADA6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>登出</button>
        </div>

        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>今日班別</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {SHIFTS.map((s) => (
            <button key={s.id} onClick={() => setShift(s.id)}
              style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: `1.5px solid ${shift === s.id ? '#2F6F5E' : '#D8DED9'}`, background: shift === s.id ? '#2F6F5E' : 'white', color: shift === s.id ? 'white' : '#3A4A45', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {s.name}
            </button>
          ))}
        </div>

        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>負責床號（可選填）</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={rangeText} onChange={(e) => setRangeText(e.target.value)}
            placeholder="例：1-10,15,20-25"
            onKeyDown={(e) => { if (e.key === 'Enter') applyRange() }}
            style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #D8DED9', fontSize: 13, outline: 'none' }} />
          <button onClick={applyRange} style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: '#1B2B26', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            套用
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 8, maxHeight: 200, overflowY: 'auto', padding: 10, background: 'white', borderRadius: 12, border: '1.5px solid #E3E7E2' }}>
          {beds.map((b) => {
            const on = selected.has(b.id)
            return (
              <button key={b.id} onClick={() => toggleBed(b.id)}
                style={{ padding: '8px 0', borderRadius: 8, border: `1.5px solid ${on ? '#2F6F5E' : '#E3E7E2'}`, background: on ? '#2F6F5E' : '#FAFAF9', color: on ? 'white' : '#3A4A45', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {bedNumber(b.id)}
              </button>
            )
          })}
        </div>
        <div style={{ fontSize: 12, color: '#8B9892', marginBottom: 24 }}>
          已選 {selected.size} 床　·　不選也能進入，之後可查看全部床位
        </div>

        <button disabled={submitting} onClick={submit}
          style={{ width: '100%', padding: 14, borderRadius: 12, background: '#2F6F5E', color: 'white', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {submitting ? <Loader2 size={17} /> : <LogIn size={17} />} 開始今日點班
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#3A4A45', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

function ErrMsg({ msg }) {
  return (
    <div style={{ fontSize: 12, color: '#C0432F', background: '#FBEEEB', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
      {msg}
    </div>
  )
}

/* ============================================================
   頂部導覽
============================================================ */
function TopBar({ user, onLogout, view, setView }) {
  const tabs = [
    { id: 'map', label: '🗺 床位圖' },
    { id: 'items', label: '📦 物品覽' },
    { id: 'board', label: '📋 公告欄' },
    { id: 'settings', label: '⚙️ 設定' },
  ]
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 30, background: 'white', borderBottom: '1px solid #E3E7E2' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '12px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1B2B26', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bed size={15} color="white" />
            </div>
            <span style={{ fontWeight: 600, fontSize: 15 }}>病房物品點班</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#5C6B66' }}>{user.name}・{shiftName(user.shift)}</span>
            <button onClick={onLogout} style={{ fontSize: 12, color: '#9BADA6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>登出</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, background: '#F0F2EF', borderRadius: 9, padding: 3, marginBottom: 10, overflowX: 'auto' }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setView(t.id)}
              style={{ flex: 1, whiteSpace: 'nowrap', padding: '7px 8px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 500, cursor: 'pointer', background: view === t.id ? 'white' : 'transparent', color: view === t.id ? '#1B2B26' : '#7A8780', boxShadow: view === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   班次名冊 / 點班確認
============================================================ */
function ShiftRoster({ user, logins, beds, onConfirm }) {
  const todayLogins = logins.filter((l) => l.shift === user.shift)
  const mine = todayLogins.find((l) => l.id === user.loginId)
  const coveredBeds = new Set(todayLogins.flatMap((l) => l.assigned_locations || []))
  const uncovered = beds.filter((b) => !coveredBeds.has(b.id))

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 16px 0' }}>
      <div style={{ borderRadius: 12, padding: '10px 14px', background: mine?.confirmed_at ? '#E7F2EC' : '#FFF6E5', border: `1px solid ${mine?.confirmed_at ? '#BFE0CC' : '#F3DDA0'}`, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {mine?.confirmed_at ? <Check size={17} color="#2F6F5E" /> : <AlertTriangle size={17} color="#B8860B" />}
            <span style={{ fontSize: 13 }}>
              {mine?.confirmed_at
                ? <><b>{shiftName(user.shift)}已完成點班</b>　{fmtTs(mine.confirmed_at)}</>
                : <><b>{shiftName(user.shift)}尚未完成點班確認</b></>}
            </span>
          </div>
          {!mine?.confirmed_at && (
            <button onClick={onConfirm} style={{ padding: '6px 12px', borderRadius: 8, background: '#1B2B26', color: 'white', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              確認我已點班
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#8B9892', marginTop: 6 }}>
          本班已登入 {todayLogins.length} 人
          {todayLogins.length > 0 && '　·　' + todayLogins.map((l) => `${l.user_name}${l.confirmed_at ? '✓' : ''}`).join('、')}
        </div>
        {uncovered.length > 0 && (
          <div style={{ fontSize: 11, color: '#B8860B', marginTop: 4 }}>
            尚未有人認領：{uncovered.map((b) => bedNumber(b.id)).join('、')} 床
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   床位地圖視圖
============================================================ */
function itemSummary(qtyMap, items) {
  return items
    .map((def) => ({ def, qty: qtyMap?.[def.id] || 0 }))
    .filter((x) => x.qty > 0)
}

function MapView({ beds, zones, invMap, items, user, showAllBeds, setShowAllBeds, onSelectLocation }) {
  const myBeds = new Set(user.assignedBeds || [])
  const hasAssignment = myBeds.size > 0
  const visibleBeds = showAllBeds || !hasAssignment ? beds : beds.filter((b) => myBeds.has(b.id))

  return (
    <div>
      <Section title="公共區域">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
          {zones.map((z) => {
            const items_ = itemSummary(invMap[z.id], items)
            return (
              <button key={z.id} onClick={() => onSelectLocation(z)}
                style={{ borderRadius: 14, padding: 12, textAlign: 'left', border: '1.5px solid #E3E7E2', background: 'white', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>{z.icon || '📍'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{z.label}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {items_.length === 0 && <span style={{ fontSize: 11, color: '#B5BDB8' }}>無登記</span>}
                  {items_.map((it) => <ItemBadge key={it.def.id} label={`${it.def.name.slice(0, 2)}×${it.qty}`} />)}
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, color: '#7A8780', letterSpacing: '0.06em' }}>
          {hasAssignment && !showAllBeds ? `我負責的床（${visibleBeds.length}）` : `全部病床（${beds.length}）`}
        </h2>
        {hasAssignment && (
          <button onClick={() => setShowAllBeds(!showAllBeds)}
            style={{ fontSize: 11, color: '#2F6F5E', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            {showAllBeds ? '只看我的床' : '查看全部床位'}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
        {visibleBeds.map((b) => {
          const items_ = itemSummary(invMap[b.id], items)
          const hasAny = items_.length > 0
          return (
            <button key={b.id} onClick={() => onSelectLocation(b)}
              style={{ borderRadius: 12, padding: '10px 8px', textAlign: 'left', border: `1.5px solid ${hasAny ? '#CFE3D8' : '#E8EBE7'}`, background: hasAny ? 'white' : '#FAFAF9', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{bedNumber(b.id)}</span>
                <Bed size={12} color={hasAny ? '#2F6F5E' : '#C3CBC6'} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {items_.length === 0 && <span style={{ fontSize: 10, color: '#C3CBC6' }}>空</span>}
                {items_.map((it) => <ItemBadge key={it.def.id} label={`${it.def.name.slice(0, 2)}${it.qty}`} small />)}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ItemBadge({ label, small }) {
  return (
    <span style={{ fontSize: small ? 9 : 11, padding: small ? '2px 5px' : '3px 7px', borderRadius: 6, background: '#EEF5F1', color: '#2F6F5E', fontWeight: 600, lineHeight: 1.2 }}>
      {label}
    </span>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <h2 style={{ fontSize: 12, fontWeight: 600, color: '#7A8780', letterSpacing: '0.06em', marginBottom: 10 }}>{title}</h2>
      {children}
    </div>
  )
}

/* ============================================================
   物品總覽視圖
============================================================ */
function ItemView({ items, invMap, onSelectItem }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((def) => {
        let total = 0, locCount = 0
        Object.values(invMap).forEach((qtyMap) => {
          const q = qtyMap[def.id] || 0
          if (q > 0) { total += q; locCount++ }
        })
        const short = def.standard_qty > 0 && total < def.standard_qty
        return (
          <button key={def.id} onClick={() => onSelectItem(def)}
            style={{ background: 'white', border: `1.5px solid ${short ? '#F3C9C0' : '#E3E7E2'}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                {def.name}
                {short && <AlertTriangle size={13} color="#C0432F" />}
              </div>
              <div style={{ fontSize: 12, color: '#8B9892', marginTop: 3 }}>
                分布於 {locCount} 個位置・共 <b style={{ color: short ? '#C0432F' : '#2F6F5E' }}>{total} {def.unit}</b>
                {def.standard_qty > 0 && <span>　（應有 {def.standard_qty}）</span>}
              </div>
            </div>
            <ChevronRight size={18} color="#C3CBC6" />
          </button>
        )
      })}
    </div>
  )
}

/* ============================================================
   公告欄
============================================================ */
function BoardView({ repairs, announcements, locations, user, onReturn, onAddAnnouncement, onDeleteAnnouncement }) {
  const [msg, setMsg] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [returningId, setReturningId] = useState(null)
  const [returnLoc, setReturnLoc] = useState('')

  return (
    <div>
      <Section title={`送修 / 送消中（${repairs.length}）`}>
        {repairs.length === 0 && (
          <p style={{ fontSize: 13, color: '#C3CBC6', padding: '16px 0', textAlign: 'center', background: 'white', borderRadius: 12, border: '1.5px solid #E3E7E2' }}>
            目前沒有送修或送消中的物品
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {repairs.map((r) => (
            <div key={r.id} style={{ background: 'white', border: '1.5px solid #E3E7E2', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {r.status === 'repair' ? <Wrench size={14} color="#B8860B" /> : <Droplets size={14} color="#3E7CA6" />}
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{r.item_name}</span>
                  <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, background: r.status === 'repair' ? '#FFF6E5' : '#EAF3FA', color: r.status === 'repair' ? '#B8860B' : '#3E7CA6' }}>
                    {r.status === 'repair' ? '送修中' : '送消中'}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#5C6B66', marginTop: 6 }}>
                財產編號：<b>{r.asset_no}</b>
                {r.location_label && <span>　·　來自 {r.location_label}</span>}
              </div>
              <div style={{ fontSize: 11, color: '#9BADA6', marginTop: 2 }}>
                {r.sent_by} 送出於 {fmtTs(r.sent_at)}{r.note ? `　備註：${r.note}` : ''}
              </div>

              {returningId === r.id ? (
                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                  <select value={returnLoc} onChange={(e) => setReturnLoc(e.target.value)}
                    style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: '1.5px solid #D8DED9', fontSize: 12 }}>
                    <option value="">取回後放回哪裡？</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                  <button onClick={() => { onReturn(r, returnLoc || null); setReturningId(null); setReturnLoc('') }}
                    style={{ padding: '0 12px', borderRadius: 8, border: 'none', background: '#2F6F5E', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    確認
                  </button>
                  <button onClick={() => setReturningId(null)}
                    style={{ padding: '0 10px', borderRadius: 8, border: '1.5px solid #D8DED9', background: 'white', fontSize: 12, cursor: 'pointer' }}>
                    取消
                  </button>
                </div>
              ) : (
                <button onClick={() => setReturningId(r.id)}
                  style={{ marginTop: 8, padding: '6px 12px', borderRadius: 8, border: '1.5px solid #2F6F5E', background: 'white', color: '#2F6F5E', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <RotateCcw size={12} /> 標記已取回
                </button>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="一般公告">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={msg} onChange={(e) => setMsg(e.target.value)}
            placeholder="輸入公告內容…"
            onKeyDown={(e) => { if (e.key === 'Enter' && msg.trim()) { onAddAnnouncement(msg.trim()); setMsg('') } }}
            style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #D8DED9', fontSize: 13, outline: 'none' }}
          />
          <button
            disabled={!msg.trim()}
            onClick={() => { onAddAnnouncement(msg.trim()); setMsg('') }}
            style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: msg.trim() ? '#1B2B26' : '#C3CBC6', color: 'white', fontSize: 13, fontWeight: 600, cursor: msg.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Megaphone size={14} /> 發布
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {announcements.length === 0 && (
            <p style={{ fontSize: 13, color: '#C3CBC6', padding: '16px 0', textAlign: 'center' }}>尚無公告</p>
          )}
          {announcements.map((a) => (
            <div key={a.id} style={{ background: 'white', border: '1.5px solid #E3E7E2', borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{a.message}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: '#9BADA6' }}>{a.created_by}・{fmtTs(a.created_at)}</span>
                {confirmDeleteId === a.id ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { onDeleteAnnouncement(a); setConfirmDeleteId(null) }}
                      style={{ fontSize: 11, color: 'white', background: '#C0432F', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>確定刪除</button>
                    <button onClick={() => setConfirmDeleteId(null)}
                      style={{ fontSize: 11, color: '#5C6B66', background: 'none', border: 'none', cursor: 'pointer' }}>取消</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDeleteId(a.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C3CBC6' }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

/* ============================================================
   床位 / 區域 詳情面板
============================================================ */
function LocationDrawer({ location, items, quantities, repairs, onClose, onUpdate, onSendRepair }) {
  const isZone = location.type === 'zone'
  const present = items.filter((def) => (quantities[def.id] || 0) > 0)
  const [adding, setAdding] = useState(false)
  const [addItemId, setAddItemId] = useState('')
  const [repairForm, setRepairForm] = useState(null) // { item, status }

  const available = items.filter((def) => !(quantities[def.id] > 0))

  return (
    <Drawer onClose={onClose}>
      <DrawerHeader icon={isZone ? location.icon : null} title={isZone ? location.label : location.label} onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {present.length === 0 && (
          <p style={{ fontSize: 13, color: '#C3CBC6', textAlign: 'center', padding: '16px 0' }}>尚無登記物品</p>
        )}
        {present.map((def) => (
          <div key={def.id} style={{ background: '#F6F7F5', borderRadius: 12, padding: '10px 12px' }}>
            <QtyRow label={def.name} unit={def.unit} qty={quantities[def.id] || 0} onChange={(q) => onUpdate(def.id, q)} flat />
            {(def.enable_repair || def.enable_disinfect) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {def.enable_repair && (
                  <button onClick={() => setRepairForm({ item: def, status: 'repair' })}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #F3DDA0', background: '#FFF6E5', color: '#B8860B', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Wrench size={11} /> 送修
                  </button>
                )}
                {def.enable_disinfect && (
                  <button onClick={() => setRepairForm({ item: def, status: 'disinfect' })}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #BFDCEC', background: '#EAF3FA', color: '#3E7CA6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Droplets size={11} /> 送消
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {!adding ? (
        <button onClick={() => setAdding(true)}
          style={{ width: '100%', padding: 10, borderRadius: 10, border: '1.5px dashed #C3CBC6', background: 'none', fontSize: 13, color: '#5C6B66', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Plus size={14} /> 新增登記物品
        </button>
      ) : (
        <div style={{ border: '1.5px solid #E3E7E2', borderRadius: 10, padding: 12, background: '#FAFAF9' }}>
          <select value={addItemId} onChange={(e) => setAddItemId(e.target.value)}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #D8DED9', background: 'white', fontSize: 13, marginBottom: 10 }}>
            <option value="">選擇物品…</option>
            {available.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={!addItemId} onClick={() => { onUpdate(addItemId, 1); setAdding(false); setAddItemId('') }}
              style={{ flex: 1, padding: 9, borderRadius: 8, background: addItemId ? '#2F6F5E' : '#B5C5BF', color: 'white', border: 'none', fontSize: 13, fontWeight: 600, cursor: addItemId ? 'pointer' : 'not-allowed' }}>
              新增（數量 1）
            </button>
            <button onClick={() => setAdding(false)}
              style={{ padding: '9px 14px', borderRadius: 8, border: '1.5px solid #D8DED9', background: 'white', fontSize: 13, cursor: 'pointer', color: '#5C6B66' }}>
              取消
            </button>
          </div>
        </div>
      )}

      {repairForm && (
        <RepairFormModal
          item={repairForm.item} status={repairForm.status}
          location={location}
          onClose={() => setRepairForm(null)}
          onSubmit={(payload) => { onSendRepair(payload); setRepairForm(null) }}
        />
      )}
    </Drawer>
  )
}

/* ============================================================
   物品詳情面板
============================================================ */
function ItemDrawer({ item, locations, invMap, repairs, onClose, onUpdate, onUpdateStandard, onSendRepair, onReturn }) {
  const entries = locations
    .map((loc) => ({ loc, qty: invMap[loc.id]?.[item.id] || 0 }))
    .filter((e) => e.qty > 0)
    .sort((a, b) => (a.loc.sort_order || 0) - (b.loc.sort_order || 0))

  const total = entries.reduce((s, e) => s + e.qty, 0)
  const short = item.standard_qty > 0 && total < item.standard_qty
  const itemRepairs = repairs.filter((r) => r.item_id === item.id)

  const [adding, setAdding] = useState(false)
  const [addLocId, setAddLocId] = useState('')
  const [editStd, setEditStd] = useState(false)
  const [stdVal, setStdVal] = useState(item.standard_qty)
  const [repairForm, setRepairForm] = useState(null)
  const [returningId, setReturningId] = useState(null)
  const [returnLoc, setReturnLoc] = useState('')

  const availableLocs = locations.filter((l) => !entries.some((e) => e.loc.id === l.id))

  return (
    <Drawer onClose={onClose}>
      <DrawerHeader title={item.name} onClose={onClose} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: 12, background: short ? '#FBEEEB' : '#F6F7F5', borderRadius: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#8B9892' }}>現有總數</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: short ? '#C0432F' : '#1B2B26' }}>{total} <span style={{ fontSize: 12, fontWeight: 400 }}>{item.unit}</span></div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#8B9892' }}>應有數量</div>
          {editStd ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="number" value={stdVal} onChange={(e) => setStdVal(parseInt(e.target.value) || 0)}
                style={{ width: 60, padding: '4px 6px', borderRadius: 6, border: '1.5px solid #D8DED9', fontSize: 14 }} />
              <button onClick={() => { onUpdateStandard(stdVal); setEditStd(false) }}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: 'none', background: '#2F6F5E', color: 'white', cursor: 'pointer' }}>存</button>
            </div>
          ) : (
            <div onClick={() => setEditStd(true)} style={{ fontSize: 20, fontWeight: 700, cursor: 'pointer' }}>
              {item.standard_qty} <span style={{ fontSize: 11, color: '#9BADA6', fontWeight: 400 }}>（點擊修改）</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {entries.length === 0 && <p style={{ fontSize: 13, color: '#C3CBC6', textAlign: 'center', padding: '16px 0' }}>尚無登記位置</p>}
        {entries.map((e) => (
          <QtyRow key={e.loc.id} label={e.loc.label} unit={item.unit} qty={e.qty} onChange={(q) => onUpdate(e.loc.id, q)} />
        ))}
      </div>

      {!adding ? (
        <button onClick={() => setAdding(true)}
          style={{ width: '100%', padding: 10, borderRadius: 10, border: '1.5px dashed #C3CBC6', background: 'none', fontSize: 13, color: '#5C6B66', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
          <Plus size={14} /> 新增登記位置
        </button>
      ) : (
        <div style={{ border: '1.5px solid #E3E7E2', borderRadius: 10, padding: 12, background: '#FAFAF9', marginBottom: 16 }}>
          <select value={addLocId} onChange={(e) => setAddLocId(e.target.value)}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #D8DED9', background: 'white', fontSize: 13, marginBottom: 10 }}>
            <option value="">選擇床位或區域…</option>
            {availableLocs.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={!addLocId} onClick={() => { onUpdate(addLocId, 1); setAdding(false); setAddLocId('') }}
              style={{ flex: 1, padding: 9, borderRadius: 8, background: addLocId ? '#2F6F5E' : '#B5C5BF', color: 'white', border: 'none', fontSize: 13, fontWeight: 600, cursor: addLocId ? 'pointer' : 'not-allowed' }}>
              新增（數量 1）
            </button>
            <button onClick={() => setAdding(false)}
              style={{ padding: '9px 14px', borderRadius: 8, border: '1.5px solid #D8DED9', background: 'white', fontSize: 13, cursor: 'pointer', color: '#5C6B66' }}>
              取消
            </button>
          </div>
        </div>
      )}

      {(item.enable_repair || item.enable_disinfect) && (
        <Section title="送修 / 送消">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {item.enable_repair && (
              <button onClick={() => setRepairForm({ status: 'repair' })}
                style={{ flex: 1, padding: 9, borderRadius: 8, border: '1.5px solid #F3DDA0', background: '#FFF6E5', color: '#B8860B', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <Wrench size={12} /> 標記送修
              </button>
            )}
            {item.enable_disinfect && (
              <button onClick={() => setRepairForm({ status: 'disinfect' })}
                style={{ flex: 1, padding: 9, borderRadius: 8, border: '1.5px solid #BFDCEC', background: '#EAF3FA', color: '#3E7CA6', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <Droplets size={12} /> 標記送消
              </button>
            )}
          </div>
          {itemRepairs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {itemRepairs.map((r) => (
                <div key={r.id} style={{ background: '#F6F7F5', borderRadius: 10, padding: 10, fontSize: 12 }}>
                  <div>編號 <b>{r.asset_no}</b>　{r.status === 'repair' ? '送修中' : '送消中'}　{r.sent_by}</div>
                  {returningId === r.id ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <select value={returnLoc} onChange={(e) => setReturnLoc(e.target.value)}
                        style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1.5px solid #D8DED9', fontSize: 11 }}>
                        <option value="">放回哪裡？</option>
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                      <button onClick={() => { onReturn(r, returnLoc || null); setReturningId(null); setReturnLoc('') }}
                        style={{ padding: '0 10px', borderRadius: 6, border: 'none', background: '#2F6F5E', color: 'white', fontSize: 11, cursor: 'pointer' }}>確認</button>
                    </div>
                  ) : (
                    <button onClick={() => setReturningId(r.id)}
                      style={{ marginTop: 6, fontSize: 11, color: '#2F6F5E', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                      標記已取回
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {repairForm && (
        <RepairFormModal
          item={item} status={repairForm.status} location={null}
          onClose={() => setRepairForm(null)}
          onSubmit={(payload) => { onSendRepair(payload); setRepairForm(null) }}
        />
      )}
    </Drawer>
  )
}

/* ============================================================
   送修 / 送消 表單
============================================================ */
function RepairFormModal({ item, status, location, onClose, onSubmit }) {
  const [assetNo, setAssetNo] = useState('')
  const [note, setNote] = useState('')

  function submit() {
    if (!assetNo.trim()) return
    onSubmit({
      itemId: item.id, itemName: item.name,
      locationId: location?.id || null, locationLabel: location?.label || null,
      assetNo: assetNo.trim(), status, note: note.trim(),
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{ position: 'relative', background: 'white', borderRadius: 16, padding: 20, width: '100%', maxWidth: 360, zIndex: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          {item.name}　{status === 'repair' ? '送修' : '送消'}
        </h3>
        <p style={{ fontSize: 12, color: '#8B9892', marginBottom: 14 }}>
          請輸入財產編號以利追蹤
        </p>
        <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, display: 'block' }}>財產編號 *</label>
        <input autoFocus value={assetNo} onChange={(e) => setAssetNo(e.target.value)}
          placeholder="例：A12345"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #D8DED9', fontSize: 14, marginBottom: 12, outline: 'none', boxSizing: 'border-box' }} />
        <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, display: 'block' }}>備註（選填）</label>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="例：螢幕故障"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #D8DED9', fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={submit} disabled={!assetNo.trim()}
            style={{ flex: 1, padding: 11, borderRadius: 10, border: 'none', background: assetNo.trim() ? '#1B2B26' : '#C3CBC6', color: 'white', fontSize: 14, fontWeight: 600, cursor: assetNo.trim() ? 'pointer' : 'not-allowed' }}>
            確認{status === 'repair' ? '送修' : '送消'}
          </button>
          <button onClick={onClose}
            style={{ padding: '0 16px', borderRadius: 10, border: '1.5px solid #D8DED9', background: 'white', fontSize: 14, cursor: 'pointer' }}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   設定頁
============================================================ */
function SettingsView({ items, locations, user, onRefresh, showToast }) {
  const [tab, setTab] = useState('items')
  const tabs = [
    { id: 'items', label: '物品管理' },
    { id: 'zones', label: '區域管理' },
    { id: 'beds', label: '床位管理' },
  ]
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, background: '#F0F2EF', borderRadius: 9, padding: 3, marginBottom: 14 }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: tab === t.id ? 'white' : 'transparent', color: tab === t.id ? '#1B2B26' : '#7A8780', boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'items' && <ItemsAdmin items={items} user={user} onRefresh={onRefresh} showToast={showToast} />}
      {tab === 'zones' && <LocationsAdmin type="zone" locations={locations} user={user} onRefresh={onRefresh} showToast={showToast} />}
      {tab === 'beds' && <LocationsAdmin type="bed" locations={locations} user={user} onRefresh={onRefresh} showToast={showToast} />}
    </div>
  )
}

function ItemsAdmin({ items, user, onRefresh, showToast }) {
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState('個')
  const [confirmDel, setConfirmDel] = useState(null)

  async function add() {
    if (!newName.trim()) return
    const id = `custom-${Date.now()}`
    await api.addItem({ id, name: newName.trim(), unit: newUnit.trim() || '個', sort_order: items.length + 1 })
    await api.logActivity('item_add', `新增物品：${newName.trim()}`, user.name, user.shift)
    setNewName(''); setNewUnit('個')
    onRefresh(); showToast('已新增物品')
  }

  async function toggle(item, field) {
    await api.updateItem(item.id, { [field]: !item[field] })
    await api.logActivity('item_update', `${item.name}　${field === 'enable_repair' ? '送修' : '送消'}選項${!item[field] ? '開啟' : '關閉'}`, user.name, user.shift)
    onRefresh()
  }

  async function del(item) {
    await api.deleteItem(item.id)
    await api.logActivity('item_delete', `刪除物品：${item.name}`, user.name, user.shift)
    setConfirmDel(null)
    onRefresh(); showToast('已刪除物品')
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {items.map((it) => (
          <div key={it.id} style={{ background: 'white', border: '1.5px solid #E3E7E2', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{it.name}　<span style={{ fontWeight: 400, color: '#9BADA6', fontSize: 11 }}>{it.unit}</span></span>
              {confirmDel === it.id ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => del(it)} style={{ fontSize: 11, color: 'white', background: '#C0432F', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>確定</button>
                  <button onClick={() => setConfirmDel(null)} style={{ fontSize: 11, color: '#5C6B66', background: 'none', border: 'none', cursor: 'pointer' }}>取消</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDel(it.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C3CBC6' }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => toggle(it, 'enable_repair')}
                style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, border: `1.5px solid ${it.enable_repair ? '#B8860B' : '#E3E7E2'}`, background: it.enable_repair ? '#FFF6E5' : 'white', color: it.enable_repair ? '#B8860B' : '#9BADA6', cursor: 'pointer' }}>
                送修選項 {it.enable_repair ? '✓' : ''}
              </button>
              <button onClick={() => toggle(it, 'enable_disinfect')}
                style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, border: `1.5px solid ${it.enable_disinfect ? '#3E7CA6' : '#E3E7E2'}`, background: it.enable_disinfect ? '#EAF3FA' : 'white', color: it.enable_disinfect ? '#3E7CA6' : '#9BADA6', cursor: 'pointer' }}>
                送消選項 {it.enable_disinfect ? '✓' : ''}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ border: '1.5px dashed #C3CBC6', borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>新增物品</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="物品名稱"
            style={{ flex: 2, padding: '8px 10px', borderRadius: 8, border: '1.5px solid #D8DED9', fontSize: 13 }} />
          <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="單位"
            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1.5px solid #D8DED9', fontSize: 13 }} />
          <button onClick={add} style={{ padding: '0 14px', borderRadius: 8, border: 'none', background: '#1B2B26', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            新增
          </button>
        </div>
      </div>
    </div>
  )
}

function LocationsAdmin({ type, locations, user, onRefresh, showToast }) {
  const list = locations.filter((l) => l.type === type).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const [newLabel, setNewLabel] = useState('')
  const [newIcon, setNewIcon] = useState('📍')
  const [confirmDel, setConfirmDel] = useState(null)

  async function add() {
    if (!newLabel.trim()) return
    const id = `${type}-custom-${Date.now()}`
    await api.addLocation({
      id, type, label: newLabel.trim(),
      icon: type === 'zone' ? newIcon : null,
      sort_order: list.length + 1,
    })
    await api.logActivity(`${type}_add`, `新增${type === 'bed' ? '床位' : '區域'}：${newLabel.trim()}`, user.name, user.shift)
    setNewLabel(''); setNewIcon('📍')
    onRefresh(); showToast('已新增')
  }

  async function del(loc) {
    await api.deleteLocation(loc.id)
    await api.logActivity(`${type}_delete`, `刪除${type === 'bed' ? '床位' : '區域'}：${loc.label}`, user.name, user.shift)
    setConfirmDel(null)
    onRefresh(); showToast('已刪除')
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {list.map((l) => (
          <div key={l.id} style={{ background: 'white', border: '1.5px solid #E3E7E2', borderRadius: 10, padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>{l.icon && <span style={{ marginRight: 6 }}>{l.icon}</span>}{l.label}</span>
            {confirmDel === l.id ? (
              <span style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => del(l)} style={{ fontSize: 11, color: 'white', background: '#C0432F', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>確定</button>
                <button onClick={() => setConfirmDel(null)} style={{ fontSize: 11, color: '#5C6B66', background: 'none', border: 'none', cursor: 'pointer' }}>取消</button>
              </span>
            ) : (
              <button onClick={() => setConfirmDel(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C3CBC6' }}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ border: '1.5px dashed #C3CBC6', borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>新增{type === 'bed' ? '床位' : '區域'}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {type === 'zone' && (
            <input value={newIcon} onChange={(e) => setNewIcon(e.target.value)}
              style={{ width: 44, padding: '8px 0', borderRadius: 8, border: '1.5px solid #D8DED9', fontSize: 16, textAlign: 'center' }} />
          )}
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            placeholder={type === 'bed' ? '例：47床' : '例：器材室'}
            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1.5px solid #D8DED9', fontSize: 13 }} />
          <button onClick={add} style={{ padding: '0 14px', borderRadius: 8, border: 'none', background: '#1B2B26', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            新增
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   歷史紀錄
============================================================ */
function HistoryDrawer({ log, onClose }) {
  return (
    <Drawer onClose={onClose}>
      <DrawerHeader title="異動紀錄" onClose={onClose} />
      <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
        {log.length === 0 && <p style={{ fontSize: 13, color: '#C3CBC6', textAlign: 'center', padding: '32px 0' }}>尚無異動紀錄</p>}
        {log.map((entry, i) => (
          <div key={entry.id} style={{ padding: '10px 0', borderBottom: i < log.length - 1 ? '1px solid #EEF0EE' : 'none' }}>
            <div style={{ fontSize: 13 }}>{entry.summary}</div>
            <div style={{ fontSize: 11, color: '#9BADA6', marginTop: 3 }}>
              {fmtTs(entry.created_at)}　·　{entry.user_name}{entry.shift ? `　·　${shiftName(entry.shift)}` : ''}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  )
}

/* ============================================================
   共用元件
============================================================ */
function QtyRow({ label, unit, qty, onChange, flat }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: flat ? 'transparent' : '#F6F7F5', borderRadius: 12, padding: flat ? '0' : '10px 12px' }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <RoundBtn onClick={() => onChange(Math.max(0, qty - 1))} disabled={qty <= 0}><Minus size={13} /></RoundBtn>
        <span style={{ minWidth: 44, textAlign: 'center', fontSize: 14, fontWeight: 700 }}>
          {qty}<span style={{ fontSize: 10, fontWeight: 400, color: '#8B9892', marginLeft: 2 }}>{unit}</span>
        </span>
        <RoundBtn onClick={() => onChange(qty + 1)}><Plus size={13} /></RoundBtn>
      </div>
    </div>
  )
}

function RoundBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid #D8DED9', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.3 : 1 }}>
      {children}
    </button>
  )
}

function Drawer({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)' }} />
      <div style={{ position: 'relative', background: 'white', width: '100%', maxWidth: 480, borderRadius: '20px 20px 0 0', padding: '20px 20px 32px', maxHeight: '85vh', overflowY: 'auto', zIndex: 10 }}>
        {children}
      </div>
    </div>
  )
}

function DrawerHeader({ icon, title, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{title}</h3>
      </div>
      <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#F0F2EF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <X size={15} />
      </button>
    </div>
  )
}

function CenterSpinner({ label }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#9BADA6' }}>
      <Loader2 size={26} />
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
    </div>
  )
}

function Toast({ msg, kind }) {
  return (
    <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', padding: '10px 18px', borderRadius: 12, background: kind === 'error' ? '#C0432F' : '#1B2B26', color: 'white', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', zIndex: 50, whiteSpace: 'nowrap' }}>
      {msg}
    </div>
  )
}
