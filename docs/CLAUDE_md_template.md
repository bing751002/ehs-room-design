# Claude Code 專案上下文範本

> 把這份內容複製到專案根目錄,改名成 `CLAUDE.md`,Claude Code 每次進這個專案都會自動讀。
> 你可以隨時修改它,告訴它哪些事不要做、哪些事預設要做。

---

```markdown
# 空間規劃-雲端版 v4 — 給 Claude Code 的常駐記憶

## 專案是什麼
這是「東森空間規劃實驗室」的雲端版工具(v3_8 HTML 工具的演進)。
- 主要使用者:Jason(東林集團林口總部專案負責人)
- 對標:AiHouse(aihousetw.com),但聚焦在「業態空間規劃」這個垂直場景
- v3_8 舊版仍在 `../../tool/v3_8_latest.html`,可參考其房間庫與評分邏輯

## 技術棧(不可擅自改)
- Vite + React 18
- Three.js + @react-three/fiber + @react-three/drei (3D)
- Supabase (auth + postgres + realtime)
- Zustand (狀態)
- TailwindCSS (樣式)

## 規則
1. 改 code 前先讀相關檔案,不要憑想像改
2. 程式註解用繁體中文寫,變數名用英文
3. **絕對不要動 `supabase/schema.sql` 的 RLS policy**,除非我明確要求
4. 加新套件之前先問我,確認真的需要再加
5. 改完 component 之後,跑 `npm run build` 確認沒編譯錯誤再說「完成」
6. 不要把任何敏感資訊(Supabase key、密碼)寫進 code 或 commit

## 業務規則(從 v3_8 移植過來的硬約束,規劃邏輯不可違反)
- 林口總部四邊都是帷幕牆,房間主入口不可在外牆
- 區外公共走道屬於不可動的硬約束(消防動線、免計容積)
- 27F 已有 SPA,其他樓層不放 SPA(forbidUsages 機制)
- 每個房間至少要有一個門(MVP 還沒做,但 v4.1 要加)

## 跟我對話的偏好
- 用繁體中文
- 直接切入重點,不要長篇前言
- 不確定的地方直接問,不要猜
- 完成每個步驟告訴我進度
- 任務太大主動建議拆步驟

## 不要做的事
- 不要主動執行 `git push --force`
- 不要修改 `.env.local`
- 不要刪除 `tool/` 底下的舊版 HTML 檔
- 不要在沒問過我之前重寫整個檔案
```

---

## 怎麼用

1. 開啟你電腦上 `空間規劃-雲端版-v4/` 資料夾。
2. 在裡面新建一個檔案叫 `CLAUDE.md`。
3. 把上面**程式碼框框裡的整段內容**(從 `# 空間規劃-雲端版 v4` 到最後)複製進去,存檔。
4. 之後在這個資料夾跑 `claude`,它會自動讀到。

## 之後你可以隨時加東西

例如:
- 加上「測試指令是 `npm run test:unit`,不是 `npm test`」
- 加上「我習慣 PR 標題用中文 + 動詞開頭(例:新增、修復、重構)」
- 加上「Three.js 的座標換算別寫成 magic number,放到 constants 檔」

這份檔案會跟著專案走,團隊有其他人加入,他們的 Claude Code 也會讀到同一份規則。
