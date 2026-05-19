import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listRegulations, createRegulation, updateRegulation, removeRegulation,
  uploadRegulationFile, REG_CATEGORIES
} from '../lib/regulations.js'
import { supabase } from '../lib/supabase.js'
import { getProfileMap, ownerLabel } from '../lib/profiles.js'

const SPACE_TYPES = [
  'office','meeting','pantry','gym','sauna','shower','locker','lounge',
  'restroom','corridor','lobby','bedroom','restaurant','clinic','custom'
]

export default function RegulationsPage() {
  const [regs, setRegs] = useState([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [profileMap, setProfileMap] = useState({})
  const [currentUid, setCurrentUid] = useState(null)
  const [filterCat, setFilterCat] = useState('all')

  useEffect(() => {
    reload()
    getProfileMap().then(setProfileMap)
    supabase.auth.getUser().then(({ data }) => setCurrentUid(data?.user?.id))
  }, [])

  async function reload() {
    setLoading(true)
    try {
      setRegs(await listRegulations({ activeOnly: false })); setTableMissing(false)
    } catch (e) {
      if (/regulations/i.test(e.message || '')) setTableMissing(true)
      else alert(e.message)
    }
    setLoading(false)
  }

  async function toggleActive(r) {
    await updateRegulation(r.id, { is_active: !r.is_active })
    reload()
  }
  async function onDelete(r) {
    if (!confirm(`刪除法規「${r.title}」?`)) return
    await removeRegulation(r.id)
    reload()
  }

  const filtered = filterCat === 'all' ? regs : regs.filter(r => r.category === filterCat)

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Link to="/" className="text-xs text-slate-500 hover:underline">← 回方案列表</Link>
            <h1 className="text-2xl font-bold mt-1">📖 法規庫</h1>
            <p className="text-sm text-slate-600 mt-1">
              匯入政府公規 (建築技術規則、消防、無障礙、室內裝修管理辦法等),
              AI 規劃時自動引用適用法規。<b>跟 內部規則 並存,法規庫為公規,內部規則為東森家規</b>。
            </p>
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true) }}
                  className="px-4 py-2 bg-brand-700 text-white rounded hover:bg-brand-500">
            + 新增法規
          </button>
        </div>

        {tableMissing && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm mb-3">
            ⚠ 法規庫尚未啟用 —— 請到 Supabase SQL Editor 跑 <code className="bg-white px-1">supabase/regulations_schema.sql</code>。
          </div>
        )}

        {showForm && (
          <RegulationForm initial={editing}
            onClose={() => { setShowForm(false); setEditing(null); reload() }} />
        )}

        {/* 過濾 */}
        {regs.length > 0 && (
          <div className="flex gap-1 mb-3 flex-wrap text-xs">
            <button onClick={() => setFilterCat('all')}
                    className={`px-2 py-1 rounded border ${filterCat === 'all' ? 'bg-brand-700 text-white' : 'bg-white'}`}>
              全部 ({regs.length})
            </button>
            {REG_CATEGORIES.map(c => {
              const cnt = regs.filter(r => r.category === c.value).length
              if (!cnt) return null
              return (
                <button key={c.value} onClick={() => setFilterCat(c.value)}
                        className={`px-2 py-1 rounded border ${filterCat === c.value ? 'bg-brand-700 text-white' : 'bg-white'}`}>
                  {c.label} ({cnt})
                </button>
              )
            })}
          </div>
        )}

        {loading ? <p>載入中…</p> :
         filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            {regs.length === 0 ? '還沒有法規。點右上「+ 新增法規」匯入第一筆。' : '沒有符合的法規'}
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map(r => (
              <li key={r.id} className={`bg-white border rounded-lg p-4 ${!r.is_active && 'opacity-50'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{r.title}</h3>
                      {r.category && <span className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">{r.category}</span>}
                      {r.authority && <span className="bg-blue-100 px-1.5 py-0.5 rounded text-xs">{r.authority}</span>}
                      {r.version && <span className="text-[10px] text-slate-500 font-mono">v{r.version}</span>}
                      <span className="text-[10px] text-slate-400">
                        👤 {ownerLabel(profileMap, r.owner, currentUid)}
                      </span>
                    </div>
                    {r.summary && (
                      <p className="text-sm text-slate-700 mt-2">{r.summary}</p>
                    )}
                    {r.applies_to_space_types?.length > 0 && (
                      <div className="flex gap-1 mt-2 text-xs flex-wrap">
                        <span className="text-slate-500">適用:</span>
                        {r.applies_to_space_types.map(t => (
                          <span key={t} className="bg-slate-100 px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                    )}
                    {(r.attachments?.length > 0 || r.source_url) && (
                      <div className="text-xs mt-2 text-slate-500 flex gap-2">
                        {r.attachments?.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer"
                             className="text-blue-600 hover:underline">📎 原始檔 {i+1}</a>
                        ))}
                        {r.source_url && (
                          <a href={r.source_url} target="_blank" rel="noreferrer"
                             className="text-blue-600 hover:underline">🔗 來源</a>
                        )}
                      </div>
                    )}
                    {r.content && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-slate-500 hover:text-slate-800">📄 顯示全文 ({r.content.length} 字)</summary>
                        <pre className="mt-1 p-2 bg-slate-50 rounded whitespace-pre-wrap max-h-60 overflow-y-auto text-[10px]">{r.content.slice(0, 5000)}</pre>
                      </details>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 text-xs ml-3">
                    {r.owner === currentUid ? (
                      <>
                        <button onClick={() => toggleActive(r)}
                                className={`px-2 py-1 rounded ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {r.is_active ? '✓ 啟用' : '停用'}
                        </button>
                        <button onClick={() => { setEditing(r); setShowForm(true) }}
                                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">編輯</button>
                        <button onClick={() => onDelete(r)} className="text-red-500 hover:underline">刪除</button>
                      </>
                    ) : (
                      <span className={`px-2 py-1 rounded text-center ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {r.is_active ? '✓ 啟用' : '停用'}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function RegulationForm({ initial, onClose }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [authority, setAuthority] = useState(initial?.authority || '')
  const [category, setCategory] = useState(initial?.category || '建築')
  const [version, setVersion] = useState(initial?.version || '')
  const [effectiveDate, setEffectiveDate] = useState(initial?.effective_date || '')
  const [sourceUrl, setSourceUrl] = useState(initial?.source_url || '')
  const [content, setContent] = useState(initial?.content || '')
  const [summary, setSummary] = useState(initial?.summary || '')
  const [appliesTo, setAppliesTo] = useState(initial?.applies_to_space_types || [])
  const [attachments, setAttachments] = useState(initial?.attachments || [])
  const [priority, setPriority] = useState(initial?.priority || 5)
  const [busy, setBusy] = useState(false)
  const isEdit = !!initial?.id

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setBusy(true)
    for (const f of files) {
      try {
        const { url, extractedText } = await uploadRegulationFile(f)
        setAttachments(a => [...a, url])
        if (extractedText && content.length < 100) {
          setContent(prev => (prev ? prev + '\n\n' : '') + `[來自 ${f.name}]\n` + extractedText)
        }
      } catch (ex) { alert(ex.message) }
    }
    setBusy(false)
    e.target.value = ''
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !content.trim()) { alert('標題與內容必填'); return }
    setBusy(true)
    try {
      const payload = {
        title, authority, category, version,
        effective_date: effectiveDate || null,
        source_url: sourceUrl,
        content, summary,
        applies_to_space_types: appliesTo,
        attachments,
        priority: Number(priority),
        is_active: true
      }
      if (isEdit) await updateRegulation(initial.id, payload)
      else await createRegulation(payload)
      onClose()
    } catch (ex) { alert(ex.message) }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={e => e.stopPropagation()}
            className="bg-white rounded-xl w-[720px] max-h-[90vh] overflow-y-auto p-6 space-y-3">
        <h2 className="text-lg font-semibold">{isEdit ? '✎ 編輯法規' : '+ 新增法規'}</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium">標題 *</span>
            <input value={title} onChange={e => setTitle(e.target.value)} required
                   placeholder="例: 建築技術規則建築設計施工編"
                   className="w-full border rounded px-2 py-1.5 mt-1" />
          </label>
          <label className="block">
            <span className="text-xs font-medium">主管機關</span>
            <input value={authority} onChange={e => setAuthority(e.target.value)}
                   placeholder="例: 內政部營建署"
                   className="w-full border rounded px-2 py-1.5 mt-1" />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-medium">類別</span>
            <select value={category} onChange={e => setCategory(e.target.value)}
                    className="w-full border rounded px-2 py-1.5 mt-1">
              {REG_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium">版本/修訂日</span>
            <input value={version} onChange={e => setVersion(e.target.value)}
                   placeholder="2024-08-15"
                   className="w-full border rounded px-2 py-1.5 mt-1" />
          </label>
          <label className="block">
            <span className="text-xs font-medium">優先度 (1-10)</span>
            <input type="number" min="1" max="10" value={priority}
                   onChange={e => setPriority(e.target.value)}
                   className="w-full border rounded px-2 py-1.5 mt-1" />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-medium">來源 URL (法規網/政府公告)</span>
          <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
                 placeholder="https://law.moj.gov.tw/..."
                 className="w-full border rounded px-2 py-1.5 mt-1 text-xs" />
        </label>

        <label className="block">
          <span className="text-xs font-medium">適用空間類型 (多選,空白表示全用)</span>
          <div className="flex gap-1 mt-1 flex-wrap text-xs">
            {SPACE_TYPES.map(t => (
              <label key={t} className="flex items-center gap-0.5 cursor-pointer">
                <input type="checkbox" checked={appliesTo.includes(t)}
                       onChange={e => {
                         if (e.target.checked) setAppliesTo([...appliesTo, t])
                         else setAppliesTo(appliesTo.filter(x => x !== t))
                       }} />
                {t}
              </label>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="text-xs font-medium">📎 上傳法規檔 (PDF/Word) — 自動抽文字到下方內容</span>
          <input type="file" multiple accept=".pdf,.doc,.docx,.txt,.md"
                 onChange={onPickFiles} className="block mt-1 text-sm" />
          {attachments.length > 0 && (
            <div className="text-xs text-emerald-600 mt-1">已上傳 {attachments.length} 個檔案</div>
          )}
        </label>

        <label className="block">
          <span className="text-xs font-medium">摘要 (簡短重點,給 AI 列表用)</span>
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2}
                    placeholder="例: 避難走廊寬度標準、樓梯數量、防火區劃面積上限..."
                    className="w-full border rounded px-2 py-1.5 mt-1 text-xs" />
        </label>

        <label className="block">
          <span className="text-xs font-medium">全文內容 * (AI 直接讀)</span>
          <textarea value={content} onChange={e => setContent(e.target.value)} required rows={12}
                    placeholder="貼上法規全文,或上傳 PDF 自動抽取..."
                    className="w-full border rounded px-2 py-1.5 mt-1 font-mono text-[10px]" />
          <div className="text-[10px] text-slate-500 mt-0.5">{content.length} 字</div>
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded">取消</button>
          <button type="submit" disabled={busy}
                  className="px-3 py-1.5 bg-brand-700 text-white rounded disabled:opacity-50">
            {busy ? '處理中…' : (isEdit ? '儲存' : '建立')}
          </button>
        </div>
      </form>
    </div>
  )
}
