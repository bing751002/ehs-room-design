# 用 Claude Code 接手這個專案 — 完整指南

> 寫給 Jason — 從零開始,讓你用 Claude Code 在自己電腦上繼續開發這個工具。

---

## 一、Claude Code 是什麼,跟 Cowork 差在哪

**Claude Code** 是 Anthropic 出的命令列工具(CLI),它讓 Claude 直接在你電腦的終端機裡跑,可以讀寫你電腦上的檔案、執行指令、跑測試、改 code、提交 git。

| 比較 | Cowork(你現在用的) | Claude Code(終端機) |
|---|---|---|
| 介面 | 對話視窗 | 終端機 |
| 適合 | 文件 / 試算表 / 短 code 任務 | 長期軟體開發、跑測試、git 工作流 |
| 是否需要終端機 | 否 | **需要** |
| 是否能跑 npm / build | 有限沙盒 | 直接在你機器上跑 |
| 同樣的 Claude 嗎 | 是 | 是 |

簡單講:**code 寫好之後要持續迭代、跑開發伺服器、debug、push GitHub,改用 Claude Code 比較順手**。

---

## 二、安裝 Claude Code(10 分鐘)

### 前置:確認你有 Node.js
打開終端機(Mac 是「終端機」,Windows 是 PowerShell)輸入:
```bash
node -v
```
如果看到 `v18.x.x` 或以上版本就 OK。沒看到的話,先到 https://nodejs.org/ 裝 LTS 版。

### Mac / Linux 安裝
打開終端機,貼這一行:
```bash
curl -fsSL https://claude.ai/install.sh | bash
```
裝完它會告訴你要把某個路徑加到 `PATH`,照做即可。

### Windows 安裝
打開 **PowerShell**(不是 cmd),貼這一行:
```powershell
irm https://claude.ai/install.ps1 | iex
```

### 驗證安裝
```bash
claude --version
```
有看到版本號就成功了。

### 第一次登入
```bash
claude
```
會跳出網頁要你登入 Anthropic 帳號(用你目前 Cowork 同一個 email:`jasonwang8213@gmail.com`),登入完關掉網頁即可。

---

## 三、用 Claude Code 跑這個專案

### 1. 進專案資料夾
在終端機 `cd` 到你的工作資料夾。Mac/Linux:
```bash
cd "/Users/你的使用者名/(東森空間規劃實驗室 在你電腦上的路徑)/projects/空間規劃-雲端版-v4"
```
Windows(PowerShell):
```powershell
cd "C:\路徑\東森空間規劃實驗室\projects\空間規劃-雲端版-v4"
```

> 小提醒:你可以直接在 Finder / 檔案總管裡找到這個資料夾,右鍵「在終端機開啟」或「複製為路徑」省得手打。

### 2. 啟動 Claude Code
```bash
claude
```
它會偵測到你在這個專案資料夾,並可以讀懂全部檔案結構。

### 3. 第一次對話(複製貼上即可)
```
請先讀 README.md 和 SETUP.md 了解這個專案,然後幫我:
1. 跑 npm install
2. 跑 npm run build 看會不會有編譯錯誤
3. 把錯誤(如果有)修掉
完成後告訴我下一步該做什麼。
```

Claude Code 會自己跑指令、看 error log、改 code、再試一次,**整個過程你不用打字**,看著它跑就好,需要批准它執行某個動作時按 `y` 即可。

---

## 四、跟 Claude Code 一起做事的常見模式

### 場景 A:加新功能
```
我想加一個「匯入 v3_8 底稿 JSON」的按鈕。
原本的 v3_8 工具在 ../../tool/v3_8_latest.html,
你看一下它的 import 邏輯,然後在 PlanList.jsx 加一個 import 按鈕,
讓使用者可以把 JSON 貼上來建立新方案。
```

### 場景 B:debug
```
跑 npm run dev 後,瀏覽器 console 出現這個錯誤:
[把錯誤訊息整段貼進去]
請幫我修。
```

### 場景 C:寫測試
```
constraints.js 裡的 scorePlan 函式,請幫我用 vitest 寫單元測試,涵蓋:
- 空方案的分數應該怎樣
- 房間互相重疊時 conflict 分數要扣多少
- 踩到 forbidUsages 時 compliance 要 0
```

### 場景 D:重構
```
Canvas2D.jsx 已經超過 200 行,
幫我把房間繪製、家具繪製、拖拉邏輯各自拆成獨立檔案。
```

### 場景 E:Git 操作
```
這次的改動很完整,幫我:
1. git add 相關檔案(不要加 .env.local)
2. 寫一個 commit message 說明這次加了什麼
3. push 到 main 分支
```

---

## 五、給 Claude Code 一份「專案上下文」(強烈建議)

Claude Code 會自動讀取專案根目錄的 `CLAUDE.md`(如果有的話),把它當成「進這個專案的常駐記憶」。
建議你建一份,內容把你的偏好寫進去,以後每次跟 Claude Code 對話它都會記得。

我已經幫你寫好一份建議的初始版本,放在 `docs/CLAUDE_md_template.md`(下一節)。
你看過覺得 OK,就把它複製到專案根目錄改名 `CLAUDE.md`。

---

## 六、跟 Cowork 並用的建議分工

兩邊各做擅長的事:

| 任務 | 用哪個 |
|---|---|
| 寫文件 / 寫報告 / 做投影片 | Cowork |
| 規劃方案、要老闆看的東西 | Cowork(因為可以直接生 .pptx / .docx) |
| 持續寫 code、跑開發伺服器、修 bug | Claude Code |
| Git 提交、PR、code review | Claude Code |
| 跨工具的綜合任務(例如:看 Slack 訊息再寫文件) | Cowork(它有 MCP 連接器) |

---

## 七、注意事項

- **API 用量**:Claude Code 跟 Cowork 共用你的 Anthropic 訂閱(Pro / Max / Team)的配額。如果你訂閱不夠用,可以單獨買 API credit。
- **權限**:Claude Code 預設會問你才執行指令,看到 `Allow this command?` 出現時,沒問題就按 `y`。如果是 `rm -rf` 之類的危險指令一定要看清楚。
- **不要把 `.env.local` 推到 GitHub**:`.gitignore` 已經幫你擋了,但還是確認一下。
- **不確定就問**:Claude Code 跟 Cowork 一樣,你打 `這個檔案是幹嘛的?` 它會解釋給你聽。

---

## 八、有問題隨時回 Cowork 找我

Claude Code 適合長時間連續開發,但**「要不要這麼做」這類規劃級的問題,回來 Cowork 找我比較順**,因為這邊有你的工作習慣記憶、林口總部的硬約束、過去的 lessons-learned。

開發到一個段落,或卡住的時候,把 Claude Code 那邊的對話摘要丟回來給我,我幫你判斷下一步走法。
