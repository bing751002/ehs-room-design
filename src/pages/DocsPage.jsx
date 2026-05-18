import { exportCanvasToPng } from '../lib/exportPng.js'
import { usePlanStore } from '../store/planStore.js'

/**
 * 文件匯出中心 — PNG / PDF / Excel / DWG (之後)
 */
export default function DocsPage() {
  const meta = usePlanStore(s => s.meta)
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <h2 className="text-xl font-semibold">📄 文件匯出</h2>
        <p className="text-sm text-slate-600">把目前方案輸出成不同格式分享或建檔。</p>

        <div className="grid grid-cols-2 gap-3">
          <ExportCard icon="🖼" title="平面圖 PNG" desc="當下畫布的高解析圖,給 LINE/簡報用"
                     buttonText="下載 PNG"
                     onClick={async () => {
                       try { await exportCanvasToPng(`${meta?.title || 'plan'}.png`, 2) }
                       catch (e) { alert(e.message) }
                     }} />
          <ExportCard icon="📊" title="採購清單 CSV" desc="自動算出的家具與建材清單"
                     buttonText="到「採購預算」頁下載"
                     onClick={null} />
          <ExportCard icon="📄" title="完整報告 PDF" desc="平面 + 3D + 預算 + 法規檢核"
                     buttonText="開發中" disabled />
          <ExportCard icon="📐" title="DWG / DXF" desc="給外部設計師/廠商編輯"
                     buttonText="Sprint 4 補上" disabled />
        </div>
      </div>
    </div>
  )
}

function ExportCard({ icon, title, desc, buttonText, onClick, disabled }) {
  return (
    <div className="bg-white border rounded-lg p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-xs text-slate-600 min-h-[2em]">{desc}</p>
      <button onClick={onClick} disabled={disabled || !onClick}
              className="w-full py-2 rounded bg-brand-700 text-white text-sm hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed">
        {buttonText}
      </button>
    </div>
  )
}
