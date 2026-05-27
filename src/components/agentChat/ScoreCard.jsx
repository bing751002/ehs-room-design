/**
 * 設計評估評分卡 — 6 維度雷達圖 + 總分 + verdict
 * 接 scores JSON 物件 (從 AI 回應的 ```scores 區塊 parse 出來)
 */

const DIMENSIONS = [
  { key: 'aesthetic',    label: '美學風格', color: '#ec4899' },
  { key: 'circulation',  label: '空間動線', color: '#3b82f6' },
  { key: 'function',     label: '機能完整', color: '#10b981' },
  { key: 'operation',    label: '營運效率', color: '#f59e0b' },
  { key: 'brand',        label: '品牌調性', color: '#8b5cf6' },
  { key: 'audience_fit', label: '客群契合', color: '#06b6d4' }
]

const VERDICT_STYLE = {
  '強烈推薦':   'bg-emerald-100 text-emerald-800 border-emerald-300',
  '可執行需小修': 'bg-blue-100 text-blue-800 border-blue-300',
  '需大幅修改': 'bg-amber-100 text-amber-800 border-amber-300',
  '退回重做':   'bg-red-100 text-red-800 border-red-300'
}

export default function ScoreCard({ scores }) {
  if (!scores) return null

  const overall = clamp(scores.overall ?? avgScore(scores))
  const verdict = scores.verdict || autoVerdict(overall)
  const verdictClass = VERDICT_STYLE[verdict] || 'bg-slate-100 text-slate-800 border-slate-300'

  return (
    <div className="mt-2 w-full max-w-[600px] bg-white border-2 border-slate-200 rounded-lg p-4 shadow-sm">
      {/* 頂部:總分 + verdict */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-bold ${scoreColor(overall)}`}>{overall}</span>
          <span className="text-xs text-slate-500">/100 總分</span>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded border ${verdictClass}`}>
          {verdict}
        </span>
      </div>

      {/* 雷達圖 + 維度列表 */}
      <div className="flex gap-4 items-start">
        <RadarChart scores={scores} />
        <div className="flex-1 space-y-1.5">
          {DIMENSIONS.map(d => {
            const item = scores[d.key]
            if (!item) return null
            const score = clamp(item.score ?? 0)
            return (
              <div key={d.key} className="text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700">{d.label}</span>
                  <span className={`font-bold ${scoreColor(score)}`}>{score}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 mt-0.5 overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                       style={{ width: `${score}%`, backgroundColor: d.color }} />
                </div>
                {item.comment && (
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{item.comment}</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RadarChart({ scores }) {
  const size = 200
  const center = size / 2
  const radius = size * 0.4
  const n = DIMENSIONS.length

  // 計算每個 axis 的端點 (從上方開始,順時針)
  const axes = DIMENSIONS.map((d, i) => {
    const angle = (-Math.PI / 2) + (i * 2 * Math.PI / n)
    return {
      ...d,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      labelX: center + (radius + 18) * Math.cos(angle),
      labelY: center + (radius + 18) * Math.sin(angle),
      score: clamp(scores[d.key]?.score ?? 0)
    }
  })

  // 資料多邊形頂點
  const dataPoints = axes.map(a => {
    const r = radius * (a.score / 100)
    const angle = Math.atan2(a.y - center, a.x - center)
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle)
    }
  })

  const polygonPoints = dataPoints.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <svg width={size} height={size} className="flex-shrink-0">
      {/* 同心圈 */}
      {[0.25, 0.5, 0.75, 1].map(r => (
        <circle key={r} cx={center} cy={center} r={radius * r}
                fill="none" stroke="#e5e7eb" strokeWidth="1" />
      ))}
      {/* 軸線 */}
      {axes.map((a, i) => (
        <line key={i} x1={center} y1={center} x2={a.x} y2={a.y}
              stroke="#e5e7eb" strokeWidth="1" />
      ))}
      {/* 資料多邊形 */}
      <polygon points={polygonPoints}
               fill="#3b82f6" fillOpacity="0.2"
               stroke="#3b82f6" strokeWidth="2" />
      {/* 資料點 */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={axes[i].color} />
      ))}
      {/* 標籤 */}
      {axes.map((a, i) => (
        <text key={i} x={a.labelX} y={a.labelY}
              textAnchor="middle" dominantBaseline="middle"
              className="fill-slate-600" style={{ fontSize: 10 }}>
          {a.label.slice(0, 4)}
        </text>
      ))}
    </svg>
  )
}

function clamp(n) { return Math.max(0, Math.min(100, Math.round(Number(n) || 0))) }
function scoreColor(s) {
  if (s >= 80) return 'text-emerald-600'
  if (s >= 60) return 'text-amber-600'
  return 'text-red-600'
}
function avgScore(scores) {
  const vals = DIMENSIONS.map(d => Number(scores[d.key]?.score) || 0).filter(v => v > 0)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
}
function autoVerdict(s) {
  if (s >= 85) return '強烈推薦'
  if (s >= 70) return '可執行需小修'
  if (s >= 50) return '需大幅修改'
  return '退回重做'
}

/**
 * 從 AI 回應中解析 ```scores ... ``` JSON 區塊
 * 回傳 { cleanText, data } 或 null (沒解析到時)
 */
export function parseScoresBlock(rawText) {
  const re = /```(?:scores|json)\s*\n([\s\S]*?)\n```/i
  const match = rawText.match(re)
  if (!match) return null
  try {
    const data = JSON.parse(match[1])
    const cleanText = rawText.replace(match[0], '').trim()
    return { cleanText, data }
  } catch (e) {
    console.warn('scores JSON 解析失敗', e)
    return null
  }
}
