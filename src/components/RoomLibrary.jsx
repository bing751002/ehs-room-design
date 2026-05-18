import { useState, useMemo, useEffect } from 'react'
import { roomTemplates as builtinTemplates, newSpaceId } from '../lib/constraints.js'
import { usePlanStore } from '../store/planStore.js'
import { listRoomTemplates, createRoomTemplate, updateRoomTemplate, removeRoomTemplate, toggleFavorite } from '../lib/roomTemplates.js'

/**
 * 房間庫 — 內建 (constraints.roomTemplates) + 使用者雲端自訂 (room_templates 表)
 */
const SPACE_TYPES = [
  { value: 'office',   label: '辦公室',   color: '#bfdbfe' },
  { value: 'meeting',  label: '會議室',   color: '#a7f3d0' },
  { value: 'pantry',   label: '茶水間',   color: '#fde68a' },
  { value: 'gym',      label: '健身區',   color: '#fca5a5' },
  { value: 'sauna',    label: '三溫暖室', color: '#fdba74' },
  { value: 'shower',   label: '淋浴間',   color: '#93c5fd' },
  { value: 'locker',   label: '更衣室',   color: '#c4b5fd' },
  { value: 'lounge',   label: '休息區',   color: '#fbcfe8' },
  { value: 'restroom', label: '洗手間',   color: '#cbd5e1' },
  { value: 'corridor', label: '走道',     color: '#e5e7eb' },
  { value: 'custom',   label: '其他',     color: '#e2e8f0' }
]

export default function RoomLibrary() {
  const addSpace = usePlanStore(s => s.addSpace)
  const plan = usePlanStore(s => s.plan)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('全部')
  const [tab, setTab] = useState('all')  // 'all' | 'mine' | 'fav'
  const [userTemplates, setUserTemplates] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  useEffect(() => { reload() }, [])
  async function reload() {
    try { setUserTemplates(await listRoomTemplates()) }
    catch (e) { console.error(e) }
  }

  // 合併內建 + 使用者
  const allTemplates = useMemo(() => {
    const built = builtinTemplates.map(t => ({
      ...t,
      _source: 'system',
      _key: 'sys_' + t.key,
      width_cm: t.w,
      depth_cm: t.h,
      is_favorite: false
    }))
    const mine = userTemplates.map(t => ({
      ...t,
      _source: 'user',
      _key: 'user_' + t.id,
      w: t.width_cm, h: t.depth_cm,
      category: t.category || '自訂'
    }))
    return [...mine, ...built]
  }, [userTemplates])

  const categories = useMemo(() => {
    const s = new Set(['全部'])
    for (const t of allTemplates) s.add(t.category || '其他')
    return Array.from(s)
  }, [allTemplates])

  const filtered = useMemo(() => {
    return allTemplates.filter(t => {
      if (tab === 'mine' && t._source !== 'user') return false
      if (tab === 'fav' && !t.is_favorite) return false
      const okQ = !q || t.name.includes(q) || (t.category || '').includes(q)
      const okC = cat === '全部' || t.category === cat
      return okQ && okC
    })
  }, [allTemplates, q, cat, tab])

  function place(t) {
    const baseX = (plan.availableZone?.x ?? 200) + 50
    const baseY = (plan.availableZone?.y ?? 200) + 50
    const w = t.w || t.width_cm || 400
    const h = t.h || t.depth_cm || 300
    addSpace({
      name: t.name,
      type: t.type,
      color: t.color,
      height: t.height_cm || 280,
      vertices: [
        { x: baseX,     y: baseY },
        { x: baseX + w, y: baseY },
        { x: baseX + w, y: baseY + h },
        { x: baseX,     y: baseY + h }
      ]
    })
  }

  async function onToggleFav(t) {
    if (t._source !== 'user') {
      alert('系統內建房型不能加入最愛,你可以複製一份成自訂房型再加入。')
      return
    }
    try { await toggleFavorite(t.id, t.is_favorite); reload() }
    catch (e) { alert(e.message) }
  }

  async function onDelete(t) {
    if (t._source !== 'user') return
    if (!confirm(`刪除自訂房型「${t.name}」?`)) return
    try { await removeRoomTemplate(t.id); reload() }
    catch (e) { alert(e.message) }
  }

  function onEdit(t) {
    if (t._source !== 'user') {
      // 系統內建 → 複製成新自訂
      setEditing({
        name: t.name + ' (複本)', type: t.type, category: t.category,
        width_cm: t.w, depth_cm: t.h, color: t.color, height_cm: 280,
        description: '', _isClone: true
      })
    } else {
      setEditing(t)
    }
    setShowForm(true)
  }

  return (
    <div className="space-y-1.5 p-2">
      {/* tabs */}
      <div className="flex gap-1 text-[10px] border-b pb-1">
        {[
          { k: 'all', label: '全部' },
          { k: 'mine', label: '我的' },
          { k: 'fav', label: '⭐ 最愛' }
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
                  className={`px-2 py-0.5 rounded ${tab === t.k ? 'bg-brand-700 text-white' : 'hover:bg-slate-100'}`}>
            {t.label}
          </button>
        ))}
        <button onClick={() => { setEditing(null); setShowForm(true) }}
                title="新增自訂房型"
                className="ml-auto px-1.5 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-500">
          + 新增
        </button>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)}
             placeholder="搜尋房間…"
             className="w-full text-xs border rounded px-2 py-1 outline-brand-700" />
      <div className="flex gap-1 flex-wrap">
        {categories.map(c => (
          <button key={c} onClick={() => setCat(c)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    cat === c ? 'bg-brand-700 text-white border-brand-700' : 'bg-white hover:bg-slate-50'
                  }`}>
            {c}
          </button>
        ))}
      </div>

      <div className="text-[10px] text-slate-500 px-1 pt-1">點名稱加到畫布</div>
      <div className="space-y-0.5">
        {filtered.map(t => (
          <div key={t._key}
               className="group w-full flex items-center gap-1 px-1.5 py-1 hover:bg-slate-100 rounded text-xs text-left">
            <span className="w-4 h-4 rounded shrink-0" style={{ background: t.color }} />
            <button onClick={() => place(t)} className="flex-1 text-left truncate">
              {t.is_favorite && '⭐ '}{t.name}
              {t._source === 'user' && <span className="ml-1 text-emerald-600 text-[9px]">(自訂)</span>}
              {t._source === 'ai_chat' && <span className="ml-1 text-violet-600 text-[9px]">(AI)</span>}
            </button>
            <span className="text-[9px] text-slate-400 shrink-0">{t.w || t.width_cm}×{t.h || t.depth_cm}</span>
            {/* 操作 */}
            <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 text-[9px]">
              <button onClick={() => onToggleFav(t)} title="加入最愛"
                      className="hover:bg-slate-200 rounded px-0.5">
                {t.is_favorite ? '⭐' : '☆'}
              </button>
              <button onClick={() => onEdit(t)} title="編輯/複製"
                      className="hover:bg-slate-200 rounded px-0.5">✎</button>
              {t._source === 'user' && (
                <button onClick={() => onDelete(t)} title="刪除"
                        className="hover:bg-red-100 rounded px-0.5 text-red-500">×</button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-[10px] text-slate-400 text-center py-2">沒有符合的房型</p>
        )}
      </div>

      {showForm && (
        <TemplateForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); reload() }} />
      )}
    </div>
  )
}

function TemplateForm({ initial, onClose }) {
  const [name, setName] = useState(initial?.name || '')
  const [type, setType] = useState(initial?.type || 'office')
  const [category, setCategory] = useState(initial?.category || '辦公')
  const [width, setWidth] = useState(initial?.width_cm || 400)
  const [depth, setDepth] = useState(initial?.depth_cm || 300)
  const [height, setHeight] = useState(initial?.height_cm || 280)
  const [color, setColor] = useState(initial?.color || '#bfdbfe')
  const [description, setDescription] = useState(initial?.description || '')
  const [busy, setBusy] = useState(false)
  const isEdit = !!(initial && initial.id && !initial._isClone)

  async function onSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { alert('名稱必填'); return }
    setBusy(true)
    try {
      const payload = {
        name, type, category,
        width_cm: Number(width), depth_cm: Number(depth), height_cm: Number(height),
        color, description, source: 'manual'
      }
      if (isEdit) await updateRoomTemplate(initial.id, payload)
      else await createRoomTemplate(payload)
      onClose()
    } catch (e) { alert(e.message) }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={e => e.stopPropagation()}
            className="bg-white rounded-lg w-[420px] p-4 space-y-2 text-sm">
        <h3 className="font-semibold">{isEdit ? '✎ 編輯房型' : '+ 新增自訂房型'}</h3>

        <label className="block">
          <span className="text-[10px] text-slate-500">名稱 *</span>
          <input value={name} onChange={e => setName(e.target.value)} required
                 placeholder="例:總經理辦公室"
                 className="w-full border rounded px-2 py-1" />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] text-slate-500">類型</span>
            <select value={type} onChange={e => {
              const t = SPACE_TYPES.find(x => x.value === e.target.value)
              setType(e.target.value)
              if (t) setColor(t.color)
            }} className="w-full border rounded px-2 py-1">
              {SPACE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-500">分類</span>
            <input value={category} onChange={e => setCategory(e.target.value)}
                   placeholder="辦公/住宅/特殊…"
                   className="w-full border rounded px-2 py-1" />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[10px] text-slate-500">寬 (cm)</span>
            <input type="number" min="1" value={width} onChange={e => setWidth(e.target.value)}
                   className="w-full border rounded px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-500">深 (cm)</span>
            <input type="number" min="1" value={depth} onChange={e => setDepth(e.target.value)}
                   className="w-full border rounded px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-500">高 (cm)</span>
            <input type="number" min="1" value={height} onChange={e => setHeight(e.target.value)}
                   className="w-full border rounded px-2 py-1" />
          </label>
        </div>

        <div className="text-[10px] text-slate-500">
          坪數預估:{((width * depth) / 33057.85).toFixed(2)} 坪
        </div>

        <label className="block">
          <span className="text-[10px] text-slate-500">顏色</span>
          <input type="color" value={color} onChange={e => setColor(e.target.value)}
                 className="w-full h-7 border rounded cursor-pointer" />
        </label>

        <label className="block">
          <span className="text-[10px] text-slate-500">設計備註 (給 AI 看的設計考量)</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                    placeholder="例:總經理室,要靠落地窗,主桌面西,後方書牆"
                    className="w-full border rounded px-2 py-1 text-xs" />
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1 border rounded">取消</button>
          <button type="submit" disabled={busy}
                  className="px-3 py-1 bg-brand-700 text-white rounded disabled:opacity-50">
            {busy ? '儲存中…' : (isEdit ? '儲存' : '建立')}
          </button>
        </div>
      </form>
    </div>
  )
}
