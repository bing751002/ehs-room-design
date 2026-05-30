/**
 * AutoCAD Color Index (ACI) → CSS hex 對照
 *
 * ACI 規格:
 *   0       BYBLOCK (繼承 BLOCK reference 的 color)
 *   1-9     命名色 (Red/Yellow/Green/Cyan/Blue/Magenta/Black/Dark Gray/Light Gray)
 *   10-249  HSV gradient (10 個 hue × 5 brightness/saturation)
 *   250-255 灰階
 *   256     BYLAYER (繼承 layer 的 color)
 *
 * 渲染策略:
 *   entity 解析時呼叫 resolveEntityColor(entity, layerColor, blockColor),
 *   把最終 CSS hex 寫進 line/text 的 color 欄位,Canvas2D 直接 stroke/fill 用。
 */

export const DEFAULT_LINE_COLOR = '#1e293b'  // slate-800 — 沒解析到 color 時的 fallback

// ACI 命名色 (1-9)
const NAMED_COLORS = {
  1: '#FF0000',  // Red
  2: '#FFBF00',  // Yellow (稍微暖一點,純黃太刺眼)
  3: '#00B050',  // Green (CAD 標準綠)
  4: '#00B0F0',  // Cyan
  5: '#0070C0',  // Blue (深一點,純藍對白底太亮)
  6: '#C000C0',  // Magenta
  7: '#000000',  // White/Black — 白底時用黑
  8: '#595959',  // Dark Gray
  9: '#A6A6A6'   // Light Gray
}

// 250-255 灰階 (Autodesk 規格)
const GRAYSCALE = {
  250: '#333333',
  251: '#5B5B5B',
  252: '#848484',
  253: '#ADADAD',
  254: '#D6D6D6',
  255: '#FFFFFF'
}

/**
 * 10-249 用 HSV gradient 程式生成 (近似 Autodesk 公式)
 * 每 10 個 ACI = 一個 hue(0-360),hue 內 5 個亮度變化
 */
function aciGradient(index) {
  if (index < 10 || index > 249) return null
  const i = index - 10
  const hueIdx = Math.floor(i / 10)   // 0-23
  const briIdx = i % 10                // 0-9
  const hue = (hueIdx * 15) % 360      // 24 個 hue
  // 0-4: 高飽和漸暗,5-9: 低飽和漸亮 (粗略)
  let s, v
  if (briIdx < 5) {
    s = 1
    v = 1 - briIdx * 0.15
  } else {
    s = 1 - (briIdx - 5) * 0.2
    v = 1
  }
  return hsvToHex(hue, s, v)
}

function hsvToHex(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r, g, b
  if (h < 60)       { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  const to = n => Math.round((n + m) * 255).toString(16).padStart(2, '0').toUpperCase()
  return '#' + to(r) + to(g) + to(b)
}

/**
 * ACI index → CSS hex。
 * @param {number|null|undefined} index ACI value (0-256)
 * @returns {string|null} hex (e.g. "#FF0000") 或 null 代表「請呼叫端 fallback」
 */
export function aciToHex(index) {
  if (index == null) return null
  if (index === 0) return null      // BYBLOCK — 呼叫端要解析
  if (index === 256) return null    // BYLAYER — 呼叫端要解析
  if (NAMED_COLORS[index]) return NAMED_COLORS[index]
  if (GRAYSCALE[index]) return GRAYSCALE[index]
  return aciGradient(index)
}

/**
 * 從 dxf.tables 拿 layer 的 ACI color (BYLAYER 時用)。
 *
 * dxf-parser 1.1.2 的 layer object:
 *   - colorIndex: ACI 整數 (1-256)  ← 用這個
 *   - color: 已轉好的 RGB 整數 (truecolor),非 ACI
 */
export function getLayerColor(layerName, dxfTables) {
  if (!layerName || !dxfTables?.layer?.layers) return null
  const layer = dxfTables.layer.layers[layerName]
  if (!layer) return null
  const idx = layer.colorIndex
  if (idx == null) return null
  return aciToHex(Math.abs(idx))
}

/**
 * 解析 entity 最終 color。
 *
 * dxf-parser 1.1.2 的 entity object (ParseHelpers.js:63):
 *   - colorIndex: ACI 整數 (group code 62 的原值)  ← 用這個
 *   - color: 已轉好的 RGB 整數,非 ACI
 *   - 若 entity 沒指定 group code 62,colorIndex = undefined,實際語意是 BYLAYER (256)
 *
 * @param {Object} entity dxf entity
 * @param {string|null} layerColor BYLAYER fallback
 * @param {string|null} blockColor BYBLOCK fallback (INSERT 繼承時傳入)
 */
export function resolveEntityColor(entity, layerColor, blockColor) {
  const idx = entity?.colorIndex
  if (idx == null) return layerColor || DEFAULT_LINE_COLOR   // 沒指定 = BYLAYER
  if (idx === 0) return blockColor || layerColor || DEFAULT_LINE_COLOR
  if (idx === 256) return layerColor || DEFAULT_LINE_COLOR
  return aciToHex(idx) || layerColor || DEFAULT_LINE_COLOR
}
