/**
 * 畫布右上方向標 + 左下比例尺 (覆蓋在 Canvas2D 之上)
 */
export default function MapOverlay({ zoom, svgW, svgH }) {
  // 比例尺 — 以螢幕像素計算,顯示對應的真實 cm/m
  // zoom = 1 SVG 單位 = zoom px。 1 SVG 單位 = 1 cm。所以 100 px 螢幕 = 100/zoom cm。
  // 選個適合長度顯示
  const targetScreenPx = 120
  const realCm = targetScreenPx / zoom
  // 找接近的整數 m/cm
  const niceLengths = [10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
  let scaleCm = niceLengths.reduce((a, b) =>
    Math.abs(b - realCm) < Math.abs(a - realCm) ? b : a
  , niceLengths[0])
  const scalePx = scaleCm * zoom

  const labelText = scaleCm >= 100 ? `${(scaleCm/100).toFixed(scaleCm >= 1000 ? 0 : 1)} m` : `${scaleCm} cm`

  return (
    <>
      {/* 方向標 — 右上 */}
      <div className="absolute top-2 left-2 z-10 pointer-events-none">
        <div className="bg-white/90 rounded-full w-12 h-12 shadow border flex items-center justify-center relative">
          <svg viewBox="-20 -20 40 40" className="w-10 h-10">
            <polygon points="0,-15 5,5 0,2 -5,5" fill="#dc2626" />
            <polygon points="0,15 5,-5 0,-2 -5,-5" fill="#1f2937" />
            <text x="0" y="-17" fontSize="6" fill="#dc2626" textAnchor="middle" fontWeight="bold">N</text>
          </svg>
        </div>
      </div>

      {/* 比例尺 — 左下 */}
      <div className="absolute bottom-2 left-2 z-10 pointer-events-none bg-white/90 px-2 py-1 rounded shadow border text-[10px] font-mono">
        <div className="flex items-end gap-1">
          <div className="border-l-2 border-r-2 border-b-2 border-slate-800 h-2"
               style={{ width: `${scalePx}px` }} />
          <span className="font-bold leading-none">{labelText}</span>
        </div>
      </div>
    </>
  )
}
