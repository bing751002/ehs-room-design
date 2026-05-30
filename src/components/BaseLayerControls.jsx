import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import ScaleCalibrator from './ScaleCalibrator.jsx'
import AiRecognizeButton from './AiRecognizeButton.jsx'
import DxfPdfFrameButton from './DxfPdfFrameButton.jsx'

/**
 * 底圖編輯控制條 — 仿 v3_8:
 *   底圖 placement 用 4 個 cm 值 (offsetX, offsetY, drawW, drawH) + rotation + opacity
 *   直接跟 SVG viewBox 同座標系,所以畫布縮放時底圖跟所有元素一起變
 *
 * - 數字直接輸入 (cm 單位,跟著比例尺校準算成 m)
 * - 4 方向微調 (按一次 100cm,Shift = 1000cm)
 * - 等比縮放 / 旋轉 90° / 透明度滑桿
 * - 多頁 PDF 切換
 */
export default function BaseLayerControls() {
  const baseLayer = usePlanStore(s => s.plan.baseLayer)
  const setBaseLayer = usePlanStore(s => s.setBaseLayer)
  const plan = usePlanStore(s => s.plan)
  const [open, setOpen] = useState(true)
  const [calibOpen, setCalibOpen] = useState(false)

  if (!baseLayer) return null

  // 統一從 placement 讀;沒有就用 fallback (跟 BaseLayerRender 邏輯一致)
  let p = baseLayer.placement
  if (!p) {
    const W = baseLayer.width || 1000, H = baseLayer.height || 1000
    const bounds = plan.bounds
    const fit = Math.min((bounds.w * 0.9) / W, (bounds.h * 0.9) / H)
    p = {
      drawW: W * fit, drawH: H * fit,
      offsetX: (bounds.w - W * fit) / 2,
      offsetY: (bounds.h - H * fit) / 2,
      rotation: 0, opacity: 0.85
    }
  }

  function patch(np) {
    setBaseLayer({ ...baseLayer, placement: { ...p, ...np } })
  }
  function move(dx, dy, big) {
    const step = big ? 1000 : 100
    patch({ offsetX: p.offsetX + dx * step, offsetY: p.offsetY + dy * step })
  }
  function zoom(factor) {
    // 以中心點為基準縮放
    const cx = p.offsetX + p.drawW / 2
    const cy = p.offsetY + p.drawH / 2
    const newW = Math.max(50, p.drawW * factor)
    const newH = Math.max(50, p.drawH * factor)
    patch({
      drawW: newW, drawH: newH,
      offsetX: cx - newW / 2, offsetY: cy - newH / 2
    })
  }
  function rotate(delta) {
    patch({ rotation: ((p.rotation || 0) + delta + 360) % 360 })
  }
  function reset() {
    // 重置到首次上傳預設 (居中填滿可用區 90%)
    const W = baseLayer.width || 1000, H = baseLayer.height || 1000
    const bounds = plan.bounds
    const fit = Math.min((bounds.w * 0.9) / W, (bounds.h * 0.9) / H)
    patch({
      drawW: W * fit, drawH: H * fit,
      offsetX: (bounds.w - W * fit) / 2,
      offsetY: (bounds.h - H * fit) / 2,
      rotation: 0, opacity: 0.85
    })
  }
  function changePage(np) {
    if (!baseLayer.pages || np < 1 || np > baseLayer.pageCount) return
    const page = baseLayer.pages.find(pg => pg.page === np)
    if (!page) return
    setBaseLayer({
      ...baseLayer,
      currentPage: np,
      previewUrl: page.previewUrl,
      previewStoragePath: page.previewStoragePath,
      width: page.width,
      height: page.height
    })
  }

  // cm → 顯示成 m (校準後才有意義)
  const f = plan.svgUnitToRealCm || 1
  const xM = ((p.offsetX * f) / 100).toFixed(1)
  const yM = ((p.offsetY * f) / 100).toFixed(1)
  const wM = ((p.drawW * f) / 100).toFixed(1)
  const hM = ((p.drawH * f) / 100).toFixed(1)

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
          <DxfPdfFrameButton />
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
          {/* 直接輸入位置/寬高 (m) — v3_8 風格 */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">底圖 (m):</span>
            <NumInput label="X" value={xM} onChange={v => patch({ offsetX: v * 100 / f })} />
            <NumInput label="Y" value={yM} onChange={v => patch({ offsetY: v * 100 / f })} />
            <NumInput label="寬" value={wM} onChange={v => patch({ drawW: v * 100 / f })} />
            <NumInput label="高" value={hM} onChange={v => patch({ drawH: v * 100 / f })} />
          </div>

          {/* 4 方向微調 */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">移動</span>
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
          </div>

          {/* 等比縮放 */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">縮放</span>
            <Btn onClick={() => zoom(1/1.05)}>−</Btn>
            <Btn onClick={() => zoom(1.05)}>+</Btn>
            <Btn onClick={() => zoom(1/1.25)}>−−</Btn>
            <Btn onClick={() => zoom(1.25)}>++</Btn>
          </div>

          {/* 旋轉 */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">旋轉</span>
            <Btn onClick={() => rotate(-90)} title="左轉 90°">↺</Btn>
            <span className="w-9 text-center">{p.rotation || 0}°</span>
            <Btn onClick={() => rotate(90)} title="右轉 90°">↻</Btn>
          </div>

          {/* 透明度 */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">透明度</span>
            <input type="range" min="0.1" max="1" step="0.05"
                   value={p.opacity ?? 0.6}
                   onChange={e => patch({ opacity: Number(e.target.value) })}
                   className="w-20" />
            <span className="w-8">{Math.round((p.opacity ?? 0.6) * 100)}%</span>
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

function NumInput({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-0.5">
      <span className="text-slate-400">{label}</span>
      <input type="number" step="0.1" value={value}
             onChange={e => onChange(Number(e.target.value))}
             className="w-14 border rounded px-1 py-0.5 text-right" />
    </label>
  )
}
