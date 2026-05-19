/**
 * 比例尺顯示 — 改放到畫布頂部右側,小型橫條,不擋到圖面
 * 方向標移除 (建築平面圖通常自帶,且使用者反映用不到)
 */
export default function MapOverlay({ zoom, svgW, svgH, svgUnitToRealCm = 1 }) {
  const targetScreenPx = 100
  const realCm = targetScreenPx * svgUnitToRealCm / zoom
  const niceLengths = [10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
  let scaleCm = niceLengths.reduce((a, b) =>
    Math.abs(b - realCm) < Math.abs(a - realCm) ? b : a
  , niceLengths[0])
  const scalePx = (scaleCm / svgUnitToRealCm) * zoom
  const labelText = scaleCm >= 100 ? `${(scaleCm/100).toFixed(scaleCm >= 1000 ? 0 : 1)} m` : `${scaleCm} cm`

  return (
    <div className="absolute top-2 right-16 z-10 pointer-events-none bg-white/85 px-2 py-0.5 rounded shadow-sm border text-[10px] font-mono flex items-center gap-1.5">
      <span className="text-slate-500">比例尺</span>
      <div className="border-l-2 border-r-2 border-b-2 border-slate-700 h-1.5"
           style={{ width: `${scalePx}px` }} />
      <span className="font-bold leading-none text-slate-800">{labelText}</span>
    </div>
  )
}
