import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { usePlanStore } from '../store/planStore.js'
import { generateRender, renderFromPlan, editRender, getStylePresets, renderReady } from '../lib/renderApi.js'
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
  const [mode, setMode] = useState('from-plan') // 'from-plan' | 'text-only'
  const [viewType, setViewType] = useState('interior') // 'interior' | 'plan'
  const styles = getStylePresets()

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

  // 從 2D 畫布截圖 → base64 PNG。要求使用者先回 2D 編輯頁畫過東西。
  async function captureCanvasPng() {
    // 嘗試從 DOM 找 SVG (在 /editor 路由才會渲染)
    const svg = document.querySelector('.canvas-svg')
    if (!svg) {
      // 暫時導使用者去 2D 編輯,渲染畢竟需要平面
      throw new Error('找不到平面圖,請先到「2D 編輯」頁畫過東西,再回來這裡渲染')
    }
    // 處理外部圖片轉 data URI (沿用 exportPng 邏輯,但回 data URL 不下載)
    const cloned = svg.cloneNode(true)
    const images = cloned.querySelectorAll('image')
    for (const img of images) {
      const href = img.getAttribute('href') || img.getAttribute('xlink:href')
      if (!href) continue
      try {
        const res = await fetch(href)
        const blob = await res.blob()
        const dataUri = await new Promise((r) => {
          const fr = new FileReader()
          fr.onload = () => r(fr.result)
          fr.readAsDataURL(blob)
        })
        img.setAttribute('href', dataUri)
      } catch (e) {}
    }
    const xml = new XMLSerializer().serializeToString(cloned)
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image()
        i.onload = () => res(i); i.onerror = rej
        i.src = url
      })
      const w = svg.viewBox.baseVal.width || svg.clientWidth
      const h = svg.viewBox.baseVal.height || svg.clientHeight
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(w, 2048)
      canvas.height = Math.round(canvas.width * h / w)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png')
    } finally { URL.revokeObjectURL(url) }
  }

  async function onGenerate() {
    if (!renderReady) { setErr('請先在 .env.local 填入 VITE_GEMINI_API_KEY 並重啟 dev'); return }
    setErr(''); setBusy(true)
    try {
      let dataUrl
      let usedPrompt = prompt
      if (mode === 'from-plan') {
        // 從平面圖渲染 — 自動補上空間清單,prompt 可有可無
        const planPng = await captureCanvasPng()
        dataUrl = await renderFromPlan({
          planImageDataUrl: planPng,
          plan, style, extra: prompt, viewType
        })
        usedPrompt = `[從平面圖 - ${viewType === 'plan' ? '俯瞰' : '室內視角'}] ${prompt}`
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
        prompt: usedPrompt, style, image_url: publicUrl, cost_usd: 0.04
      })
      await reload()
    } catch (e) {
      setErr(e.message)
    } finally { setBusy(false) }
  }

  async function onEdit() {
    if (!editTarget || !editPrompt.trim()) return
    setBusy(true); setErr('')
    try {
      const newDataUrl = await editRender({ imageUrl: editTarget.image_url, editPrompt })
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
          <h2 className="text-xl font-semibold">🎨 渲染圖廊 <span className="text-xs text-slate-500 ml-2">Gemini Imagen 4</span></h2>
          <p className="text-sm text-slate-600 mt-1">
            選風格 + 描述場景 → 5-15 秒生圖。每張約 $0.04 USD,免費 tier 每天 50 張。
            生圖後可點「✏ 編輯這張」直接改細節 (例如換材質/換家具)。
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

          {/* 視角 (只有 from-plan 模式才顯示) */}
          {mode === 'from-plan' && (
            <div>
              <label className="block text-xs font-medium mb-1">視角</label>
              <div className="flex gap-1.5 text-xs">
                <button onClick={() => setViewType('interior')}
                        className={`px-3 py-1 rounded border ${viewType === 'interior' ? 'bg-brand-700 text-white' : 'bg-slate-50'}`}>
                  🚶 室內視角 (站在裡面看,給老闆看用)
                </button>
                <button onClick={() => setViewType('plan')}
                        className={`px-3 py-1 rounded border ${viewType === 'plan' ? 'bg-brand-700 text-white' : 'bg-slate-50'}`}>
                  🗺 俯瞰平面 (帶材質的平面渲染圖)
                </button>
              </div>
            </div>
          )}

          {/* 平面圖預覽 (只在 from-plan 模式下顯示) */}
          {mode === 'from-plan' && (
            <div>
              <label className="block text-xs font-medium mb-1">AI 看到的平面圖預覽</label>
              <div className="border rounded overflow-hidden h-48 bg-slate-100">
                <Canvas2D />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                ↑ AI 會根據這張平面圖的結構去生圖 (可拖移/縮放查看)
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">風格</label>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {styles.map(s => (
                <button key={s.id} onClick={() => setStyle(s.id)}
                        className={`px-2 py-1 rounded border ${style === s.id ? 'bg-brand-700 text-white' : 'bg-slate-50 hover:bg-slate-100'}`}>
                  {s.label}
                </button>
              ))}
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
          <button onClick={onGenerate} disabled={busy || !renderReady}
                  className="px-4 py-2 bg-brand-700 text-white rounded hover:bg-brand-500 disabled:opacity-40">
            {busy && !editTarget ? '渲染中 (10-30 秒)…' : (mode === 'from-plan' ? '🏗 從平面圖渲染' : '🎨 生成渲染圖')}
          </button>
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
              {renders.map(r => (
                <div key={r.id} className="bg-white border rounded-lg overflow-hidden">
                  <img src={r.image_url} alt="" className="w-full aspect-video object-cover" />
                  <div className="p-2 text-xs space-y-1">
                    <div className="font-medium line-clamp-2" title={r.prompt}>{r.prompt}</div>
                    <div className="text-slate-500 flex justify-between items-center">
                      <span>{styles.find(s => s.id === r.style)?.label || r.style}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setEditTarget(r)}
                                className="text-amber-600 hover:underline">✏ 改</button>
                        <button onClick={() => onDelete(r)}
                                className="text-red-500 hover:underline">刪</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
