import { Suspense, useState, useMemo } from 'react'
import Canvas3D from '../components/Canvas3D.jsx'
import { usePlanStore } from '../store/planStore.js'
import { spaceVertices, polygonCenter } from '../lib/constraints.js'

/**
 * 全螢幕 3D 預覽 + 浮動工具列
 *  - 切換俯瞰 / 透視 / 漫遊
 *  - 漫遊模式可「傳送到指定空間」
 */
export default function View3DPage() {
  const [viewMode, setViewMode] = useState('orbit')   // 'orbit' | 'topdown' | 'walk'
  const [teleportTarget, setTeleportTarget] = useState(null)
  const plan = usePlanStore(s => s.plan)

  const spaces = plan.spaces || []
  // 把每個空間算中心 (cm),用來傳送
  const spaceCenters = useMemo(() => spaces.map(sp => {
    const vs = spaceVertices(sp)
    const c = polygonCenter(vs)
    return { id: sp.id, name: sp.name || '(未命名)', type: sp.type, x: c.x, y: c.y }
  }), [JSON.stringify(spaces)])

  function changeMode(mode) {
    setViewMode(mode)
    setTeleportTarget(null)
  }

  function teleportToSpace(spaceId) {
    if (!spaceId) return
    const sc = spaceCenters.find(s => s.id === spaceId)
    if (!sc) return
    if (viewMode !== 'walk') setViewMode('walk')
    setTeleportTarget({ x: sc.x, y: sc.y })
  }

  return (
    <div className="relative h-full w-full">
      {/* 浮動工具列 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10
                      flex items-center gap-2 bg-white/95 backdrop-blur rounded-full
                      shadow-lg border border-slate-200 px-2 py-1.5 text-xs">
        <ModeBtn active={viewMode === 'topdown'} onClick={() => changeMode('topdown')}
                 icon="👁" label="俯瞰" />
        <ModeBtn active={viewMode === 'orbit'} onClick={() => changeMode('orbit')}
                 icon="🎥" label="透視" />
        <ModeBtn active={viewMode === 'walk'} onClick={() => changeMode('walk')}
                 icon="🚶" label="漫遊" />

        {spaces.length > 0 && (
          <div className="border-l pl-2 ml-1 flex items-center gap-1">
            <span className="text-slate-500">傳送到</span>
            <select
              value=""
              onChange={(e) => { teleportToSpace(e.target.value); e.target.value = '' }}
              className="text-xs border rounded px-1.5 py-1 bg-white">
              <option value="">選空間…</option>
              {spaceCenters.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.type ? `(${s.type})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 操作說明 (右上) */}
      <div className="absolute top-3 right-3 z-10 bg-white/95 backdrop-blur
                      rounded-lg shadow border border-slate-200 px-3 py-2 text-[11px] text-slate-600 max-w-[280px]">
        {viewMode === 'orbit' && (
          <>🎥 <b>透視</b>:左鍵拖曳旋轉、右鍵拖曳平移、滾輪縮放</>
        )}
        {viewMode === 'topdown' && (
          <>👁 <b>俯瞰</b>:左/右鍵拖曳平移、滾輪縮放</>
        )}
        {viewMode === 'walk' && (
          <>🚶 <b>漫遊</b>:點畫面鎖定視角 → <b>WASD</b> 走動、滑鼠轉向、<b>Shift</b> 加速衝刺、<b>Esc</b> 解鎖</>
        )}
      </div>

      <Suspense fallback={<LoadingCanvas />}>
        <Canvas3D
          viewMode={viewMode}
          teleportTarget={teleportTarget}
          onTeleportDone={() => setTeleportTarget(null)}
        />
      </Suspense>
    </div>
  )
}

function ModeBtn({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick}
            className={`px-3 py-1 rounded-full transition-colors flex items-center gap-1
              ${active
                ? 'bg-brand-700 text-white shadow'
                : 'text-slate-700 hover:bg-slate-100'}`}>
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function LoadingCanvas() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-gradient-to-b from-sky-100 to-slate-50 text-slate-500 text-sm">
      載入 3D 場景中…
    </div>
  )
}
