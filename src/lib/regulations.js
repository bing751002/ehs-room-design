/**
 * 法規庫 CRUD + RAG 檢索
 */
import { supabase } from './supabase.js'
import { extractForAI } from './fileExtract.js'

export const REG_CATEGORIES = [
  { value: '建築',     label: '🏗 建築 (建築技術規則...)' },
  { value: '消防',     label: '🚒 消防 (各類場所消防安全設備設置標準...)' },
  { value: '無障礙',   label: '♿ 無障礙設施' },
  { value: '室內裝修', label: '🪑 室內裝修管理辦法' },
  { value: '勞安',     label: '⛑ 勞工安全衛生' },
  { value: '環保',     label: '🌱 環保 / 廢棄物' },
  { value: 'SPA/三溫暖', label: '♨️ SPA / 三溫暖規範' },
  { value: '餐飲',     label: '🍽 餐飲業規範' },
  { value: '健身',     label: '💪 運動健身場館' },
  { value: '酒店',     label: '🏨 觀光旅館 / 民宿' },
  { value: '診所',     label: '🏥 醫療機構' },
  { value: '其他',     label: '其他' }
]

export async function listRegulations({ activeOnly = true } = {}) {
  let q = supabase.from('regulations').select('*')
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: false })
  if (activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) {
    if (error.code === 'PGRST205' || /regulations/i.test(error.message || '')) {
      console.warn('[regulations] regulations 表還沒建,請跑 supabase/regulations_schema.sql')
      return []
    }
    throw error
  }
  return data || []
}

export async function createRegulation(input) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const { data, error } = await supabase.from('regulations').insert({
    owner: user.id, ...input
  }).select().single()
  if (error) throw error
  return data
}

export async function updateRegulation(id, patch) {
  const { data, error } = await supabase.from('regulations').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function removeRegulation(id) {
  const { error } = await supabase.from('regulations').delete().eq('id', id)
  if (error) throw error
}

/** 上傳附件 (PDF/Word) 並抽出文字 — 自動帶進 form */
const BUCKET = 'plan-assets'
export async function uploadRegulationFile(file) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const ts = Date.now()
  const safeName = file.name.replace(/[^\w.-]/g, '_')
  const path = `${user.id}/regulations/${ts}_${safeName}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data: signed } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5)  // 5 年有效
  // 同時抽文字
  let extracted = ''
  try {
    const data = await extractForAI(file)
    if (data.type === 'text') extracted = data.text
  } catch (e) { console.warn('抽文字失敗', e) }
  return { url: signed.signedUrl, extractedText: extracted }
}

/**
 * 把 active 法規格式化成 prompt
 *
 * 策略 — 避免 AI 看不到關鍵條文又抓不到 token:
 *  1. 從 userQuery 抽出關鍵字 (§ 條號、章節、業態關鍵字)
 *  2. 對每部法規,優先抓「含關鍵字的條文段落」(含前後文)
 *  3. 沒命中關鍵字 → 才退回 summary / 前段截斷
 *  4. 整體 token 預算 ≤ ~12000 字 (≈ 4000 token)
 *
 * @param {Array} regs - 法規清單
 * @param {Array} applicableTypes - 適用空間類型 (filter 用)
 * @param {string} userQuery - 使用者本次提問 (給關鍵字檢索用,可選)
 */
export function regsToPromptText(regs, applicableTypes = [], userQuery = '') {
  if (!regs?.length) return ''

  // 把法規分兩組:applicableTypes 命中的 (高優先) + 其他 (備援)
  // **不再硬性 filter 掉沒命中的**, 因為使用者問「§79」時不需要看 sauna applies_to
  const matched = []
  const others = []
  for (const r of regs) {
    if (!applicableTypes.length || !r.applies_to_space_types?.length ||
        r.applies_to_space_types.some(t => applicableTypes.includes(t))) {
      matched.push(r)
    } else {
      others.push(r)
    }
  }
  const ordered = [...matched, ...others]

  // 從 userQuery 抽關鍵字:條號、章節、業態詞
  const keywords = extractRegKeywords(userQuery)

  // 預算策略 (claude-opus 上限 200k token,可大方一點)
  //   - 命中關鍵字的法規:可給較大段落 (8000 字)
  //   - 沒命中的法規:只給標題+摘要 (100-300 字),不浪費 token
  //   - 整體上限 60000 字 (≈ 20000 token,留足夠空間給對話)
  const MAX_TOTAL_CHARS = 60000
  const PER_REG_MAX_HIT = 8000
  const PER_REG_MAX_NOHIT_SUMMARY = 300   // 沒命中只給簡介
  let budget = MAX_TOTAL_CHARS
  const blocks = []

  // 先處理命中關鍵字的 → 優先給足空間
  const hitBlocks = []
  const missBlocks = []
  for (const r of ordered) {
    const head = `## ${r.title}${r.authority ? ` (${r.authority})` : ''}`
    let body = ''
    let hit = false
    if (r.content && keywords.length) {
      const matched2 = extractRelevantSections(r.content, keywords, PER_REG_MAX_HIT)
      if (matched2) {
        body = matched2
        hit = true
      }
    }
    if (hit) {
      hitBlocks.push({ head, body })
    } else {
      // 沒命中:只給簡短說明 (summary 或 content 前 300 字),AI 知道「有這部法規」但要時可用 tool 撈
      const brief = r.summary
        ? r.summary.slice(0, PER_REG_MAX_NOHIT_SUMMARY)
        : (r.content
            ? r.content.slice(0, PER_REG_MAX_NOHIT_SUMMARY)
            : '(無摘要)')
      missBlocks.push({ head, body: `${brief}\n_(本次未命中關鍵字,如需詳細條文請呼叫 lookup_regulation tool)_` })
    }
  }

  // 命中的先塞,再塞未命中(只塞簡介,確保 AI 知道有哪些法規可查)
  for (const b of [...hitBlocks, ...missBlocks]) {
    const len = b.head.length + b.body.length + 10
    if (len > budget) {
      // 剩餘預算不足放完整 body,只塞 head 讓 AI 知道有這部
      if (budget > b.head.length + 50) {
        blocks.push(`${b.head}\n_(超出 token 預算,請呼叫 lookup_regulation('${b.head.replace(/^## /, '').slice(0, 30)}') 取得內容)_`)
        budget -= b.head.length + 50
      }
      continue
    }
    blocks.push(`${b.head}\n${b.body}`)
    budget -= len
  }

  const lines = [
    '\n\n# 📖 適用法規 (從你已建立的法規庫檢索)',
    '> 以下是政府公告的強制性法規條文,**這些是已收錄在法規庫的真實原文摘錄**',
    '> ⚠️ 鐵則:',
    '> 1. 若某條號沒出現在下面,只代表「本次依關鍵字篩選後沒命中」,**並非「法規庫沒收錄」**',
    '> 2. 嚴禁回覆「法規庫無此條文」「未收錄在本次提供的法規庫中」這類話',
    '> 3. 條號沒命中時,正確回應方式:「請於問題中明確提及 §條號或主題,系統會重新檢索」',
    '> 4. 不可叫使用者去 law.moj.gov.tw 自己查 — 法規庫已經有,只是這次檢索沒命中',
    blocks.join('\n\n---\n\n')
  ]
  return lines.join('\n')
}

/**
 * 從使用者提問抽關鍵字:條號、章節編號、業態詞、常見法規關鍵字
 * 條號自動展開阿拉伯數字 ↔ 中文數字,以涵蓋法規原文兩種寫法
 */
function extractRegKeywords(query) {
  if (!query) return []
  const out = new Set()
  // 1. 阿拉伯數字條號 (§79 / 第79條 / 第79-2條)
  const arabRegex = /§\s*(\d+(?:[-之]\d+)?)|第\s*(\d+(?:[-之]\d+)?)\s*條/g
  let m
  while ((m = arabRegex.exec(query))) {
    const num = m[1] || m[2]
    if (num) addSectionVariants(out, num)
  }
  // 2. 中文數字條號 (第七十九條 / 第九十三條)
  const cnRegex = /第\s*([零一二三四五六七八九十百千〇○]+(?:之[零一二三四五六七八九十]+)?)\s*條/g
  while ((m = cnRegex.exec(query))) {
    const arab = cnToArab(m[1])
    if (arab) addSectionVariants(out, String(arab))
  }
  // 3. 常見業態詞 / 法規關鍵字 (含同義詞展開)
  // 包含「主題詞 → 同義詞家族」自動展開,即使使用者只提一個詞,也會帶出相關詞
  const TERM_FAMILIES = [
    // 防火 / 消防
    ['防火區劃', '防火', '區劃', '防火門', '防火構造', '防火時效'],
    ['避難', '避難距離', '避難通道', '避難方向', '步行距離', '避難層'],
    ['樓梯', '安全梯', '直通樓梯', '特別安全梯', '梯間', '梯廳'],
    ['撒水', '灑水', '自動撒水', '撒水頭', '撒水設備'],
    ['排煙', '排煙設備', '排煙窗', '排煙口'],
    ['消防', '消防栓', '消防設備', '緊急照明', '緊急電源', '出口標示'],
    ['火警', '火災', '火災探測', '感知器'],
    // 建築
    ['採光', '開窗', '採光面積'],
    ['通風', '通風面積', '換氣'],
    ['走廊', '走道', '通道', '走道寬', '走廊寬'],
    ['居室', '使用面積', '樓地板面積', '專有部分'],
    ['天花', '淨高', '樓高', '天花板'],
    ['出口', '雙出口', '出入口'],
    ['容留', '容留人數', '人數', '使用人數密度'],
    ['寬度', '淨寬', '有效寬度'],
    ['建蔽率', '容積率', '基地'],
    ['退縮', '開口', '帷幕'],
    ['高層', '高層建築', '超高層'],
    ['室內裝修', '裝修', '裝修審查'],
    ['類組', '使用類組', '組別', '變更使用'],
    // 無障礙
    ['無障礙', '輪椅', '坡道', '無障礙電梯', '無障礙廁所'],
    // 業態
    ['辦公', '辦公室', 'G類', 'G2', 'G-2', 'G類組'],
    ['商業', 'B類', 'B-2', 'B2'],
    ['住宿', '酒店', '旅館', '客房', 'H類', 'H-1', 'H-2'],
    ['餐廳', '餐飲', '廚房', '油脂截留', '排油煙'],
    ['會議', '會議室'],
    ['茶水', '茶水間'],
    ['健身', '健身房', 'D-1', 'D1類組'],
    ['SPA', 'spa', '三溫暖', '美容', '美髮', '蒸氣', '乾蒸', '濕蒸'],
    ['淋浴', '淋浴間', '更衣', '更衣室', '盥洗'],
    ['休息', '休息區', 'lounge', '交誼'],
    ['電競', '電子遊戲'],
    ['診所', '醫療', 'F類', 'F-1', '候診', '診間'],
    // 防滑、安全
    ['防滑', '防滑等級', 'IPX4'],
    // 第六種產業
    ['第六種產業', '產業專區', '產業園區', '產業類'],
    // 結構
    ['耐震', '結構', '地震力'],
    // 室內環境
    ['電氣', '電力'],
    ['給水', '排水', '衛生']
  ]
  for (const fam of TERM_FAMILIES) {
    // 任一同義詞被提到,就把整家族全部加入關鍵字集
    if (fam.some(t => query.includes(t))) {
      for (const t of fam) out.add(t)
    }
  }
  // 4. 業態類組 (A-1 / B-2 / D-1 / G-2 / H-1 等)
  const classRegex = /\b([A-H])[-－]?(\d+)\b/g
  while ((m = classRegex.exec(query))) {
    out.add(`${m[1]}-${m[2]}`)
    out.add(`${m[1]}${m[2]}`)
    out.add(`${m[1]}類`)
  }
  return Array.from(out)
}

// 把「§79」「§79-2」「§79之2」等多種寫法加入關鍵字集合
function addSectionVariants(set, num) {
  // num 可能是 "79" / "79-2" / "79之2"
  const arabNum = num.replace(/之/g, '-')
  const parts = arabNum.split('-')
  set.add(`§${arabNum}`)
  set.add(`第${arabNum}條`)
  set.add(`第${parts[0]}條`)
  // 中文數字版本
  const cn = arabToCn(Number(parts[0]))
  if (cn) {
    if (parts[1]) {
      const cn2 = arabToCn(Number(parts[1]))
      set.add(`第${cn}條之${cn2}`)
      set.add(`第${cn}條之${parts[1]}`)
    }
    set.add(`第${cn}條`)
  }
}

// 阿拉伯數字 → 中文 (1-999, 法規條號用)
function arabToCn(n) {
  if (!Number.isFinite(n) || n < 0 || n > 999) return null
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n === 0) return '零'
  if (n < 10) return digits[n]
  if (n < 20) return n === 10 ? '十' : '十' + digits[n - 10]
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10
    return digits[t] + '十' + (o ? digits[o] : '')
  }
  // 100-999
  const h = Math.floor(n / 100), rest = n % 100
  let s = digits[h] + '百'
  if (rest === 0) return s
  if (rest < 10) return s + '零' + digits[rest]
  if (rest === 10) return s + '一十'
  if (rest < 20) return s + '一十' + digits[rest - 10]
  const t = Math.floor(rest / 10), o = rest % 10
  return s + digits[t] + '十' + (o ? digits[o] : '')
}

// 中文數字 → 阿拉伯 (簡版,夠用於法規條號)
function cnToArab(s) {
  if (!s) return null
  const map = { 零: 0, 〇: 0, '○': 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  // 純單字 (一-九)
  if (s.length === 1 && map[s] != null) return map[s]
  // 十 / 十X
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (map[s[1]] || 0)
  // 兩位 X十Y / X十
  if (s.length === 2 && s[1] === '十') return map[s[0]] * 10
  if (s.length === 3 && s[1] === '十') return map[s[0]] * 10 + (map[s[2]] || 0)
  // 百
  if (s.includes('百')) {
    const idx = s.indexOf('百')
    const h = map[s[idx - 1]] || 1
    const rest = s.slice(idx + 1)
    if (!rest) return h * 100
    if (rest.startsWith('零')) return h * 100 + (map[rest[1]] || 0)
    if (rest.startsWith('一十')) return h * 100 + 10 + (map[rest[2]] || 0)
    return h * 100 + cnToArab(rest)
  }
  return null
}

/**
 * 從整部法規全文中,擷取含關鍵字的條文段落 (含前後 context)
 * 條文以 "第N條" 為單位切分
 */
function extractRelevantSections(fullText, keywords, maxChars = 2000) {
  if (!fullText || !keywords.length) return ''
  // 切成條文 — 法規通常用「第 N 條」或「第N條」分段
  const articleRegex = /(第\s*\d+(?:-\d+)?\s*條[^第]*?(?=第\s*\d+(?:-\d+)?\s*條|$))/g
  const articles = fullText.match(articleRegex) || []

  // 如果切不出條文,fallback:用換行切段
  const segments = articles.length > 3 ? articles : fullText.split(/\n{2,}/)

  // 對每段算命中數,有命中就收
  const scored = []
  for (const seg of segments) {
    let score = 0
    for (const k of keywords) {
      if (seg.includes(k)) score += k.startsWith('§') || k.startsWith('第') ? 5 : 1
    }
    if (score > 0) scored.push({ seg, score })
  }
  if (!scored.length) return ''

  // 高分先取,合計到 maxChars
  scored.sort((a, b) => b.score - a.score)
  const out = []
  let total = 0
  for (const { seg } of scored) {
    if (total >= maxChars) break
    out.push(seg.trim())
    total += seg.length
  }
  return out.join('\n\n---\n\n')
}
