import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listRules, createRule, updateRule, removeRule,
  uploadRuleAttachment, extractPdfText
} from '../lib/internalRules.js'

const CATEGORIES = ['消防','無障礙','品牌','業態','機電','其他']

export default function RulesPage() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [tableMissing, setTableMissing] = useState(false)
  useEffect(() => { reload() }, [])
  async function reload() {
    setLoading(true)
    try {
      const list = await listRules({ activeOnly: false })
      setRules(list); setTableMissing(false)
    } catch (e) {
      if (/internal_rules/i.test(e.message || '')) setTableMissing(true)
      else alert(e.message)
    }
    setLoading(false)
  }

  async function toggleActive(r) {
    await updateRule(r.id, { is_active: !r.is_active })
    reload()
  }
  async function onDelete(r) {
    if (!confirm(`刪除規則「${r.title}」?`)) return
    await removeRule(r.id)
    reload()
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Link to="/" className="text-xs text-slate-500 hover:underline">← 回方案列表</Link>
            <h1 className="text-2xl font-bold mt-1">⚖️ 內部規則管理</h1>
            <p className="text-sm text-slate-600 mt-1">
              上傳東森公司內部規定 (消防、品牌、業態等),AI 規劃時自動套用,
              <b>優先順序高於台灣公規</b>。
            </p>
          </div>
          <button onClick={() => setShowForm(true)}
                  className="px-4 py-2 bg-brand-700 text-white rounded hover:bg-brand-500">
            + 新增規則
          </button>
        </div>

        {showForm && <RuleForm onClose={() => { setShowForm(false); reload() }} />}

        {tableMissing && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm mb-3">
            ⚠ 內部規則尚未啟用 —— 請到 Supabase SQL Editor 跑 <code className="bg-white px-1">supabase/rules_schema.sql</code> 的內容,然後重整。
          </div>
        )}

        {loading ? <p>載入中…</p> :
         rules.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            還沒有內部規則。點右上「+ 新增規則」上傳。
          </div>
        ) : (
          <ul className="space-y-3">
            {rules.map(r => (
              <li key={r.id} className={`bg-white border rounded-lg p-4 ${!r.is_active && 'opacity-50'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{r.title}</h3>
                      {r.category && <span className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">{r.category}</span>}
                      <span className="text-xs text-slate-500">優先度 {r.priority}</span>
                    </div>
                    <pre className="text-xs text-slate-700 mt-2 whitespace-pre-wrap line-clamp-4 max-w-3xl">{r.content}</pre>
                    {r.attachments?.length > 0 && (
                      <div className="text-xs mt-2 text-slate-500">
                        附件: {r.attachments.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer"
                             className="text-blue-600 hover:underline mr-2">📎{i+1}</a>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 text-xs">
                    <button onClick={() => toggleActive(r)}
                            className={`px-2 py-1 rounded ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.is_active ? '✓ 啟用中' : '已停用'}
                    </button>
                    <button onClick={() => onDelete(r)}
                            className="text-red-500 hover:underline">刪除</button>
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

function RuleForm({ onClose }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('其他')
  const [priority, setPriority] = useState(5)
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState([])
  const [busy, setBusy] = useState(false)

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setBusy(true)
    try {
      const urls = []
      for (const f of files) {
        const { url } = await uploadRuleAttachment(f)
        urls.push(url)
        // 如果是 PDF,自動抽文字進 content
        if (f.name.toLowerCase().endsWith('.pdf')) {
          try {
            const text = await extractPdfText(f)
            setContent(prev => (prev ? prev + '\n\n' : '') + `[從 ${f.name} 自動抽取]\n` + text)
          } catch (ex) { console.warn('PDF 抽文字失敗', ex) }
        }
      }
      setAttachments(prev => [...prev, ...urls])
    } catch (ex) { alert(ex.message) }
    setBusy(false)
  }
  async function onSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !content.trim()) { alert('標題與內容必填'); return }
    setBusy(true)
    try {
      await createRule({
        title, category, content, attachments,
        priority: Number(priority), is_active: true
      })
      onClose()
    } catch (ex) { alert(ex.message) }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={e => e.stopPropagation()}
            className="bg-white rounded-xl w-[640px] max-h-[90vh] overflow-y-auto p-6 space-y-3">
        <h2 className="text-lg font-semibold">+ 新增內部規則</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium">標題 *</span>
            <input value={title} onChange={e => setTitle(e.target.value)} required
                   placeholder="例:東森酒店客房最低標準"
                   className="w-full border rounded px-2 py-1.5 mt-1" />
          </label>
          <label className="block">
            <span className="text-xs font-medium">類別</span>
            <select value={category} onChange={e => setCategory(e.target.value)}
                    className="w-full border rounded px-2 py-1.5 mt-1">
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-medium">優先度 (1-10,越高越優先覆寫公規)</span>
          <input type="number" min="1" max="10" value={priority}
                 onChange={e => setPriority(e.target.value)}
                 className="w-24 border rounded px-2 py-1.5 mt-1" />
        </label>

        <label className="block">
          <span className="text-xs font-medium">附件上傳 (PDF/Word/圖片)</span>
          <input type="file" multiple accept=".pdf,.doc,.docx,.txt,image/*"
                 onChange={onPickFiles} className="block mt-1 text-sm" />
          <p className="text-[10px] text-slate-400 mt-1">PDF 會自動抽取文字到下方內容欄</p>
          {attachments.length > 0 && (
            <div className="text-xs mt-1 text-green-600">已上傳 {attachments.length} 個檔案</div>
          )}
        </label>

        <label className="block">
          <span className="text-xs font-medium">規則內容 * (AI 直接讀這段)</span>
          <textarea value={content} onChange={e => setContent(e.target.value)} required
                    rows={10}
                    placeholder="例:&#10;1. 客房最低面積 12 m² (含衛浴)&#10;2. 雙人房床墊規格 200×150&#10;3. 浴室必須採乾濕分離..."
                    className="w-full border rounded px-2 py-1.5 mt-1 font-mono text-xs" />
        </label>

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
