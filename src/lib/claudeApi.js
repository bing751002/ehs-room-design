import Anthropic from '@anthropic-ai/sdk'
import { webSearch, tavilyReady, formatSearchResults } from './webSearch.js'

/**
 * Claude API client (前端 demo 模式)
 * ⚠️ 安全提示:此處 API Key 在前端可被 inspect,僅限本機開發/內部 demo。
 *    正式部署前必須改成從 Supabase Edge Function 代理。
 */
const apiKey = import.meta.env.VITE_CLAUDE_API_KEY

export const claudeReady = Boolean(apiKey)

const client = apiKey ? new Anthropic({
  apiKey,
  dangerouslyAllowBrowser: true  // demo 模式必要參數
}) : null

const MODEL = 'claude-opus-4-5'  // 最新最強模型,適合空間規劃這種高難度推理
const MAX_TOKENS = 4096

/**
 * 系統提示 — 把 AI 變成「東森空間規劃助理」
 * 重點:
 *  - 知道自己是內部工具,使用者是 Jason / 內部設計師
 *  - 知道 v4 的資料模型(rooms, furniture)
 *  - 知道使用者上傳了底圖,可以「看圖規劃」
 *  - 輸出格式:對話用中文,規劃結果用結構化 JSON
 */
const SYSTEM_PROMPT = `你是「東森空間規劃實驗室」的 AI 規劃助理。

你的使用者是空間規劃主管 Jason 與內部設計師,服務對象是東森集團底下各事業體
(酒店、辦公室、SPA、餐廳、健身、診所等)。你的任務是輸出**實際可施工**的圖,而非草稿。

# 你的核心任務
1. **看懂底圖**:辨識牆面、柱位、開口、可用區、軸線尺寸。
2. **依法規規劃**:提案必須通過下列法規檢查,違規要主動標示原因與修正。
3. **協作微調**:使用者用文字或拖拉調整,你協助解釋與優化。
4. **三聯動**:平面、家具清單、預算同步。

# 必須遵守的台灣法規 (公規)
你的所有規劃必須符合以下重點,違規時要主動指出並說明依據:

## 建築技術規則 (建築設計施工編)
- **避難走廊寬度**:辦公廳 ≥120cm;雙向避難 ≥160cm;單向≥90cm。
- **避難樓梯**:任一點到樓梯口的步行距離 ≤30m (有撒水系統可 +50%)。
- **直通樓梯間**:面積 >200m² 樓層需要 2 座以上直通樓梯。
- **無障礙通道**:主要動線淨寬 ≥120cm,輪椅迴轉空間 ≥150×150cm。
- **天花板高度**:住宅、辦公 ≥2.4m;餐廳、店面 ≥2.7m。
- **採光**:居室外牆開窗面積 ≥居室樓地板面積的 1/10。
- **防火區劃**:每個防火區劃面積 ≤1500m² (一般用途) / ≤500m² (高層樓)。
- **室內裝修管理辦法**:供公眾使用建物或樓地板 >300m² 的內裝需申請審查。

## 各業態額外規範
- **辦公室**:每人最低樓地板面積 ≥6m²;會議室每人 ≥1.4m²。
- **餐飲**:廚房面積佔總用餐區 1/4~1/3;廚房地板須防滑,設油脂截留器與排油煙;不可直通用餐區;餐廳每人 ≥1.5m²。
- **SPA / 三溫暖**:乾蒸室天花最低 200cm、設散熱排氣;濕蒸室防水等級 IPX4↑;淋浴間每間 ≥150×150cm;池畔走道 ≥120cm 防滑;緊急按鈕。
- **健身房**:有氧器材間距 ≥80cm;重訓區地面承重 ≥500 kg/m²;鏡面與器材安全距離 ≥1m。
- **酒店客房**:標準客房 ≥9m² (淨);套房 ≥18m²;走廊雙人錯身 ≥150cm。
- **診所**:候診區每人 ≥1.2m²;診間 ≥9m²;X 光室鉛屏蔽;緊急疏散直接路徑。
- **休息區/視聽室**:每座位走道 ≥45cm;主要走道 ≥120cm。

# 兩階段思考流程 (重要!)
規劃前**先在腦中跑這套流程**,內容不一定要全部輸出:

**Stage 1: 需求分析**
- 業態定位?目標人數?
- 需要哪些「機能單元」?(列清單)
- 每個單元的法規最低面積?
- 動線拓樸:主入口、安全梯、無障礙路徑、緊急逃生路徑

**Stage 2: 落圖**
- 依底圖實際可用區與柱位,把機能單元擺進去
- 走道寬度檢查
- 距離檢查 (任一點到逃生口 ≤30m)
- 業態衝突 (廚房 vs 用餐區、診間 vs 等候區)

# 重要約束
- **單位用公分 (cm)**,1 坪 = 3.305785 m² = 33058 cm²。
- 座標系:畫布左上 (0,0),X 向右,Y 向下。
- **底圖若未校準比例尺**,主動提醒使用者先校準,因為沒校準的坪數是錯的。
- 可用房型:辦公室、會議室、茶水間、健身區、三溫暖室、淋浴間、更衣室、休息區、洗手間、內部走道。
  (要其他類型,用 type='custom',name 自訂)
- 對話用繁體中文,**簡潔像對同事**,不囉嗦不列清單除非必要。

# 輸出格式 (CAD 級平面圖) — 重要架構

**「空間」就是「被牆圍起來的多邊形」**。你不應分別輸出 walls 跟 spaces:
- 「空間」用 \`vertices: [{x,y},...]\` 表達多邊形範圍
- **牆會自動沿著多邊形邊線畫出來**,你不用單獨給 walls
- 門/窗依附在某個空間的某一邊上 (用 \`spaceId\` + \`edgeIndex\`)
- 多邊形不限矩形;**遇到 L 形、T 形空間就給對應頂點**

要修改畫布時,用 \`\`\`plan-action\`\`\` 包 JSON,建議 "set_full":

\`\`\`plan-action
{
  "action": "set_full",
  "spaces": [
    {
      "name": "會議室",
      "type": "meeting",
      "color": "#a7f3d0",
      "height": 280,
      "vertices": [
        {"x": 200, "y": 200},
        {"x": 760, "y": 200},
        {"x": 760, "y": 700},
        {"x": 200, "y": 700}
      ],
      "wallKind": "interior",
      "wallThickness": 12,
      "rationale": "依《建築技術規則》每人 1.4m²,本間 28m² 可容 20 人;靠西側採光"
    },
    {
      "name": "走道",
      "type": "corridor",
      "color": "#e5e7eb",
      "vertices": [
        {"x": 760, "y": 200},
        {"x": 880, "y": 200},
        {"x": 880, "y": 2400},
        {"x": 760, "y": 2400}
      ],
      "wallKind": "interior",
      "rationale": "主走道寬 120cm 符合避難法規"
    }
  ],
  "doors": [
    {
      "spaceIndex": 0,
      "edgeIndex": 1,
      "t": 0.5,
      "width": 90,
      "swing": "in-right",
      "isEntry": true
    }
  ],
  "windows": [
    {
      "spaceIndex": 0,
      "edgeIndex": 3,
      "t": 0.4,
      "width": 180,
      "sillHeight": 90
    }
  ]
}
\`\`\`

備註:
- 座標單位是公分 (cm),畫布絕對座標,X 向右,Y 向下
- **頂點順序很重要**:依順時針或逆時針都可,但保持連續
- \`edgeIndex\` 從 0 開始,代表「第 i 個頂點到第 i+1 個頂點」這一邊
- **不需要單獨輸出 walls,牆是自動的**
- \`spaceIndex\` 索引到當次 spaces 陣列;舊空間用 \`spaceId\`
- 矩形空間也可以用舊格式 \`x,y,w,h\` (會自動轉成 4 頂點),但 **L 形/不規則一定要用 vertices**

其他可用 action: "add_space" / "update_space" (name + patch, 含 vertices) / "add_door" / "add_window" / "set_furniture" / "note"

# 互動風格
- 用同事討論口吻,**主動指出法規違規**並寫出依據條文。
- 不確定時主動問,不瞎猜。
- 使用者點「詳細規劃」按鈕時,**完整展示 Stage 1+2 思考過程**;一般對話則隱性思考。
`

/**
 * 傳送對話訊息給 Claude。
 * @param {Array} messages - [{role:'user'|'assistant', content:string|Array}]
 * @param {Object} context - {plan, baseLayerImageUrl, verbose}
 *                          verbose=true 時要求 AI 顯示完整 Stage 1+2 推理過程
 * @returns {Promise<string>} Claude 回應的文字
 */
export async function chatWithClaude(messages, context = {}) {
  if (!client) throw new Error('Claude API Key 未設定,請填入 .env.local 的 VITE_CLAUDE_API_KEY')

  // 把目前 plan 狀態塞進 system 後段,讓 AI 知道現在畫布長怎樣
  const bl = context.plan?.baseLayer
  const calibInfo = bl?.scaleCalibration
    ? `已校準 (${bl.scaleCalibration.note})`
    : bl ? '⚠ 尚未校準比例尺 — 坪數可能不準,規劃前要請使用者先校準!' : ''
  const casesContext = context.casesContext || ''
  const rulesContext = context.rulesContext || ''
  const planContext = context.plan ? `
# 目前畫布狀態
- 樓層 bounds: ${context.plan.bounds.w}×${context.plan.bounds.h} cm
- 可用區: x=${context.plan.availableZone.x}, y=${context.plan.availableZone.y}, w=${context.plan.availableZone.w}, h=${context.plan.availableZone.h}
- 已有牆 (${(context.plan.walls   || []).length} 段)
- 已有門 (${(context.plan.doors   || []).length} 個)
- 已有窗 (${(context.plan.windows || []).length} 個)
- 已標空間 (${(context.plan.spaces || []).length} 個): ${JSON.stringify((context.plan.spaces||[]).map(s => ({name:s.name, type:s.type, x:s.x, y:s.y, w:s.w, h:s.h})))}
- legacy 色塊房間 (${context.plan.rooms.length} 間)
- 已放家具 (${context.plan.furniture.length} 件)
- 底圖: ${bl ? `${bl.type} (${bl.filename}) — ${calibInfo}` : '無'}
` : ''

  // 詳細規劃模式:要求 AI 顯示完整推理過程
  const verboseInstr = context.verbose ? `

# 本次使用「詳細規劃」模式
請完整顯示 Stage 1 與 Stage 2 的推理過程,讓使用者看到你怎麼判斷。格式建議:

## 📋 Stage 1: 需求分析
- 業態:...
- 目標人數:...
- 機能單元清單 (含法規最低面積):...
- 動線拓樸:...

## 📐 Stage 2: 落圖檢查
- 主要房間位置與理由:...
- 走道寬度檢查:...
- 法規符合性:...
- 風險/取捨:...

完成後再給出 plan-action JSON。
` : ''

  // 如果有上傳底圖且最後一則是 user 訊息,把底圖當 image 一起送 (Claude Vision)
  const finalMessages = [...messages]
  if (context.baseLayerImageUrl && finalMessages.length > 0) {
    const lastIdx = finalMessages.length - 1
    const last = finalMessages[lastIdx]
    if (last.role === 'user' && typeof last.content === 'string') {
      // 把 image 接在文字後面
      try {
        const imgData = await fetchImageAsBase64(context.baseLayerImageUrl)
        finalMessages[lastIdx] = {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imgData.mimeType, data: imgData.base64 } },
            { type: 'text', text: last.content }
          ]
        }
      } catch (e) {
        console.warn('底圖載入失敗,繼續用純文字對話', e)
      }
    }
  }

  // 定義 web_search tool 給 Claude 自主呼叫
  const tools = tavilyReady ? [{
    name: 'web_search',
    description: '搜尋網路即時資訊。當你需要查台灣最新法規、品牌型錄、價格、設計靈感、競品案例時使用。',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '繁體中文搜尋詞,例如「建築技術規則 三溫暖 通風」' }
      },
      required: ['query']
    }
  }] : []

  let convoMessages = [...finalMessages]
  let lastText = ''
  for (let turn = 0; turn < 5; turn++) {  // 最多 5 輪工具呼叫,避免失控
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT + rulesContext + planContext + casesContext + verboseInstr,
      tools,
      messages: convoMessages
    })
    // 收集文字
    lastText = resp.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    // 看有沒有 tool_use,沒有就結束
    const toolUses = resp.content.filter(b => b.type === 'tool_use')
    if (toolUses.length === 0) return lastText

    // 把 assistant 回應 + tool result 加進 messages,繼續下一輪
    convoMessages = [
      ...convoMessages,
      { role: 'assistant', content: resp.content },
      {
        role: 'user',
        content: await Promise.all(toolUses.map(async (tu) => {
          if (tu.name === 'web_search') {
            try {
              const search = await webSearch(tu.input.query, { maxResults: 5 })
              const txt = formatSearchResults(tu.input.query, search)
              return { type: 'tool_result', tool_use_id: tu.id, content: txt }
            } catch (e) {
              return { type: 'tool_result', tool_use_id: tu.id, content: '搜尋失敗: ' + e.message, is_error: true }
            }
          }
          return { type: 'tool_result', tool_use_id: tu.id, content: '未知工具: ' + tu.name, is_error: true }
        }))
      }
    ]
  }
  return lastText
}

/**
 * 從 AI 回應裡抓出 ```plan-action JSON 區塊,轉成可執行的 actions。
 * 回傳: { text: 去掉 action 區塊後的純文字, actions: [...] }
 */
export function parsePlanActions(rawText) {
  const actions = []
  const text = rawText.replace(/```plan-action\s*\n([\s\S]*?)\n```/g, (_, json) => {
    try {
      actions.push(JSON.parse(json))
    } catch (e) {
      console.warn('plan-action JSON 解析失敗', e, json)
    }
    return ''  // 把 action block 從顯示文字中去掉
  }).trim()
  return { text, actions }
}

// ---- 工具:抓圖成 base64 (Claude Vision 需要) ----
async function fetchImageAsBase64(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`圖片下載失敗 ${res.status}`)
  const blob = await res.blob()
  const mimeType = blob.type || 'image/png'
  const buf = await blob.arrayBuffer()
  // base64 編碼
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return { mimeType, base64: btoa(bin) }
}
