import { useEffect, useState } from 'react'

const STORAGE_KEY = 'tour_v4_seen'

const STEPS = [
  {
    title: '👋 歡迎進入東森空間規劃實驗室',
    body: '這個工具幫你「上傳底圖 → AI 規劃 → 出 3D 與採購清單」。3 分鐘走完最快流程。'
  },
  {
    title: '① 上傳底圖',
    body: '畫布左上「+ 上傳底圖」支援 DXF / PDF / JPG / PNG。多頁 PDF 也行。'
  },
  {
    title: '② 校準比例尺(重要!)',
    body: '上傳完務必點「📐 校準比例尺」。沒校準的話坪數會錯,AI 識別也會偏。'
  },
  {
    title: '③ AI 自動識別',
    body: '點「🤖 AI 識別圖紙」讓 AI 看圖自動生牆/門/窗/空間。出來後可拖頂點/拖整塊調整。'
  },
  {
    title: '④ 跟 AI 對話規劃',
    body: '右側 AI 助手:打字告訴 AI 你要規劃什麼(例:「30 人辦公室含 2 會議室」)。AI 會考慮法規 + 你的案例庫 + 內部規則。'
  },
  {
    title: '⑤ 看 3D + 出採購清單',
    body: '右下浮動 3D 俯瞰預覽即時跟著動。左 nav 切「採購預算」看自動估算的家具與建材費用。'
  },
  {
    title: '⑥ 出渲染圖給老闆',
    body: '左 nav「渲染圖廊」→ 從目前平面圖一鍵生擬真渲染圖(Gemini Imagen 4)。'
  },
  {
    title: '快捷鍵',
    body: 'V 選取、W 加牆、D 加門、N 加窗、R 加空間、M 量距、Esc 取消、⌘Z 撤銷、⌘⇧Z 重做、Alt+滾輪 縮放底圖。'
  }
]

export default function OnboardingTour() {
  const [step, setStep] = useState(-1)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setStep(0)
  }, [])

  function close() {
    localStorage.setItem(STORAGE_KEY, '1')
    setStep(-1)
  }
  function next() {
    if (step >= STEPS.length - 1) close()
    else setStep(step + 1)
  }

  if (step < 0) return null
  const s = STEPS[step]

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={close}>
      <div className="bg-white rounded-xl shadow-2xl w-[520px] p-6 space-y-4"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">步驟 {step + 1} / {STEPS.length}</span>
          <button onClick={close} className="text-slate-400 hover:text-slate-700 text-sm">跳過 ✕</button>
        </div>
        <h2 className="text-xl font-semibold">{s.title}</h2>
        <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
        <div className="flex justify-between items-center pt-2 border-t">
          <button onClick={() => setStep(Math.max(0, step - 1))}
                  disabled={step === 0}
                  className="text-sm text-slate-500 hover:text-slate-800 disabled:opacity-30">← 上一步</button>
          <button onClick={next}
                  className="px-4 py-1.5 bg-brand-700 text-white rounded hover:bg-brand-500 text-sm">
            {step >= STEPS.length - 1 ? '開始使用' : '下一步 →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// 也匯出一個「重新看引導」的函式給 PlanList 用
export function resetTour() {
  localStorage.removeItem(STORAGE_KEY)
  location.reload()
}
