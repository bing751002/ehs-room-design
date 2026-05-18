import { useEffect, useRef, useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { chatWithClaude, parsePlanActions, claudeReady } from '../lib/claudeApi.js'
import { newId, newWallId, newDoorId, newWindowId, newSpaceId } from '../lib/constraints.js'
import { searchSimilarCases, caseToPromptText } from '../lib/caseLibrary.js'
import { listRules, rulesToPromptText } from '../lib/internalRules.js'
import { loadChatHistory, appendChatMessage, clearChatHistory } from '../lib/chatHistory.js'
import { createRoomTemplate } from '../lib/roomTemplates.js'
import { spaceVertices } from '../lib/constraints.js'

/**
 * 右側 AI 對話面板 — 仿 illoca 的 Agent 風格
 * - 預設快速按鈕 (東森常用場景)
 * - 上傳底圖會自動帶入 Claude Vision
 * - 回應裡的 ```plan-action 自動套用到 planStore
 */

const QUICK_PROMPTS = [
  { label: '規劃 30 人辦公室', prompt: '請在底圖上規劃一個 30 人的辦公空間,包含 2 間中型會議室、1 間茶水間、1 間休息區。動線要順,主入口靠近電梯廳。' },
  { label: '設計 SPA / 三溫暖區', prompt: '依照目前底圖規劃一個高端 SPA 區,包含三溫暖室、淋浴間 3 間、更衣室、休息區。風格走五星飯店日式禪意。' },
  { label: '酒店客房層配置', prompt: '請參考目前底圖規劃酒店標準客房層,客房數量請依照可用區自動估算,加上 1 個布草間、1 個服務員工作站。' },
  { label: '健身房規劃', prompt: '規劃健身房,包含有氧區、重訓區、團體教室、更衣淋浴區。設備擺放要符合運動安全距離。' },
  { label: '幫我看底圖告訴我這層有什麼', prompt: '請看我上傳的底圖,告訴我這個樓層的結構特徵 (柱位、可用區、開口、走道),並建議適合做什麼用途。' }
]

export default function ChatPanel() {
  const plan = usePlanStore(s => s.plan)
  const setPlan = usePlanStore(s => s.setPlan)
  const planId = usePlanStore(s => s.planId)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  // 載入該 plan 的對話歷史 (切換方案時自動載入)
  useEffect(() => {
    if (!planId) return
    let cancelled = false
    loadChatHistory(planId).then(hist => {
      if (!cancelled && hist?.length) setMessages(hist)
    }).catch(e => console.warn(e))
    return () => { cancelled = true }
  }, [planId])

  async function send(text, opts = {}) {
    if (!text.trim() || busy) return
    setErr('')
    const userMsg = { role: 'user', content: text, verbose: opts.verbose }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setBusy(true)
    // 存 user 訊息到雲端 (背景,不阻塞)
    appendChatMessage(planId, userMsg).catch(e => console.warn(e))
    try {
      const baseLayerImageUrl = plan.baseLayer?.type === 'pdf'
        ? plan.baseLayer.previewUrl
        : (plan.baseLayer?.type === 'image' ? plan.baseLayer.publicUrl : null)

      // 內部規則:全部 active 規則塞進 prompt
      let rulesContext = ''
      try {
        const rules = await listRules({ activeOnly: true })
        rulesContext = rulesToPromptText(rules)
      } catch (e) { console.warn('內部規則讀取失敗', e) }

      // 房間庫:把使用者自訂的房型塞進 prompt,AI 規劃時優先用這些
      let templatesContext = ''
      try {
        const { listRoomTemplates } = await import('../lib/roomTemplates.js')
        const ts = await listRoomTemplates()
        if (ts.length) {
          templatesContext = '\n\n# 📚 使用者自訂房間庫 (規劃時優先使用這些尺寸與設計考量):\n' +
            ts.slice(0, 30).map(t => `- ${t.name} [${t.type}] ${t.width_cm}×${t.depth_cm}×${t.height_cm}cm${t.description ? ' — ' + t.description : ''}`).join('\n')
        }
      } catch (e) { console.warn('房間庫讀取失敗', e) }

      // RAG:依使用者最新訊息粗略抓關鍵字當類型,從案例庫撈相近案例給 AI 當參考
      let casesContext = ''
      try {
        const lowered = text.toLowerCase()
        const detected = []
        const map = { '辦公':'office', '會議':'meeting', '茶水':'pantry', '健身':'gym', 'spa':'sauna',
                      '三溫暖':'sauna', '淋浴':'shower', '更衣':'locker', '休息':'lounge',
                      '酒店':'lounge', '客房':'lounge', '餐廳':'pantry', '電競':'gym', '診所':'meeting' }
        for (const [k, v] of Object.entries(map)) if (lowered.includes(k)) detected.push(v)
        if (detected.length) {
          const top = await searchSimilarCases({ spaceTypes: detected, topK: 3 })
          if (top.length) {
            casesContext = '\n\n# 📚 相關歷史案例 (從東森案例庫檢索,作為設計依據參考):\n' +
                            top.map(x => caseToPromptText(x.case)).join('\n\n')
          }
        }
      } catch (e) { console.warn('案例庫檢索失敗', e) }

      const reply = await chatWithClaude(
        newMessages.map(m => ({ role: m.role, content: m.content })),
        { plan, baseLayerImageUrl, verbose: opts.verbose, casesContext, rulesContext, templatesContext }
      )

      const { text: cleanText, actions } = parsePlanActions(reply)
      const asstMsg = { role: 'assistant', content: cleanText || '(已套用變更到畫布)', actions }
      setMessages(m => [...m, asstMsg])
      appendChatMessage(planId, asstMsg).catch(e => console.warn(e))

      // 套用 AI 給的 plan-action
      for (const act of actions) applyAction(act)
    } catch (ex) {
      console.error(ex)
      setErr(ex.message || 'AI 呼叫失敗')
    } finally {
      setBusy(false)
    }
  }

  function applyAction(act) {
    const cur = usePlanStore.getState().plan

    // 新世代:一次覆蓋所有 CAD 元素
    // spaces 是主體 (多邊形),牆會自動由空間邊產生;legacy walls 仍可選用
    if (act.action === 'set_full') {
      // 先建 spaces (拿到 id 才能對應 doors/windows 的 spaceIndex)
      const spaces = (act.spaces || []).map(s => {
        const sp = { id: newSpaceId(), height: 280, color: '#e2e8f0', wallKind: 'interior', wallThickness: 12, ...s }
        // 若給的是 vertices 就用 vertices,否則保留 x,y,w,h (會在 spaceVertices 自動轉)
        return sp
      })
      const spaceByIdx = spaces.map(s => s.id)

      // legacy walls (大多不用,只有真的「孤立的牆」才會給)
      const walls = (act.walls || []).map(w => ({ id: newWallId(), thickness: 12, kind: 'interior', ...w }))
      const wallByIdx = walls.map(w => w.id)

      // doors:可用 spaceIndex + edgeIndex,或 wallIndex(legacy),或 wallId/spaceId(已存在)
      const doors = (act.doors || []).map(d => {
        const id = newDoorId()
        let wallId = d.wallId
        if (!wallId && d.spaceId != null && d.edgeIndex != null) {
          wallId = `edge-${d.spaceId}-${d.edgeIndex}`
        } else if (!wallId && d.spaceIndex != null && d.edgeIndex != null) {
          const spId = spaceByIdx[d.spaceIndex]
          if (spId) wallId = `edge-${spId}-${d.edgeIndex}`
        } else if (!wallId && d.wallIndex != null) {
          wallId = wallByIdx[d.wallIndex]
        }
        return { id, width: 90, swing: 'in-right', t: 0.5, ...d, wallId }
      }).filter(d => d.wallId)

      const windows = (act.windows || []).map(w => {
        const id = newWindowId()
        let wallId = w.wallId
        if (!wallId && w.spaceId != null && w.edgeIndex != null) {
          wallId = `edge-${w.spaceId}-${w.edgeIndex}`
        } else if (!wallId && w.spaceIndex != null && w.edgeIndex != null) {
          const spId = spaceByIdx[w.spaceIndex]
          if (spId) wallId = `edge-${spId}-${w.edgeIndex}`
        } else if (!wallId && w.wallIndex != null) {
          wallId = wallByIdx[w.wallIndex]
        }
        return { id, width: 150, t: 0.5, sillHeight: 90, ...w, wallId }
      }).filter(w => w.wallId)

      setPlan({ ...cur, walls, doors, windows, spaces, rooms: [] })
      return
    }

    if (act.action === 'add_wall' && act.wall) {
      const w = { id: newWallId(), thickness: 12, kind: 'interior', ...act.wall }
      setPlan({ ...cur, walls: [...(cur.walls || []), w] })
    } else if (act.action === 'add_door' && act.door) {
      const d = { id: newDoorId(), width: 90, swing: 'in-right', t: 0.5, ...act.door }
      setPlan({ ...cur, doors: [...(cur.doors || []), d] })
    } else if (act.action === 'add_window' && act.window) {
      const w = { id: newWindowId(), width: 150, t: 0.5, sillHeight: 90, ...act.window }
      setPlan({ ...cur, windows: [...(cur.windows || []), w] })
    } else if (act.action === 'add_space' && act.space) {
      const sp = { id: newSpaceId(), height: 280, color: '#e2e8f0', ...act.space }
      setPlan({ ...cur, spaces: [...(cur.spaces || []), sp] })
    } else if (act.action === 'update_space' && act.name && act.patch) {
      setPlan({
        ...cur,
        spaces: (cur.spaces || []).map(s => s.name === act.name ? { ...s, ...act.patch } : s)
      })
    }
    // 舊版相容
    else if (act.action === 'set_rooms' && Array.isArray(act.rooms)) {
      const rooms = act.rooms.map(r => ({ id: newId('room'), height: 280, ...r }))
      setPlan({ ...cur, rooms })
    } else if (act.action === 'add_room' && act.room) {
      setPlan({ ...cur, rooms: [...cur.rooms, { id: newId('room'), height: 280, ...act.room }] })
    } else if (act.action === 'update_room' && act.name && act.patch) {
      setPlan({
        ...cur,
        rooms: cur.rooms.map(r => r.name === act.name ? { ...r, ...act.patch } : r)
      })
    } else if (act.action === 'set_furniture' && Array.isArray(act.furniture)) {
      const furniture = act.furniture.map(f => ({ id: newId('furn'), rot: 0, height: 80, ...f }))
      setPlan({ ...cur, furniture })
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
        <a href="https://console.anthropic.com" target="_blank" rel="noreferrer"
           className="text-brand-700 underline">前往 console.anthropic.com 申請 →</a>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b flex items-center justify-between bg-slate-50">
        <div>
          <div className="text-sm font-semibold">🤖 規劃助手</div>
          <div className="text-[10px] text-slate-500">由 Claude 提供 · 內部用</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {plan.spaces?.length > 0 && (
            <button onClick={async () => {
              if (!confirm(`把目前畫布上的 ${plan.spaces.length} 個空間都存到房間庫?(下次規劃時可重用)`)) return
              let ok = 0
              for (const sp of plan.spaces) {
                try {
                  const vs = spaceVertices(sp)
                  const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
                  const w = Math.round(Math.max(...xs) - Math.min(...xs))
                  const h = Math.round(Math.max(...ys) - Math.min(...ys))
                  await createRoomTemplate({
                    name: sp.name || '空間',
                    type: sp.type || 'custom',
                    category: 'AI 建議',
                    width_cm: w, depth_cm: h,
                    height_cm: sp.height || 280,
                    color: sp.color || '#e2e8f0',
                    description: sp.rationale || '',
                    source: 'ai_chat'
                  })
                  ok++
                } catch (e) { console.warn('存房型失敗', e) }
              }
              alert(`已存 ${ok} 個房型到房間庫`)
            }}
                    title="把畫布上所有空間存到房間庫供之後重用"
                    className="text-emerald-600 hover:underline">
              📚 加入房間庫
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={() => {
              if (confirm('清除這個方案的所有 AI 對話歷史?(雲端也會清掉)')) {
                setMessages([])
                clearChatHistory(planId).catch(e => console.warn(e))
              }
            }}
                    className="text-slate-500 hover:text-slate-800">清除</button>
          )}
        </div>
      </div>

      {/* 對話訊息區 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-slate-600 text-xs leading-relaxed">
              👋 你好。我會看你上傳的底圖,依需求在畫布上提房間配置。
              先點下面的快速範本,或直接打字告訴我你要什麼。
            </p>
            <div className="space-y-1.5">
              {QUICK_PROMPTS.map(q => (
                <button key={q.label} onClick={() => send(q.prompt)}
                        className="w-full text-left px-3 py-2 rounded border hover:bg-slate-50 text-xs">
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} group`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-lg whitespace-pre-wrap leading-relaxed
                ${m.role === 'user' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-800'}`}>
              {m.content}
              {m.actions?.length > 0 && (
                <div className="mt-1.5 text-[10px] opacity-70">
                  ✓ 已套用 {m.actions.length} 項變更到畫布
                </div>
              )}
            </div>
            <div className="flex gap-1 mt-0.5 text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">
              <button onClick={() => navigator.clipboard.writeText(m.content)}
                      title="複製文字" className="hover:text-slate-700">📋 複製</button>
              {m.role === 'assistant' && i > 0 && (
                <button onClick={() => {
                  // 找上一個 user 訊息,重新送一次 (略過 i 之後的)
                  const prevUser = messages.slice(0, i).reverse().find(x => x.role === 'user')
                  if (prevUser) {
                    setMessages(messages.slice(0, messages.findIndex(x => x === prevUser)))
                    send(prevUser.content, { verbose: prevUser.verbose })
                  }
                }} title="重新生成這個回覆" className="hover:text-slate-700">🔄 再生成</button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-slate-100 px-3 py-2 rounded-lg text-slate-500 text-xs">思考中…</div>
          </div>
        )}
        {err && <div className="text-red-600 text-xs">{err}</div>}
      </div>

      {/* 輸入區 */}
      <div className="border-t p-2">
        <form onSubmit={e => { e.preventDefault(); send(input) }} className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
            }}
            placeholder="告訴我你要規劃什麼…(Shift+Enter 換行)"
            rows={2}
            className="flex-1 border rounded px-2 py-1.5 text-sm resize-none focus:outline-brand-700" />
          <div className="flex flex-col gap-1 self-end">
            <button type="submit" disabled={busy || !input.trim()}
                    className="px-3 py-1.5 rounded bg-brand-700 text-white text-sm hover:bg-brand-500 disabled:opacity-40">
              送出
            </button>
            <button type="button" disabled={busy || !input.trim()}
                    onClick={() => send(input, { verbose: true })}
                    title="顯示 AI 完整推理 (Stage 1 + Stage 2)"
                    className="px-2 py-1 rounded bg-slate-700 text-white text-[10px] hover:bg-slate-600 disabled:opacity-40">
              📋 詳細規劃
            </button>
          </div>
        </form>
        {plan.baseLayer && (
          <div className="text-[10px] text-slate-400 mt-1">
            🖼 已附上底圖讓 AI 看 ({plan.baseLayer.filename})
          </div>
        )}
      </div>
    </div>
  )
}
