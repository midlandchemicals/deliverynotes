'use client'

// Both reports work the same way: one month is being looked at, and any number
// of others can be folded into the same document.
export default function MonthPicker({ months, current, setCurrent, extra, setExtra, fmtMoney }) {
  const toggleExtra = (k) => setExtra((s) => {
    const n = new Set(s)
    n.has(k) ? n.delete(k) : n.add(k)
    return n
  })
  return (
    <div className="card">
      <div className="ttl"><h2>Month</h2></div>
      {months.length === 0 ? <div className="empty">No delivery notes on file yet.</div> : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {months.map((m) => (
              <button key={m.key} className={'chip' + (current === m.key ? ' on' : '')}
                onClick={() => setCurrent(m.key)}>
                {m.label} <span style={{ opacity: .65 }}>· {fmtMoney(m.net)}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>
              Also include in the report
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {months.filter((m) => m.key !== current).map((m) => (
                <label key={m.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 12.5, cursor: 'pointer', margin: 0 }}>
                  <input type="checkbox" checked={extra.has(m.key)} onChange={() => toggleExtra(m.key)}
                    style={{ width: 'auto', height: 15, accentColor: 'var(--accent)' }} />
                  {m.label}
                </label>
              ))}
              {months.length < 2 && <span className="hint" style={{ margin: 0 }}>Only one month on file so far.</span>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
