import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { emptyPlan } from '../lib/constraints.js'

export default function PlanList() {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('plans').select('id,title,floor_label,updated_at')
      .order('updated_at', { ascending: false })
    if (!error) setPlans(data ?? [])
    setLoading(false)
  }

  async function create() {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('plans')
      .insert({ owner: user.id, title: '新方案', data: emptyPlan() })
      .select().single()
    if (error) { alert(error.message); return }
    nav(`/plan/${data.id}`)
  }

  async function remove(id) {
    if (!confirm('確定刪除這個方案?(此動作無法復原)')) return
    await supabase.from('plans').delete().eq('id', id)
    load()
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">我的方案</h2>
        <div className="flex gap-2">
          <Link to="/cases" className="border px-3 py-1.5 rounded hover:bg-slate-50 text-sm">
            📚 案例庫
          </Link>
          <Link to="/rules" className="border px-3 py-1.5 rounded hover:bg-slate-50 text-sm">
            ⚖️ 內部規則
          </Link>
          <button onClick={create} className="bg-brand-700 text-white px-3 py-1.5 rounded hover:bg-brand-500">
            + 新增方案
          </button>
        </div>
      </div>
      {loading ? <p className="text-slate-500">載入中...</p> :
       plans.length === 0 ? <p className="text-slate-500">還沒有方案,點右上「新增方案」開始。</p> :
        <ul className="divide-y bg-white rounded-xl shadow-sm">
          {plans.map(p => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <Link to={`/plan/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                <div className="text-xs text-slate-500">
                  {p.floor_label ?? '未指定樓層'} · 更新於 {new Date(p.updated_at).toLocaleString('zh-TW')}
                </div>
              </div>
              <button onClick={() => remove(p.id)}
                      className="text-red-500 text-sm hover:underline">刪除</button>
            </li>
          ))}
        </ul>}
    </div>
  )
}
