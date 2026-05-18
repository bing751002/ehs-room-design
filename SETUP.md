# 安裝與部署 — 給 Jason 的逐步說明

整套 MVP 第一次跑起來大約需要 30-60 分鐘,主要時間花在 Supabase 帳號與專案建立。
之後每次改完 code 只需要 `npm run dev` 即可。

---

## 階段 1:本機跑起來(15 分鐘)

### 1-1 安裝 Node.js
如果還沒裝過,到 https://nodejs.org/ 下載 LTS 版本(20 或 22)。
裝完打開終端機輸入 `node -v`,有看到版本號就 OK。

### 1-2 安裝套件
打開終端機,`cd` 到這個專案資料夾,然後執行:
```bash
npm install
```
等個 1-2 分鐘,會看到 node_modules/ 資料夾被建立。

### 1-3 啟動開發伺服器
```bash
npm run dev
```
終端機會顯示 `http://localhost:5173/`,點開來。
**這時你應該會看到登入畫面**,但因為還沒設 Supabase 所以不能登入 —— 那是下一步。

---

## 階段 2:建 Supabase 後端(20 分鐘)

### 2-1 註冊 Supabase 帳號
1. 到 https://supabase.com 註冊免費帳號(用 Google 或 GitHub 登入最快)。
2. 點 「New project」。
3. 填:
   - Project name: `space-planner`(或你喜歡的名字)
   - Database password: 隨便設一組強密碼,**抄下來**
   - Region: `Northeast Asia (Tokyo)` 或 `Singapore`(離台灣近)
4. 點 「Create new project」,等 2-3 分鐘後綠燈亮起代表完成。

### 2-2 跑資料表 schema
1. 進到專案後,左側選單點 「SQL Editor」。
2. 點 「New query」。
3. 把這個專案 `supabase/schema.sql` 的內容 **整段複製貼上**。
4. 點右下 「Run」。應該會看到 "Success. No rows returned"。

### 2-3 開啟 Realtime
1. 左側選單 → Database → Replication。
2. 找到 `supabase_realtime`,點 「manage」。
3. 把 `plans` 表的 toggle 打開。

### 2-4 拿 API 金鑰
1. 左側選單 → Settings → API。
2. 找到 「Project URL」 與 「anon public key」,複製。
3. 回到專案根目錄,把 `.env.example` 複製成 `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
4. 編輯 `.env.local`,把 URL 與 key 填進去。

### 2-5 重啟開發伺服器
在跑 `npm run dev` 的終端按 Ctrl+C 停掉,再 `npm run dev` 一次。
回到瀏覽器 http://localhost:5173/,輸入你的 email,會收到登入連結,點進去就登入了。

---

## 階段 3:邀請隊友(5 分鐘)

第一版多人協作的最簡實作:**讓隊友各自註冊登入,然後在 Supabase Dashboard 手動把他們加進 `plan_collaborators` 表**。
未來可以做成 UI 內邀請,但 MVP 先這樣。

1. 隊友先用自己的 email 登入一次系統(讓帳號被建立)。
2. 在 Supabase Dashboard → Authentication → Users,找到隊友的 UUID 並複製。
3. → Table editor → `plan_collaborators` → Insert row:
   - `plan_id`: 你想分享的方案 UUID(在 plans 表找)
   - `user_id`: 隊友的 UUID
   - `role`: `editor`(可改) 或 `viewer`(唯讀)

加完後,隊友登入就會看到那個方案,而且兩邊拖拉房間會 **即時同步**(Realtime)。

---

## 階段 4(可選):部署到 Vercel

1. 把這個資料夾推到一個 GitHub repo(私有也行)。
2. 到 https://vercel.com 註冊,連結 GitHub。
3. Import 那個 repo,框架選 Vite。
4. Environment Variables 填入 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_ANON_KEY`。
5. Deploy。幾分鐘後拿到一個 `https://xxx.vercel.app` 的網址,直接給隊友用。

---

## 常見問題

**Q: `npm install` 卡住或失敗**
A: 試試 `npm install --legacy-peer-deps`,或檢查 Node 是否為 18 以上。

**Q: 登入連結收不到信**
A: 檢查 Supabase Dashboard → Authentication → Email Templates 是否有設好。免費版每小時有寄信額度上限。

**Q: 3D 預覽轉很慢**
A: 房間 + 家具超過 100 個之後 Three.js 沒做 instancing 會吃力,這是 v4.1 要優化的點。

**Q: 多人同步看起來沒生效**
A: 確認階段 2-3 的 Realtime 有開,並且兩個帳號都被加進 `plan_collaborators`。

---

## 下一步(v4.1 路線圖)

- 自動配置(把 v3_8 的 AI 對話橋接搬過來,用 Claude API 自動生成方案)
- 真實家具 GLB 模型(用 Sketchfab API 或自架 CDN)
- 路徑追蹤渲染(用 three-mesh-bvh + path tracer,或外接 Stable Diffusion)
- 完整邀請 UI(在系統內按按鈕邀請隊友,不用手動進 DB)
- 版本快照(支援回到任意時間點)
- 量距離、開門弧、走道寬度自動檢查
