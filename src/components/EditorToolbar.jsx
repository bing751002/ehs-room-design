import { usePlanStore } from '../store/planStore.js'
import { exportCanvasToPng } from '../lib/exportPng.js'

/**
 * 編輯器主工具列 — Figma 風極簡。
 * 模式:select / measure / add-wall / add-door / add-window / add-space
 * 加上撤銷/重做。
 */
const TOOLS = [
  { mode: 'select',     icon: '↖',  label: '選取', shortcut: 'V' },
  { mode: 'add-wall',   icon: '│',  label: '牆',   shortcut: 'W' },
  { mode: 'add-door',   icon: '⛌',  label: '門',   shortcut: 'D' },
  { mode: 'add-window', icon: '⊞',  label: '窗',   shortcut: 'N' },
  { mode: 'add-space',  icon: '▭',  label: '空間', shortcut: 'R' },
  { mode: 'add-column', icon: '▪',  label: '柱',   shortcut: 'C' },
  { mode: 'measure',    icon: '📏', label: '量距', shortcut: 'M' }
]

export default function EditorToolbar() {
  const editMode = usePlanStore(s => s.editMode)
  const setEditMode = usePlanStore(s => s.setEditMode)
  const undo = usePlanStore(s => s.undo)
  const redo = usePlanStore(s => s.redo)
  const history = usePlanStore(s => s.history)
  const meta = usePlanStore(s => s.meta)
  const canUndo = history.pointer > 0
  const canRedo = history.pointer < history.stack.length - 1
  async function onExport() {
    try {
      await exportCanvasToPng(`${meta?.title || 'plan'}.png`)
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="flex items-center gap-1 bg-white border rounded shadow-sm px-1.5 py-1 text-xs">
      <button onClick={undo} disabled={!canUndo}
              title="撤銷 (⌘Z)"
              className="px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-30">↶</button>
      <button onClick={redo} disabled={!canRedo}
              title="重做 (⌘⇧Z)"
              className="px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-30">↷</button>
      <span className="w-px h-5 bg-slate-200 mx-1" />
      {TOOLS.map(t => (
        <button key={t.mode}
                onClick={() => setEditMode(t.mode)}
                title={`${t.label} (${t.shortcut})`}
                className={`px-2 py-1 rounded flex items-center gap-1 ${
                  editMode === t.mode ? 'bg-brand-700 text-white' : 'hover:bg-slate-100'
                }`}>
          <span>{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
      <span className="w-px h-5 bg-slate-200 mx-1" />
      <button onClick={onExport} title="匯出畫布為 PNG"
              className="px-2 py-1 rounded hover:bg-slate-100">📷 匯出 PNG</button>
    </div>
  )
}
