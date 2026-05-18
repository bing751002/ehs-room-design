import BomPanel from '../components/BomPanel.jsx'

/**
 * 全頁版採購清單 — 跟側邊版 BomPanel 一樣的邏輯,只是更大版面。
 */
export default function BomPage() {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-5xl mx-auto p-6">
        <BomPanel />
      </div>
    </div>
  )
}
