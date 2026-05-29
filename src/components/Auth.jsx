import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    console.log('[auth] 開始寄送 OTP', email)
    try {
      const { data, error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin }
      })
      console.log('[auth] Supabase 回應', { data, error })
      if (error) setErr(error.message)
      else setSent(true)
    } catch (ex) {
      console.error('[auth] 例外', ex)
      setErr('寄送失敗: ' + (ex.message || String(ex)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-xl shadow w-96">
        <h1 className="text-xl font-semibold mb-1">東森空間規劃實驗室</h1>
        <p className="text-sm text-slate-500 mb-6">輸入 email,我們會寄登入連結給你</p>
        {sent ? (
          <p className="text-green-600 text-sm">登入連結已寄出,請查收信箱。</p>
        ) : (
          <form onSubmit={send} className="space-y-3">
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                   placeholder="you@example.com"
                   className="w-full border rounded px-3 py-2" />
            <button className="w-full bg-brand-700 text-white rounded py-2 hover:bg-brand-500">
              寄送登入連結
            </button>
            {err && <p className="text-red-600 text-sm">{err}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
