import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import Auth from './components/Auth.jsx'
import PlanList from './components/PlanList.jsx'
import Editor from './components/Editor.jsx'
import EditorLayout from './components/EditorLayout.jsx'
import View3DPage from './pages/View3DPage.jsx'
import BomPage from './pages/BomPage.jsx'
import RenderPage from './pages/RenderPage.jsx'
import DocsPage from './pages/DocsPage.jsx'
import CaseLibraryPage from './pages/CaseLibraryPage.jsx'
import RulesPage from './pages/RulesPage.jsx'
import OnboardingTour from './components/OnboardingTour.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="p-8 text-slate-500">載入中...</div>
  if (!session) return <Auth />

  return (
    <div className="min-h-screen flex flex-col">
      <OnboardingTour />
      <header className="h-12 bg-brand-900 text-white flex items-center px-4 justify-between">
        <Link to="/" className="font-semibold">東森空間規劃實驗室</Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="opacity-80">{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()}
                  className="px-2 py-1 rounded bg-brand-700 hover:bg-brand-500">登出</button>
        </div>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<PlanList />} />
          <Route path="/cases" element={<CaseLibraryPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/plan/:id" element={<EditorLayout />}>
            <Route index element={<Navigate to="editor" replace />} />
            <Route path="editor" element={<Editor />} />
            <Route path="3d"     element={<View3DPage />} />
            <Route path="bom"    element={<BomPage />} />
            <Route path="render" element={<RenderPage />} />
            <Route path="docs"   element={<DocsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
