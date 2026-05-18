import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listCases, createCase, removeCase, uploadCaseImage } from '../lib/caseLibrary.js'

const SPACE_TYPE_OPTIONS = [
  'office','meeting','pantry','gym','sauna','shower','locker','lounge','restroom','corridor','custom'
]

/**
 * 案例庫頁 — 上傳歷年成功/失敗案例。AI 規劃新方案時會自動撈相近案例當參考。
 */
export default function CaseLibraryPage() {
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [tableMissing, setTableMissing] = useState(false)
  useEffect(() => { reload() }, [])
  async function reload() {
    setLoading(true)
    try {
      const list = await listCases()
      setCases(list)
      setTableMissing(false)
    } catch (e) {
      if (/reference_cases/i.test(e.message || '')) setTableMissing(true)
      else alert(e.message)
    }
    setLoading(false)
  }

  async function onDelete(c) {
    if (!confirm(`刪除案例「${c.title}」?`)) return
    await removeCase(c.id)
    reload()
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Link to="/" className="text-xs text-slate-500 hover:underline">← 回方案列表</Link>
            <h1 className="text-2xl font-bold mt-1">📚 東森空間規劃案例庫</h1>
            <p className="text-sm text-slate-600 mt-1">
              上傳過去成功/失敗的規劃案例,AI 新方案時會自動撈相近案例當參考,讓系統「越用越懂東森」。
            </p>
          </div>
          <button onClick={() => setShowForm(true)}
                  className="px-4 py-2 bg-brand-700 text-white rounded hover:bg-brand-500">
            + 新增案例
          </button>
        </div>

        {showForm && <CaseForm onClose={() => { setShowForm(false); reload() }} />}

        {tableMissing && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm mb-3">
            ⚠ 案例庫尚未啟用 —— 請到 Supabase SQL Editor 跑 <code className="bg-white px-1">supabase/cases_schema.sql</code> 的內容,然後重整。
          </div>
        )}

        {loading ? <p>載入中…</p> :
         cases.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            還沒有案例。點右上「+ 新增案例」上傳第一筆。
          </div>
        ) : (
          <ul className="space-y-3">
            {cases.map(c => (
              <li key={c.id} className="bg-white border rounded-lg p-4 flex gap-4">
                {c.image_urls?.[0] && (
                  <img src={c.image_urls[0]} alt="" className="w-32 h-24 object-cover rounded" />
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{c.title}</h3>
                    <button onClick={() => onDelete(c)}
                            className="text-xs text-red-500 hover:underline">刪除</button>
                  </div>
                  <div className="flex gap-1 mt-1 text-xs">
                    {(c.space_types || []).map(t => (
                      <span key={t} className="bg-slate-100 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                    {(c.tags || []).map(t => (
                      <span key={t} className="bg-amber-100 px-1.5 py-0.5 rounded">#{t}</span>
                    ))}
                  </div>
                  {c.description && (
                    <p className="text-sm text-slate-600 mt-2 line-clamp-2">{c.description}</p>
                  )}
                  {(c.what_worked || c.what_failed) && (
                    <div className="mt-2 text-xs space-y-0.5">
                      {c.what_worked && <p className="text-green-700">✅ {c.what_worked}</p>}
                      {c.what_failed && <p className="text-red-700">❌ {c.what_failed}</p>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CaseForm({ onClose }) {
  const [title, setTitle] = useState('')
  const [spaceTypes, setSpaceTypes] = useState([])
  const [tagsRaw, setTagsRaw] = useState('')
  const [areaPing, setAreaPing] = useState('')
  const [description, setDescription] = useState('')
  const [bossNotes, setBossNotes] = useState('')
  const [whatWorked, setWhatWorked] = useState('')
  const [whatFailed, setWhatFailed] = useState('')
  const [imageUrls, setImageUrls] = useState([])
  const [busy, setBusy] = useState(false)

  async function onPickImages(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setBusy(true)
    try {
      const urls = []
      for (const f of files) {
        const { url } = await uploadCaseImage(f)
        urls.push(url)
      }
      setImageUrls(prev => [...prev, ...urls])
    } catch (ex) { alert(ex.message) }
    setBusy(false)
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!title.trim()) { alert('案例標題必填'); return }
    setBusy(true)
    try {
      await createCase({
        title,
        space_types: spaceTypes,
        tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
        area_ping: areaPing ? Number(areaPing) : null,
        description, boss_notes: bossNotes,
        what_worked: whatWorked, what_failed: whatFailed,
        image_urls: imageUrls
      })
      onClose()
    } catch (e) { alert(e.message) }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={e => e.stopPropagation()}
            className="bg-white rounded-xl w-[680px] max-h-[90vh] overflow-y-auto p-6 space-y-3">
        <h2 className="text-lg font-semibold">+ 新增案例</h2>

        <Field label="標題 *">
          <input value={title} onChange={e => setTitle(e.target.value)}
                 placeholder="例:6F 五星級三溫暖男賓區" required
                 className="w-full border rounded px-2 py-1.5" />
        </Field>

        <Field label="空間類型 (可多選)">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {SPACE_TYPE_OPTIONS.map(t => (
              <label key={t} className={`px-2 py-1 rounded cursor-pointer border ${
                spaceTypes.includes(t) ? 'bg-brand-700 text-white' : 'bg-slate-50'
              }`}>
                <input type="checkbox" className="hidden"
                       checked={spaceTypes.includes(t)}
                       onChange={() => setSpaceTypes(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])} />
                {t}
              </label>
            ))}
          </div>
        </Field>

        <Field label="標籤 (逗號分隔)">
          <input value={tagsRaw} onChange={e => setTagsRaw(e.target.value)}
                 placeholder="日式禪意, 高端, 男賓"
                 className="w-full border rounded px-2 py-1.5" />
        </Field>

        <Field label="坪數">
          <input type="number" value={areaPing} onChange={e => setAreaPing(e.target.value)}
                 placeholder="例: 45.5"
                 className="w-full border rounded px-2 py-1.5" />
        </Field>

        <Field label="描述">
          <textarea value={description} onChange={e => setDescription(e.target.value)}
                    rows={3} placeholder="設計重點、配置理念、用了什麼材質..."
                    className="w-full border rounded px-2 py-1.5" />
        </Field>

        <Field label="老闆偏好 / 評論">
          <textarea value={bossNotes} onChange={e => setBossNotes(e.target.value)}
                    rows={2} placeholder="老闆說過什麼話?喜歡/不喜歡什麼?"
                    className="w-full border rounded px-2 py-1.5" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="✅ 做對了什麼">
            <textarea value={whatWorked} onChange={e => setWhatWorked(e.target.value)}
                      rows={2} className="w-full border rounded px-2 py-1.5 bg-green-50" />
          </Field>
          <Field label="❌ 踩到什麼雷">
            <textarea value={whatFailed} onChange={e => setWhatFailed(e.target.value)}
                      rows={2} className="w-full border rounded px-2 py-1.5 bg-red-50" />
          </Field>
        </div>

        <Field label="參考圖片 (可多張)">
          <input type="file" accept="image/*" multiple onChange={onPickImages}
                 className="text-sm" />
          {imageUrls.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {imageUrls.map((u, i) => (
                <img key={i} src={u} alt="" className="w-16 h-16 object-cover rounded border" />
              ))}
            </div>
          )}
        </Field>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded">取消</button>
          <button type="submit" disabled={busy}
                  className="px-3 py-1.5 bg-brand-700 text-white rounded disabled:opacity-50">
            {busy ? '處理中…' : '儲存'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  )
}
