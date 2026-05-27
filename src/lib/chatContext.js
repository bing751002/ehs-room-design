/**
 * RAG Context 載入 helper
 * — 統一給 ChatPanel / AuditPage / CritiquePage 用
 * — 依使用者最新訊息偵測空間類型,從案例庫/法規/規則/房型撈相關內容
 */
import { searchSimilarCases, caseToPromptText } from './caseLibrary.js'
import { listRules, rulesToPromptText } from './internalRules.js'
import { listRegulations, regsToPromptText } from './regulations.js'
import { listRoomTemplates } from './roomTemplates.js'

const SPACE_TYPE_MAP = {
  '辦公': 'office', '會議': 'meeting', '茶水': 'pantry',
  '健身': 'gym', 'spa': 'sauna', '三溫暖': 'sauna',
  '淋浴': 'shower', '更衣': 'locker', '休息': 'lounge',
  '酒店': 'lounge', '客房': 'lounge', '餐廳': 'pantry',
  '電競': 'gym', '診所': 'meeting'
}

export function detectSpaceTypes(text) {
  const lowered = (text || '').toLowerCase()
  const found = []
  for (const [k, v] of Object.entries(SPACE_TYPE_MAP)) {
    if (lowered.includes(k) && !found.includes(v)) found.push(v)
  }
  return found
}

/**
 * 組 RAG context — 每項都有 try/catch 不影響其他項
 * @param {string} userText - 使用者最新訊息 (用來偵測空間類型)
 * @param {Object} opts - { includeRules, includeRegs, includeCases, includeTemplates }
 * @returns {Promise<{rulesContext, regsContext, casesContext, templatesContext}>}
 */
export async function buildRAGContext(userText, opts = {}) {
  const {
    includeRules = true,
    includeRegs = true,
    includeCases = true,
    includeTemplates = true
  } = opts

  const detected = detectSpaceTypes(userText)
  const result = { rulesContext: '', regsContext: '', casesContext: '', templatesContext: '' }

  const tasks = []

  if (includeRules) {
    tasks.push(
      listRules({ activeOnly: true })
        .then(rules => { result.rulesContext = rulesToPromptText(rules) })
        .catch(e => console.warn('內部規則載入失敗', e))
    )
  }

  if (includeRegs) {
    tasks.push(
      listRegulations({ activeOnly: true })
        // 把 userText 傳進去,讓 regs 能依「§79」「防火區劃」這類關鍵字檢索相關條文
        .then(regs => { result.regsContext = regsToPromptText(regs, detected, userText) })
        .catch(e => console.warn('法規庫載入失敗', e))
    )
  }

  if (includeCases && detected.length) {
    tasks.push(
      searchSimilarCases({ spaceTypes: detected, topK: 5 })
        .then(top => {
          if (top?.length) {
            result.casesContext = '\n\n# 📚 相關歷史案例 (從東森團隊累積案例庫檢索)\n' +
              '> 每個案例都標註了「圖紙類型」與「時期」,使用時請注意:\n' +
              '> - 🟢 **現行/已完工** = 真實落地經驗,**最高權重**參考\n' +
              '> - 🟡 **規劃中** = 進行中,可借鑑\n' +
              '> - ⚪ **歷史/已改建** = 僅供「曾這樣做過」參考,**不要直接複製**\n' +
              '> - 🔵 **純參考圖** = 網路靈感,**只當美感參考**\n\n' +
              top.map(x => caseToPromptText(x.case)).join('\n\n')
          }
        })
        .catch(e => console.warn('案例庫檢索失敗', e))
    )
  }

  if (includeTemplates) {
    tasks.push(
      listRoomTemplates()
        .then(ts => {
          if (ts?.length) {
            result.templatesContext = '\n\n# 📚 使用者自訂房間庫 (規劃時優先使用這些尺寸與設計考量):\n' +
              ts.slice(0, 30).map(t => `- ${t.name} [${t.type}] ${t.width_cm}×${t.depth_cm}×${t.height_cm}cm${t.description ? ' — ' + t.description : ''}`).join('\n')
          }
        })
        .catch(e => console.warn('房間庫載入失敗', e))
    )
  }

  await Promise.all(tasks)
  return result
}
