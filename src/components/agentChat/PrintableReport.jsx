import { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ScoreCard from './ScoreCard.jsx'

/**
 * 可列印審查/評估報告 — 全螢幕 modal,套 print stylesheet
 * 使用者按 Cmd/Ctrl+P 或內建「列印」按鈕,瀏覽器列印對話即可存成 PDF
 */
export default function PrintableReport({ title, agentType, messages, onClose }) {
  // 開啟報告時鎖捲動
  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [])

  const reportTitle = title || '審查報告'
  const reportSubtitle = agentType === 'audit'
    ? '圖面審查報告 (跑照建築師 + 防綜顧問)'
    : '設計評估報告 (資深設計總監 + 集團總裁)'

  const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })

  // 收集所有附件 (原圖)
  const allAttachments = messages
    .filter(m => m.role === 'user' && m.attachments?.length)
    .flatMap(m => m.attachments)

  return (
    <div className="fixed inset-0 z-50 bg-slate-700/80 overflow-y-auto print:bg-white print:static print:overflow-visible">
      {/* 工具列 (列印時隱藏) */}
      <div className="sticky top-0 z-10 bg-slate-800 text-white px-4 py-2 flex items-center justify-between print:hidden">
        <div className="text-sm font-semibold">📄 報告預覽</div>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
                  className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-sm">
            🖨 列印 / 存 PDF
          </button>
          <button onClick={onClose}
                  className="px-3 py-1 rounded bg-slate-600 hover:bg-slate-500 text-sm">
            關閉
          </button>
        </div>
      </div>

      {/* 報告本體 */}
      <article className="max-w-[210mm] mx-auto my-6 bg-white p-12 shadow-2xl print:shadow-none print:my-0 print:max-w-none">
        <style>{`
          @media print {
            @page { size: A4; margin: 15mm; }
            .page-break { page-break-after: always; }
          }
        `}</style>

        {/* 報告標頭 */}
        <header className="border-b-2 border-slate-800 pb-4 mb-6">
          <div className="text-xs text-slate-500">東森空間規劃實驗室</div>
          <h1 className="text-2xl font-bold mt-1">{reportTitle}</h1>
          <div className="text-sm text-slate-600 mt-1">{reportSubtitle}</div>
          <div className="text-xs text-slate-500 mt-2">產出日期:{today}</div>
        </header>

        {/* 原圖縮圖區 */}
        {allAttachments.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold border-b pb-1 mb-2">📎 審查圖檔</h2>
            <div className="grid grid-cols-2 gap-2">
              {allAttachments.map((a, i) => (
                <div key={i} className="border rounded p-2 text-xs">
                  {a.mime_type?.startsWith('image/') ? (
                    <img src={a.signed_url} alt={a.filename}
                         className="w-full h-auto object-contain max-h-60" />
                  ) : (
                    <div className="bg-slate-100 p-4 text-center text-slate-500">
                      📎 {a.mime_type || '檔案'}
                    </div>
                  )}
                  <div className="mt-1 truncate text-slate-600">{a.filename}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 對話內容 */}
        <section className="space-y-5">
          {messages.map((m, i) => (
            <div key={i}>
              {m.role === 'user' ? (
                <div className="bg-slate-100 border-l-4 border-slate-400 p-3 text-sm">
                  <div className="text-[10px] text-slate-500 font-semibold mb-1">使用者提問:</div>
                  <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                </div>
              ) : (
                <div className="p-3 text-sm">
                  <div className="text-[10px] text-brand-700 font-semibold mb-1">
                    {agentType === 'audit' ? '跑照建築師 + 防綜顧問 回應:' : '資深設計總監 + 集團總裁 回應:'}
                  </div>
                  <div className="prose-print leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({node, ...p}) => <h1 className="text-base font-bold mt-2 mb-1 border-b pb-0.5" {...p} />,
                        h2: ({node, ...p}) => <h2 className="text-sm font-bold mt-2 mb-1" {...p} />,
                        h3: ({node, ...p}) => <h3 className="text-sm font-semibold mt-1.5 mb-0.5" {...p} />,
                        table: ({node, ...p}) => <table className="text-xs border-collapse border border-slate-400 my-2" {...p} />,
                        th: ({node, ...p}) => <th className="border border-slate-400 px-2 py-1 bg-slate-100" {...p} />,
                        td: ({node, ...p}) => <td className="border border-slate-400 px-2 py-1 align-top" {...p} />,
                        ul: ({node, ...p}) => <ul className="list-disc ml-5 my-1" {...p} />,
                        ol: ({node, ...p}) => <ol className="list-decimal ml-5 my-1" {...p} />,
                        strong: ({node, ...p}) => <strong className="font-semibold" {...p} />
                      }}
                    >{m.content}</ReactMarkdown>
                  </div>
                  {m.metadata && <ScoreCard scores={m.metadata} />}
                </div>
              )}
            </div>
          ))}
        </section>

        {/* 報告 footer */}
        <footer className="mt-12 pt-4 border-t text-[10px] text-slate-400 text-center">
          本報告由東森空間規劃實驗室 AI Agent 自動產出,僅供內部參考,實際送照仍需由認證建築師簽章確認。
        </footer>
      </article>
    </div>
  )
}
