'use client'
import { useEffect, useState } from 'react'

// A small curated fallback so we always show something even if the live
// "on this day" lookup is unavailable (offline, blocked, rate-limited).
const FALLBACK = [
  'The first commercial chemical works in Britain opened in the 18th century — the start of the industry this very app serves.',
  'Sulphuric acid is the most produced industrial chemical in the world by mass.',
  'The IBC (Intermediate Bulk Container) was standardised in the 1990s and now moves most liquid chemicals by road.',
  'The hazard diamond (UN ADR) classification system dates back to international agreements first signed in 1957.',
  '“Chemistry” takes its name from alchemy, itself from the Arabic al-kīmiyā.',
  'Water is one of the only substances on Earth found naturally as a solid, liquid and gas.',
  'The pH scale was introduced by Danish chemist Søren Sørensen in 1909.',
]

// Deterministic pick for a given day so the fact is stable across refreshes.
function dayIndex(d) {
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d - start) / 86400000)
}

export default function FactOfTheDay() {
  const [fact, setFact] = useState(null) // { year, text } | { text }
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${mm}/${dd}`, {
          headers: { accept: 'application/json' },
        })
        if (!res.ok) throw new Error('bad status')
        const data = await res.json()
        const events = (data.selected || data.events || []).filter((e) => e.text && e.year)
        if (!events.length) throw new Error('no events')
        const pick = events[dayIndex(now) % events.length]
        if (!cancelled) setFact({ year: pick.year, text: pick.text.replace(/\s+$/, '') })
      } catch (e) {
        if (!cancelled) {
          setFailed(true)
          setFact({ text: FALLBACK[dayIndex(now) % FALLBACK.length] })
        }
      }
    })()

    return () => { cancelled = true }
  }, [])

  if (!fact) return null

  return (
    <div style={{
      maxWidth: 640, margin: '0 auto', textAlign: 'center',
      background: 'var(--panel-2)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '14px 22px',
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase',
        color: 'var(--accent)', marginBottom: 6,
      }}>
        {failed ? '💡 Did you know' : '📅 On this day'}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink)' }}>
        {fact.year && (
          <strong style={{ color: 'var(--heading)' }}>In {fact.year}, </strong>
        )}
        {fact.text}
      </div>
    </div>
  )
}
