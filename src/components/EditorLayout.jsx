import { useEffect } from 'react'
import { NavLink, Outlet, useParams, Link, useNavigate } from 'react-router-dom'
import { usePlanStore } from '../store/planStore.js'
import { supabase } from '../lib/supabase.js'
import FloorTabs from './FloorTabs.jsx'
import TopActionBar from './TopActionBar.jsx'

/**
 * 編輯器外殼:左側 sub-nav + 中間 outlet。
 * 子路由:
 *   /plan/:id            → 預設導向 編輯 (2D 平面)
 *   /plan/:id/editor     → 平面編輯器 (Canvas2D + AI)
 *   /plan/:id/3d         → 3D 預覽 (全頁)
 *   /plan/:id/bom        → 採購清單 + 預算 (全頁)
 *   /plan/:id/render     → 渲染圖廊 (Sprint 3 待補)
 *   /plan/:id/docs       → 文件 / 匯出 (Sprint 4 待補)
 */
export default function EditorLayout() {
  const { id } = useParams()
  const nav = useNavigate()
  const load = usePlanStore(s => s.load)
  const applyRemote = usePlanStore(s => s.applyRemote)
  const meta = usePlanStore(s => s.meta)
  const setMeta = usePlanStore(s => s.setMeta)
  const saving = usePlanStore(s => s.saving)
  const plan = usePlanStore(s => s.plan)

  async function saveAsCopy() {
    const newTitle = prompt('複製成新方案,名稱?', `${meta.title || '方案'} (複本)`)
    if (!newTitle) return
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('plans').insert({
      owner: user.id, title: newTitle, floor_label: meta.floor_label,
      data: plan
    }).select().single()
    if (error) { alert(error.message); return }
    nav(`/plan/${data.id}/editor`)
  }

  useEffect(() => {
    load(id)
    const ch = supabase.channel(`plan-${id}`)
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'plans', filter: `id=eq.${id}` },
          (payload) => applyRemote(payload.new))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id])

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      <TopActionBar />
      <div className="flex-1 flex overflow-hidden">
      {/* 左側 sub-nav */}
      <nav className="w-44 border-r bg-slate-50 flex flex-col text-sm">
        <Link to="/" className="px-3 py-2 text-xs text-slate-500 hover:underline border-b">
          ← 全部方案
        </Link>
        <div className="px-3 py-2 border-b">
          <input className="border-b text-sm px-1 outline-none w-full bg-transparent"
                 value={meta.title || ''}
                 onChange={e => setMeta({ title: e.target.value })} />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-slate-400">{saving ? '儲存中…' : '已儲存'}</span>
            <button onClick={saveAsCopy}
                    title="複製成新方案,當前方案不變"
                    className="text-[10px] text-slate-600 hover:text-brand-700 hover:underline">
              📑 另存
            </button>
          </div>
        </div>
        <div className="px-2 py-2 space-y-1 flex-1">
          <SideLink to="editor" icon="📐">2D 編輯</SideLink>
          <SideLink to="3d"     icon="🏗">3D 預覽</SideLink>
          <SideLink to="bom"    icon="📋">採購預算</SideLink>
          <SideLink to="render" icon="🎨">渲染圖廊</SideLink>
          <SideLink to="docs"   icon="📄">文件匯出</SideLink>
        </div>
        <div className="px-3 py-2 border-t">
          <FloorTabs />
        </div>
      </nav>

      {/* 中間 outlet */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      </div>
    </div>
  )
}

function SideLink({ to, icon, children }) {
  return (
    <NavLink to={to}
             className={({ isActive }) =>
               `block px-2 py-1.5 rounded text-sm ${
                 isActive ? 'bg-brand-700 text-white' : 'hover:bg-slate-100 text-slate-700'
               }`
             }>
      <span className="mr-1.5">{icon}</span>{children}
    </NavLink>
  )
}
