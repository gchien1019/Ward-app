import { supabase } from './supabaseClient'
import { todayStr, nowStamp } from './helpers'

/* ---------- 讀取 ---------- */

export async function fetchAll() {
  const [items, locations, inventory, repairs, announcements, logins, log] =
    await Promise.all([
      supabase.from('items').select('*').order('sort_order'),
      supabase.from('locations').select('*').order('sort_order'),
      supabase.from('inventory').select('*'),
      supabase
        .from('repair_records')
        .select('*')
        .is('returned_at', null)
        .order('sent_at', { ascending: false }),
      supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('shift_logins')
        .select('*')
        .eq('date', todayStr())
        .order('created_at', { ascending: false }),
      supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300),
    ])

  return {
    items: items.data || [],
    locations: locations.data || [],
    inventory: inventory.data || [],
    repairs: repairs.data || [],
    announcements: announcements.data || [],
    logins: logins.data || [],
    log: log.data || [],
  }
}

/* ---------- 紀錄足跡 ---------- */

export async function logActivity(action, summary, userName, shift) {
  await supabase
    .from('activity_log')
    .insert({ action, summary, user_name: userName, shift })
}

/* ---------- 庫存數量 ---------- */

export async function setQty(itemId, locationId, newQty, userName) {
  await supabase.from('inventory').upsert({
    item_id: itemId,
    location_id: locationId,
    qty_onhand: newQty,
    updated_at: new Date().toISOString(),
    updated_by: userName,
  })
}

/* ---------- 應有數量 ---------- */

export async function setStandardQty(itemId, qty) {
  await supabase.from('items').update({ standard_qty: qty }).eq('id', itemId)
}

/* ---------- 送修 / 送消 ---------- */

export async function sendForRepair({
  itemId,
  itemName,
  locationId,
  locationLabel,
  assetNo,
  status,
  note,
  userName,
}) {
  await supabase.from('repair_records').insert({
    item_id: itemId,
    item_name: itemName,
    location_id: locationId || null,
    location_label: locationLabel || null,
    asset_no: assetNo,
    status,
    note: note || null,
    sent_by: userName,
  })
}

export async function returnFromRepair(recordId) {
  await supabase
    .from('repair_records')
    .update({ returned_at: new Date().toISOString() })
    .eq('id', recordId)
}

/* ---------- 公告 ---------- */

export async function addAnnouncement(message, userName) {
  await supabase.from('announcements').insert({ message, created_by: userName })
}

export async function deleteAnnouncement(id) {
  await supabase.from('announcements').delete().eq('id', id)
}

/* ---------- 物品管理 ---------- */

export async function addItem(item) {
  await supabase.from('items').insert(item)
}
export async function updateItem(id, patch) {
  await supabase.from('items').update(patch).eq('id', id)
}
export async function deleteItem(id) {
  await supabase.from('items').delete().eq('id', id)
}

/* ---------- 位置管理 ---------- */

export async function addLocation(loc) {
  await supabase.from('locations').insert(loc)
}
export async function deleteLocation(id) {
  await supabase.from('locations').delete().eq('id', id)
}

/* ---------- 班次登入 ---------- */

export async function createShiftLogin(userName, shift, assignedLocations) {
  const { data } = await supabase
    .from('shift_logins')
    .insert({
      date: todayStr(),
      shift,
      user_name: userName,
      assigned_locations: assignedLocations,
    })
    .select()
    .single()
  return data
}

export async function confirmShiftLogin(id) {
  await supabase
    .from('shift_logins')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', id)
}

/* ---------- Supabase Auth ---------- */

function padPin(pin) { return pin + '@@' } // 四碼補成六碼，用戶感知不到

export async function signUp(email, pin, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password: padPin(pin),
    options: { data: { display_name: displayName } },
  })
  if (error) throw error
  // 同時寫入 profiles 表
  if (data.user) {
    await supabase.from('profiles').upsert({
      id: data.user.id,
      display_name: displayName,
      email,
    })
  }
  return data
}

export async function signIn(email, pin) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: padPin(pin),
  })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=1',
  })
  if (error) throw error
}

export async function updatePassword(newPin) {
  const { error } = await supabase.auth.updateUser({ password: padPin(newPin) })
  if (error) throw error
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function getProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}
