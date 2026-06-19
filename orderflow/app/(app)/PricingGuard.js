'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const SESSION_KEY = 'pz_unlocked'
const isSessionUnlocked = () => typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === '1'
const persistUnlock = () => typeof window !== 'undefined' && sessionStorage.setItem(SESSION_KEY, '1')

async function checkPassword(input) {
  const { data } = await createClient().from('app_settings').select('value').eq('key', 'pricing_password').single()
  const stored = data?.value || ''
  return !stored || stored === input  // if no password configured, any input unlocks
}

// Wrapper component — blurs children until pricing password is entered.
export default function PricingGuard({ children }) {
  const [ok, setOk] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isSessionUnlocked()) { setOk(true); return }
    // Auto-unlock if no password is configured
    checkPassword('__auto__').then((pass) => { if (pass) { persistUnlock(); setOk(true) } })
  }, [])

  async function attempt() {
    if (!pw) { setErr('Please enter the password'); return }
    setBusy(true); setErr('')
    const pass = await checkPassword(pw)
    if (pass) { persistUnlock(); setOk(true) } else setErr('Incorrect password')
    setBusy(false)
  }

  if (ok) return <>{children}</>

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ filter: 'blur(8px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.65 }}>
        {children}
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
        <div className="card" style={{ maxWidth: 300, width: '100%', textAlign: 'center', padding: '32px 28px', margin: 0 }}>
          <div style={{ fontSize: 38, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, color: 'var(--ink)' }}>Pricing is locked</div>
          <p className="hint" style={{ marginBottom: 16 }}>Enter the pricing password to view.</p>
          <input
            type="password" value={pw} placeholder="Password"
            onChange={(e) => { setPw(e.target.value); setErr('') }}
            onKeyDown={(e) => e.key === 'Enter' && attempt()}
            style={{ marginBottom: 8 }}
          />
          {err && <p style={{ color: 'var(--bad)', fontSize: 12, margin: '4px 0 8px' }}>{err}</p>}
          <button className="btn btn-a" style={{ width: '100%', marginTop: 4 }} onClick={attempt} disabled={busy}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Hook for gating a button action (e.g. Print office copy) without a wrapper.
// Usage: const { guard, ModalUI } = usePricingCheck()
//        <button onClick={() => guard(myFn)}>Print</button>
//        {ModalUI}
export function usePricingCheck() {
  const [show, setShow] = useState(false)
  const [pending, setPending] = useState(null)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  function guard(fn) {
    if (isSessionUnlocked()) { fn(); return }
    setPending(() => fn); setPw(''); setErr(''); setShow(true)
  }

  async function attempt() {
    if (!pw) { setErr('Please enter the password'); return }
    setBusy(true); setErr('')
    const pass = await checkPassword(pw)
    if (pass) {
      persistUnlock(); setShow(false); pending?.()
    } else {
      setErr('Incorrect password')
    }
    setBusy(false)
  }

  const ModalUI = show ? (
    <div className="modal-bg" onClick={() => setShow(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 300, textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Pricing password required</div>
        <p className="hint" style={{ marginBottom: 14 }}>Enter the password to generate the office copy.</p>
        <input
          type="password" autoFocus value={pw} placeholder="Password"
          onChange={(e) => { setPw(e.target.value); setErr('') }}
          onKeyDown={(e) => e.key === 'Enter' && attempt()}
          style={{ marginBottom: 8 }}
        />
        {err && <p style={{ color: 'var(--bad)', fontSize: 12, margin: '4px 0 8px' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-g" style={{ flex: 1 }} onClick={() => setShow(false)}>Cancel</button>
          <button className="btn btn-a" style={{ flex: 1 }} onClick={attempt} disabled={busy}>
            {busy ? '…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { guard, ModalUI }
}
