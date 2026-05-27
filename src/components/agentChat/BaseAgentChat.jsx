import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatWithClaude, claudeReady } from '../../lib/claudeApi.js'
import { buildRAGContext } from '../../lib/chatContext.js'
import { extractForAI } from '../../lib/fileExtract.js'
import {
  loadThread, appendMessage, uploadAgentAttachment
} from '../../lib/agentChats.js'
import { createRule } from '../../lib/internalRules.js'

// Markdown 渲染元件 — 表格、checklist、emoji 都能正確顯示
function AssistantMarkdown({ children }) {
  return (
    <div className="prose-agent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...p }) => <h1 className="text-base font-bold mt-3 mb-1.5 text-slate-900 border-b pb-1" {...p} />,
          h2: ({ node, ...p }) => <h2 className="text-sm font-bold mt-3 mb-1 text-slate-900" {...p} />,
          h3: ({ node, ...p }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-slate-800" {...p} />,
          p:  ({ node, ...p }) => <p className="my-1.5 leading-relaxed" {...p} />,
          ul: ({ node, ...p }) => <ul className="list-disc ml-5 my-1.5 space-y-0.5" {...p} />,
          ol: ({ node, ...p }) => <ol className="list-decimal ml-5 my-1.5 space-y-0.5" {...p} />,
          li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
          strong: ({ node, ...p }) => <strong className="font-semibold text-slate-900" {...p} />,
          em: ({ node, ...p }) => <em className="text-slate-700" {...p} />,
          code: ({ node, inline, ...p }) => inline
            ? <code className="bg-slate-100 px-1 py-0.5 rounded text-[12px] text-rose-700" {...p} />
            : <code className="block bg-slate-100 p-2 rounded text-[12px] overflow-x-auto" {...p} />,
          blockquote: ({ node, ...p }) => <blockquote className="border-l-4 border-amber-300 pl-3 my-2 text-slate-600 bg-amber-50/50 py-1" {...p} />,
          table: ({ node, ...p }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse border border-slate-300" {...p} /></div>,
          thead: ({ node, ...p }) => <thead className="bg-slate-100" {...p} />,
          th: ({ node, ...p }) => <th className="border border-slate-300 px-2 py-1 text-left font-semibold" {...p} />,
          td: ({ node, ...p }) => <td className="border border-slate-300 px-2 py-1 align-top" {...p} />,
          hr: ({ node, ...p }) => <hr className="my-3 border-slate-200" {...p} />,
          a: ({ node, ...p }) => <a className="text-brand-700 underline" target="_blank" rel="noreferrer" {...p} />
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

/**
 * 共用 Agent 對話框 — 給 /audit (審圖) 與 /critique (設計評估) 兩個 Agent 用
 *
 * props:
 *  - agentType: 'audit' | 'critique'
 *  - threadId: 當前對話 thread uuid
 *  - threadTitle: 對話標題 (新建 thread 第一則訊息用)
 *  - systemPrompt: string — 取代規劃師 system prompt
 *  - quickPrompts: [{ label, prompt }]
 *  - ragOptions: { includeRules, includeRegs, includeCases, includeTemplates }
 *  - renderAssistantExtras?: (msg) => ReactNode — 額外渲染 (例如 ScoreCard)
 *  - placeholder?: string
 *  - emptyHint?: string
 *  - onMessagesChange?: (messages) => void — 父層想拿訊息列表 (列印報告用)
 */
export default function BaseAgentChat({
  agentType,
  threadId,
  threadTitle,
  systemPrompt,
  quickPrompts = [],
  ragOptions = {},
  renderAssistantExtras,
  placeholder = '把設計師寄來的圖拖進來,或直接打字告訴我要審什麼…(Shift+Enter 換行)',
  emptyHint,
  parseAssistantMetadata,
  onMessagesChange
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [correctionTarget, setCorrectionTarget] = useState(null)   // 要標記為錯誤的 AI 訊息
  const [extracting, setExtracting] = useState(false)              // AI 自動抽取錯誤中
  const [err, setErr] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState([])
  const [extractingFile, setExtractingFile] = useState(null)
  const fileInputRef = useRef(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  // 切換 thread 時載入訊息
  useEffect(() => {
    if (!threadId) { setMessages([]); return }
    let cancelled = false
    loadThread(threadId).then(hist => {
      if (!cancelled) setMessages(hist || [])
    }).catch(e => console.warn(e))
    return () => { cancelled = true }
  }, [threadId])

  // 訊息變動時通知父層
  useEffect(() => { onMessagesChange?.(messages) }, [messages, onMessagesChange])

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setErr('')
    const newAtts = []
    for (const file of files) {
      setExtractingFile(file.name)
      try {
        const data = await extractForAI(file)
        // 同時上傳到 storage,留紀錄
        let uploaded = null
        try { uploaded = await uploadAgentAttachment(file, threadId) }
        catch (uex) { console.warn('附件上傳 storage 失敗 (僅本次可用)', uex) }
        newAtts.push({
          name: file.name, size: file.size, type: data.type,
          _data: data, _storage: uploaded
        })
      } catch (ex) {
        setErr(`處理 ${file.name} 失敗: ${ex.message}`)
      }
    }
    setExtractingFile(null)
    setPendingAttachments(p => [...p, ...newAtts])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeAttachment(idx) {
    setPendingAttachments(p => p.filter((_, i) => i !== idx))
  }

  async function send(text) {
    if ((!text.trim() && pendingAttachments.length === 0) || busy) return
    setInput('')
    const sendingAttachments = pendingAttachments
    setPendingAttachments([])
    setErr('')
    const userText = text.trim() || (sendingAttachments.length ? '請看附件,給我審查意見' : '')
    const storedAttachments = sendingAttachments
      .filter(a => a._storage)
      .map(a => a._storage)
    const userMsg = {
      role: 'user',
      content: userText,
      attachments: storedAttachments
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setBusy(true)
    // 第一則訊息時帶 threadTitle 註冊
    const isFirstMsg = messages.length === 0
    appendMessage(threadId, agentType, userMsg, isFirstMsg ? threadTitle : null)
      .catch(e => console.warn(e))

    try {
      const ragContext = await buildRAGContext(text, ragOptions)

      const reply = await chatWithClaude(
        newMessages.map(m => ({ role: m.role, content: m.content })),
        {
          systemPromptOverride: systemPrompt,
          ...ragContext,
          attachments: sendingAttachments.map(a => a._data)
        }
      )

      // 解析評分 metadata (CritiquePage 用)
      const metadata = parseAssistantMetadata?.(reply) || null
      const cleanText = metadata?.cleanText ?? reply

      const asstMsg = { role: 'assistant', content: cleanText, metadata: metadata?.data || null }
      setMessages(m => [...m, asstMsg])
      appendMessage(threadId, agentType, asstMsg).catch(e => console.warn(e))
    } catch (ex) {
      console.error(ex)
      setErr(ex.message || 'AI 呼叫失敗')
    } finally {
      setBusy(false)
    }
  }

  if (!claudeReady) {
    return (
      <div className="p-4 text-sm space-y-2">
        <div className="font-semibold">AI 助理未啟用</div>
        <p className="text-slate-600">
          請在 <code className="bg-slate-100 px-1 rounded">.env.local</code> 設定
          <code className="bg-slate-100 px-1 rounded mx-1">VITE_CLAUDE_API_KEY</code>
          後重啟 dev server。
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 對話訊息區 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 text-sm bg-slate-50">
        {messages.length === 0 && (
          <div className="space-y-3 max-w-2xl mx-auto">
            {emptyHint && (
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">{emptyHint}</p>
            )}
            {quickPrompts.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-slate-500 font-semibold">常用問題:</div>
                {quickPrompts.map(q => (
                  <button key={q.label} onClick={() => send(q.prompt)}
                          className="w-full text-left px-3 py-2 rounded border bg-white hover:bg-slate-100 text-xs">
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} group`}>
            <div className={`${m.role === 'user' ? 'max-w-[85%]' : 'max-w-[92%]'} px-4 py-3 rounded-lg leading-relaxed
                ${m.role === 'user' ? 'bg-brand-700 text-white whitespace-pre-wrap' : 'bg-white border text-slate-800 text-sm'}`}>
              {m.role === 'assistant'
                ? <AssistantMarkdown>{m.content}</AssistantMarkdown>
                : m.content}
              {m.attachments?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.attachments.map((a, j) => (
                    <a key={j} href={a.signed_url} target="_blank" rel="noreferrer"
                       className={`text-[10px] underline ${m.role === 'user' ? 'text-emerald-100' : 'text-emerald-700'}`}>
                      📎 {a.filename}
                    </a>
                  ))}
                </div>
              )}
            </div>
            {m.role === 'assistant' && renderAssistantExtras?.(m)}
            <div className="flex gap-2 mt-0.5 text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">
              <button onClick={() => navigator.clipboard.writeText(m.content)}
                      title="複製文字" className="hover:text-slate-700">📋 複製</button>
              {m.role === 'assistant' && (
                <button
                  onClick={() => setCorrectionTarget({
                    aiContent: m.content,
                    // 取最近一個 user 訊息當情境
                    userContext: [...messages.slice(0, i)].reverse().find(x => x.role === 'user')?.content || ''
                  })}
                  title="把這則錯誤寫進規則庫,下次不再犯"
                  className="hover:text-red-600">⚠️ 標記為錯誤,寫入規則庫</button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-white border px-3 py-2 rounded-lg text-slate-500 text-xs">思考中…</div>
          </div>
        )}
        {err && <div className="text-red-600 text-xs">{err}</div>}
      </div>

      {/* 輸入區 */}
      <div className="border-t p-3 bg-white">
        {pendingAttachments.length > 0 && (
          <div className="flex gap-1 mb-2 flex-wrap">
            {pendingAttachments.map((a, i) => (
              <span key={i}
                    className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] px-1.5 py-0.5 rounded">
                {a.type === 'image' ? '🖼' : '📎'}
                <span className="max-w-[160px] truncate" title={a.name}>{a.name}</span>
                <button onClick={() => removeAttachment(i)} className="hover:text-red-600 ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
        {extractingFile && (
          <div className="text-[10px] text-amber-600 mb-1">⏳ 處理 {extractingFile}…</div>
        )}

        <form onSubmit={e => { e.preventDefault(); send(input) }} className="flex gap-2">
          <input ref={fileInputRef} type="file" multiple onChange={onPickFiles} className="hidden"
                 accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.ppt,.pptx,.txt,.md,.jpg,.jpeg,.png,.webp,.gif,.bmp" />
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder={placeholder}
            rows={2}
            className="flex-1 border rounded px-2 py-1.5 text-sm resize-none focus:outline-brand-700" />
          <div className="flex flex-col gap-1 self-end">
            <button type="submit" disabled={busy || (!input.trim() && pendingAttachments.length === 0)}
                    className="px-3 py-1.5 rounded bg-brand-700 text-white text-sm hover:bg-brand-500 disabled:opacity-40">
              送出
            </button>
            <button type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy || extractingFile}
                    title="附加圖檔 (PDF/JPG/PNG/Word/Excel)"
                    className="px-2 py-1 rounded bg-emerald-600 text-white text-[10px] hover:bg-emerald-500 disabled:opacity-40">
              📎 附檔
            </button>
          </div>
        </form>
      </div>

      {/* 標記錯誤 → 寫入規則庫 Modal */}
      {correctionTarget && (
        <CorrectionModal
          aiContent={correctionTarget.aiContent}
          userContext={correctionTarget.userContext}
          extracting={extracting}
          setExtracting={setExtracting}
          onClose={() => setCorrectionTarget(null)}
          onSaved={(count) => {
            setCorrectionTarget(null)
            alert(`✅ 已寫入規則庫 ${count} 條,下次審查 AI 會自動參考`)
          }}
        />
      )}
    </div>
  )
}

/**
 * 標記錯誤 → 寫入規則庫 Modal
 *
 * 法規類規則沒有「優先順序」概念 — 全部都是鐵則,不能違反或寫錯。
 * 改以「分類」分組,並支援一次標記多條 (一則 AI 回應裡常常同時有多個錯)。
 */
const EMPTY_ITEM = () => ({
  title: '', errorText: '', correctText: '', applyWhen: '', category: '法規'
})

function CorrectionModal({ aiContent, userContext, extracting, setExtracting, onClose, onSaved }) {
  // items 陣列 — 一次可標記多條錯誤
  const [items, setItems] = useState([EMPTY_ITEM()])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function patchItem(idx, patch) {
    setItems(arr => arr.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  function addItem() {
    setItems(arr => [...arr, EMPTY_ITEM()])
  }
  function removeItem(idx) {
    setItems(arr => arr.length <= 1 ? arr : arr.filter((_, i) => i !== idx))
  }

  async function autoExtract() {
    setExtracting(true)
    setErr('')
    try {
      // 動態引入避免循環 import
      const { chatWithClaude } = await import('../../lib/claudeApi.js')
      const sys = `你是品管助理。使用者發現 AI 在審圖回應裡犯了 **可能不只一個** 錯誤 (引用錯法條、數值錯誤、引條號錯誤等)。

請從下方原始對話逐條找出**所有**錯誤,每條一個 JSON 物件,合起來放陣列。

每條欄位:
- title: 一句話標題 (20 字內,具體到條號數值)
- error: AI 講錯了什麼 (引用原文 2 行內)
- correct: 正確答案 (引法源 + 條文摘要 2-3 行,文字必須精確,不可有誤)
- when: 什麼情境會用到 (1 行)
- category: 法規 / 業態類組 / 消防 / 無障礙 / 公司規範 / 其他

如果整段 AI 回應沒有任何錯誤,回空陣列 []。

嚴格用以下 JSON 格式回應 (包在 \`\`\`json 區塊):
\`\`\`json
[
  { "title": "...", "error": "...", "correct": "...", "when": "...", "category": "法規" },
  { "title": "...", "error": "...", "correct": "...", "when": "...", "category": "法規" }
]
\`\`\``
      const reply = await chatWithClaude(
        [{
          role: 'user',
          content: `使用者提問:\n${userContext || '(無)'}\n\nAI 回應 (找出所有錯誤):\n${aiContent}\n\n請逐條萃取 JSON 陣列。`
        }],
        { systemPromptOverride: sys }
      )
      const m = reply.match(/```json\s*([\s\S]*?)\s*```/)
      if (!m) throw new Error('AI 沒有回 JSON 陣列格式,請手動填寫')
      const data = JSON.parse(m[1])
      if (!Array.isArray(data)) throw new Error('AI 回的不是陣列')
      if (data.length === 0) {
        setErr('AI 判斷此回應沒有錯誤,你仍可手動填寫一條')
        return
      }
      setItems(data.map(d => ({
        title: d.title || '',
        errorText: d.error || '',
        correctText: d.correct || '',
        applyWhen: d.when || '',
        category: d.category || '法規'
      })))
    } catch (ex) {
      setErr('自動萃取失敗: ' + ex.message)
    } finally {
      setExtracting(false)
    }
  }

  async function save() {
    // 驗證 — 每條至少要有 title 跟 correctText
    const valid = items.filter(it => it.title.trim() && it.correctText.trim())
    if (valid.length === 0) {
      setErr('至少要填一條完整的:標題 + 正確答案')
      return
    }
    if (valid.length < items.length) {
      if (!confirm(`有 ${items.length - valid.length} 條未填完整 (缺標題或正確答案),只儲存 ${valid.length} 條?`)) return
    }
    setSaving(true)
    setErr('')
    try {
      const today = new Date().toLocaleDateString('zh-TW')
      for (const it of valid) {
        const content = [
          `**⚠️ AI 易誤點**:${it.errorText || '(未填)'}`,
          `**✅ 正確說明**:${it.correctText}`,
          it.applyWhen ? `**🎯 適用情境**:${it.applyWhen}` : null,
          `\n_${today} 由審查對話糾正並記錄_`
        ].filter(Boolean).join('\n\n')
        await createRule({
          title: `🚨 ${it.title}`,
          category: it.category,
          content,
          priority: 0,        // 規則之間沒有優先順序,全部都是鐵則
          is_active: true
        })
      }
      onSaved?.(valid.length)
    } catch (ex) {
      setErr('儲存失敗: ' + ex.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-700/70 flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between bg-amber-50 flex-shrink-0">
          <div>
            <div className="font-semibold text-sm">⚠️ 標記錯誤並寫入規則庫</div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              法規類規則沒有先後高低,全部都是鐵則。一次可記錄多條,下次任何審查都會自動帶入 prompt。
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">✕</button>
        </div>

        <div className="p-4 space-y-3 text-sm overflow-y-auto flex-1">
          {/* AI 自動抽取按鈕 */}
          <div className="bg-blue-50 border border-blue-200 rounded p-3 flex items-center justify-between gap-3">
            <div className="text-xs text-blue-900 flex-1">
              💡 讓 AI 從本次對話自動萃取**所有**錯誤,你只需檢查/微調再儲存
            </div>
            <button
              onClick={autoExtract}
              disabled={extracting}
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-500 disabled:opacity-50 flex-shrink-0">
              {extracting ? '🤖 萃取中…' : '🤖 AI 自動萃取所有錯誤'}
            </button>
          </div>

          {/* 多條目編輯 */}
          {items.map((it, idx) => (
            <div key={idx} className="border border-amber-200 rounded-lg p-3 space-y-2 bg-amber-50/30">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-amber-900">
                  錯誤 #{idx + 1}
                </div>
                {items.length > 1 && (
                  <button onClick={() => removeItem(idx)}
                          className="text-[10px] text-red-600 hover:text-red-800">
                    🗑 移除這條
                  </button>
                )}
              </div>

              <Field label="標題 (一句話,具體到條號數值)">
                <input value={it.title}
                       onChange={e => patchItem(idx, { title: e.target.value })}
                       placeholder="例:§79 高層防火區劃 ≤1000m² (非 500m²)"
                       className="w-full border rounded px-2 py-1.5 text-sm" />
              </Field>

              <Field label="⚠️ AI 講錯了什麼">
                <textarea value={it.errorText}
                          onChange={e => patchItem(idx, { errorText: e.target.value })}
                          placeholder="AI 寫:高層建築防火區劃 ≤500m²"
                          rows={2}
                          className="w-full border rounded px-2 py-1.5 text-sm" />
              </Field>

              <Field label="✅ 正確答案 (必填,文字必須精確不可有誤)">
                <textarea value={it.correctText}
                          onChange={e => patchItem(idx, { correctText: e.target.value })}
                          placeholder="建築技術規則 §79:一般 ≤1500m²、高層 ≤1000m²、地下 ≤1000m²"
                          rows={3}
                          className="w-full border rounded px-2 py-1.5 text-sm" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="🎯 適用情境">
                  <input value={it.applyWhen}
                         onChange={e => patchItem(idx, { applyWhen: e.target.value })}
                         placeholder="問防火區劃面積上限時"
                         className="w-full border rounded px-2 py-1.5 text-sm" />
                </Field>
                <Field label="分類">
                  <select value={it.category}
                          onChange={e => patchItem(idx, { category: e.target.value })}
                          className="w-full border rounded px-2 py-1.5 text-sm">
                    <option>法規</option>
                    <option>業態類組</option>
                    <option>消防</option>
                    <option>無障礙</option>
                    <option>公司規範</option>
                    <option>其他</option>
                  </select>
                </Field>
              </div>
            </div>
          ))}

          {/* 加一條按鈕 */}
          <button onClick={addItem}
                  className="w-full py-2 border-2 border-dashed border-slate-300 rounded text-slate-500 text-xs hover:border-amber-400 hover:text-amber-700">
            + 再加一條錯誤
          </button>

          {/* 原始對話節錄 (折疊) */}
          <details className="text-xs text-slate-600 bg-slate-50 rounded p-2">
            <summary className="cursor-pointer">📜 原始對話 (參考)</summary>
            <div className="mt-2 space-y-2">
              <div><b>使用者:</b> <span className="whitespace-pre-wrap">{userContext || '(無)'}</span></div>
              <div><b>AI 回應:</b>
                <pre className="whitespace-pre-wrap font-sans text-[11px] bg-white p-2 rounded mt-1 max-h-40 overflow-y-auto">{aiContent}</pre>
              </div>
            </div>
          </details>

          {err && <div className="text-red-600 text-xs">{err}</div>}
        </div>

        <div className="px-4 py-3 border-t bg-slate-50 flex justify-between items-center gap-2 flex-shrink-0">
          <div className="text-[11px] text-slate-500">
            目前共 {items.length} 條,將儲存填完整的
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
                    className="px-3 py-1.5 rounded border text-sm hover:bg-slate-100">取消</button>
            <button onClick={save} disabled={saving}
                    className="px-3 py-1.5 rounded bg-red-600 text-white text-sm hover:bg-red-500 disabled:opacity-50">
              {saving ? '儲存中…' : '⚠️ 全部儲存到規則庫'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 font-medium mb-1">{label}</label>
      {children}
    </div>
  )
}
