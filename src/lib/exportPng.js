/**
 * 匯出 SVG 畫布成 PNG 下載。
 * 找出第一個 <svg> 元素,序列化後用 <img> + canvas 轉 PNG。
 */
/**
 * 取得當前畫布的 PNG dataURL,不下載,給 AI 渲染用
 * @param {number} scale - 倍率,給 AI 用建議 2.5 (高解析,AI 看得清楚)
 * @param {Object} opts
 *   - hideBaseLayer: 移除底圖 PDF 圖片 (預設 false)。給 AI 看時建議 true,
 *     因為底圖通常模糊,AI 會被它誤導
 */
export async function captureCanvasAsDataUrl(scale = 2, opts = {}) {
  const { hideBaseLayer = false } = opts
  const svg = document.querySelector('.canvas-svg') || document.querySelector('svg')
  if (!svg) throw new Error('找不到畫布 — 請確認目前在 2D 編輯頁')

  const cloned = svg.cloneNode(true)
  const images = cloned.querySelectorAll('image')
  for (const img of images) {
    if (hideBaseLayer) {
      // 砍掉所有 <image> (底圖 PDF / JPG),只留你畫的結構
      img.parentNode?.removeChild(img)
      continue
    }
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
    } catch (e) { console.warn('外部圖片載入失敗', href) }
  }
  const xml = new XMLSerializer().serializeToString(cloned)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const w = svg.viewBox.baseVal.width || svg.clientWidth
    const h = svg.viewBox.baseVal.height || svg.clientHeight
    const canvas = document.createElement('canvas')
    canvas.width = w * scale; canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function exportCanvasToPng(filename = 'plan.png', scale = 2) {
  const svg = document.querySelector('.canvas-svg') || document.querySelector('svg')
  if (!svg) throw new Error('找不到畫布')

  // 把 svg 整個轉成字串
  const cloned = svg.cloneNode(true)
  // 處理外部圖片 (Supabase signedUrl 的 image href) — 轉成 data URI
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
    } catch (e) {
      console.warn('無法載入圖片,匯出時跳過', href)
    }
  }

  const xml = new XMLSerializer().serializeToString(cloned)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const w = svg.viewBox.baseVal.width || svg.clientWidth
    const h = svg.viewBox.baseVal.height || svg.clientHeight
    const canvas = document.createElement('canvas')
    canvas.width = w * scale; canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const pngUrl = canvas.toDataURL('image/png')
    triggerDownload(pngUrl, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}
function triggerDownload(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
}
