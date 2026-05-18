import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { chatWithClaude } from '../lib/claudeApi.js'

/**
 * 比例尺校準 — 三種方式並存:
 *   1) 點兩點 + 輸入實際距離 (svgPx ↔ realCm)
 *   2) 手動輸入 1:X 比例 (1 cm 圖上 = X cm 實際)
 *   3) AI 看圖自動辨識 (透過 Claude Vision 讀軸線標註)
 * 結果套用到 baseLayer.transform.scale。
 */
export default function ScaleCalibrator({ open, onClose }) {
  const plan = usePlanStore(s => s.plan)
  const calibMode = usePlanStore(s => s.calibMode)
  const setCalibMode = usePlanStore(s => s.setCalibMode)
  const calibPoints = usePlanStore(s => s.calibPoints)
  const clearCalibPoints = usePlanStore(s => s.clearCalibPoints)
  const applyScaleCalibration = usePlanStore(s => s.applyScaleCalibration)

  const [method, setMethod] = useState('two-point')
  const [realDistance, setRealDistance] = useState('')
  const [realUnit, setRealUnit] = useState('cm')
  const [ratioValue, setRatioValue] = useState('100')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiSuggest, setAiSuggest] = useState(null)
  const [err, setErr] = useState('')

  if (!open) return null

  const bl = plan.baseLayer

  // ---- 方式 1: 兩點測距 ----
  function svgDist() {
    if (calibPoints.length < 2) return 0
    const [a, b] = calibPoints
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
  }
  function applyTwoPoint() {
    const px = svgDist()
    const d = parseFloat(realDistance)
    if (!px || !d) { setErr('請點兩點並輸入實際距離'); return }
    const realCm = realUnit === 'm' ? d * 100 : d
    applyScaleCalibration({ method: 'two-point', svgPx: px, realCm, note: `${d}${realUnit}` })
    setCalibMode(false); onClose()
  }

  // ---- 方式 2: 手動輸入 1:X ----
  function applyRatio() {
    const r = parseFloat(ratioValue)
    if (!r || r <= 0) { setErr('請輸入有效比例'); return }
    applyScaleCalibration({ method: 'ratio', ratio: r, note: `1:${r}` })
    onClose()
  }

  // ---- 方式 3: AI 自動辨識 ----
  async function aiDetect() {
    if (!bl) return
    const imgUrl = bl.type === 'pdf' ? bl.previewUrl : bl.publicUrl
    if (!imgUrl) { setErr('底圖沒有可看的圖片'); return }
    setAiBusy(true); setErr('')
    try {
      const messages = [{
        role: 'user',
        content: '請看這張建築/室內平面圖底圖,找出上面的「軸線尺寸標註」(例如 1080、1255、4670 之類的數字)。回覆格式只能是 JSON: {"totalWidthCm": 數字, "totalHeightCm": 數字, "evidence": "你看到的尺寸標註"}。如果完全看不到尺寸,回 {"totalWidthCm": null, "totalHeightCm": null, "evidence": "原因"}。'
      }]
      const reply = await chatWithClaude(messages, { plan, baseLayerImageUrl: imgUrl })
      const jsonMatch = reply.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('AI 沒回 JSON: ' + reply.slice(0, 100))
      const data = JSON.parse(jsonMatch[0])
      setAiSuggest(data)
    } catch (e) {
      setErr(e.message)
    } finally {
      setAiBusy(false)
    }
  }
  function applyAi() {
    if (!aiSuggest?.totalWidthCm || !bl) return
    // 底圖目前 render 寬 = baseLayer.width * fit * t.scale,我們想讓 render 寬 = totalWidthCm
    // 用「等效 ratio」乘進去 (近似)
    const t = bl.transform || { scale: 1 }
    const currentSvgPx = bl.width
    const realCm = aiSuggest.totalWidthCm
    applyScaleCalibration({ method: 'ai', svgPx: currentSvgPx, realCm, note: `AI: ${aiSuggest.evidence}` })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold">📐 校準比例尺</h2>
          <button onClick={() => { setCalibMode(false); onClose() }}
                  className="text-slate-500 hover:text-slate-800">✕</button>
        </div>

        {/* tabs */}
        <div className="flex border-b text-sm">
          {[
            { key: 'two-point', label: '① 點兩點' },
            { key: 'ratio',     label: '② 輸入比例 1:X' },
            { key: 'ai',        label: '③ AI 自動辨識' }
          ].map(t => (
            <button key={t.key} onClick={() => setMethod(t.key)}
                    className={`flex-1 py-2 ${method === t.key ? 'bg-slate-100 font-semibold' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 text-sm space-y-3">
          {bl?.scaleCalibration && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs">
              ⚠ 已校準過({bl.scaleCalibration.note}),再校準會覆蓋之前的設定。
            </div>
          )}

          {/* 方式 1 */}
          {method === 'two-point' && (
            <div className="space-y-2">
              <p className="text-slate-600">
                ① 點下面按鈕進入「點兩點」模式 → 在畫布上點兩個已知距離的點 → 輸入實際距離。
              </p>
              <div className="flex items-center gap-2">
                {!calibMode ? (
                  <button onClick={() => setCalibMode(true)}
                          className="px-3 py-1.5 bg-brand-700 text-white rounded hover:bg-brand-500">
                    開始點兩點
                  </button>
                ) : (
                  <>
                    <span className="text-amber-700 font-medium">畫布上點 {2 - calibPoints.length} 點</span>
                    <button onClick={clearCalibPoints} className="px-2 py-1 border rounded text-xs">重點</button>
                    <button onClick={() => setCalibMode(false)} className="px-2 py-1 border rounded text-xs">取消</button>
                  </>
                )}
                {calibPoints.length === 2 && (
                  <span className="text-slate-500 text-xs">已點 2 點,SVG 距離 {Math.round(svgDist())} 單位</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-slate-600">這兩點實際距離:</label>
                <input type="number" min="0" step="0.01"
                       value={realDistance} onChange={e => setRealDistance(e.target.value)}
                       className="border rounded px-2 py-1 w-28" />
                <select value={realUnit} onChange={e => setRealUnit(e.target.value)}
                        className="border rounded px-2 py-1">
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
                <button onClick={applyTwoPoint}
                        disabled={calibPoints.length !== 2 || !realDistance}
                        className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-40">
                  套用
                </button>
              </div>
            </div>
          )}

          {/* 方式 2 */}
          {method === 'ratio' && (
            <div className="space-y-2">
              <p className="text-slate-600">
                如果你已經知道 PDF 出圖比例,直接輸入。例如「1:100」就填 100。
              </p>
              <div className="flex items-center gap-2">
                <span>1 :</span>
                <input type="number" min="1"
                       value={ratioValue} onChange={e => setRatioValue(e.target.value)}
                       className="border rounded px-2 py-1 w-28" />
                <span className="text-slate-500 text-xs">圖上 1 cm = 實際 {ratioValue} cm</span>
                <button onClick={applyRatio} disabled={!ratioValue}
                        className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-40">
                  套用
                </button>
              </div>
              <p className="text-xs text-slate-400">
                註:此模式會直接把底圖縮放係數乘上你輸入的數字。若效果不如預期,改用「點兩點」更精準。
              </p>
            </div>
          )}

          {/* 方式 3 */}
          {method === 'ai' && (
            <div className="space-y-2">
              <p className="text-slate-600">
                讓 Claude 看你上傳的底圖,讀出軸線標註自動推算尺寸。
              </p>
              <button onClick={aiDetect} disabled={aiBusy || !bl}
                      className="px-3 py-1.5 bg-brand-700 text-white rounded hover:bg-brand-500 disabled:opacity-40">
                {aiBusy ? '辨識中…' : '讓 AI 讀圖'}
              </button>
              {aiSuggest && (
                <div className="border rounded p-2 bg-slate-50 text-xs space-y-1">
                  <div><b>AI 看到的:</b> {aiSuggest.evidence}</div>
                  <div><b>推估總寬:</b> {aiSuggest.totalWidthCm || '無'} cm</div>
                  <div><b>推估總高:</b> {aiSuggest.totalHeightCm || '無'} cm</div>
                  {aiSuggest.totalWidthCm && (
                    <button onClick={applyAi}
                            className="mt-1 px-3 py-1 bg-green-600 text-white rounded text-xs">
                      採用 AI 結果
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {err && <div className="text-red-600 text-xs">{err}</div>}
        </div>
      </div>
    </div>
  )
}
