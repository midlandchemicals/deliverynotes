'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { prettyDate, fmt } from '@/lib/calc'
import { toast, toastError } from '@/lib/notify'
import { useIsAdmin } from '@/app/(app)/PricingGuard'
import { byMonth, noteLines, isSalesLetterhead, letterheadName, letterheadsPresent, loadReportNotes } from '@/lib/reports'
import { generateSalesReportPDF } from '@/lib/pdf'
import MonthPicker from '../MonthPicker'

const money = (n) => '£' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const LABELS = { ilex: 'Ilex', apfarm: 'AP Farms', fielder: 'Fielder' }

export default function IlexSalesPage() {
  const supabase = createClient()
  const router = useRouter()
  const isAdmin = useIsAdmin()
  const [notes, setNotes] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [orphaned, setOrphaned] = useState(0)
  const [duplicates, setDuplicates] = useState(0)
  const [letterheads, setLetterheads] = useState([])
  const [current, setCurrent] = useState('')
  const [extra, setExtra] = useState(new Set())
  // Which letterheads to include. Seeded with Ilex / AP Farms / Fielder, but
  // shown and editable — the names are typed by hand, so a silent no-match is
  // the one outcome this must never produce.
  const [chosenLh, setChosenLh] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      const [n, lh] = await Promise.all([
        loadReportNotes(supabase),
        // Logos are fetched for the one letterhead we print on, at that moment.
        supabase.from('letterheads').select('id, name, company, color, address, footer').order('name'),
      ])
      if (n.error) { setLoadError(n.error); toastError('Could not load delivery notes'); setNotes([]); return }
      setNotes(n.notes)
      setOrphaned(n.orphaned || 0)
      setDuplicates(n.duplicates || 0)
      setLetterheads(lh.data || [])
    })()
  }, [])

  const available = useMemo(() => letterheadsPresent(notes || []), [notes])

  // Seed the selection once the notes are in: whatever matched automatically,
  // or nothing if none did (in which case the page asks you to pick).
  useEffect(() => {
    if (chosenLh !== null || !notes) return
    setChosenLh(new Set(available.filter((x) => x.auto).map((x) => x.name)))
  }, [notes, available, chosenLh])

  // Ilex, AP Farms and Fielder together — deliberately not separated, just in
  // date order within each month.
  const inScope = useMemo(
    () => (notes || []).filter((n) => (chosenLh ? chosenLh.has(letterheadName(n) || '(no letterhead)') : isSalesLetterhead(n))),
    [notes, chosenLh],
  )
  const months = useMemo(() => byMonth(inScope), [inScope])
  useEffect(() => { if (!current && months.length) setCurrent(months[0].key) }, [months, current])

  const rowsFor = (m) => m.notes.flatMap(noteLines)
  const month = months.find((m) => m.key === current)
  const chosen = useMemo(() => {
    const keys = [current, ...extra].filter(Boolean)
    // Oldest first: a multi-month report reads forwards through the year.
    return months.filter((m) => keys.includes(m.key)).slice().sort((a, b) => (a.key < b.key ? -1 : 1))
  }, [months, current, extra])


  async function generate() {
    if (!chosen.length) { toastError('Choose a month first'); return }
    const head = letterheads.find((l) => `${l.name} ${l.company}`.toUpperCase().includes('MIDLAND')) || letterheads[0]
    if (!head) { toastError('No letterhead set up to print on'); return }
    // The logo is deliberately not in the list query — fetch it for this one.
    setBusy(true)
    const { data: full } = await supabase.from('letterheads').select('*').eq('id', head.id).single()
    setBusy(false)
    const midland = full || head
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
          <h1>Ilex Sales Reports</h1>
          <div className="sub">
            Newest first · {inScope.length} delivery note{inScope.length === 1 ? '' : 's'} included, of {(notes || []).length} on file
          </div>
        </div>
        <button className="btn btn-g" onClick={() => router.push('/')}>← Dashboard</button>
      </div>

      <div className="card">
        <div className="ttl">
          <h2>Letterheads included</h2>
          <span className="muted" style={{ fontSize: 12 }}>Ilex, AP Farms and Fielder are ticked automatically</span>
        </div>
        {available.length === 0 ? (
          <div className="empty">No delivery notes on file at all yet.</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {available.map((x) => (
                <button key={x.name}
                  className={'chip' + (chosenLh?.has(x.name) ? ' on' : '')}
                  onClick={() => setChosenLh((s) => {
                    const n = new Set(s || [])
                    n.has(x.name) ? n.delete(x.name) : n.add(x.name)
                    return n
                  })}>
                  {x.name} <span style={{ opacity: .65 }}>· {x.count}</span>
                </button>
              ))}
            </div>
            {inScope.length === 0 && (
              <p className="hint" style={{ marginBottom: 0, color: '#7A5511', fontWeight: 600 }}>
                ⚠ Nothing is ticked, so there is nothing to report. The names above are exactly as they appear on the
                delivery notes — tick the ones that belong in this report.
              </p>
            )}
          </>
        )}
      </div>

      {loadError && (
        <p className="hint" style={{ background: '#FBEEEC', border: '1px solid var(--bad, #C24E42)', borderRadius: 8, padding: '10px 12px', color: '#8A2B22', fontWeight: 600 }}>
          ⚠ The delivery notes could not be loaded. The database said:<br />
          <span className="mono" style={{ fontWeight: 400 }}>{loadError}</span>
        </p>
      )}

      {(orphaned > 0 || duplicates > 0) && (
        <p className="hint">
          {orphaned > 0 && <>{orphaned} note{orphaned === 1 ? '' : 's'} from deleted orders skipped. </>}
          {duplicates > 0 && <>{duplicates} repeat cop{duplicates === 1 ? 'y' : 'ies'} of a delivery note ignored — each order is counted once, using its most recent copy.</>}
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
