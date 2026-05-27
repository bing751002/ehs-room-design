import { useEffect, useMemo, useState } from 'react'
import BaseAgentChat from './BaseAgentChat.jsx'
import {
  listThreads, deleteThread, renameThread, createThreadId
} from '../../lib/agentChats.js'

/**
 * Agent 頁面共用佈局:左側 thread 清單 + 右側對話框 + 頂部 toolbar
 *
 * props: 大部分 forward 給 BaseAgentChat,額外有:
 *  - title: 頁標題 (e.g. "🔍 圖面審查")
 *  - subtitle: 副標 (e.g. "跑照建築師 + 防綜顧問")
 *  - agentType: 'audit' | 'critique'
 *  - extraToolbar?: ({thread, messages}) => ReactNode (給「列印報告」按鈕)
 */
export default function AgentPageLayout({
  title, subtitle, agentType,
  systemPrompt, quickPrompts, ragOptions,
  renderAssistantExtras, parseAssistantMetadata,
  placeholder, emptyHint,
  extraToolbar
}) {
  const [threads, setThreads] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [currentTitle, setCurrentTitle] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { refreshThreads() }, [agentType])

  async function refreshThreads() {
    setLoading(true)
    try {
      const ts = await listThreads(agentType)
      setThreads(ts)
      // 預設選最近一筆;若都沒有,自動建一個新 thread
      if (ts.length && !currentId) {
        setCurrentId(ts[0].thread_id)
        setCurrentTitle(ts[0].thread_title || formatDate(ts[0].created_at))
      } else if (!ts.length) {
        startNewThread()
      }
    } finally { setLoading(false) }
  }

  function startNewThread() {
    const id = createThreadId()
    const title = `${formatDate(new Date())} 新審查`
    setCurrentId(id)
    setCurrentTitle(title)
    setMessages([])
  }

  async function onDeleteThread(threadId) {
    if (!confirm('確定要刪除這次審查紀錄嗎?')) return
    await deleteThread(threadId)
    if (threadId === currentId) {
      setCurrentId(null)
      setMessages([])
    }
    await refreshThreads()
  }

  async function onRenameThread(threadId, oldTitle) {
    const next = prompt('改個對話標題:', oldTitle || '')
    if (next == null) return
    await renameThread(threadId, next)
    if (threadId === currentId) setCurrentTitle(next)
    await refreshThreads()
  }

  const currentThreadMeta = useMemo(
    () => threads.find(t => t.thread_id === currentId),
    [threads, currentId]
  )

  return (
    <div className="flex h-[calc(100vh-3rem)] bg-white">
      {/* 左側 thread 列表 */}
      <aside className="w-64 border-r flex flex-col bg-slate-50">
        <div className="p-3 border-b">
          <div className="font-semibold text-sm">{title}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>
          <button onClick={startNewThread}
                  className="mt-2 w-full text-xs px-2 py-1.5 rounded bg-brand-700 text-white hover:bg-brand-500">
            + 開始新審查
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-3 text-xs text-slate-400">載入中…</div>}
          {!loading && !threads.length && (
            <div className="p-3 text-xs text-slate-400">尚無歷史紀錄。上傳第一張圖就會自動建立。</div>
          )}
          {threads.map(t => (
            <div key={t.thread_id}
                 className={`px-3 py-2 cursor-pointer border-b text-xs group ${
                   currentId === t.thread_id ? 'bg-brand-100 border-l-2 border-l-brand-700' : 'hover:bg-slate-100'
                 }`}
                 onClick={() => {
                   setCurrentId(t.thread_id)
                   setCurrentTitle(t.thread_title || formatDate(t.created_at))
                 }}>
              <div className="font-medium truncate">{t.thread_title || '(未命名)'}</div>
              <div className="text-[10px] text-slate-500 mt-0.5 flex justify-between">
                <span>{formatDate(t.last_msg_at)} · {t.msg_count} 訊息</span>
                <span className="opacity-0 group-hover:opacity-100 flex gap-1">
                  <button onClick={(e) => { e.stopPropagation(); onRenameThread(t.thread_id, t.thread_title) }}
                          title="改標題" className="hover:text-brand-700">✎</button>
                  <button onClick={(e) => { e.stopPropagation(); onDeleteThread(t.thread_id) }}
                          title="刪除" className="hover:text-red-600">🗑</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 右側對話區 */}
      <div className="flex-1 flex flex-col">
        {/* 頂部 toolbar */}
        <div className="px-4 py-2 border-b flex items-center justify-between bg-white">
          <div>
            <input
              value={currentTitle}
              onChange={e => setCurrentTitle(e.target.value)}
              onBlur={() => currentId && currentThreadMeta && renameThread(currentId, currentTitle).then(refreshThreads)}
              className="text-sm font-medium bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-700 focus:outline-none px-1"
              placeholder="輸入這次審查的標題…"
            />
            <div className="text-[10px] text-slate-500 mt-0.5">
              {messages.length > 0 ? `${messages.length} 則訊息` : '尚未開始對話'}
            </div>
          </div>
          {extraToolbar?.({ threadId: currentId, threadTitle: currentTitle, messages })}
        </div>

        {/* 對話框 */}
        {currentId && (
          <div className="flex-1 overflow-hidden">
            <BaseAgentChat
              agentType={agentType}
              threadId={currentId}
              threadTitle={currentTitle}
              systemPrompt={systemPrompt}
              quickPrompts={quickPrompts}
              ragOptions={ragOptions}
              renderAssistantExtras={renderAssistantExtras}
              parseAssistantMetadata={parseAssistantMetadata}
              placeholder={placeholder}
              emptyHint={emptyHint}
              onMessagesChange={setMessages}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function formatDate(d) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
