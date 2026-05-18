# 空間規劃 — 雲端版 v4 (MVP)

> 從 `tool/v3_8_latest.html` 的單檔離線版,演進到雲端、多人協作、2D + 3D 並存的版本。
> AiHouse 對標,但範圍聚焦在「林口總部空間規劃」這個垂直場景。

## 為什麼有這個專案

`tool/v3_8_latest.html` 是一個 4300 行單檔純前端 HTML + SVG 工具,功能已經完整,但有兩個天花板:

1. **單機 localStorage**:資料只存在自己瀏覽器,團隊內無法協作。
2. **純 2D**:沒辦法給老闆/客戶看到立體空間感。

這個 v4 不丟棄 v3_8 的核心 know-how(房間庫、硬約束檢查、5 維度評分),而是把它**移植到一個可演進的技術棧**上。v3_8 仍然保留作為單人離線版繼續可用。

## 技術選擇

| 層 | 技術 | 為什麼選它 |
|---|---|---|
| Build | Vite | 開發伺服器秒啟動,適合 MVP |
| UI | React 18 | 你 tool/ 底下已有 `.jsx` 檔,且 R3F 必須用 React |
| 3D | Three.js + @react-three/fiber + drei | 業界 3D 標準,R3F 把 Three.js 包成 React 元件 |
| 樣式 | TailwindCSS | 快、跟 v3_8 的 inline class 風格接近 |
| 狀態 | Zustand | 比 Redux 輕,單檔 store 即可 |
| 後端 | Supabase | 一站式提供:Postgres + Auth + Realtime + Storage,免費起步 |
| 部署 | Vercel | 免費、Git push 即上線 |

## MVP 範圍(1-2 週)

### 已包含
- [x] 帳號登入(Supabase Auth - email magic link)
- [x] 2D 規劃畫布(房間拖拉、調大小、刪除)
- [x] 房間庫(從 v3_8 移植)
- [x] 硬約束資料模型(走道、保留區、可用區、結構柱)
- [x] 雲端存檔(每個方案一筆 row,雲端讀寫)
- [x] 多人即時同步(Supabase Realtime — 跟 Google Docs 一樣)
- [x] 3D 立體預覽(2D 房間拉高成牆面盒子)
- [x] 家具模型庫(內建 20-50 個 CC0 模型,分類:辦公、餐飲、健身、三溫暖)

### 延後到 v4.1+
- 擬真渲染(需要 path tracing 或 AI 算圖,單獨就要 1 個月起跳)
- 大量家具模型(百萬級需要外接 Sketchfab API 或自建模型 CDN)
- 完整權限管理(角色、留言、版本控制)
- 自動生成方案(從 v3_8 的 AI 對話橋接演進)

## 資料夾結構

```
空間規劃-雲端版-v4/
├── README.md                  ← 你現在看的
├── SETUP.md                   ← 安裝與部署步驟(給 Jason)
├── package.json
├── vite.config.js
├── tailwind.config.js
├── index.html
├── .env.example               ← Supabase 環境變數樣板
├── public/                    ← 靜態檔(家具模型 .glb)
├── src/
│   ├── main.jsx               ← React 入口
│   ├── App.jsx                ← 路由與主框架
│   ├── components/
│   │   ├── Auth.jsx           ← 登入頁
│   │   ├── PlanList.jsx       ← 我的方案列表
│   │   ├── Editor.jsx         ← 主編輯器(2D + 3D 切換)
│   │   ├── Canvas2D.jsx       ← 2D 拖拉畫布(v3_8 簡化移植)
│   │   ├── Canvas3D.jsx       ← Three.js 3D 預覽
│   │   ├── RoomLibrary.jsx    ← 左側房間庫
│   │   └── FurnitureLibrary.jsx ← 家具庫
│   ├── lib/
│   │   ├── supabase.js        ← Supabase client
│   │   └── constraints.js     ← 從 v3_8 移植的硬約束邏輯
│   └── store/
│       └── planStore.js       ← Zustand 全域狀態
├── supabase/
│   └── schema.sql             ← 資料表 + RLS 設定
└── docs/
    └── architecture.md        ← 架構說明
```

## 快速開始

請看 [`SETUP.md`](./SETUP.md)。
