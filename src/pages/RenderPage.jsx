import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { usePlanStore } from '../store/planStore.js'
import { generateRender, renderFromPlan, editRender, getStylePresets, getViewPresets, getModelPresets, renderReady } from '../lib/renderApi.js'
import { captureCanvasAsDataUrl } from '../lib/exportPng.js'
import Canvas2D from '../components/Canvas2D.jsx'

/**
 * 渲染圖廊頁 — 用 Gemini Imagen 4 生圖 + Gemini 2.5 Flash Image 編輯。
 */
export default function RenderPage() {
  const { id: planId } = useParams()
  const plan = usePlanStore(s => s.plan)
  const [renders, setRenders] = useState([])
  const [loading, setLoading] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState('modern')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editTarget, setEditTarget] = useState(null) // {id, image_url}
  const [editPrompt, setEditPrompt] = useState('')
  const [lightbox, setLightbox] = useState(null)   // {url, prompt, style}
  const [mode, setMode] = useState('from-plan') // 'from-plan' | 'text-only'
  const [viewType, setViewType] = useState('interior_wide')
  const [focusSpace, setFocusSpace] = useState('')
  const [modelId, setModelId] = useState('nano-banana-2')
  const [styleCustom, setStyleCustom] = useState('')   // 使用者自由輸入的風格描述
  const [hideBaseLayerForAI, setHideBaseLayerForAI] = useState(true)   // 給 AI 的圖要不要含底圖
  const [batchProgress, setBatchProgress] = useState(null)   // { done, total, currentStyle }
  const styles = getStylePresets()
  const views = getViewPresets()
  const models = getModelPresets()

  useEffect(() => { reload() }, [planId])
  async function reload() {
    setLoading(true)
    const { data, error } = await supabase.from('renders')
      .select('*').eq('plan_id', planId).order('created_at', { ascending: false })
    if (error && (error.code === 'PGRST205' || /renders/i.test(error.message || ''))) {
      console.warn('[renders] renders 表還沒建,請跑 supabase/renders_schema.sql')
      setRenders([])
    } else if (!error) {
      setRenders(data || [])
    }
    setLoading(false)
  }

  // 把 base64 data URL 上傳到 Supabase Storage,回傳 signedUrl
  async function uploadDataUrl(dataUrl) {
    const { data: { user } } = await supabase.auth.getUser()
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
    if (!match) throw new Error('圖片格式不對')
    const mimeType = match[1]
    const binary = atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: mimeType })
    const ts = Date.now()
    const path = `${user.id}/renders/${ts}.png`
    const { error } = await supabase.storage.from('plan-assets')
      .upload(path, blob, { contentType: mimeType, upsert: false })
    if (error) throw error
    const { data: signed } = await supabase.storage.from('plan-assets')
      .createSignedUrl(path, 60 * 60 * 24 * 365)
    return signed.signedUrl
  }

  // 從 2D 畫布截圖 → base64 PNG (用共用 helper)
  // scale 2.5 給 AI 看比較清楚;hideBaseLayer 砍掉模糊底圖,只留結構,AI 不被誤導
  async function captureCanvasPng() {
    try {
      return await captureCanvasAsDataUrl(2.5, { hideBaseLayer: hideBaseLayerForAI })
    } catch (e) {
      throw new Error('找不到平面圖 — 此頁底下有預覽 (滾上去看),如果還是看不到請回 2D 編輯頁先畫過東西')
    }
  }

  async function onGenerate() {
    if (!renderReady) { setErr('請先在 .env.local 填入 VITE_GEMINI_API_KEY 並重啟 dev'); return }
    setErr(''); setBusy(true)
    try {
      let dataUrl
      const viewLabel = views.find(v => v.id === viewType)?.label || viewType
      let usedPrompt = prompt
      if (mode === 'from-plan') {
        const planPng = await captureCanvasPng()
        // 上傳「實送進 AI 的平面圖」當證據,之後可在每張渲染下顯示「AI 看到的是這張」
        let sourceUrl = null
        try { sourceUrl = await uploadDataUrl(planPng) } catch (e) { console.warn('source 圖上傳失敗', e) }
        window.__lastSentPlanImage = planPng   // debug 用 — 開 console 看 window.__lastSentPlanImage 確認
        dataUrl = await renderFromPlan({
          planImageDataUrl: planPng,
          plan, style, styleCustom, modelId, viewType, focusSpace, extra: prompt
        })
        const modelLabel = models.find(m => m.id === modelId)?.label || ''
        usedPrompt = `[${modelLabel} · ${viewLabel}${focusSpace ? ' · 聚焦:' + focusSpace : ''}${styleCustom ? ' · ' + styleCustom : ''}] ${prompt}`
        // 把 sourceUrl 塞進 metadata 給渲染卡片用
        window.__lastRenderSourceUrl = sourceUrl
      } else {
        if (!prompt.trim()) { setErr('純文字模式需要描述場景'); setBusy(false); return }
        const spaceContext = plan.spaces?.length
          ? `Layout includes: ${plan.spaces.map(s => s.name).join(', ')}. `
          : ''
        const fullPrompt = spaceContext + prompt
        dataUrl = await generateRender({ prompt: fullPrompt, style })
        usedPrompt = fullPrompt
      }
      const publicUrl = await uploadDataUrl(dataUrl)
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('renders').insert({
        owner: user.id, plan_id: planId,
        prompt: usedPrompt + (window.__lastRenderSourceUrl ? `\n[SRC:${window.__lastRenderSourceUrl}]` : ''),
        style, image_url: publicUrl, cost_usd: 0.04
      })
      await reload()
    } catch (e) {
      setErr(e.message)
    } finally { setBusy(false) }
  }

  /**
   * 預覽「現在如果按生圖,AI 會看到什麼?」
   * 純前端 — 不送 API,只截圖顯示給使用者
   */
  async function onPreviewCapture() {
    setErr('')
    try {
      const dataUrl = await captureCanvasPng()
      setLightbox({
        image_url: dataUrl,
        prompt: '👁 這就是 AI 會看到的平面圖 (截自你目前的畫布)',
        style: '預覽',
        id: 'preview-' + Date.now()
      })
    } catch (e) { setErr(e.message) }
  }

  /**
   * 一鍵批次生「同一個 plan 用所有風格」
   * 想看完整風格樣板給總裁選用
   */
  async function onBatchAllStyles() {
    if (!renderReady) { setErr('請先設定 Gemini API Key'); return }
    if (mode !== 'from-plan') { setErr('批次只支援「從平面圖」模式'); return }
    if (!confirm(`將用所有 ${styles.length} 種風格各生 1 張 (約 ${styles.length * 10} 秒,費用 ~$${(styles.length * 0.04).toFixed(2)}USD)。確認?`)) return
    setErr(''); setBusy(true)
    const viewLabel = views.find(v => v.id === viewType)?.label || viewType
    try {
      const planPng = await captureCanvasPng()
      const { data: { user } } = await supabase.auth.getUser()
      let done = 0
      for (const s of styles) {
        setBatchProgress({ done, total: styles.length, currentStyle: s.label })
        try {
          const dataUrl = await renderFromPlan({
            planImageDataUrl: planPng,
            plan, style: s.id, styleCustom, modelId, viewType, focusSpace, extra: prompt
          })
          const publicUrl = await uploadDataUrl(dataUrl)
          await supabase.from('renders').insert({
            owner: user.id, plan_id: planId,
            prompt: `[批次·${viewLabel}·${s.label}] ${prompt}`,
            style: s.id, image_url: publicUrl, cost_usd: 0.04
          })
        } catch (e) {
          console.warn(`風格 ${s.label} 失敗:`, e.message)
        }
        done++
        setBatchProgress({ done, total: styles.length, currentStyle: s.label })
        await reload()
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setBatchProgress(null)
      setBusy(false)
    }
  }

  async function onEdit() {
    if (!editTarget || !editPrompt.trim()) return
    setBusy(true); setErr('')
    try {
      const newDataUrl = await editRender({ imageUrl: editTarget.image_url, editPrompt, modelId })
      const publicUrl = await uploadDataUrl(newDataUrl)
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('renders').insert({
        owner: user.id, plan_id: planId,
        prompt: `[編輯自前一張] ${editPrompt}`,
        style: editTarget.style, image_url: publicUrl, cost_usd: 0.04
      })
      setEditTarget(null); setEditPrompt('')
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function onDelete(r) {
    if (!confirm('刪除這張渲染?')) return
    await supabase.from('renders').delete().eq('id', r.id)
    reload()
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">🎨 渲染圖廊 <span className="text-xs text-slate-500 ml-2">Gemini Nano Banana (2.5 Flash Image)</span></h2>
          <p className="text-sm text-slate-600 mt-1">
            **酷家樂式**:用 AI 把你的 2D plan 直接生 3D 寫實圖,保留結構/比例/動線,只改材質光照。
            <br />選視角 → 選風格 → 生圖。每張約 $0.04 USD,10-15 秒。可一鍵跑全部 9 種風格給總裁挑。
            <br />生圖後點「✏ 編輯這張」可對話式微調 (「沙發換綠色」)。
          </p>
          {!renderReady && (
            <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded">
              ⚠ 未設定 Gemini API Key。請到 <a href="https://aistudio.google.com" target="_blank" className="underline">aistudio.google.com</a> 拿 key,
              填到 <code>.env.local</code> 的 <code>VITE_GEMINI_API_KEY</code>。
            </div>
          )}
        </div>

        {/* 生成表單 */}
        <div className="bg-white border rounded-lg p-4 space-y-3">
          {/* 模式切換 */}
          <div>
            <label className="block text-xs font-medium mb-1">渲染來源</label>
            <div className="flex gap-1.5 text-xs">
              <button onClick={() => setMode('from-plan')}
                      className={`px-3 py-1.5 rounded border ${mode === 'from-plan' ? 'bg-brand-700 text-white' : 'bg-slate-50 hover:bg-slate-100'}`}>
                🏗 從目前平面圖 (推薦)
              </button>
              <button onClick={() => setMode('text-only')}
                      className={`px-3 py-1.5 rounded border ${mode === 'text-only' ? 'bg-brand-700 text-white' : 'bg-slate-50 hover:bg-slate-100'}`}>
                ✍ 純文字描述
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              {mode === 'from-plan'
                ? '✨ AI 看你的平面圖,依結構生擬真渲染 (保留你的空間配置)'
                : '⚠ 純文字生圖,AI 自由發揮,跟你的平面圖無關'}
            </p>
          </div>

          {/* 視角 + 聚焦空間 (只有 from-plan 模式才顯示) */}
          {mode === 'from-plan' && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1">視角</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-xs">
                  {views.map(v => (
                    <button key={v.id} onClick={() => setViewType(v.id)}
                            title={v.desc}
                            className={`px-2 py-1.5 rounded border text-left ${
                              viewType === v.id ? 'bg-brand-700 text-white border-brand-700' : 'bg-slate-50 hover:bg-slate-100'
                            }`}>
                      <div className="font-medium">{v.label}</div>
                      <div className={`text-[10px] ${viewType === v.id ? 'opacity-80' : 'text-slate-500'}`}>{v.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {(plan.spaces || []).length > 0 && (
                <div>
                  <label className="block text-xs font-medium mb-1">聚焦哪個空間? (可選 — 不選=全景)</label>
                  <div className="flex flex-wrap gap-1 text-xs">
                    <button onClick={() => setFocusSpace('')}
                            className={`px-2 py-1 rounded border ${!focusSpace ? 'bg-emerald-600 text-white' : 'bg-slate-50'}`}>
                      🌐 全景
                    </button>
                    {plan.spaces.map(sp => (
                      <button key={sp.id} onClick={() => setFocusSpace(sp.name || '')}
                              className={`px-2 py-1 rounded border ${focusSpace === sp.name ? 'bg-emerald-600 text-white' : 'bg-slate-50 hover:bg-slate-100'}`}>
                        {sp.name || '(未命名)'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 平面圖預覽 (只在 from-plan 模式下顯示) */}
          {mode === 'from-plan' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium">AI 看到的平面圖預覽</label>
                <button onClick={onPreviewCapture}
                        className="text-[11px] text-blue-600 hover:underline">
                  👁 預覽實際送出的圖 (看 AI 會收到什麼)
                </button>
              </div>
              <div className="border rounded overflow-hidden h-48 bg-slate-100">
                <Canvas2D />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                ↑ AI 會根據這張平面圖的結構去生圖 · 按「👁 預覽」可看實際截圖
              </p>
              <label className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" checked={hideBaseLayerForAI}
                       onChange={e => setHideBaseLayerForAI(e.target.checked)} />
                <span>給 AI 的圖移除底圖 PDF (推薦勾選 — 模糊底圖會干擾 AI,留結構線最乾淨)</span>
              </label>
            </div>
          )}

          {/* 模型選擇 */}
          <div>
            <label className="block text-xs font-medium mb-1">AI 模型</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 text-xs">
              {models.map(m => (
                <button key={m.id} onClick={() => setModelId(m.id)}
                        title={m.desc}
                        className={`px-2 py-1.5 rounded border text-left ${
                          modelId === m.id ? 'bg-brand-700 text-white border-brand-700' : 'bg-slate-50 hover:bg-slate-100'
                        }`}>
                  <div className="font-medium">{m.label}</div>
                  <div className={`text-[10px] ${modelId === m.id ? 'opacity-80' : 'text-slate-500'}`}>{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">風格</label>
            <textarea value={styleCustom} onChange={e => setStyleCustom(e.target.value)} rows={3}
                      placeholder="自由描述風格 (中英文皆可,可寫詳細也可短描述)&#10;例:「東森集團企業形象色,深酒紅+金邊,大理石質感,類佳士得拍賣會等級」&#10;「Hermès 旗艦店風格,橘色皮革,黃銅五金,展示燈聚光」&#10;「Wabi-sabi 侘寂,微弱燭光,水泥牆配古董木桌」&#10;「故宮博物院展廳風格,胡桃木+米黃光,雷射線控展示」"
                      className="w-full border rounded px-2 py-1.5 text-sm text-slate-700" />
            <div className="mt-2">
              <div className="text-[10px] text-slate-500 mb-1">💡 快速套用範本 (點按鈕會把該風格描述加到上方,可再編輯):</div>
              <div className="flex flex-wrap gap-1 text-[11px]">
                <button onClick={() => setStyleCustom('')}
                        className="px-2 py-0.5 rounded border bg-white hover:bg-slate-100 text-slate-500">
                  🗑 清空
                </button>
                {styles.map(s => (
                  <button key={s.id} type="button"
                          onClick={() => setStyleCustom(styleCustom ? styleCustom + ', ' + s.prompt : s.prompt)}
                          title={`點擊把「${s.label}」描述加進去`}
                          className="px-2 py-0.5 rounded border bg-white hover:bg-brand-50 hover:border-brand-300">
                    + {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {mode === 'from-plan' ? '額外描述 (可選)' : '場景描述 *'}
            </label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
                      placeholder={mode === 'from-plan'
                        ? '例:傍晚溫暖燈光,木質地板,綠植點綴'
                        : '例:30 人辦公空間,落地窗,自然採光,中央長會議桌'}
                      className="w-full border rounded px-2 py-1.5 text-sm" />
          </div>
          {err && <div className="text-red-600 text-xs">{err}</div>}

          {/* 批次進度條 */}
          {batchProgress && (
            <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">
              <div className="flex justify-between mb-1">
                <span>批次中:{batchProgress.currentStyle}</span>
                <span className="font-semibold">{batchProgress.done} / {batchProgress.total}</span>
              </div>
              <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full transition-all"
                     style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }} />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onGenerate} disabled={busy || !renderReady}
                    className="flex-1 px-4 py-2 bg-brand-700 text-white rounded hover:bg-brand-500 disabled:opacity-40 font-semibold">
              {busy && !editTarget && !batchProgress ? '渲染中 (10-30 秒)…' : (mode === 'from-plan' ? '🏗 從平面圖渲染 1 張' : '🎨 生成渲染圖')}
            </button>
            {mode === 'from-plan' && (
              <button onClick={onBatchAllStyles} disabled={busy || !renderReady}
                      title="同一個 plan + 視角,9 種風格各生 1 張,給總裁挑風格用"
                      className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-500 disabled:opacity-40 text-sm">
                🎭 批次生 {styles.length} 種風格
              </button>
            )}
          </div>
        </div>

        {/* 編輯模式 */}
        {editTarget && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">✏ 編輯模式</h3>
              <button onClick={() => { setEditTarget(null); setEditPrompt('') }}
                      className="text-xs text-slate-500 hover:underline">取消</button>
            </div>
            <img src={editTarget.image_url} alt="" className="h-32 rounded border" />
            <input value={editPrompt} onChange={e => setEditPrompt(e.target.value)}
                   placeholder="例:把牆換成木質、加一張沙發、換成傍晚燈光"
                   className="w-full border rounded px-2 py-1.5 text-sm" />
            <button onClick={onEdit} disabled={busy || !editPrompt.trim()}
                    className="px-3 py-1.5 bg-amber-600 text-white rounded text-sm hover:bg-amber-500 disabled:opacity-40">
              {busy ? '處理中…' : '套用編輯'}
            </button>
          </div>
        )}

        {/* 圖廊 */}
        <div>
          <h3 className="text-sm font-semibold mb-2">過往渲染 ({renders.length})</h3>
          {loading ? <p className="text-slate-500">載入中…</p> :
           renders.length === 0 ? (
            <div className="text-center py-12 text-slate-500">還沒有渲染,上面生成第一張。</div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {renders.map(r => {
                // 抽出 [SRC:xxx] 標記
                const srcMatch = r.prompt?.match(/\[SRC:([^\]]+)\]/)
                const srcUrl = srcMatch?.[1]
                const cleanPrompt = (r.prompt || '').replace(/\[SRC:[^\]]+\]/, '').trim()
                return (
                <div key={r.id} className="bg-white border rounded-lg overflow-hidden group">
                  <div className="relative cursor-zoom-in" onClick={() => setLightbox(r)}>
                    <img src={r.image_url} alt="" className="w-full aspect-video object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/60 px-2 py-1 rounded">🔍 點擊放大</span>
                    </div>
                  </div>
                  {srcUrl && (
                    <div className="flex items-center gap-2 px-2 py-1 bg-blue-50 border-t border-b text-[10px] text-blue-800"
                         title="AI 收到的平面圖 (證據)">
                      <img src={srcUrl} alt="src" className="h-10 w-16 object-cover rounded border" />
                      <span className="flex-1">↑ AI 收到的平面圖</span>
                      <a href={srcUrl} target="_blank" rel="noreferrer" className="hover:underline">🔍 看大圖</a>
                    </div>
                  )}
                  <div className="p-2 text-xs space-y-1">
                    <div className="font-medium line-clamp-2" title={cleanPrompt}>{cleanPrompt}</div>
                    <div className="text-slate-500 flex justify-between items-center">
                      <span>{styles.find(s => s.id === r.style)?.label || r.style}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setLightbox(r)}
                                className="text-blue-600 hover:underline">🔍 看大圖</button>
                        <button onClick={() => setEditTarget(r)}
                                className="text-amber-600 hover:underline">✏ 改</button>
                        <button onClick={() => onDelete(r)}
                                className="text-red-500 hover:underline">刪</button>
                      </div>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox 大圖檢視 */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col"
             onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between p-3 text-white text-sm bg-black/50">
            <div className="flex-1 truncate pr-4">
              <span className="opacity-70 text-xs">{styles.find(s => s.id === lightbox.style)?.label || lightbox.style}</span>
              <div className="truncate" title={lightbox.prompt}>{lightbox.prompt}</div>
            </div>
            <div className="flex gap-2 items-center" onClick={e => e.stopPropagation()}>
              <a href={lightbox.image_url} download={`render-${lightbox.id}.png`} target="_blank"
                 className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs">
                💾 下載原圖
              </a>
              <a href={lightbox.image_url} target="_blank" rel="noreferrer"
                 className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs">
                🔗 開新分頁
              </a>
              <button onClick={() => { setEditTarget(lightbox); setLightbox(null) }}
                      className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-xs">
                ✏ 改這張
              </button>
              <button onClick={() => setLightbox(null)}
                      className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs">
                ✕ 關閉
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img src={lightbox.image_url} alt=""
                 className="max-w-full max-h-full object-contain"
                 onClick={e => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  )
}
