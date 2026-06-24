export function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
export function nowTimeStr() {
  return new Date().toTimeString().slice(0, 5)
}
export function nowStamp() {
  const d = new Date()
  return `${todayStr()} ${nowTimeStr()}`
}
export function fmtTs(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function autoShift() {
  const h = new Date().getHours()
  if (h >= 7 && h < 15) return 'day'
  if (h >= 15 && h < 23) return 'evening'
  return 'night'
}
export const SHIFTS = [
  { id: 'day', name: '白班' },
  { id: 'evening', name: '小夜' },
  { id: 'night', name: '大夜' },
]
export function shiftName(id) {
  return SHIFTS.find((s) => s.id === id)?.name || id
}
