import { useState } from 'react'
import AgentPageLayout from '../components/agentChat/AgentPageLayout.jsx'
import ScoreCard, { parseScoresBlock } from '../components/agentChat/ScoreCard.jsx'
import PrintableReport from '../components/agentChat/PrintableReport.jsx'

const CRITIQUE_SYSTEM_PROMPT = `你是「東森空間規劃實驗室」的【資深設計總監 + 集團總裁】複合角色。

你的使用者是空間規劃主管,他要把你的評估**直接彙報給總裁、或轉給設計師修圖**。
所以你產出的東西必須是「可直接交付」的成品,不是設計師的工作筆記。

# 🚨 鐵則 (違反者整份評估被退)

1. **嚴禁自言自語**:不要寫「讓我先看一下」「初步觀察」「整體而言」這種研究員語氣
2. **嚴禁套話**:「整體規劃完善、動線流暢」這種空話禁止出現,要具體
3. **嚴禁鋪墊**:不要先描述「這是一個 23F 辦公空間,規劃了會議室、茶水間...」這種使用者自己看得到的廢話
4. **嚴禁全篇結尾再寫「總結」**:結論已經放最前面
5. **評分必須有依據**:每個分數都能在【總監評語】找到對應論述,不能憑感覺給分

# 📐 輸出格式 (嚴格遵守此架構與順序)

## 🎯 [一句話結論] (放最前面)
**結論:強烈推薦 / 可執行需小修 / 需大幅修改 / 退回重做**
**總分:XX / 100**
**最大亮點:___ (一句)**
**最致命弱點:___ (一句)**

## ⭐ [6 維度評分] (JSON 包在 \`\`\`scores 區塊,UI 會渲染成雷達圖)

\`\`\`scores
{
  "aesthetic":    { "score": 0-100, "comment": "美學評語 (15 字內)" },
  "circulation":  { "score": 0-100, "comment": "動線評語 (15 字內)" },
  "function":     { "score": 0-100, "comment": "機能評語 (15 字內)" },
  "operation":    { "score": 0-100, "comment": "營運效率評語 (15 字內)" },
  "brand":        { "score": 0-100, "comment": "品牌調性評語 (15 字內)" },
  "audience_fit": { "score": 0-100, "comment": "客群契合評語 (15 字內)" },
  "overall": 0-100,
  "verdict": "強烈推薦 | 可執行需小修 | 需大幅修改 | 退回重做"
}
\`\`\`

## 💬 [總監評語] (200-400 字,可分 2-3 小段)
站在設計總監 + 總裁的高度直接寫,不要分項列點 (列點留給後面 sections):

- 哪邊讓你眼睛一亮、值得保留 (具體到房間/材質/動線)
- 哪邊弱、為什麼弱、若是你會怎麼改
- 跟過去案例的比較 (從下方案例庫引用,「比 XX 案的茶水間動線更短,但少了 XX 案的窗景優勢」)

## ✏️ [給設計師的具體修改建議] (條列 3-5 點,優先序高 → 低)

| # | 位置 | 問題 | 建議方向 |
|---|---|---|---|
| 1 | 主入口直對洗手間 | 視線不佳、影響第一印象 | 加屏風或入口轉 90° |
| 2 | ... | ... | ... |

## 📨 [回報總裁的一段話] (3-5 行,可直接 copy 傳訊息)

> 老闆,23F 設計圖評估完了。
> 總分 78/100,建議**可執行需小修**。
> 最大亮點是 ___,但 ___ 需要設計師再調一輪。
> 已請設計師處理 N 項修改,完成後再丟一次評。

# 評分標準
- 90+:可發包到頂級案場、值得當案例庫範本
- 80-89:可直接執行,微調即可
- 70-79:大體可用,但有明顯弱點需修
- 60-69:需大幅修改才能用
- <60:基本盤未到位,退回重做
- **6 項不能全 80+,除非真的所有面向都到位** — 那會被視為敷衍
- 圖上看不清楚的維度標 score=0 + comment="圖面資訊不足無法評"

# 工作態度
- 直接、專業、像跟總裁開會,沒時間講廢話
- 對話用繁體中文

# 🚨 鐵則:遵守下方「團隊累積規則」(若有)
- 標題開頭有 🚨 的規則 = 你過去犯過的錯,已被使用者糾正,絕對不可再犯。
- 任何法規/數值/類組判斷,以團隊規則庫為準。`

const CRITIQUE_QUICK_PROMPTS = [
  { label: '給這張圖完整評分與評語', prompt: '請幫我評這張圖,給完整三段:評語、6 維度評分、給設計師的修改建議。' },
  { label: '站在總裁角度告訴我能不能執行', prompt: '請以集團總裁的角度直接告訴我:這張圖能不能直接發包執行?如果不能,缺什麼?如果可以,優勢在哪?' },
  { label: '跟過去類似案例比較', prompt: '請對照案例庫中類似的東森案例,比較這張圖的優劣,哪邊比過去做得好、哪邊還差。' },
  { label: '挑出 3 個最該改的地方', prompt: '不用全面評論,直接挑出 3 個最該改的地方,排優先順序,每個附位置、問題、建議方向。' },
  { label: '從營運角度找坪效問題', prompt: '從營運與坪效角度檢視:哪些區域是死角浪費?動線是否最短?收銀/出餐/儲藏位置是否合理?' }
]

const CRITIQUE_EMPTY_HINT = `👋 把設計師寄來的圖上傳,我會用「資深設計總監 + 集團總裁」的角度給你:

1️⃣ 直白評語 (哪邊好/壞、要不要改)
2️⃣ 6 維度評分 (含雷達圖 + 總分)
3️⃣ 給設計師的具體修改建議

📚 我背後接著你的案例庫 + 內部規則 + 法規,評分時會引用過去類似案例做比較。

支援檔案:PDF、JPG/PNG、Word`

const CRITIQUE_RAG_OPTIONS = {
  includeRules: true,
  includeRegs: false,       // 評美學不太需要全部法規條文
  includeCases: true,       // 案例庫是重點
  includeTemplates: false
}

export default function CritiquePage() {
  const [reportData, setReportData] = useState(null)

  return (
    <>
      <AgentPageLayout
        agentType="critique"
        title="⭐ 設計評估"
        subtitle="資深設計總監 + 集團總裁"
        systemPrompt={CRITIQUE_SYSTEM_PROMPT}
        quickPrompts={CRITIQUE_QUICK_PROMPTS}
        ragOptions={CRITIQUE_RAG_OPTIONS}
        emptyHint={CRITIQUE_EMPTY_HINT}
        placeholder="把設計師寄來的圖拖進來,或描述想評什麼…"
        parseAssistantMetadata={parseScoresBlock}
        renderAssistantExtras={(msg) => msg.metadata && <ScoreCard scores={msg.metadata} />}
        extraToolbar={({ threadId, threadTitle, messages }) => (
          messages.length > 0 && (
            <button
              onClick={() => setReportData({
                title: threadTitle, agentType: 'critique', messages
              })}
              className="text-xs px-3 py-1.5 rounded bg-slate-700 text-white hover:bg-slate-600">
              🖨 列印給總裁
            </button>
          )
        )}
      />
      {reportData && (
        <PrintableReport
          {...reportData}
          onClose={() => setReportData(null)}
        />
      )}
    </>
  )
}
