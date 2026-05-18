import { useNavigate, useLocation } from 'react-router-dom'
import { usePlanStore } from '../store/planStore.js'
import { supabase } from '../lib/supabase.js'
import { exportCanvasToPng } from '../lib/exportPng.js'

/**
 * 編輯器頂部「全寬動作列」— 酷家樂風,所有重要動作集中。
 * 取代各頁面零散的按鈕,讓使用者隨時找得到工具。
 */
export default function TopActionBar() {
  const nav = useNavigate()
  const location = useLocation()
  const meta = usePlanStore(s => s.meta)
  const plan = usePlanStore(s => s.plan)
  const planId = usePlanStore(s => s.planId)
  const saving = usePlanStore(s => s.saving)
  const undo = usePlanStore(s => s.undo)
  const redo = usePlanStore(s => s.redo)
  const setPlan = usePlanStore(s => s.setPlan)
  const history = usePlanStore(s => s.history)

  const canUndo = history.pointer > 0
  const canRedo = history.pointer < history.stack.length - 1
  const isOnEditor = location.pathname.endsWith('/editor')

  async function exportPng() {
    try { await exportCanvasToPng(`${meta?.title || 'plan'}.png`, 2) }
    catch (e) { alert(e.message) }
  }

  async function saveAsCopy() {
    const t = prompt('複製成新方案,名稱?', `${meta.title || '方案'} (複本)`)
    if (!t) return
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('plans').insert({
      owner: user.id, title: t, floor_label: meta.floor_label, data: plan
    }).select().single()
    if (error) { alert(error.message); return }
    nav(`/plan/${data.id}/editor`)
  }

  function clearAll() {
    if (!confirm('清空畫布上所有牆/門/窗/空間/家具/結構柱?(底圖與樓層保留)')) return
    setPlan({ ...plan, walls: [], doors: [], windows: [], spaces: [], rooms: [], furniture: [], structuralColumns: [] })
  }

  return (
    <div className="h-11 bg-white border-b flex items-center px-3 gap-1 text-xs shrink-0">
      {/* 檔案 */}
      <Group>
        <Btn icon="📂" label="另存" onClick={saveAsCopy} tooltip="複製成新方案" />
        <Btn icon="📷" label="匯出 PNG" onClick={exportPng} tooltip="把當下畫面下載成 PNG" />
      </Group>

      <Divider />

      {/* 撤銷重做 */}
      <Group>
        <Btn icon="↶" label="撤銷" onClick={undo} disabled={!canUndo} tooltip="⌘Z" />
        <Btn icon="↷" label="重做" onClick={redo} disabled={!canRedo} tooltip="⌘⇧Z" />
      </Group>

      <Divider />

      {/* 清空 */}
      <Group>
        <Btn icon="🗑" label="清空" onClick={clearAll} tooltip="清空畫布所有元素" danger />
      </Group>

      <Divider />

      {/* AI / 工具 */}
      <Group>
        <Btn icon="🤖" label="AI 規劃" onClick={() => isOnEditor ? null : nav(`/plan/${planId}/editor`)}
             tooltip="到 2D 編輯頁跟 AI 對話" highlight />
        <Btn icon="🎨" label="渲染" onClick={() => nav(`/plan/${planId}/render`)} tooltip="生成擬真渲染圖" />
        <Btn icon="🏗" label="3D" onClick={() => nav(`/plan/${planId}/3d`)} tooltip="全螢幕 3D 預覽" />
        <Btn icon="📋" label="採購" onClick={() => nav(`/plan/${planId}/bom`)} tooltip="家具/建材清單+預算" />
        <Btn icon="📄" label="匯出" onClick={() => nav(`/plan/${planId}/docs`)} tooltip="PDF / DWG 報告" />
      </Group>

      <div className="ml-auto flex items-center gap-2 text-slate-500 text-[10px]">
        <span className="inline-flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${saving ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
          {saving ? '儲存中…' : '已儲存到雲端'}
        </span>
      </div>
    </div>
  )
}

function Group({ children }) {
  return <div className="flex items-center gap-0.5">{children}</div>
}
function Divider() {
  return <span className="w-px h-5 bg-slate-200 mx-1.5" />
}
function Btn({ icon, label, onClick, disabled, tooltip, danger, highlight }) {
  return (
    <button onClick={onClick} disabled={disabled} title={tooltip}
            className={`px-2 py-1 rounded flex items-center gap-1 ${
              disabled ? 'opacity-30 cursor-not-allowed' :
              danger ? 'hover:bg-red-50 text-red-600' :
              highlight ? 'bg-brand-50 text-brand-700 hover:bg-brand-100' :
              'hover:bg-slate-100 text-slate-700'
            }`}>
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
