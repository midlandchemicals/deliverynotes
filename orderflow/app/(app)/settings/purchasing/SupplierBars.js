'use client'
import { useState } from 'react'

// Average unit price by supplier. One measure across nominal categories, so
// every bar is the same colour — shading them by value would double-encode the
// length. The cheapest is called out by a label, not a second hue.
const ACCENT = '#1F6E4E'

export default function SupplierBars({ rows, fmt }) {
  const [hover, setHover] = useState(null)
  if (!rows || rows.length < 2) return null

  const max = Math.max(...rows.map((r) => r.avg))
  const best = rows.reduce((a, b) => (b.avg < a.avg ? b : a))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '4px 0 6px' }}>
      {rows.map((r) => {
        const pct = max ? (r.avg / max) * 100 : 0
        const isBest = r.name === best.name
        return (
          <div key={r.name}
            onMouseEnter={() => setHover(r.name)} onMouseLeave={() => setHover(null)}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,26%) 1fr auto', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={r.name}>{r.name}</div>
            <div style={{ background: 'var(--panel-2)', borderRadius: 4, height: 18, position: 'relative' }}>
              <div style={{
                width: `${Math.max(pct, 1.5)}%`, height: '100%', background: ACCENT,
                borderRadius: '0 4px 4px 0', opacity: hover && hover !== r.name ? 0.45 : 1,
                transition: 'opacity .12s',
              }} />
            </div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)', whiteSpace: 'nowrap' }}>
              {fmt(r.avg)}
              <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 10.5, color: 'var(--muted)' }}>
                {' '}× {r.n}
              </span>
              {isBest && rows.length > 1 && (
                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 10, color: ACCENT }}> · cheapest</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
