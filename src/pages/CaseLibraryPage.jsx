import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listCases, createCase, removeCase, uploadCaseImage } from '../lib/caseLibrary.js'
import { batchImportImages, DOC_TYPES, ERAS } from '../lib/imageImport.js'
import { supabase } from '../lib/supabase.js'
import { getProfileMap, ownerLabel } from '../lib/profiles.js'

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
  const [showBatch, setShowBatch] = useState(false)
  const [profileMap, setProfileMap] = useState({})
  const [currentUid, setCurrentUid] = useState(null)
  const [filterDocType, setFilterDocType] = useState('all')
  const [filterEra, setFilterEra] = useState('all')

  const [tableMissing, setTableMissing] = useState(false)
  useEffect(() => {
    reload()
    getProfileMap().then(setProfileMap)
    supabase.auth.getUser().then(({ data }) => setCurrentUid(data?.user?.id))
  }, [])
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
          <div className="flex gap-2">
            <button onClick={() => setShowBatch(true)}
                    className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-500">
              📦 批次匯入圖檔 (AI 自動標籤)
            </button>
            <button onClick={() => setShowForm(true)}
                    className="px-4 py-2 bg-brand-700 text-white rounded hover:bg-brand-500">
              + 手動新增
            </button>
          </div>
        </div>

        {showForm && <CaseForm onClose={() => { setShowForm(false); reload() }} />}
        {showBatch && <BatchImportForm onClose={() => { setShowBatch(false); reload() }} />}

        {/* 過濾器 */}
        {!loading && cases.length > 0 && (
          <div className="flex gap-2 mb-3 text-xs flex-wrap">
            <span className="text-slate-500 self-center">過濾:</span>
            <select value={filterDocType} onChange={e => setFilterDocType(e.target.value)}
                    className="border rounded px-2 py-1">
              <option value="all">全部類型</option>
              {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <select value={filterEra} onChange={e => setFilterEra(e.target.value)}
                    className="border rounded px-2 py-1">
              <option value="all">全部時期</option>
              {ERAS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
        )}

        {tableMissing && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm mb-3">
            ⚠ 案例庫尚未啟用 —— 請到 Supabase SQL Editor 跑 <code className="bg-white px-1">supabase/cases_schema.sql</code> 的內容,然後重整。
          </div>
        )}

        {(() => {
          if (loading) return <p>載入中…</p>
          if (cases.length === 0) return (
            <div className="text-center py-12 text-slate-500">
              還沒有案例。點右上批次匯入或手動新增。
            </div>
          )
          const filtered = cases.filter(c => {
            if (filterDocType !== 'all' && c.doc_type !== filterDocType) return false
            if (filterEra !== 'all' && c.era !== filterEra) return false
            return true
          })
          if (filtered.length === 0) return (
            <div className="text-center py-12 text-slate-500">
              沒有符合過濾條件的案例。
            </div>
          )
          return (
          <ul className="space-y-3">
            {filtered.map(c => (
              <li key={c.id} className="bg-white border rounded-lg p-4 flex gap-4">
                {(c.thumbnail_url || c.attachments?.[0] || c.image_urls?.[0]) && (
                  <img src={c.thumbnail_url || c.attachments?.[0] || c.image_urls?.[0]} alt=""
                       className="w-32 h-24 object-cover rounded" />
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{c.title}</h3>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400">👤 {ownerLabel(profileMap, c.owner, currentUid)}</span>
                      {c.owner === currentUid && (
                        <button onClick={() => onDelete(c)}
                                className="text-red-500 hover:underline">刪除</button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 mt-1 text-xs flex-wrap">
                    {c.doc_type && (
                      <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                        {DOC_TYPES.find(d => d.value === c.doc_type)?.label || c.doc_type}
                      </span>
                    )}
                    {c.era && (
                      <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded">
                        {ERAS.find(e => e.value === c.era)?.label || c.era}
                      </span>
                    )}
                    {c.project && (
                      <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">📍 {c.project}</span>
                    )}
                    {c.year && <span className="bg-slate-100 px-1.5 py-0.5 rounded">{c.year}</span>}
                    {(c.space_types || []).map(t => (
                      <span key={t} className="bg-slate-100 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                    {(c.style_tags || []).map(t => (
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
          )
        })()}
      </div>
    </div>
  )
}

function BatchImportForm({ onClose }) {
  const [files, setFiles] = useState([])
  const [docType, setDocType] = useState('reference')
  const [era, setEra] = useState('reference')
  const [project, setProject] = useState('')
  const [year, setYear] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState(null)

  function onPick(e) {
    setFiles(Array.from(e.target.files || []))
  }
  async function onSubmit(e) {
    e.preventDefault()
    if (!files.length) return
    setBusy(true)
    setProgress({ idx: 0, total: files.length, status: '開始…' })
    try {
      const rs = await batchImportImages(
        files,
        {
          doc_type: docType,
          era,
          project: project.trim(),
          year: year ? Number(year) : null,
          description: description.trim()
        },
        (idx, total, status) => setProgress({ idx, total, status })
      )
      setResults(rs)
    } catch (e) {
      alert(e.message)
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={e => e.stopPropagation()}
            className="bg-white rounded-xl w-[640px] max-h-[90vh] overflow-y-auto p-6 space-y-3">
        <h2 className="text-lg font-semibold">📦 批次匯入圖檔到案例庫</h2>
        <p className="text-xs text-slate-600">
          一次拖多張圖,AI 會自動辨識每張的「類型/時期/空間/風格」並寫入案例庫。
          支援:JPG、PNG、PDF。
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium">📋 圖紙類型 (套用所有檔)</span>
            <select value={docType} onChange={e => setDocType(e.target.value)}
                    className="w-full border rounded px-2 py-1.5 mt-1 text-sm">
              {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <span className="text-[10px] text-slate-500">{DOC_TYPES.find(d => d.value === docType)?.hint}</span>
          </label>
          <label className="block">
            <span className="text-xs font-medium">📅 時期</span>
            <select value={era} onChange={e => setEra(e.target.value)}
                    className="w-full border rounded px-2 py-1.5 mt-1 text-sm">
              {ERAS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium">案場名稱 (可選)</span>
            <input value={project} onChange={e => setProject(e.target.value)}
                   placeholder="例: 林口 25F 總裁住家"
                   className="w-full border rounded px-2 py-1.5 mt-1 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs font-medium">年份 (可選)</span>
            <input type="number" value={year} onChange={e => setYear(e.target.value)}
                   placeholder="例: 2025"
                   className="w-full border rounded px-2 py-1.5 mt-1 text-sm" />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-medium">統一備註 (可選,給 AI 看的)</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                    placeholder="例: 這批是 2024 林口住家設計參考,業主偏好現代極簡"
                    className="w-full border rounded px-2 py-1.5 mt-1 text-sm" />
        </label>

        <label className="block">
          <span className="text-xs font-medium">選擇檔案 *</span>
          <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.pdf"
                 onChange={onPick} className="block mt-1 text-sm" />
          {files.length > 0 && (
            <div className="text-xs text-emerald-600 mt-1">
              已選 {files.length} 個檔案,總大小 {(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB
            </div>
          )}
        </label>

        {progress && (
          <div className="bg-slate-50 border rounded p-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span>{progress.status}</span>
              <span>{progress.idx} / {progress.total}</span>
            </div>
            <div className="w-full h-1.5 bg-slate-200 rounded overflow-hidden">
              <div className="h-full bg-brand-700 transition-all"
                   style={{ width: `${(progress.idx / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {results && (
          <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-xs">
            ✅ 完成 {results.filter(r => r.ok).length} / {results.length} 張
            {results.filter(r => !r.ok).length > 0 && (
              <div className="text-red-600 mt-1">
                失敗: {results.filter(r => !r.ok).map(r => r.file).join(', ')}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose}
                  className="px-3 py-1.5 border rounded">關閉</button>
          {!results && (
            <button type="submit" disabled={busy || !files.length}
                    className="px-3 py-1.5 bg-brand-700 text-white rounded disabled:opacity-50">
              {busy ? `處理中 ${progress?.idx || 0}/${progress?.total || files.length}…` : `開始匯入 (${files.length} 張)`}
            </button>
          )}
        </div>
      </form>
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
