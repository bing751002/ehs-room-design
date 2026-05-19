import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRoomTemplates, removeRoomTemplate, toggleFavorite } from '../lib/roomTemplates.js'
import { supabase } from '../lib/supabase.js'
import { getProfileMap, ownerLabel } from '../lib/profiles.js'

/**
 * 獨立房間庫管理頁 — 顯示所有自訂房型,可批次管理
 */
export default function RoomLibraryPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [profileMap, setProfileMap] = useState({})
  const [currentUid, setCurrentUid] = useState(null)

  useEffect(() => {
    reload()
    getProfileMap().then(setProfileMap)
    supabase.auth.getUser().then(({ data }) => setCurrentUid(data?.user?.id))
  }, [])
  async function reload() {
    setLoading(true)
    try {
      const list = await listRoomTemplates()
      setItems(list); setTableMissing(false)
    } catch (e) {
      if (/room_templates/i.test(e.message || '')) setTableMissing(true)
      else alert(e.message)
    }
    setLoading(false)
  }

  async function onDelete(t) {
    if (!confirm(`刪除「${t.name}」?`)) return
    await removeRoomTemplate(t.id)
    reload()
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        <Link to="/" className="text-xs text-slate-500 hover:underline">← 回方案列表</Link>
        <h1 className="text-2xl font-bold mt-1 mb-1">🏠 房間庫管理</h1>
        <p className="text-sm text-slate-600 mb-4">
          自訂房型 + AI 對話自動沉澱的房型。規劃時 AI 會優先參考這些自訂房型的尺寸與設計考量。
        </p>

        {tableMissing && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm mb-3">
            ⚠ 房間庫尚未啟用 —— 請到 Supabase SQL Editor 跑 <code className="bg-white px-1">supabase/room_templates_schema.sql</code>。
          </div>
        )}

        {loading ? <p>載入中…</p> :
          items.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              還沒有自訂房型。到任一方案的「房間庫」側欄按「+ 新增」,或讓 AI 規劃後一鍵存進來。
            </div>
          ) : (
            <table className="w-full bg-white border rounded-lg text-sm">
              <thead className="bg-slate-100 text-xs">
                <tr>
                  <th className="text-left p-2">名稱</th>
                  <th className="text-left p-2">類型</th>
                  <th className="text-left p-2">分類</th>
                  <th className="text-right p-2">尺寸 (cm)</th>
                  <th className="text-right p-2">坪數</th>
                  <th className="text-left p-2">來源</th>
                  <th className="text-left p-2">加入者</th>
                  <th className="text-left p-2">最愛</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(t => (
                  <tr key={t.id} className="border-t hover:bg-slate-50">
                    <td className="p-2 font-medium flex items-center gap-1">
                      <span className="w-4 h-4 rounded shrink-0" style={{ background: t.color }} />
                      {t.name}
                    </td>
                    <td className="p-2 text-xs">{t.type}</td>
                    <td className="p-2 text-xs">{t.category || '-'}</td>
                    <td className="p-2 text-right font-mono text-xs">
                      {t.width_cm}×{t.depth_cm}×{t.height_cm}
                    </td>
                    <td className="p-2 text-right text-xs">
                      {((t.width_cm * t.depth_cm) / 33057.85).toFixed(2)}
                    </td>
                    <td className="p-2 text-xs">
                      {t.source === 'ai_chat' ? '🤖 AI' : t.source === 'manual' ? '✋ 手動' : t.source}
                    </td>
                    <td className="p-2 text-xs text-slate-500">
                      👤 {ownerLabel(profileMap, t.owner, currentUid)}
                    </td>
                    <td className="p-2">
                      {t.owner === currentUid ? (
                        <button onClick={async () => { await toggleFavorite(t.id, t.is_favorite); reload() }}>
                          {t.is_favorite ? '⭐' : '☆'}
                        </button>
                      ) : (
                        <span>{t.is_favorite ? '⭐' : '☆'}</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {t.owner === currentUid ? (
                        <button onClick={() => onDelete(t)}
                                className="text-red-500 text-xs hover:underline">刪除</button>
                      ) : (
                        <span className="text-[10px] text-slate-400">(其他同事的)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}
