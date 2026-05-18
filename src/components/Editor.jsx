import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import Canvas2D from './Canvas2D.jsx'
import Canvas3D from './Canvas3D.jsx'
import RoomLibrary from './RoomLibrary.jsx'
import FurnitureLibrary from './FurnitureLibrary.jsx'
import ScorePanel from './ScorePanel.jsx'
import BaseLayerUpload from './BaseLayerUpload.jsx'
import BaseLayerControls from './BaseLayerControls.jsx'
import ChatPanel from './ChatPanel.jsx'
import EditorToolbar from './EditorToolbar.jsx'
import BomPanel from './BomPanel.jsx'
import PropertiesPanel from './PropertiesPanel.jsx'
import FloorPropsPanel from './FloorPropsPanel.jsx'

/**
 * 2D 平面編輯器主畫面 (在 EditorLayout 內當 outlet)。
 * EditorLayout 已經處理 load() + realtime + 樓層切換 + 全域導覽,
 * 這裡只關心:房間庫/家具庫 | 畫布(工具列+底圖+Canvas2D) | AI/BOM/評分
 */
export default function Editor() {
  const [tab, setTab] = useState('room')       // 'room' | 'furn'
  const [rightTab, setRightTab] = useState('ai') // 'ai' | 'bom' | 'score'
  const [previewView, setPreviewView] = useState('topdown') // 'topdown' | 'perspective' | 'off'
  const [leftCollapsed, setLeftCollapsed] = useState(false)

  return (
    <div className="h-full grid" style={{ gridTemplateColumns: `${leftCollapsed ? 28 : 200}px 1fr 320px` }}>
      {/* 左欄:房間庫 / 家具庫 (可折疊) */}
      <aside className="border-r bg-white overflow-y-auto relative">
        {leftCollapsed ? (
          <button onClick={() => setLeftCollapsed(false)} title="展開"
                  className="absolute inset-0 w-full text-xs text-slate-500 hover:bg-slate-50">
            ▶
          </button>
        ) : (
          <>
            <div className="flex border-b text-sm">
              <button onClick={() => setTab('room')}
                      className={`flex-1 py-2 ${tab === 'room' ? 'bg-slate-100 font-semibold' : ''}`}>房間庫</button>
              <button onClick={() => setTab('furn')}
                      className={`flex-1 py-2 ${tab === 'furn' ? 'bg-slate-100 font-semibold' : ''}`}>家具庫</button>
              <button onClick={() => setLeftCollapsed(true)} title="折疊"
                      className="px-2 text-slate-400 hover:text-slate-700">◀</button>
            </div>
            {tab === 'room' ? <RoomLibrary /> : <FurnitureLibrary />}
          </>
        )}
      </aside>

      {/* 中欄:工具列 + 底圖控制 + 畫布 (含 3D 俯瞰小視窗) */}
      <section className="flex flex-col bg-slate-100 overflow-hidden relative">
        <div className="px-3 pt-2 space-y-2 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <EditorToolbar />
            <BaseLayerUpload />
            <div className="ml-auto flex gap-1 text-xs">
              <span className="text-slate-500 self-center mr-1">3D 預覽:</span>
              {[
                { k: 'topdown', label: '俯瞰' },
                { k: 'perspective', label: '透視' },
                { k: 'off', label: '關閉' }
              ].map(o => (
                <button key={o.k} onClick={() => setPreviewView(o.k)}
                        className={`px-2 py-1 rounded border ${previewView === o.k ? 'bg-brand-700 text-white border-brand-700' : 'bg-white hover:bg-slate-50'}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <BaseLayerControls />
        </div>
        <div className="flex-1 min-h-0 relative">
          <Canvas2D />
          {/* 屬性面板 (選取後浮動右上) */}
          <PropertiesPanel />
          {/* 3D 俯瞰活預覽 (浮動右下) */}
          {previewView !== 'off' && (
            <div className="absolute bottom-3 right-3 w-72 h-56 bg-white border-2 border-brand-700 rounded-lg shadow-xl overflow-hidden">
              <div className="absolute top-1 left-2 text-[10px] font-medium bg-white/80 px-1.5 py-0.5 rounded z-10">
                {previewView === 'topdown' ? '🗺 3D 俯瞰' : '🏗 3D 透視'} · 即時預覽
              </div>
              <Canvas3D view={previewView} mini />
            </div>
          )}
        </div>
      </section>

      {/* 右欄:AI / 採購清單 / 評分 */}
      <aside className="border-l bg-white flex flex-col overflow-hidden">
        <div className="flex border-b text-[11px] shrink-0">
          {[
            { k: 'ai',    label: '🤖 AI' },
            { k: 'floor', label: '🏢 樓層' },
            { k: 'bom',   label: '📋 採購' },
            { k: 'score', label: '📊 評分' }
          ].map(t => (
            <button key={t.k} onClick={() => setRightTab(t.k)}
                    className={`flex-1 py-2 ${rightTab === t.k ? 'bg-slate-100 font-semibold' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          {rightTab === 'ai'    && <ChatPanel />}
          {rightTab === 'floor' && <FloorPropsPanel />}
          {rightTab === 'bom'   && <BomPanel />}
          {rightTab === 'score' && <ScorePanel />}
        </div>
      </aside>
    </div>
  )
}
