'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prettyDate, todayISO, dateISO } from '@/lib/calc'
import { toastError } from '@/lib/notify'
import { loadReportNotes, monthLabel } from '@/lib/reports'
import { dgRows, REPORT_CLASSES, SEPARATE_CLASSES } from '@/lib/dg'

// Dangerous Goods — a running tally of tonnes moved per ADR class, for the
// DGSA annual report. Nothing to enter: it's read from the delivery notes.

const ALL_CLASSES = ['1', ...REPORT_CLASSES.slice(0, 5), '7', ...REPORT_CLASSES.slice(5)] // 1,2,3,4,5,6,7,8,9
const kgNum = (n) => Math.round(n || 0).toLocaleString('en-GB')
const tonnes = (kg) => ((kg || 0) / 1000).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const litres = (l) => Math.round(l || 0).toLocaleString('en-GB')

function yearsAgo(n) { const d = new Date(); d.setFullYear(d.getFullYear() - n); d.setDate(d.getDate() + 1); return dateISO(d) }

function downloadCSV(name, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function DangerousGoodsPage() {
  const supabase = createClient()
  const [notes, setNotes] = useState(null)
  const [from, setFrom] = useState(yearsAgo(1))   // "the 12 months leading to this report"
  const [to, setTo] = useState(todayISO())
  const [basis, setBasis] = useState('net')        // net | gross
  const [openClass, setOpenClass] = useState(null)

  useEffect(() => {
    (async () => {
      const res = await loadReportNotes(supabase, { limit: 10000 })
      if (res.error) { toastError('Could not load delivery notes: ' + res.error); setNotes([]); return }
      setNotes(res.notes)
    })()
  }, [])

  const [lo, hi] = from <= to ? [from, to] : [to, from]
  const { rows, unclassified } = useMemo(() => dgRows(notes || [], lo, hi), [notes, lo, hi])
  const kgOf = (r) => (basis === 'gross' ? r.grossKg : r.netKg)

  const byClass = useMemo(() => {
    const m = {}
    for (const c of ALL_CLASSES) m[c] = { kg: 0, litres: 0, lines: 0 }
    for (const r of rows) {
      const c = m[r.major] || (m[r.major] = { kg: 0, litres: 0, lines: 0 })
      c.kg += kgOf(r); c.litres += r.litres; c.lines++
    }
    return m
  }, [rows, basis]) // eslint-disable-line

  const totalKg = Object.values(byClass).reduce((a, c) => a + c.kg, 0)

  // Month → customer + product breakdown for the class that's open.
  const detail = useMemo(() => {
    if (!openClass) return []
    const months = new Map()
    for (const r of rows.filter((x) => x.major === openClass)) {
      if (!months.has(r.month)) months.set(r.month, new Map())
      const g = months.get(r.month)
      const key = `${r.customer}¦${r.product}¦${r.un}`
      if (!g.has(key)) g.set(key, { customer: r.customer, product: r.product, un: r.un, cls: r.cls, qty: 0, litres: 0, kg: 0, notes: new Set() })
      const x = g.get(key)
      x.qty += r.qty; x.litres += r.litres; x.kg += kgOf(r); x.notes.add(r.docNo)
    }
    return [...months.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, g]) => {
      const items = [...g.values()].sort((a, b) => b.kg - a.kg)
      return { month, items, kg: items.reduce((a, i) => a + i.kg, 0), litres: items.reduce((a, i) => a + i.litres, 0) }
    })
  }, [rows, openClass, basis]) // eslint-disable-line

  function setPreset(p) {
    const now = new Date()
    if (p === '12m') { setFrom(yearsAgo(1)); setTo(todayISO()) }
    if (p === 'ytd') { setFrom(`${now.getFullYear()}-01-01`); setTo(todayISO()) }
    if (p === 'last') { setFrom(`${now.getFullYear() - 1}-01-01`); setTo(`${now.getFullYear() - 1}-12-31`) }
  }

  function exportSummary() {
    const head = [['Dangerous goods moved', `${prettyDate(lo)} to ${prettyDate(hi)}`, `${basis === 'gross' ? 'Gross' : 'Net'} mass`], [], ['Class', 'Tonnes', 'Kg', 'Litres', 'Lines']]
    const body = ALL_CLASSES.map((c) => [`Class ${c}`, tonnes(byClass[c].kg), Math.round(byClass[c].kg), Math.round(byClass[c].litres), byClass[c].lines])
    downloadCSV(`dangerous-goods-${lo}-to-${hi}.csv`, [...head, ...body, [], ['Total', tonnes(totalKg), Math.round(totalKg)]])
  }

  function exportClass() {
    const out = [['Month', 'Customer', 'Product', 'UN', 'Class', 'Packages', 'Litres', 'Kg', 'Tonnes', 'Delivery notes']]
    for (const m of detail) {
      for (const i of m.items) out.push([monthLabel(m.month), i.customer, i.product, i.un, i.cls, i.qty, Math.round(i.litres), Math.round(i.kg), tonnes(i.kg), [...i.notes].join(' ')])
      out.push([`${monthLabel(m.month)} total`, '', '', '', '', '', Math.round(m.litres), Math.round(m.kg), tonnes(m.kg), ''])
    }
    downloadCSV(`class-${openClass}-${lo}-to-${hi}.csv`, out)
  }

  if (notes === null) return (
    <div className="card"><div className="skel skel-title" />{[0, 1, 2].map((i) => <div key={i} className="skel skel-row" />)}</div>
  )

  const classKg = openClass ? byClass[openClass]?.kg || 0 : 0

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dangerous Goods</h1>
          <div className="sub">
            Tonnes moved per ADR class, tallied automatically from every delivery note — for the DGSA annual report.
          </div>
        </div>
        <button className="btn btn-g" onClick={exportSummary}>⬇ Download summary (CSV)</button>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}><label>From</label>
            <input className="mono" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>To</label>
            <input className="mono" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="chip" onClick={() => setPreset('12m')}>Last 12 months</button>
            <button className="chip" onClick={() => setPreset('ytd')}>This year</button>
            <button className="chip" onClick={() => setPreset('last')}>Last year</button>
          </div>
          <span style={{ flex: 1 }} />
          <div className="theme-tog" style={{ background: 'var(--field-bg)' }}>
            <button className={basis === 'net' ? 'on' : ''} onClick={() => setBasis('net')}>Net weight</button>
            <button className={basis === 'gross' ? 'on' : ''} onClick={() => setBasis('gross')}>Gross weight</button>
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          {prettyDate(lo)} – {prettyDate(hi)} · {rows.length} dangerous line{rows.length === 1 ? '' : 's'} ·{' '}
          <b>{tonnes(totalKg)} tonnes</b> in total ({basis === 'gross' ? 'goods plus packaging' : 'the goods themselves, without packaging'}).
          Click a class to see the month-by-month breakdown.
        </p>
      </div>

      {unclassified.length > 0 && (
        <p className="hint" style={{ background: '#FCF4E2', border: '1px solid var(--warn, #B07E28)', borderRadius: 8, padding: '9px 12px', color: '#7A5511', fontWeight: 600 }}>
          ⚠ {unclassified.length} line{unclassified.length === 1 ? ' has' : 's have'} a UN number but no class could be worked out
          ({[...new Set(unclassified.map((u) => `${u.product} · ${u.un}`))].slice(0, 5).join(', ')}{unclassified.length > 5 ? '…' : ''}).
          Set the ADR class on those products so they’re counted.
        </p>
      )}

      <div className="dg-grid">
        {ALL_CLASSES.map((c) => {
          const v = byClass[c]
          const separate = SEPARATE_CLASSES.includes(c)
          const on = openClass === c
          return (
            <button key={c} className={'dg-tile' + (on ? ' on' : '') + (v.kg ? '' : ' zero')} onClick={() => setOpenClass(on ? null : c)}>
              <span className="dg-class">Class {c}</span>
              <span className="dg-tonnes">{tonnes(v.kg)}<small> t</small></span>
              <span className="dg-sub">{v.lines ? `${kgNum(v.kg)} kg · ${litres(v.litres)} L` : 'nothing moved'}</span>
              {separate && <span className="dg-sub">separate sheet on the report</span>}
            </button>
          )
        })}
      </div>

      {openClass && (
        <div className="card">
          <div className="ttl">
            <h2>Class {openClass} — month by month</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>{tonnes(classKg)} t</span>
              {detail.length > 0 && <button className="btn btn-g btn-sm" onClick={exportClass}>⬇ CSV</button>}
              <button className="btn btn-g btn-sm" onClick={() => setOpenClass(null)}>Close</button>
            </div>
          </div>
          {detail.length === 0 ? <div className="empty">No Class {openClass} goods went out in this period.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl tbl-cards">
                <thead><tr>
                  <th>Customer</th><th>Product</th><th>UN</th>
                  <th style={{ textAlign: 'right' }}>Packages</th>
                  <th style={{ textAlign: 'right' }}>Litres</th>
                  <th style={{ textAlign: 'right' }}>Kg</th>
                  <th style={{ textAlign: 'right' }}>Tonnes</th>
                </tr></thead>
                {detail.map((m) => (
                  <tbody key={m.month}>
                    <tr className="dg-month">
                      <td colSpan={4}><b>{monthLabel(m.month)}</b></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{litres(m.litres)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{kgNum(m.kg)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{tonnes(m.kg)}</td>
                    </tr>
                    {m.items.map((i) => (
                      <tr key={`${i.customer}${i.product}${i.un}`}>
                        <td data-label="Customer">{i.customer || '—'}</td>
                        <td data-label="Product">{i.product}{i.cls !== openClass ? <span className="muted"> · {i.cls}</span> : null}</td>
                        <td className="mono" data-label="UN">{i.un}</td>
                        <td className="mono" style={{ textAlign: 'right' }} data-label="Packages">{i.qty}</td>
                        <td className="mono" style={{ textAlign: 'right' }} data-label="Litres">{litres(i.litres)}</td>
                        <td className="mono" style={{ textAlign: 'right' }} data-label="Kg">{kgNum(i.kg)}</td>
                        <td className="mono" style={{ textAlign: 'right' }} data-label="Tonnes">{tonnes(i.kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </div>
      )}

      <p className="hint">
        Counts every delivery note dispatched in the period (its latest copy only; deleted and trashed orders are left out).
        Limited-quantity consignments can’t be told apart yet, so they are included.
      </p>
    </div>
  )
}
