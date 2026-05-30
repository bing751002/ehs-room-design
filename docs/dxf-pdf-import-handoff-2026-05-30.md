# DXF + PDF Import Handoff

Last updated: 2026-05-30

## Current Goal

使用者的最終目標是：讓使用者上傳同版本的 DXF + PDF，系統用 PDF 當乾淨底圖，再用 DXF/PDF 的幾何與文字資訊自動框出各區域，後續要拿這些區域建立 3D。準確度比速度重要，但流程要能通用到其他 DXF/PDF，不要為了目前這張圖硬寫座標。

目前優先級是「先把大區域與封閉房間框準」，家具、柱子、裝飾線可以先不作為主要輸出。判斷區域時以牆與門為主，因為使用者認為是否為同一個區塊應由牆/門分隔決定，不應只依文字或坪數切區。

## What Was Built

主要流程已接回正式上傳：

- `BaseLayerUpload.jsx` 支援同時選 DXF + PDF，會走 `uploadDxfPdfBaseLayer()`。
- `fileUpload.js` 會建立 hybrid base layer。
- `dxfPdfBaseLayer.js` 會把 PDF crop、DXF overlay lines、PDF import preview 合成同一個 baseLayer。
- `dxfPdfImport.js` 負責 PDF 文字、DXF frame、DXF overlay 對齊與 room preview。
- `DxfPdfFrameButton.jsx` 會從目前 baseLayer 產生正式 `spaces`。
- `dxfPdfDeterministicImport.js` 負責把 matched rooms 轉成 canvas spaces，並做 post-alignment correction。

之前畫面會留下舊牆/門/窗或上傳後動一下又像回到舊狀態，已先在套用 DXF+PDF spaces 時清掉舊的 `rooms/walls/doors/windows`，避免舊 DXF 物件蓋在新底圖上。

## Current Technical Problem

PDF 底圖本身已經相當準，但自動產生的房間框仍會局部偏移，尤其是小房間與下排房間。這不是單純整張圖的 global offset，原因是：

- 不同區塊的偏移不一致，有些區塊已準，有些區塊上下偏。
- PDF 文字位置不一定在房間中心，小房間更容易把文字當中心造成誤判。
- DXF 裡有些封閉框不等於實際牆線，尤其門窗、地面造型、天花/地坪線會混在一起。
- 86 人共享辦公室與 44 人討論休息區實際上是同一個物理區塊，中間沒有牆或門，所以不能只用標籤分成兩個房間。

所以目前策略改成：

1. 先用 DXF + PDF 文字找出候選房間框。
2. 再把候選框邊界貼齊 PDF/DXF overlay 裡可見的牆線。
3. 如果整張圖有一致位移才做 global correction。
4. 如果只有少數小房間局部偏移，做 local correction。
5. 如果同一個房間左右/上下邊各自偏一點，做 per-edge snap，而不是整間平移。

## Latest Implementation State

`src/lib/dxfPdfDeterministicImport.js` 目前已有三層 post check：

- global correction: 只在 residual cluster 足夠一致時套用整張圖偏移。
- local room correction: 小房間若所有邊的 residual 都一致，平移該房間 vertices。
- edge snapping: 對每個房間的水平/垂直邊，找附近重疊度足夠高的 overlay edge，逐邊貼齊。

新增/相關函式：

- `spaceEdges(space)`: 取出房間水平/垂直邊，現在也帶 `aIndex/bIndex`。
- `closestResidual(edge, candidates)`: 用於 global/local residual。
- `correctLocalSpaceOffsets(spaces, overlay)`: 局部整間修正。
- `closestEdgeSnap(edge, candidates)`: 找單條邊最近可貼齊的 overlay edge。
- `snapSpaceEdgesToOverlay(spaces, overlay)`: 對每個 room 的邊做 per-edge snap。
- `correctGlobalSpaceOffset(spaces, baseLayer, bounds)`: 整合 global/local/edge snap，並把診斷寫進 `meta.postAlignmentCorrection`。

真實 fixture 測到的診斷大致如下：

```json
{
  "spaces": 19,
  "correction": {
    "applied": true,
    "reason": "local-corrections-applied",
    "offset": { "x": 0, "y": 0 },
    "localCorrectionCount": 2,
    "edgeSnapCount": 15,
    "sampleCount": 102,
    "xClusterRatio": 0.82,
    "yClusterRatio": 0.27
  }
}
```

這代表目前不再套用危險的整張 y = -70 位移，而是只修明確局部偏移與可貼邊的房間。

## Verification Already Run

在 `D:\ehs-house-design-system\空間規劃-雲端版-v4` 已跑過：

```powershell
node test-fixtures\_test_dxf_pdf_deterministic_import.mjs
node test-fixtures\_test_dxf_pdf_import.mjs
node test-fixtures\_test_dxf_pdf_base_layer.mjs
node test-fixtures\_test_dxf_upload_content.mjs
node test-fixtures\_test_gemini_dxf_pdf_hint.mjs
npm run build
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173 | Select-Object -ExpandProperty StatusCode
```

結果：

- deterministic import test: pass
- DXF/PDF import fixture test: pass
- DXF/PDF base layer test: pass
- DXF upload content test: pass
- Gemini hint test: pass
- Vite build: pass
- local dev server status: `200`

Build 仍有既有 warning：

- `node:fs` / `node:path` 被 Vite externalized for browser compatibility，來源是 Anthropic SDK。
- bundle chunk 大於 500 kB。
- `pdfjs-dist`/`claudeApi.js` dynamic import chunk warning。

這些 warning 不是這次 DXF/PDF 框線修正造成的。

## Important Files

核心檔案：

- `src/lib/dxfPdfImport.js`
- `src/lib/dxfPdfDeterministicImport.js`
- `src/lib/dxfPdfBaseLayer.js`
- `src/lib/fileUpload.js`
- `src/components/BaseLayerUpload.jsx`
- `src/components/DxfPdfFrameButton.jsx`
- `src/components/DxfPdfImportWizard.jsx`
- `src/lib/dxfPreview.js`

測試與 fixture：

- `test-fixtures/_test_dxf_pdf_deterministic_import.mjs`
- `test-fixtures/_test_dxf_pdf_import.mjs`
- `test-fixtures/_test_dxf_pdf_base_layer.mjs`
- `test-fixtures/office22F.dxf`
- `test-fixtures/render-output/pdf-text-alignment.json`
- `test-fixtures/render-output/pdf-dxf-alignment-summary.json`

注意：目前 working tree 有很多既有未提交與未追蹤檔案，不要 reset 或 checkout。只針對 DXF/PDF import 相關檔案做最小修改。

## Remaining Work

下一步建議：

1. 讓使用者重新上傳同版本 DXF + PDF，按 DXF+PDF 框線產生，視覺確認 per-edge snap 後的結果。
2. 如果仍有整區上下偏移，先看 `console.info('[DXF+PDF deterministic import]', result.meta)` 裡的 `postAlignmentCorrection`。
3. 若偏移是某些大區域造成，不要再放寬 global correction。應改進 wall/door boundary extraction 或 per-region snap。
4. 大區域優先：86+44 應視為同一 physical space，44 可保留 functional zone label，但不要變成獨立牆區。
5. 小房間再調：顧問室、洽談室、會議室這類可用 per-edge snap 加強，但要避免把家具/窗線當牆。
6. 開放空間要用牆/門 flood-fill 或 connected-region 方法，而不是文字中心外擴。

## Known Risks

- `snapSpaceEdgesToOverlay()` 目前是通用幾何 heuristic，可能在 overlay line 過多時把邊貼到家具線或窗線。它用 overlap ratio、距離與 labelPlacement 限制降低風險，但仍需視覺驗證。
- 如果 DXF layer 裡牆線不足、門窗線與家具線混雜，純 deterministic 方法可能還是不夠。可考慮之後加入 LLM/VLM 做「判斷這條線是不是牆/門」的輔助，但目前使用者要求先不用 LLM。
- 文字位置不可靠，不應再把文字位置當房間中心，只能作為 label 和候選匹配提示。
- 有些 UI 文案檔案出現 mojibake，可能是編碼/終端顯示問題。不要因為整理文案而大規模改 unrelated files。

## Suggested Prompt For Next LLM

把下面這段直接交給下一個 LLM：

```text
你在 D:\ehs-house-design-system\空間規劃-雲端版-v4 工作。使用者要做 DXF+PDF import：上傳同版本 DXF 和 PDF，用 PDF 當乾淨底圖，用 DXF/PDF 資訊產生準確 2D 空間框線，後續要轉 3D。請不要 hardcode 目前這張圖，要做通用流程。

目前已經接上正式流程：BaseLayerUpload 可同時上傳 DXF+PDF，fileUpload/dxfPdfBaseLayer 產生 hybrid baseLayer，DxfPdfFrameButton 會從 baseLayer 套用 spaces。套用時會清掉舊 rooms/walls/doors/windows，避免舊物件殘留。

目前正在解的問題是：PDF 底圖準，但 room frames 有局部偏移。這不是整張圖 global offset；有些區域準，有些小房間或下排房間偏。使用者要求以牆和門判斷 physical space，不要只靠文字中心。86 人共享辦公室與 44 人討論休息區是同一物理區塊，因中間沒有牆/門，44 只能是 functional zone label。

請先閱讀：
- src/lib/dxfPdfDeterministicImport.js
- src/lib/dxfPdfImport.js
- src/lib/dxfPdfBaseLayer.js
- src/components/BaseLayerUpload.jsx
- src/components/DxfPdfFrameButton.jsx
- test-fixtures/_test_dxf_pdf_deterministic_import.mjs
- test-fixtures/_test_dxf_pdf_import.mjs

目前 dxfPdfDeterministicImport.js 已有 post-alignment correction：
1. global correction：只有 residual cluster 一致才整張平移。
2. local correction：少數小房間邊線 residual 一致時，只平移該房間 vertices。
3. per-edge snap：對每條水平/垂直邊找附近重疊度足夠高的 overlay wall edge，逐邊貼齊。

請先跑：
node test-fixtures\_test_dxf_pdf_deterministic_import.mjs
node test-fixtures\_test_dxf_pdf_import.mjs
npm run build

如果要繼續改善，優先做：
1. 在 UI 重新上傳 DXF+PDF，按 DXF+PDF 框線產生，檢查實際畫面。
2. 用 console meta 裡的 postAlignmentCorrection 判斷偏移原因。
3. 不要放寬 global correction 來修局部問題。
4. 若大區域還不準，改善 wall/door boundary extraction 或 connected-region/flood-fill，而不是用文字中心框。
5. 若小房間邊界差一點，微調 snapSpaceEdgesToOverlay 的候選線過濾，避免貼到家具/窗線。

重要：working tree 很髒，有很多未提交和未追蹤檔案。不要 git reset、不要 checkout、不要清掉別人的修改。只針對 DXF/PDF import 相關檔案做最小修改。每次修改後跑 deterministic/import fixture tests 和 npm run build。
```

