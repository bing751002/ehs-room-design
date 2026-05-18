import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import ScaleCalibrator from './ScaleCalibrator.jsx'
import AiRecognizeButton from './AiRecognizeButton.jsx'

/**
 * 底圖編輯控制條 — 出現在畫布上方
 *  - 位置:上下左右移動 (按一次移 50cm,Shift+按 移 500cm)
 *  - 縮放:− / + (5% 一次,Shift 25% 一次)
 *  - 旋轉:左/右 90° / 重設
 *  - 多頁 PDF:頁面切換
 *  - 重置:把 transform 歸零
 */
export default function BaseLayerControls() {
  const baseLayer = usePlanStore(s => s.plan.baseLayer)
  const setBaseLayer = usePlanStore(s => s.setBaseLayer)
  const [open, setOpen] = useState(true)
  const [calibOpen, setCalibOpen] = useState(false)

  if (!baseLayer) return null
  const t = baseLayer.transform || { x: 0, y: 0, scale: 1, rotation: 0 }

  function patch(p) {
    setBaseLayer({ ...baseLayer, transform: { ...t, ...p } })
  }
  function move(dx, dy, big) {
    const step = big ? 500 : 50
    patch({ x: t.x + dx * step, y: t.y + dy * step })
  }
  function zoom(factor) {
    patch({ scale: Math.max(0.1, Math.min(10, t.scale * factor)) })
  }
  function rotate(delta) {
    patch({ rotation: (t.rotation + delta) % 360 })
  }
  function reset() {
    patch({ x: 0, y: 0, scale: 1, rotation: 0 })
  }
  function changePage(p) {
    if (!baseLayer.pages || p < 1 || p > baseLayer.pageCount) return
    const page = baseLayer.pages.find(pg => pg.page === p)
    if (!page) return
    setBaseLayer({
      ...baseLayer,
      currentPage: p,
      previewUrl: page.previewUrl,
      previewStoragePath: page.previewStoragePath,
      width: page.width,
      height: page.height
    })
  }

  return (
    <div className="bg-white border rounded shadow-sm text-xs">
      <div className="flex items-center justify-between px-2 py-1 border-b">
        <button onClick={() => setOpen(o => !o)} className="font-medium flex items-center gap-1">
          {open ? '▾' : '▸'} 底圖調整
          <span className="text-slate-500 truncate max-w-[140px]" title={baseLayer.filename}>
            {baseLayer.filename}
          </span>
        </button>
        <div className="flex items-center gap-3">
          <AiRecognizeButton />
          <button onClick={() => setCalibOpen(true)}
                  className={`px-2 py-0.5 rounded border ${baseLayer.scaleCalibration ? 'bg-green-50 border-green-300 text-green-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}
                  title="校準比例尺 (沒校準前的坪數不準!)">
            📐 {baseLayer.scaleCalibration ? `已校準 (${baseLayer.scaleCalibration.note})` : '校準比例尺'}
          </button>
          {baseLayer.pageCount > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => changePage(baseLayer.currentPage - 1)}
                      disabled={baseLayer.currentPage <= 1}
                      className="px-1.5 py-0.5 border rounded hover:bg-slate-50 disabled:opacity-30">‹</button>
              <span>{baseLayer.currentPage} / {baseLayer.pageCount}</span>
              <button onClick={() => changePage(baseLayer.currentPage + 1)}
                      disabled={baseLayer.currentPage >= baseLayer.pageCount}
                      className="px-1.5 py-0.5 border rounded hover:bg-slate-50 disabled:opacity-30">›</button>
            </div>
          )}
        </div>
      </div>
      <ScaleCalibrator open={calibOpen} onClose={() => setCalibOpen(false)} />

      {open && (
        <div className="p-2 flex items-center gap-3 flex-wrap">
          {/* 位置控制 */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">位置</span>
            <div className="grid grid-cols-3 gap-0.5">
              <span />
              <Btn onClick={(e) => move(0, -1, e.shiftKey)}>↑</Btn>
              <span />
              <Btn onClick={(e) => move(-1, 0, e.shiftKey)}>←</Btn>
              <Btn onClick={reset} title="歸零">○</Btn>
              <Btn onClick={(e) => move(1, 0, e.shiftKey)}>→</Btn>
              <span />
              <Btn onClick={(e) => move(0, 1, e.shiftKey)}>↓</Btn>
              <span />
            </div>
            <span className="text-slate-400 text-[10px]">(Shift=大步)</span>
          </div>

          {/* 縮放 */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">縮放</span>
            <Btn onClick={() => zoom(1/1.05)}>−</Btn>
            <span className="w-12 text-center">{Math.round(t.scale * 100)}%</span>
            <Btn onClick={() => zoom(1.05)}>+</Btn>
            <Btn onClick={() => zoom(1/1.25)}>−−</Btn>
            <Btn onClick={() => zoom(1.25)}>++</Btn>
          </div>

          {/* 旋轉 */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">旋轉</span>
            <Btn onClick={() => rotate(-90)} title="左轉 90°">↺</Btn>
            <span className="w-9 text-center">{t.rotation}°</span>
            <Btn onClick={() => rotate(90)} title="右轉 90°">↻</Btn>
            <Btn onClick={() => rotate(-1)}>‹</Btn>
            <Btn onClick={() => rotate(1)}>›</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

function Btn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title}
            className="px-1.5 py-0.5 border rounded hover:bg-slate-100 active:bg-slate-200 font-mono">
      {children}
    </button>
  )
}
