# 🤝 東森空間規劃實驗室 — 工程師 Handover 文件

> 給接手的工程師:從零到能跑、能改、能上 cloud 的完整指引。
> 預估上手時間:**1-2 小時**(從 git clone 到本機跑起來)。

---

## 📦 專案速覽

| 項目 | 說明 |
|---|---|
| 用途 | 室內空間規劃工具(2D 編輯 + 3D 預覽 + AI 規劃/審圖/評圖/渲染) |
| 技術棧 | React 18 + Vite + Tailwind + Three.js + Supabase + Anthropic Claude + Google Gemini |
| 程式碼規模 | ~12,000 行 (60+ 檔) |
| 部署 | Vercel(前端)+ Supabase(後端 BaaS) |
| 開發語言 | JavaScript ES Modules (沒用 TypeScript) |
| GitHub Repo | git@github.com:jasonwang8213-jpg/eastern-group--planner.git |
| 正式環境 | https://eastern-group-planner.vercel.app |

---

## 🚀 5 分鐘起跑(Local Dev)

```bash
# 1. clone
git clone git@github.com:jasonwang8213-jpg/eastern-group--planner.git
cd eastern-group--planner

# 2. 安裝
npm install

# 3. 環境變數 (跟 Jason 拿 .env.local,或重新申請 — 見下面 §環境變數)
cp .env.example .env.local
# 編輯 .env.local 填入金鑰

# 4. 跑
npm run dev
# 開 http://localhost:5173
```

如果跑起來看到「東森空間規劃實驗室」標題就成功了。

---

## 🔑 環境變數(`.env.local`)

| 變數 | 必填 | 用途 | 申請位置 |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Supabase 專案 URL | Supabase Dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase 公開金鑰(受 RLS 保護) | 同上 |
| `VITE_CLAUDE_API_KEY` | ✅ | Claude API(AI 規劃/審圖/評圖核心) | https://console.anthropic.com |
| `VITE_GEMINI_API_KEY` | ✅ | Gemini(渲染圖、AI 圖紙辨識) | https://aistudio.google.com/apikey |
| `VITE_TAVILY_API_KEY` | 選 | 網路搜尋 tool(AI 查最新法規用) | https://tavily.com (免費 1000/月) |
| `VITE_CLOUDCONVERT_API_KEY` | 選 | DWG → DXF 轉檔 | https://cloudconvert.com |

⚠️ **目前 API key 在前端可被 inspect**,只適合內部 demo。正式部署前必須搬到 Supabase Edge Function 代理(詳見 §「上 cloud 注意事項」)。

---

## 📂 程式碼結構

```
src/
├── App.jsx                    # Router + auth shell
├── main.jsx                   # entry
├── index.css                  # tailwind base
│
├── components/                # 共用元件 (~4000 行)
│   ├── Canvas2D.jsx             ★ 690 行 — 2D 編輯器主體 (SVG)
│   ├── Canvas3D.jsx             ★ 500 行 — 3D 預覽 (three.js)
│   ├── ChatPanel.jsx            ★ 398 行 — 規劃師對話 (含 plan-action 自動套用)
│   ├── EditorToolbar.jsx        編輯工具列
│   ├── EditorLayout.jsx         /plan/:id 的 layout 與子路由
│   ├── PropertiesPanel.jsx      ★ 374 行 — 物件屬性編輯 (空間/牆/門/窗)
│   ├── BomPanel.jsx             採購預算
│   ├── ScorePanel.jsx           方案評分
│   ├── BaseLayerControls.jsx    底圖上傳/校準/位移
│   ├── ScaleCalibrator.jsx      比例尺校準工具
│   ├── PlanList.jsx             方案列表頁
│   ├── FloorTabs.jsx            多樓層 tab
│   ├── OnboardingTour.jsx       新手導覽
│   │
│   ├── canvas/                  Canvas2D 的 sub-components
│   │   ├── SpacePolygon.jsx     ★ 552 行 — 多邊形空間 (含 ㄇ字型 / L型)
│   │   └── WallsLayer.jsx       312 行 — 牆/門/窗渲染與互動
│   │
│   └── agentChat/               AI 審圖/評圖共用元件
│       ├── BaseAgentChat.jsx    ★ 580 行 — 對話框 + 標記錯誤寫入規則庫
│       ├── AgentPageLayout.jsx  thread 列表 + 對話佈局
│       ├── ScoreCard.jsx        評圖 6 維度雷達圖
│       └── PrintableReport.jsx  PDF 列印報告
│
├── pages/                     # 路由頁面 (~1900 行)
│   ├── AuditPage.jsx            🔍 審圖 (跑照建築師 + 防綜)
│   ├── CritiquePage.jsx         ⭐ 評圖 (設計總監 + 總裁)
│   ├── CaseLibraryPage.jsx      案例庫管理
│   ├── RulesPage.jsx            內部規則庫
│   ├── RegulationsPage.jsx      ★ 335 行 — 法規庫
│   ├── RoomLibraryPage.jsx      房型模板庫
│   ├── BomPage.jsx              採購單頁
│   ├── RenderPage.jsx           ★ 渲染圖廊 (Gemini Imagen + Nano Banana)
│   ├── DocsPage.jsx             文件輸出
│   └── View3DPage.jsx           3D 全螢幕預覽 (含漫遊)
│
├── lib/                       # 工具與 API (~3100 行)
│   ├── supabase.js              Supabase client
│   ├── claudeApi.js             ★ 511 行 — Claude API + tools (web_search, lookup_regulation)
│   ├── renderApi.js             Gemini 渲染 (3 個模型可選)
│   ├── aiVision.js              ★ Claude Vision 辨識平面圖
│   ├── webSearch.js             Tavily 網搜
│   ├── fileUpload.js            上傳底圖到 Supabase Storage
│   ├── fileExtract.js           PDF/Word/Excel/圖片 → 文字 (給 AI 讀)
│   ├── exportPng.js             SVG → PNG 匯出 / dataURL
│   ├── dwgConvert.js            DWG → DXF
│   ├── imageImport.js           圖片批次匯入 + AI 標籤
│   ├── constraints.js           ★ 531 行 — 核心幾何 (spaceVertices/polygonCenter/吸附 snap)
│   ├── chatContext.js           統一 RAG context 載入
│   ├── chatHistory.js           ChatPanel 對話歷史
│   ├── agentChats.js            審圖/評圖獨立對話歷史
│   ├── caseLibrary.js           案例庫 CRUD + 檢索
│   ├── internalRules.js         內部規則 CRUD + prompt 注入
│   ├── regulations.js           ★ 法規庫 (含關鍵字檢索與 token 預算)
│   ├── roomTemplates.js         房型模板
│   └── profiles.js              user profile
│
└── store/
    └── planStore.js           ★ 446 行 — Zustand 全域狀態 (plan + history + selection)

supabase/                      # 資料表 SQL (跑一次就好)
├── schema.sql                   主表 (plans, profiles)
├── chat_schema.sql              ChatPanel 對話歷史
├── agent_chats_schema.sql       審圖/評圖獨立對話
├── cases_schema.sql             + cases_extend.sql 案例庫
├── rules_schema.sql             內部規則
├── regulations_schema.sql       法規庫
├── room_templates_schema.sql    房型模板
├── renders_schema.sql           渲染圖紀錄
└── profiles_schema.sql          team profile

docs/                          # 既有開發筆記
README.md, SETUP.md
HANDOVER.md (本檔)
```

★ = 重點檔(行數多/邏輯複雜,先讀這些)

---

## 🏗 架構快覽

### 資料流
```
User → React → Zustand (planStore) → Supabase (PostgreSQL + Storage + Auth)
                  ↓
              AI APIs (Claude / Gemini / Tavily) → 回應 → 套用到畫布
```

### Auth
- **Supabase Auth** 用 magic link (email)
- RLS 政策:每張表 `owner = auth.uid()`
- 沒有密碼

### AI 系統三條線
1. **規劃師 ChatPanel** (`ChatPanel.jsx`):看 plan + 對話 + 自動套用 plan-action JSON 到畫布
2. **審圖 Agent** (`AuditPage.jsx`):跑照建築師,引用法規庫條文
3. **評圖 Agent** (`CritiquePage.jsx`):設計總監評語 + 6 維度評分

三條線共用 `chatWithClaude()` (claudeApi.js),用 `systemPromptOverride` 切角色。

### 知識庫(會自動塞進 AI prompt)
- 法規庫 (regulations) — 政府公規,有關鍵字檢索 + lookup_regulation tool
- 內部規則 (internal_rules) — 公司家規 + AI 過往錯誤糾正紀錄 (🚨 標記)
- 案例庫 (cases) — 東森累積案場
- 房型模板 (room_templates) — 常用房型尺寸

---

## ☁️ Supabase 設定(接手後要做的事)

### A. 取得專案存取權
1. 找 Jason 在 Supabase Dashboard → Settings → Team → **Invite member**
2. 用你的 email 設 **Admin**

### B. 確認資料庫
進 SQL Editor 確認下列表都存在:
```
plans, profiles, chat_messages, agent_chats,
cases, internal_rules, regulations, room_templates, renders
```

如果缺,跑 `supabase/*.sql` 對應的檔案(每個檔開 SQL Editor 貼上 → Run)。

### C. Storage Bucket
進 Storage → 應有 bucket `plan-assets` (Private)。如缺手動建:
- Name: `plan-assets`
- Public: ❌ Private
- RLS Policy: 已寫死路徑為 `{user_id}/...`,owner only

### D. Redirect URLs (登入回跳)
Auth → URL Configuration → Redirect URLs,確認有:
```
https://eastern-group-planner.vercel.app/**
http://localhost:5173/**
http://127.0.0.1:5173/**
```

---

## 🌐 上雲端注意事項(工程師問的「上雲設定」)

### 現況(內部 demo 階段)
- ✅ 前端 deploy 在 Vercel,自動從 main branch 部署
- ✅ Supabase 是 production tier
- ⚠️ **API keys 直接放前端**(VITE_ 前綴會 bundle 進 client JS,瀏覽器 inspect 看得到)

### 上正式環境前必做(安全性)

#### 1. **把 AI API key 搬到 Supabase Edge Function**
目前 `claudeApi.js`、`renderApi.js`、`webSearch.js` 都直接從 `import.meta.env` 拿 key。攻擊者打開 DevTools 就能偷。

**做法**:
- Supabase → Edge Functions → 建 `claude-proxy`、`gemini-proxy`、`tavily-proxy`
- 把 key 放 Edge Function 環境變數(Settings → Edge Functions → Secrets)
- 前端改 fetch 自己的 edge function endpoint
- 移除 `dangerouslyAllowBrowser: true`

範例(Edge Function 偽代碼):
```js
// supabase/functions/claude-proxy/index.ts
Deno.serve(async (req) => {
  const { messages, system } = await req.json()
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('CLAUDE_API_KEY'),
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: 'claude-opus-4-5', messages, system, max_tokens: 4096 })
  })
  return new Response(r.body, { headers: r.headers })
})
```

#### 2. **RLS 政策審查**
所有表都有 `owner = auth.uid()`,但 Storage policy 要驗證。
SQL Editor 跑:
```sql
SELECT schemaname, tablename, policyname
FROM pg_policies WHERE schemaname = 'public';
```
應看到每張表 4 條 (select/insert/update/delete) policy。

#### 3. **Vercel 環境變數**
Vercel → Project Settings → Environment Variables
- 把 `VITE_SUPABASE_URL` 跟 `VITE_SUPABASE_ANON_KEY` 設成 production
- AI key 撤掉(改用 Edge Function 後不需要前端有)

#### 4. **域名 / SSL**
Vercel 預設 `.vercel.app` 有 SSL。要綁公司域名:
- Vercel → Domains → Add → 輸入 `planner.ettoday.com.tw` (或類似)
- 去 DNS 加 CNAME 指向 Vercel
- SSL 自動

#### 5. **備份策略**
Supabase Pro tier 有 daily backup,但建議:
- 設定 GitHub Action 每天匯出資料庫到 Google Drive (或公司 NAS)
- 範例 script 可問 ChatGPT 用 `pg_dump`

#### 6. **多人協作**
目前**沒有「正在編輯中」鎖**(兩人同時改會互相覆蓋)。
若要多人協作,要加 Supabase Realtime presence,在 EditorLayout.jsx 攔截。

#### 7. **使用量監控**
- Supabase → Reports 看 API 用量
- Anthropic Console → Usage 看 Claude token
- Google AI Studio → Quotas 看 Gemini 用量
建議設用量告警 email,免得月底爆。

---

## 🐛 已知問題 / 待修清單

> 詳見:這份 Handover 對應的「UX Audit 報告」(在我們對話歷史中,Jason 可請 Claude 重出)

### 🔴 嚴重(優先修)
1. **編輯器無 autosave** — 瀏覽器當掉資料全丟。建議用 localStorage 每 10 秒備份
2. **API key 在前端可被 inspect** — 上正式前必修(見上面 §1)
3. **PDF 列印報告把全部對話印進去** — 應該讓使用者選段落

### 🟡 中等
4. PlanList 無搜尋(80+ 案子翻不到)
5. BOM 採購單只能匯出 CSV 不能線上編輯
6. 兩人同時編輯會互相覆蓋
7. 渲染等 30 秒無進度條
8. Gemini Nano Banana 對「結構嚴格保留」能力不足 — 可考慮接 fal.ai ControlNet (見下方建議)

### 🟢 小細節
9. 工具列快捷鍵沒集中速查
10. snap 吸附時無視覺反饋
11. thread 列表名稱太長被截
12. 沒上傳大檔 token 預警

---

## 🎯 工程師可能會問的事

### Q: 為什麼用 zustand 不用 Redux?
A: 專案規模適中,zustand API 簡單,planStore 已 446 行單檔好維護。

### Q: 為什麼前端直接打 AI API 不走後端?
A: 內部 demo 圖快。**上 production 必須改走 Supabase Edge Function**(見 §「上雲注意」)。

### Q: 為什麼 Canvas2D 用 SVG 不用 Canvas?
A: SVG 容易做事件處理(每個 polygon/circle/line 都能直接綁 onMouseDown),且匯出 PNG 一行搞定。畫布內物件數 < 1000 時 SVG 完全夠快。

### Q: 為什麼 Canvas3D 用 three.js 不用 SketchUp/Blender 引擎?
A: 純瀏覽器,免裝。three.js + react-three-fiber 寫起來像 React。

### Q: 為什麼有兩套 chat (ChatPanel + agentChat/BaseAgentChat)?
A: ChatPanel 綁定 plan_id(規劃師對話跟方案綁),BaseAgentChat 用 thread_id(獨立審圖/評圖)。schema 跟 UX 不同所以拆。

### Q: 為什麼法規庫一部 10 萬字塞不進 prompt?
A: 用了「關鍵字檢索 + 智能切片」,從 userQuery 抽 §條號/業態詞 → 只切相關段落塞進 prompt(`regulations.js` 的 `extractRelevantSections`)。並且開了 `lookup_regulation` tool 讓 AI 不夠時自己撈。

### Q: branch 怎麼開?
A: 目前 main 直接部署,建議改:
- main → 自動 deploy production
- dev → 自動 deploy preview
- feature branch → PR 後 squash merge

---

## 📞 接手聯絡

- 原作者:Jason Wang (jasonwang8213@gmail.com)
- AI 協作工具:Claude Code (這份程式碼 80% 由 Claude Code 協助寫)
- 如需 git history 與架構演進脈絡:可問 Jason

---

## ✅ 接手 Checklist

- [ ] 拿到 GitHub repo 存取權
- [ ] 拿到 Supabase 專案 admin
- [ ] 拿到 Vercel 專案 access
- [ ] 拿到 .env.local(或申請新 API keys)
- [ ] 本機 `npm run dev` 跑起來看到登入頁
- [ ] 用自己 email magic link 登入
- [ ] 試一輪:新增方案 → 上傳底圖 → 校準 → 畫空間 → 切 3D → 跑 AI 規劃師
- [ ] 讀完本檔 + `src/components/Canvas2D.jsx` + `src/lib/claudeApi.js` + `src/store/planStore.js`(這 3 檔讀完就懂核心)
- [ ] 跑 `npm run build` 確認可打包
- [ ] 開新 branch `dev` 開始改動
