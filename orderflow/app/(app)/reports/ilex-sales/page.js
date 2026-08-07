'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { prettyDate, fmt } from '@/lib/calc'
import { toast, toastError } from '@/lib/notify'
import { useIsAdmin } from '@/app/(app)/PricingGuard'
import { byMonth, noteLines, isSalesLetterhead, salesLetterheadOf } from '@/lib/reports'
import { generateSalesReportPDF } from '@/lib/pdf'
import MonthPicker from '../MonthPicker'

const money = (n) => '£' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const LABELS = { ilex: 'Ilex', apfarm: 'AP Farms', fielder: 'Fielder' }

export default function IlexSalesPage() {
  const supabase = createClient()
  const router = useRouter()
  const isAdmin = useIsAdmin()
  const [notes, setNotes] = useState(null)
  const [letterheads, setLetterheads] = useState([])
  const [current, setCurrent] = useState('')
  const [extra, setExtra] = useState(new Set())

  useEffect(() => {
    (async () => {
      const [n, lh] = await Promise.all([
        supabase.from('dispatch_notes').select('*').order('doc_date', { ascending: false }),
        supabase.from('letterheads').select('*').order('name'),
      ])
      if (n.error) { toastError('Could not load delivery notes: ' + n.error.message); setNotes([]); return }
      setNotes(n.data || [])
      setLetterheads(lh.data || [])
    })()
  }, [])

  // Ilex, AP Farms and Fielder together — deliberately not separated, just in
  // date order within each month.
  const inScope = useMemo(() => (notes || []).filter(isSalesLetterhead), [notes])
  const months = useMemo(() => byMonth(inScope), [inScope])
  useEffect(() => { if (!current && months.length) setCurrent(months[0].key) }, [months, current])

  const rowsFor = (m) => m.notes.flatMap(noteLines)
  const month = months.find((m) => m.key === current)
  const chosen = useMemo(() => {
    const keys = [current, ...extra].filter(Boolean)
    return months.filter((m) => keys.includes(m.key))
  }, [months, current, extra])

  // Which of the three actually appear, so the header can say so honestly.
  const present = useMemo(() => {
    const s = new Set(inScope.map(salesLetterheadOf).filter(Boolean))
    return [...s].map((k) => LABELS[k] || k)
  }, [inScope])

  function generate() {
    if (!chosen.length) { toastError('Choose a month first'); return }
    const midland = letterheads.find((l) => `${l.name} ${l.company}`.toUpperCase().includes('MIDLAND')) || letterheads[0]
    if (!midland) { toastError('No letterhead set up to print on'); return }
    const payload = chosen.map((m) => {
      const rows = rowsFor(m)
      return { label: m.label, rows, net: rows.reduce((a, r) => a + r.net, 0) }
    })
    generateSalesReportPDF(payload, midland, 'SALES REPORT')
    toast(`Sales report for ${payload.length} month${payload.length === 1 ? '' : 's'} opened`)
  }

  if (!isAdmin) return <div className="card"><div className="empty">This report is admin-only.</div></div>
  if (notes === null) return <div className="card"><div className="skel skel-title" />{[0, 1, 2].map((i) => <div key={i} className="skel skel-row" />)}</div>

  const rows = month ? rowsFor(month) : []
  const grandRows = chosen.reduce((a, m) => a + rowsFor(m).length, 0)
  const grandNet = chosen.reduce((a, m) => a + rowsFor(m).reduce((x, r) => x + r.net, 0), 0)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Ilex sales report</h1>
          <div className="sub">
            Ilex, AP Farms and Fielder together, newest first · {inScope.length} delivery note{inScope.length === 1 ? '' : 's'} on file
            {present.length > 0 && ` · covering ${present.join(', ')}`}
          </div>
        </div>
        <button className="btn btn-g" onClick={() => router.push('/')}>← Dashboard</button>
      </div>

      {inScope.length === 0 && (
        <p className="hint" style={{ background: '#FCF4E2', border: '1px solid var(--warn, #B07E28)', borderRadius: 8, padding: '9px 12px', color: '#7A5511', fontWeight: 600 }}>
          ⚠ No delivery notes found on the Ilex, AP Farms or Fielder letterheads. Notes are matched on the letterhead
          they were printed with — check the names in Letterheads if you expected some here.
        </p>
      )}

      <MonthPicker months={months} current={current} setCurrent={setCurrent} extra={extra} setExtra={setExtra} fmtMoney={money} />

      {month && (
        <div className="card">
          <div className="ttl">
            <h2>{month.label}</h2>
            <span className="muted" style={{ fontSize: 12.5 }}>{rows.length} line{rows.length === 1 ? '' : 's'} · {money(month.net)}</span>
          </div>
          <table className="tbl tbl-cards">
            <thead><tr>
              <th>Date</th><th>Del. note</th><th>Customer no.</th><th>Customer</th><th>Product</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th>Delivery address</th>
              <th style={{ textAlign: 'right' }}>Net</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono" data-label="Date">{prettyDate(r.date)}</td>
                  <td className="mono" data-label="Del. note">{r.docNo}</td>
                  <td data-label="Customer no.">{r.poRef || '—'}</td>
                  <td data-label="Customer">{r.customer}</td>
                  <td data-label="Product">{r.product}</td>
                  <td className="mono" style={{ textAlign: 'right' }} data-label="Volume">{r.unitVol ? `${fmt(r.unitVol)} L` : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }} data-label="Qty">{r.qty || '—'}</td>
                  <td style={{ fontSize: 11.5 }} data-label="Delivery address">{r.deliverTo}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }} data-label="Net">{money(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="ttl"><h2>Generate the report</h2></div>
        <p className="hint" style={{ marginTop: 0 }}>
          {chosen.length === 0 ? 'Choose a month above.' : (
            <>Covering <b>{chosen.map((m) => m.label).join(', ')}</b> — {grandRows} line{grandRows === 1 ? '' : 's'},
              {' '}<b>{money(grandNet)}</b>. Prints landscape on the Midland letterhead.</>
          )}
        </p>
        <button className="btn btn-a" disabled={!chosen.length} onClick={generate}>📄 Generate sales report</button>
      </div>
    </div>
  )
}
