'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { prettyDate, fmt } from '@/lib/calc'
import { toast, toastError } from '@/lib/notify'
import { useIsAdmin } from '@/app/(app)/PricingGuard'
import { byMonth, noteLines, isSalesLetterhead, letterheadName, letterheadsPresent, loadReportNotes, effectiveMonth, shiftMonth, monthLabel, realCustomerName } from '@/lib/reports'
import { generateSalesReportPDF } from '@/lib/pdf'
import MonthPicker from '../MonthPicker'

const money = (n) => '£' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const LABELS = { ilex: 'Ilex', apfarm: 'AP Farms', fielder: 'Fielder' }

const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayShort = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')
const dayLong = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// Split a month into Monday-aligned weeks, clamped to the month — so September
// gives Week 1 (1–7 Sep), Week 2 (8–14 Sep) … each with its exact dates.
function weeksOfMonth(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number)
  if (!y || !m) return []
  const lastDay = new Date(y, m, 0).getDate()
  const weeks = []
  let day = 1, n = 1
  while (day <= lastDay) {
    const dowMon = (new Date(y, m - 1, day).getDay() + 6) % 7    // Mon=0 … Sun=6
    const endDay = Math.min(day + (6 - dowMon), lastDay)
    weeks.push({ key: `${monthKey}-w${n}`, n, from: toISODate(new Date(y, m - 1, day)), to: toISODate(new Date(y, m - 1, endDay)) })
    day = endDay + 1; n++
  }
  return weeks
}
const firstOfMonth = (mk) => `${mk}-01`
const lastOfMonth = (mk) => { const [y, m] = mk.split('-').map(Number); return toISODate(new Date(y, m, 0)) }

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
  const [reassign, setReassign] = useState(null)   // a note being moved to another month
  const [reportMode, setReportMode] = useState('month')   // month | week | range
  const [excludeNow, setExcludeNow] = useState(new Set())  // note ids dropped from this report only
  const [weekSel, setWeekSel] = useState(new Set())
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')

  async function load() {
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
  }
  useEffect(() => { load() }, [])

  // Un-ticking an order asks whether it should count towards next or last month,
  // then pins it there (orders.report_month). It leaves this month's report and
  // joins the chosen one — the order and its delivery note are untouched.
  async function moveNote(note, delta) {
    const target = shiftMonth(effectiveMonth(note), delta)
    if (!note.order_id || !target) { setReassign(null); return }
    setBusy(true)
    const res = await supabase.from('orders').update({ report_month: target }).eq('id', note.order_id)
    setBusy(false)
    setReassign(null)
    if (res.error) { toastError('Could not move that order: ' + res.error.message); return }
    toast(`${realCustomerName(note) || note.doc_no} moved to ${monthLabel(target.slice(0, 7))}`)
    await load()
  }

  // Drop an order from THIS report only (or put it back). It's a one-off, held
  // in memory — nothing is saved, so it clears when the report is generated or
  // the page is refreshed.
  function removeNow(note) {
    setExcludeNow((s) => { const n = new Set(s); n.add(note.id); return n })
    setReassign(null)
  }
  function restoreNow(note) {
    setExcludeNow((s) => { const n = new Set(s); n.delete(note.id); return n })
  }

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

  // Weekly / date-range reporting works off actual dispatch dates. Excluded
  // orders are dropped here too, so they never reach a report whichever way it's
  // sliced.
  const reportable = useMemo(() => inScope.filter((n) => !excludeNow.has(n.id)), [inScope, excludeNow])
  const weeks = useMemo(() => weeksOfMonth(current), [current])
  useEffect(() => { setWeekSel(new Set()) }, [current]) // clear week ticks when the month changes
  // Seed the date-range pickers to the selected month the first time.
  useEffect(() => {
    if (current && !rangeFrom && !rangeTo) { setRangeFrom(firstOfMonth(current)); setRangeTo(lastOfMonth(current)) }
  }, [current]) // eslint-disable-line
  const notesBetween = (from, to) => reportable.filter((n) => n.doc_date && n.doc_date >= from && n.doc_date <= to)

  // What actually prints and totals: orders dropped from this report are left out.
  const rowsFor = (m) => m.notes.filter((n) => !excludeNow.has(n.id)).flatMap(noteLines)
  const month = months.find((m) => m.key === current)
  const chosen = useMemo(() => {
    const keys = [current, ...extra].filter(Boolean)
    // Oldest first: a multi-month report reads forwards through the year.
    return months.filter((m) => keys.includes(m.key)).slice().sort((a, b) => (a.key < b.key ? -1 : 1))
  }, [months, current, extra])


  // Build the report sections for whichever mode is active.
  function buildPayload() {
    if (reportMode === 'week') {
      const sel = weeks.filter((w) => weekSel.has(w.key))
      return sel.map((w) => {
        const rows = notesBetween(w.from, w.to).flatMap(noteLines)
        return { label: `${monthLabel(current)} · Week ${w.n} (${dayShort(w.from)}–${dayShort(w.to)})`, rows, net: rows.reduce((a, r) => a + r.net, 0) }
      })
    }
    if (reportMode === 'range') {
      if (!rangeFrom || !rangeTo) return []
      const [from, to] = rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom]
      const rows = notesBetween(from, to).flatMap(noteLines)
      return [{ label: `${dayLong(from)} – ${dayLong(to)}`, rows, net: rows.reduce((a, r) => a + r.net, 0) }]
    }
    return chosen.map((m) => {
      const rows = rowsFor(m)
      return { label: m.label, rows, net: rows.reduce((a, r) => a + r.net, 0) }
    })
  }

  async function generate() {
    const payload = buildPayload()
    if (!payload.length) { toastError(reportMode === 'week' ? 'Pick at least one week' : reportMode === 'range' ? 'Choose both dates' : 'Choose a month first'); return }
    const head = letterheads.find((l) => `${l.name} ${l.company}`.toUpperCase().includes('MIDLAND')) || letterheads[0]
    if (!head) { toastError('No letterhead set up to print on'); return }
    // The logo is deliberately not in the list query — fetch it for this one.
    setBusy(true)
    const { data: full } = await supabase.from('letterheads').select('*').eq('id', head.id).single()
    setBusy(false)
    generateSalesReportPDF(payload, full || head, 'SALES REPORT')
    setExcludeNow(new Set())   // one-off drops reset once the report is out
    toast('Sales report opened')
  }

  if (!isAdmin) return <div className="card"><div className="empty">This report is admin-only.</div></div>
  if (notes === null) return <div className="card"><div className="skel skel-title" />{[0, 1, 2].map((i) => <div key={i} className="skel skel-row" />)}</div>

  // The table shows every order (so an un-ticked one can be re-ticked); the
  // report content and totals below use only the included ones.
  const rows = month ? month.notes.flatMap(noteLines) : []
  const reportRows = month ? rowsFor(month) : []
  const monthNet = reportRows.reduce((a, r) => a + r.net, 0)
  // First line of each order in the list — that's where its single tick sits.
  const seenNote = new Set()
  const firstRow = rows.map((r) => { const first = !seenNote.has(r.noteId); seenNote.add(r.noteId); return first })

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
            <span className="muted" style={{ fontSize: 12.5 }}>{reportRows.length} line{reportRows.length === 1 ? '' : 's'} · {money(monthNet)}</span>
          </div>
          {isAdmin && (
            <p className="hint" style={{ marginTop: 0 }}>
              Every order is ticked into the report. Un-tick one to leave it off <b>this</b> report (a one-off — it resets
              when you generate the report or refresh), or to move it to another month. Dropped orders stay listed (greyed)
              so you can tick them back.
            </p>
          )}
          <table className="tbl tbl-cards">
            <thead><tr>
              {isAdmin && <th style={{ width: 34, textAlign: 'center' }} title="Include in this month">✓</th>}
              <th>Date</th><th>Del. note</th><th>Customer no.</th><th>Customer</th><th>Product</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th>Delivery address</th>
              <th style={{ textAlign: 'right' }}>Net</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const isExcl = excludeNow.has(r.noteId)
                return (
                <tr key={i} style={isExcl ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                  {isAdmin && (
                    <td data-label="In report" style={{ textAlign: 'center' }}>
                      {/* One tick per order: it sits on the order's first line, so
                          multi-line orders aren't ticked several times over. A
                          ticked order is in the report; un-ticking opens the choices,
                          re-ticking a dropped one puts it straight back. */}
                      {firstRow[i] ? (
                        <input type="checkbox" checked={!isExcl} readOnly disabled={busy}
                          title={isExcl ? `Dropped from this report — tick to put ${r.docNo} back` : `Included — un-tick to move or drop ${r.docNo}`}
                          onChange={() => { const n = month.notes.find((x) => x.id === r.noteId); if (!n) return; isExcl ? restoreNow(n) : setReassign(n) }}
                          style={{ width: 16, height: 16, cursor: 'pointer' }} />
                      ) : null}
                    </td>
                  )}
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
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="ttl"><h2>Generate the report</h2></div>

        <div className="theme-tog" style={{ background: 'var(--field-bg)', marginBottom: 14, display: 'inline-flex' }}>
          {[['month', 'Whole month'], ['week', 'By week'], ['range', 'Date range']].map(([k, label]) => (
            <button key={k} className={reportMode === k ? 'on' : ''} onClick={() => setReportMode(k)}>{label}</button>
          ))}
        </div>

        {reportMode === 'week' && (
          <div style={{ marginBottom: 14 }}>
            <p className="hint" style={{ marginTop: 0 }}>
              Weeks of <b>{current ? monthLabel(current) : '—'}</b> — tick the ones to report. Change the month above to pick a different one.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {weeks.map((w) => {
                const rows = notesBetween(w.from, w.to).flatMap(noteLines)
                const on = weekSel.has(w.key)
                return (
                  <button key={w.key} className={'chip' + (on ? ' on' : '')}
                    onClick={() => setWeekSel((s) => { const n = new Set(s); n.has(w.key) ? n.delete(w.key) : n.add(w.key); return n })}>
                    Week {w.n} · {dayShort(w.from)}–{dayShort(w.to)}
                    <span style={{ opacity: .65 }}> · {rows.length} line{rows.length === 1 ? '' : 's'} · {money(rows.reduce((a, r) => a + r.net, 0))}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {reportMode === 'range' && (
          <div className="row c2" style={{ maxWidth: 420, marginBottom: 8 }}>
            <div className="field"><label>From</label>
              <input className="mono" type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} /></div>
            <div className="field"><label>To</label>
              <input className="mono" type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} /></div>
          </div>
        )}

        {(() => {
          const payload = buildPayload()
          const lines = payload.reduce((a, p) => a + p.rows.length, 0)
          const net = payload.reduce((a, p) => a + p.net, 0)
          const ready = payload.length > 0
          return (
            <p className="hint" style={{ marginTop: reportMode === 'range' ? 4 : 0 }}>
              {!ready
                ? (reportMode === 'week' ? 'Tick at least one week.' : reportMode === 'range' ? 'Pick both dates.' : 'Choose a month above.')
                : <>Covering <b>{payload.map((p) => p.label).join(', ')}</b> — {lines} line{lines === 1 ? '' : 's'},{' '}<b>{money(net)}</b>. Prints landscape on the Midland letterhead.</>}
            </p>
          )
        })()}

        <button className="btn btn-a" disabled={busy} onClick={generate}>📄 Generate sales report</button>
      </div>

      {reassign && (
        <div className="modal-bg" onClick={() => !busy && setReassign(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 6 }}>Take this order off the report</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>
              <b>{realCustomerName(reassign) || reassign.doc_no}</b> (#{reassign.doc_no}) is in{' '}
              <b>{monthLabel(effectiveMonth(reassign))}</b>. What would you like to do?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <button className="btn btn-a" disabled={busy} style={{ justifyContent: 'flex-start' }}
                onClick={() => removeNow(reassign)}>
                Just leave it off this report · <b style={{ marginLeft: 6 }}>one-off, resets after generating</b>
              </button>
              <button className="btn btn-g" disabled={busy} style={{ justifyContent: 'flex-start' }}
                onClick={() => moveNote(reassign, 1)}>
                Move to next month · <b style={{ marginLeft: 6 }}>{monthLabel(shiftMonth(effectiveMonth(reassign), 1).slice(0, 7))}</b>
              </button>
              <button className="btn btn-g" disabled={busy} style={{ justifyContent: 'flex-start' }}
                onClick={() => moveNote(reassign, -1)}>
                Move to last month · <b style={{ marginLeft: 6 }}>{monthLabel(shiftMonth(effectiveMonth(reassign), -1).slice(0, 7))}</b>
              </button>
              <button className="btn btn-g" disabled={busy} onClick={() => setReassign(null)}>Cancel — leave it as it is</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
