'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { prettyDate } from '@/lib/calc'
import { ok, toast, toastError } from '@/lib/notify'
import { useIsAdmin } from '@/app/(app)/PricingGuard'
import { byMonth, noteNet, customerNameOf, loadReportNotes } from '@/lib/reports'
import { generateCommissionPDF } from '@/lib/pdf'
import MonthPicker from '../MonthPicker'

const GROUP = 'Elite Farm'
const RATES = [10, 15]
const money = (n) => '£' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function EliteFarmPage() {
  const supabase = createClient()
  const router = useRouter()
  const isAdmin = useIsAdmin()
  const [notes, setNotes] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [orphaned, setOrphaned] = useState(0)
  const [customers, setCustomers] = useState([])
  const [letterheads, setLetterheads] = useState([])
  const [current, setCurrent] = useState('')
  const [extra, setExtra] = useState(new Set())
  const [rates, setRates] = useState({})        // monthKey -> 10 | 15
  const [showPicker, setShowPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      const [n, c, lh] = await Promise.all([
        loadReportNotes(supabase),
        supabase.from('customers').select('id, name, commission_group').order('name'),
        // Logos are fetched for the one letterhead we print on, at that moment.
        supabase.from('letterheads').select('id, name, company, color, address, footer').order('name'),
      ])
      if (n.error) { setLoadError(n.error); toastError('Could not load delivery notes'); setNotes([]); return }
      setNotes(n.notes)
      setOrphaned(n.orphaned || 0)
      setCustomers(c.data || [])
      setLetterheads(lh.data || [])
    })()
  }, [])

  // Which customers count. Anything already tagged wins; otherwise a name that
  // mentions the group is offered as a sensible starting point.
  const tagged = useMemo(() => new Set(
    customers.filter((c) => (c.commission_group || '').trim().toLowerCase() === GROUP.toLowerCase()).map((c) => c.id),
  ), [customers])
  const anyTagged = tagged.size > 0
  const nameLooksElite = (n) => /\belite\b/i.test(String(n || ''))
  const isGroupCustomer = (name) => {
    const c = customers.find((x) => (x.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase())
    if (anyTagged) return !!c && tagged.has(c.id)
    return nameLooksElite(name)   // nothing tagged yet — fall back to the name
  }

  const groupNotes = useMemo(
    () => (notes || []).filter((n) => isGroupCustomer(customerNameOf(n))),
    [notes, customers, tagged],
  )
  const months = useMemo(() => byMonth(groupNotes), [groupNotes])

  useEffect(() => { if (!current && months.length) setCurrent(months[0].key) }, [months, current])

  const rateFor = (k) => rates[k] || null
  const chosen = useMemo(() => {
    const keys = [current, ...extra].filter(Boolean)
    // Oldest first: a multi-month report reads forwards through the year.
    return months.filter((m) => keys.includes(m.key)).slice().sort((a, b) => (a.key < b.key ? -1 : 1))
  }, [months, current, extra])
  const missingRate = chosen.filter((m) => !rateFor(m.key))
  const month = months.find((m) => m.key === current)

  async function setCommissionGroup(id, on) {
    setBusy(true)
    const res = await supabase.from('customers').update({ commission_group: on ? GROUP : '' }).eq('id', id)
    setBusy(false)
    if (!ok(res, 'saving the customer')) return
    setCustomers((cs) => cs.map((c) => (c.id === id ? { ...c, commission_group: on ? GROUP : '' } : c)))
  }

  async function generate() {
    if (!chosen.length) { toastError('Choose a month first'); return }
    if (missingRate.length) { toastError(`Choose a rate for ${missingRate.map((m) => m.label).join(', ')}`); return }
    const head = letterheads.find((l) => `${l.name} ${l.company}`.toUpperCase().includes('ILEX')) || letterheads[0]
    if (!head) { toastError('No letterhead set up to print on'); return }
    // The logo is deliberately not in the list query — fetch it for this one.
    setBusy(true)
    const { data: full } = await supabase.from('letterheads').select('*').eq('id', head.id).single()
    setBusy(false)
    const ilex = full || head
    const payload = chosen.map((m) => {
      const rate = rateFor(m.key)
      const rows = m.notes.map((n) => ({
        date: n.doc_date, docNo: n.doc_no, poRef: n.totals?.po_ref || '',
        customer: customerNameOf(n), net: noteNet(n),
      }))
      const net = rows.reduce((a, x) => a + x.net, 0)
      return { label: m.label, rate, rows, net, commission: Math.round(net * rate) / 100 }
    })
    generateCommissionPDF(payload, ilex, GROUP)
    toast(`Statement for ${payload.length} month${payload.length === 1 ? '' : 's'} opened`)
  }

  if (!isAdmin) return <div className="card"><div className="empty">This report is admin-only.</div></div>
  if (notes === null) return <div className="card"><div className="skel skel-title" />{[0, 1, 2].map((i) => <div key={i} className="skel skel-row" />)}</div>

  const grandNet = chosen.reduce((a, m) => a + m.net, 0)
  const grandCom = chosen.reduce((a, m) => a + (rateFor(m.key) ? (m.net * rateFor(m.key)) / 100 : 0), 0)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{GROUP} Commission</h1>
          <div className="sub">
            Commission payable on delivery notes to {GROUP} customers · {groupNotes.length} note{groupNotes.length === 1 ? '' : 's'} on file
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-g" onClick={() => setShowPicker(true)}>⚙ Which customers count</button>
          <button className="btn btn-g" onClick={() => router.push('/')}>← Dashboard</button>
        </div>
      </div>

      {!anyTagged && (
        <p className="hint" style={{ background: '#FCF4E2', border: '1px solid var(--warn, #B07E28)', borderRadius: 8, padding: '9px 12px', color: '#7A5511', fontWeight: 600 }}>
          ⚠ No customers have been marked as {GROUP} yet, so this is guessing from any customer whose name contains
          “Elite”. Use <b>Which customers count</b> to set them properly.
        </p>
      )}

      {loadError && (
        <p className="hint" style={{ background: '#FBEEEC', border: '1px solid var(--bad, #C24E42)', borderRadius: 8, padding: '10px 12px', color: '#8A2B22', fontWeight: 600 }}>
          ⚠ The delivery notes could not be loaded. The database said:<br />
          <span className="mono" style={{ fontWeight: 400 }}>{loadError}</span>
        </p>
      )}

      {orphaned > 0 && (
        <p className="hint">
          {orphaned} delivery note{orphaned === 1 ? '' : 's'} left over from deleted orders {orphaned === 1 ? 'was' : 'were'} skipped.
        </p>
      )}

      <MonthPicker months={months} current={current} setCurrent={setCurrent} extra={extra} setExtra={setExtra} fmtMoney={money} />

      {month && (
        <div className="card">
          <div className="ttl">
            <h2>{month.label}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Commission rate:</span>
              {RATES.map((r) => (
                <label key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0, fontWeight: 600, fontSize: 13, cursor: 'pointer', margin: 0 }}>
                  <input type="checkbox" checked={rateFor(current) === r}
                    onChange={() => setRates((s) => ({ ...s, [current]: s[current] === r ? null : r }))}
                    style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
                  {r}%
                </label>
              ))}
            </div>
          </div>

          {month.notes.length === 0 ? <div className="empty">No {GROUP} deliveries in {month.label}.</div> : (
            <>
              <table className="tbl tbl-cards">
                <thead><tr>
                  <th>Date</th><th>Delivery note</th><th>Customer no.</th><th>Customer</th>
                  <th style={{ textAlign: 'right' }}>Net value</th>
                  <th style={{ textAlign: 'right' }}>Commission</th>
                </tr></thead>
                <tbody>
                  {month.notes.map((n) => {
                    const net = noteNet(n)
                    const rate = rateFor(current)
                    return (
                      <tr key={n.id}>
                        <td className="mono" data-label="Date">{prettyDate(n.doc_date)}</td>
                        <td className="mono" data-label="Delivery note">{n.doc_no}</td>
                        <td data-label="Customer no.">{n.totals?.po_ref || '—'}</td>
                        <td data-label="Customer">{customerNameOf(n)}</td>
                        <td className="mono" style={{ textAlign: 'right' }} data-label="Net value">{money(net)}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }} data-label="Commission">
                          {rate ? money((net * rate) / 100) : <span className="muted">pick a rate</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="stat-row">
                <Stat label={`${month.label} net sales`} value={money(month.net)} sub={`${month.notes.length} delivery note${month.notes.length === 1 ? '' : 's'}`} />
                <Stat label="Rate" value={rateFor(current) ? `${rateFor(current)}%` : '—'} sub={rateFor(current) ? 'chosen' : 'tick 10% or 15%'} />
                <Stat label="Commission this month" value={rateFor(current) ? money((month.net * rateFor(current)) / 100) : '—'} />
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="ttl"><h2>Generate the statement</h2></div>
        <p className="hint" style={{ marginTop: 0 }}>
          {chosen.length === 0 ? 'Choose a month above.' : (
            <>Covering <b>{chosen.map((m) => m.label).join(', ')}</b> — net {money(grandNet)}
              {missingRate.length === 0 ? <>, commission <b>{money(grandCom)}</b>.</> : <>. Still needs a rate for <b>{missingRate.map((m) => m.label).join(', ')}</b>.</>}
              {' '}Prints on the Ilex letterhead.</>
          )}
        </p>
        <button className="btn btn-a" disabled={busy || !chosen.length || missingRate.length > 0} onClick={generate}>
          📄 Generate commission statement
        </button>
      </div>

      {showPicker && (
        <div className="modal-bg" onClick={() => !busy && setShowPicker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 6 }}>Which customers count as {GROUP}?</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Tick every customer whose orders earn {GROUP} commission. This is what the report uses — once anything is
              ticked, the guess based on the name stops being used.
            </p>
            <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 9 }}>
              {customers.map((c) => {
                const on = tagged.has(c.id)
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderBottom: '1px solid var(--line)', textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 13, cursor: 'pointer', margin: 0 }}>
                    <input type="checkbox" checked={on} disabled={busy}
                      onChange={(e) => setCommissionGroup(c.id, e.target.checked)}
                      style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
                    <span style={{ color: on ? 'var(--accent)' : 'var(--ink)', fontWeight: on ? 700 : 500 }}>{c.name}</span>
                    {!on && nameLooksElite(c.name) && <span style={{ fontSize: 10.5, color: 'var(--warn, #B07E28)' }}>· name mentions Elite</span>}
                  </label>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-a" onClick={() => setShowPicker(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}
