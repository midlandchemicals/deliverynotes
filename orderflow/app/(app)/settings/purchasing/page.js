'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prettyDate } from '@/lib/calc'
import { ok, toast, toastError } from '@/lib/notify'
import { useIsAdmin } from '@/app/(app)/PricingGuard'

// Purchasing — what we buy, who from, and what it has cost over time.
// Rows come from the monthly purchase spreadsheets; the unit price is always
// derived (net ÷ qty) so it can't drift from the figures on the sheet.

const KEY = (s) => String(s || '').trim().toUpperCase()
const money = (n) => '£' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Unit prices run from pennies (caps) to thousands (IBCs), so show enough
// decimals to be useful at the small end without noise at the large end.
const unitMoney = (n) => (n >= 100 ? money(n) : '£' + (Math.round((n || 0) * 10000) / 10000).toFixed(4))
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10))

export default function PurchasingPage() {
  const supabase = createClient()
  const isAdmin = useIsAdmin()
  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState('catalogue')   // catalogue | suppliers | import
  const [q, setQ] = useState('')
  const [openItem, setOpenItem] = useState(null)     // product key
  const [openSupplier, setOpenSupplier] = useState(null)
  const [renaming, setRenaming] = useState(null)     // { kind, from, to }
  const [busy, setBusy] = useState(false)

  // import state
  const [preview, setPreview] = useState(null)       // { name, rows, dupes }
  const fileRef = useRef(null)

  // manual add
  const blankAdd = { purchase_date: new Date().toISOString().slice(0, 10), supplier: '', product: '', qty: '', net_total: '' }
  const [add, setAdd] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('purchases').select('*').order('purchase_date', { ascending: false })
    if (error) { toastError('Could not load purchases: ' + error.message); setRows([]); return }
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  // ── aggregates ────────────────────────────────────────────────────────────
  const items = useMemo(() => {
    const map = new Map()
    for (const r of rows || []) {
      const k = KEY(r.product)
      if (!map.has(k)) map.set(k, { key: k, name: r.product, buys: [] })
      map.get(k).buys.push(r)
    }
    return [...map.values()].map((it) => {
      const buys = [...it.buys].sort((a, b) => (a.purchase_date < b.purchase_date ? 1 : -1)) // newest first
      const unit = (r) => (Number(r.qty) ? Number(r.net_total) / Number(r.qty) : 0)
      const prices = buys.map(unit).filter((n) => n > 0)
      const latest = buys[0]
      const previous = buys[1]
      return {
        ...it, buys,
        count: buys.length,
        spend: buys.reduce((s, r) => s + Number(r.net_total || 0), 0),
        last: latest ? unit(latest) : 0,
        lastDate: latest?.purchase_date,
        lastSupplier: latest?.supplier || '',
        prev: previous ? unit(previous) : null,
        min: prices.length ? Math.min(...prices) : 0,
        max: prices.length ? Math.max(...prices) : 0,
        suppliers: [...new Set(buys.map((r) => KEY(r.supplier)))],
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const suppliers = useMemo(() => {
    const map = new Map()
    for (const r of rows || []) {
      const k = KEY(r.supplier)
      if (!map.has(k)) map.set(k, { key: k, name: r.supplier, buys: [] })
      map.get(k).buys.push(r)
    }
    return [...map.values()].map((s) => ({
      ...s,
      count: s.buys.length,
      spend: s.buys.reduce((a, r) => a + Number(r.net_total || 0), 0),
      products: [...new Set(s.buys.map((r) => KEY(r.product)))].length,
      lastDate: s.buys.map((r) => r.purchase_date).sort().slice(-1)[0],
    })).sort((a, b) => b.spend - a.spend)
  }, [rows])

  const hay = (s) => KEY(s).includes(KEY(q))
  const shownItems = q ? items.filter((i) => hay(i.name) || i.suppliers.some(hay)) : items
  const shownSuppliers = q ? suppliers.filter((s) => hay(s.name)) : suppliers
  const totalSpend = (rows || []).reduce((a, r) => a + Number(r.net_total || 0), 0)

  // ── import ────────────────────────────────────────────────────────────────
  // The sheets are laid out: row 1 title, row 2 headings, then DATE | _ |
  // SUPPLIER | QTY | _ | PRODUCT | _ | _ | NET PRICE. Read by heading rather
  // than fixed position so a shifted column doesn't import silent rubbish.
  async function pickFile(file) {
    if (!file) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true })
      const headRow = grid.findIndex((r) => (r || []).some((c) => KEY(c) === 'SUPPLIER'))
      if (headRow === -1) throw new Error('No SUPPLIER heading found — is this a purchases sheet?')
      const head = grid[headRow].map(KEY)
      const col = (...names) => head.findIndex((h) => names.includes(h))
      const cDate = col('DATE'), cSup = col('SUPPLIER'), cQty = col('QTY')
      const cProd = col('PRODUCT'), cNet = col('NET PRICE', 'NET', 'NETPRICE')
      if ([cDate, cSup, cQty, cProd, cNet].some((i) => i === -1)) throw new Error('Missing one of DATE / SUPPLIER / QTY / PRODUCT / NET PRICE')

      const parsed = []
      for (const r of grid.slice(headRow + 1)) {
        const d = r?.[cDate]
        if (!(d instanceof Date)) continue        // skips blanks and the totals row
        const qty = Number(r[cQty]) || 0
        const net = Number(r[cNet]) || 0
        const product = String(r[cProd] ?? '').trim()
        const supplier = String(r[cSup] ?? '').trim()
        if (!product && !supplier) continue
        parsed.push({ purchase_date: iso(d), supplier, product, qty, net_total: net, source: file.name })
      }
      // Anything already on file with the same date, supplier, product, qty and
      // total is almost certainly a re-import rather than a second delivery.
      const existing = new Set((rows || []).map((r) => [r.purchase_date, KEY(r.supplier), KEY(r.product), Number(r.qty), Number(r.net_total)].join('|')))
      const dupes = parsed.filter((p) => existing.has([p.purchase_date, KEY(p.supplier), KEY(p.product), p.qty, p.net_total].join('|')))
      setPreview({ name: file.name, rows: parsed, dupes: new Set(dupes.map((d) => JSON.stringify(d))) })
      if (!parsed.length) toastError('No dated rows found in that sheet')
    } catch (e) {
      toastError('Could not read that file: ' + e.message)
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function confirmImport(includeDupes) {
    const all = preview.rows
    const toAdd = includeDupes ? all : all.filter((r) => !preview.dupes.has(JSON.stringify(r)))
    if (!toAdd.length) { toast('Nothing new to import'); setPreview(null); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const res = await supabase.from('purchases').insert(toAdd.map((r) => ({ ...r, created_by: user?.id || null })))
    setBusy(false)
    if (!ok(res, 'importing the purchases')) return
    toast(`Imported ${toAdd.length} purchase${toAdd.length === 1 ? '' : 's'} from ${preview.name}`)
    setPreview(null)
    load()
  }

  // ── rename / merge ────────────────────────────────────────────────────────
  // "HAMMOND CHEMICALS" and "HAMMONDS CHEMICALS" are the same supplier; renaming
  // one onto the other joins their history rather than leaving two half-records.
  async function doRename() {
    const { kind, from, to } = renaming
    const clean = to.trim()
    if (!clean) { toastError('Enter the name to use'); return }
    setBusy(true)
    const field = kind === 'supplier' ? 'supplier' : 'product'
    const ids = (rows || []).filter((r) => KEY(r[field]) === KEY(from)).map((r) => r.id)
    const res = await supabase.from('purchases').update({ [field]: clean }).in('id', ids)
    setBusy(false)
    if (!ok(res, 'renaming')) return
    toast(`${ids.length} row${ids.length === 1 ? '' : 's'} updated to "${clean}"`)
    setRenaming(null); setOpenItem(null); setOpenSupplier(null)
    load()
  }

  async function saveAdd() {
    if (!add.product.trim() || !add.supplier.trim()) { toastError('Supplier and product are both needed'); return }
    if (!(Number(add.qty) > 0)) { toastError('Quantity must be more than zero'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const res = await supabase.from('purchases').insert({
      purchase_date: add.purchase_date, supplier: add.supplier.trim(), product: add.product.trim(),
      qty: Number(add.qty), net_total: Number(add.net_total) || 0, source: 'entered by hand',
      created_by: user?.id || null,
    })
    setBusy(false)
    if (!ok(res, 'saving the purchase')) return
    toast('Purchase added'); setAdd(null); load()
  }

  async function removeRow(r) {
    if (!confirm(`Delete this purchase?\n\n${prettyDate(r.purchase_date)} · ${r.supplier} · ${r.product}`)) return
    if (!ok(await supabase.from('purchases').delete().eq('id', r.id), 'deleting the purchase')) return
    load()
  }

  if (!isAdmin) return (
    <div className="card"><div className="empty">Purchasing is admin-only.</div></div>
  )
  if (rows === null) return (
    <div className="card"><div className="skel skel-title" />{[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-row" />)}</div>
  )

  const item = openItem ? items.find((i) => i.key === openItem) : null
  const sup = openSupplier ? suppliers.find((s) => s.key === openSupplier) : null

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Purchasing</h1>
          <div className="sub">
            What we buy, who from, and what it has cost — {items.length} product{items.length === 1 ? '' : 's'} ·{' '}
            {suppliers.length} supplier{suppliers.length === 1 ? '' : 's'} · {money(totalSpend)} on file
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-g" onClick={() => setAdd(blankAdd)}>＋ Add a purchase</button>
          <button className="btn btn-a" onClick={() => setTab('import')}>⬆ Import a month</button>
        </div>
      </div>

      <div className="sub-nav">
        {[['catalogue', 'Catalogue'], ['suppliers', 'Suppliers'], ['import', 'Import']].map(([k, label]) => (
          <a key={k} className={tab === k ? 'on' : ''} style={{ cursor: 'pointer' }} onClick={() => setTab(k)}>{label}</a>
        ))}
      </div>

      {tab !== 'import' && (
        <div className="filters">
          <input placeholder="Search product or supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}

      {/* ── CATALOGUE ── */}
      {tab === 'catalogue' && (
        <div className="card">
          {shownItems.length === 0 ? (
            <div className="empty">Nothing yet — import a month of purchases to get started.</div>
          ) : (
            <table className="tbl tbl-cards">
              <thead><tr>
                <th>Product</th>
                <th>Last supplier</th>
                <th style={{ textAlign: 'right' }}>Latest unit price</th>
                <th style={{ textAlign: 'right' }}>Change</th>
                <th style={{ textAlign: 'right' }}>Times bought</th>
                <th style={{ textAlign: 'right' }}>Total spend</th>
              </tr></thead>
              <tbody>
                {shownItems.map((it) => {
                  const delta = it.prev ? (it.last - it.prev) / it.prev : null
                  return (
                    <tr key={it.key} style={{ cursor: 'pointer' }} onClick={() => setOpenItem(it.key)}>
                      <td data-label="Product">
                        <span style={{ fontWeight: 600, color: 'var(--heading)' }}>{it.name}</span>
                      </td>
                      <td data-label="Last supplier">{it.lastSupplier}</td>
                      <td className="mono" style={{ textAlign: 'right' }} data-label="Latest unit price">{unitMoney(it.last)}</td>
                      <td style={{ textAlign: 'right' }} data-label="Change">
                        {delta === null ? <span className="muted">—</span> : (
                          <span style={{ fontWeight: 700, fontSize: 12, color: delta > 0.0001 ? 'var(--bad)' : delta < -0.0001 ? 'var(--accent)' : 'var(--muted)' }}>
                            {delta > 0.0001 ? '▲' : delta < -0.0001 ? '▼' : '='} {Math.abs(delta * 100).toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }} data-label="Times bought">{it.count}</td>
                      <td className="mono" style={{ textAlign: 'right' }} data-label="Total spend">{money(it.spend)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── SUPPLIERS ── */}
      {tab === 'suppliers' && (
        <div className="card">
          {shownSuppliers.length === 0 ? <div className="empty">No suppliers yet.</div> : (
            <table className="tbl tbl-cards">
              <thead><tr>
                <th>Supplier</th>
                <th style={{ textAlign: 'right' }}>Products</th>
                <th style={{ textAlign: 'right' }}>Purchases</th>
                <th style={{ textAlign: 'right' }}>Total spend</th>
                <th style={{ textAlign: 'right' }}>Last purchase</th>
              </tr></thead>
              <tbody>
                {shownSuppliers.map((s) => (
                  <tr key={s.key} style={{ cursor: 'pointer' }} onClick={() => setOpenSupplier(s.key)}>
                    <td data-label="Supplier"><span style={{ fontWeight: 600, color: 'var(--heading)' }}>{s.name}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Products">{s.products}</td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Purchases">{s.count}</td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Total spend">{money(s.spend)}</td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Last purchase">{prettyDate(s.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── IMPORT ── */}
      {tab === 'import' && (
        <div className="card">
          <div className="ttl"><h2>Import a month</h2></div>
          {!preview ? (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Choose one of the monthly purchase spreadsheets. It reads the <b>DATE</b>, <b>SUPPLIER</b>, <b>QTY</b>,
                <b> PRODUCT</b> and <b>NET PRICE</b> columns by their headings, ignores the title and totals rows, and
                shows you everything before anything is saved. Importing the same month twice is safe — repeats are
                spotted and skipped.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" disabled={busy}
                onChange={(e) => pickFile(e.target.files?.[0])}
                style={{ padding: 10, background: 'var(--panel-2)', border: '1px dashed var(--line-solid)' }} />
              {busy && <p className="hint">Reading…</p>}
            </>
          ) : (() => {
            const fresh = preview.rows.filter((r) => !preview.dupes.has(JSON.stringify(r)))
            const total = preview.rows.reduce((a, r) => a + r.net_total, 0)
            return (
              <>
                <p className="hint" style={{ marginTop: 0 }}>
                  <b>{preview.name}</b> — {preview.rows.length} rows, {money(total)} in total.{' '}
                  {preview.dupes.size > 0
                    ? <><b>{preview.dupes.size}</b> already on file and will be skipped, leaving <b>{fresh.length}</b> to import.</>
                    : <>All <b>{fresh.length}</b> are new.</>}
                </p>
                <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 9 }}>
                  <table className="tbl" style={{ minWidth: 0 }}>
                    <thead><tr><th>Date</th><th>Supplier</th><th>Product</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Net</th><th style={{ textAlign: 'right' }}>Unit</th></tr></thead>
                    <tbody>
                      {preview.rows.map((r, i) => {
                        const dup = preview.dupes.has(JSON.stringify(r))
                        return (
                          <tr key={i} style={dup ? { opacity: .45 } : undefined} title={dup ? 'Already on file — will be skipped' : ''}>
                            <td className="mono">{prettyDate(r.purchase_date)}</td>
                            <td>{r.supplier}</td>
                            <td>{r.product}{dup ? ' · already on file' : ''}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{r.qty}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{money(r.net_total)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{r.qty ? unitMoney(r.net_total / r.qty) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <button className="btn btn-a" disabled={busy || !fresh.length} onClick={() => confirmImport(false)}>
                    {busy ? 'Importing…' : `Import ${fresh.length} purchase${fresh.length === 1 ? '' : 's'}`}
                  </button>
                  {preview.dupes.size > 0 && (
                    <button className="btn btn-g" disabled={busy} onClick={() => confirmImport(true)}>
                      Import all {preview.rows.length}, including repeats
                    </button>
                  )}
                  <button className="btn btn-g" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ── one product's price history ── */}
      {item && (
        <div className="modal-bg" onClick={() => setOpenItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, textAlign: 'left' }}>
            <div className="ttl" style={{ marginBottom: 6 }}>
              <h2 style={{ margin: 0 }}>{item.name}</h2>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-g btn-sm" onClick={() => setRenaming({ kind: 'product', from: item.name, to: item.name })}>✎ Rename / merge</button>
                <button className="btn btn-g btn-sm" onClick={() => setOpenItem(null)}>Close</button>
              </div>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              Bought {item.count} time{item.count === 1 ? '' : 's'} from {item.suppliers.length} supplier{item.suppliers.length === 1 ? '' : 's'} ·
              {' '}lowest {unitMoney(item.min)} · highest {unitMoney(item.max)} · {money(item.spend)} in total
            </p>
            <PriceChart buys={item.buys} />
            <table className="tbl" style={{ minWidth: 0 }}>
              <thead><tr><th>Date</th><th>Supplier</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Net total</th><th style={{ textAlign: 'right' }}>Unit price</th><th></th></tr></thead>
              <tbody>
                {item.buys.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{prettyDate(r.purchase_date)}</td>
                    <td>{r.supplier}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{Number(r.qty)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(r.net_total)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{r.qty ? unitMoney(r.net_total / r.qty) : '—'}</td>
                    <td><button className="btn-dl" onClick={() => removeRow(r)} title="Delete this purchase">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Unit price is the net total divided by the quantity. If a figure looks wrong, check the quantity on that
              row — a price per pallet and a price per drum will not compare.
            </p>
          </div>
        </div>
      )}

      {/* ── one supplier ── */}
      {sup && (
        <div className="modal-bg" onClick={() => setOpenSupplier(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, textAlign: 'left' }}>
            <div className="ttl" style={{ marginBottom: 6 }}>
              <h2 style={{ margin: 0 }}>{sup.name}</h2>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-g btn-sm" onClick={() => setRenaming({ kind: 'supplier', from: sup.name, to: sup.name })}>✎ Rename / merge</button>
                <button className="btn btn-g btn-sm" onClick={() => setOpenSupplier(null)}>Close</button>
              </div>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              {sup.count} purchase{sup.count === 1 ? '' : 's'} · {sup.products} product{sup.products === 1 ? '' : 's'} · {money(sup.spend)} in total
            </p>
            <table className="tbl" style={{ minWidth: 0 }}>
              <thead><tr><th>Date</th><th>Product</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Net total</th><th style={{ textAlign: 'right' }}>Unit price</th></tr></thead>
              <tbody>
                {[...sup.buys].sort((a, b) => (a.purchase_date < b.purchase_date ? 1 : -1)).map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => { setOpenSupplier(null); setOpenItem(KEY(r.product)) }}>
                    <td className="mono">{prettyDate(r.purchase_date)}</td>
                    <td>{r.product}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{Number(r.qty)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(r.net_total)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.qty ? unitMoney(r.net_total / r.qty) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── rename / merge ── */}
      {renaming && (
        <div className="modal-bg" onClick={() => !busy && setRenaming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 6 }}>Rename this {renaming.kind}</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
              Every purchase recorded as <b>{renaming.from}</b> is renamed. Type the name of an existing{' '}
              {renaming.kind} to <b>merge</b> the two together — useful where the same one has been spelled two ways.
            </p>
            <div className="field">
              <label>Name to use</label>
              <input value={renaming.to} autoFocus
                onChange={(e) => setRenaming((r) => ({ ...r, to: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && doRename()}
                list="pur-names" />
              <datalist id="pur-names">
                {(renaming.kind === 'supplier' ? suppliers : items).map((x) => <option key={x.key} value={x.name} />)}
              </datalist>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-g" disabled={busy} onClick={() => setRenaming(null)}>Cancel</button>
              <button className="btn btn-a" disabled={busy} onClick={doRename}>{busy ? 'Saving…' : 'Rename'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── add one by hand ── */}
      {add && (
        <div className="modal-bg" onClick={() => !busy && setAdd(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 6 }}>Add a purchase</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>For anything bought outside the monthly sheet.</p>
            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Date</label>
                <input className="mono" type="date" value={add.purchase_date}
                  onChange={(e) => setAdd((a) => ({ ...a, purchase_date: e.target.value }))} /></div>
              <div className="field"><label>Supplier</label>
                <input value={add.supplier} list="pur-sups"
                  onChange={(e) => setAdd((a) => ({ ...a, supplier: e.target.value }))} />
                <datalist id="pur-sups">{suppliers.map((s) => <option key={s.key} value={s.name} />)}</datalist>
              </div>
            </div>
            <div className="field"><label>Product</label>
              <input value={add.product} list="pur-prods"
                onChange={(e) => setAdd((a) => ({ ...a, product: e.target.value }))} />
              <datalist id="pur-prods">{items.map((i) => <option key={i.key} value={i.name} />)}</datalist>
            </div>
            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Quantity</label>
                <input className="mono" type="number" min="0" step="any" value={add.qty}
                  onChange={(e) => setAdd((a) => ({ ...a, qty: e.target.value }))} /></div>
              <div className="field"><label>Net total (£)</label>
                <input className="mono" type="number" min="0" step="0.01" value={add.net_total}
                  onChange={(e) => setAdd((a) => ({ ...a, net_total: e.target.value }))} /></div>
            </div>
            {Number(add.qty) > 0 && Number(add.net_total) > 0 && (
              <p className="hint" style={{ marginTop: 0 }}>
                = <b>{unitMoney(Number(add.net_total) / Number(add.qty))}</b> per unit
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-g" disabled={busy} onClick={() => setAdd(null)}>Cancel</button>
              <button className="btn btn-a" disabled={busy} onClick={saveAdd}>{busy ? 'Saving…' : 'Add purchase'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Unit price over time. Inline SVG — a line with a point per purchase, so a
// creeping price is visible at a glance rather than read out of the table.
function PriceChart({ buys }) {
  const pts = [...buys]
    .filter((b) => Number(b.qty) > 0)
    .map((b) => ({ d: b.purchase_date, v: Number(b.net_total) / Number(b.qty) }))
    .sort((a, b) => (a.d < b.d ? -1 : 1))
  if (pts.length < 2) return null

  const W = 640, H = 120, P = 26
  const vals = pts.map((p) => p.v)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || hi || 1
  const x = (i) => P + (i * (W - 2 * P)) / (pts.length - 1)
  const y = (v) => H - P - ((v - lo) / span) * (H - 2 * P)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const up = pts[pts.length - 1].v > pts[0].v
  const stroke = up ? 'var(--bad, #C24E42)' : 'var(--accent)'

  return (
    <div style={{ overflowX: 'auto', margin: '4px 0 14px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Unit price over time">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--line)" strokeWidth="1" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.v)} r="3.5" fill={stroke} />
            <title>{`${prettyDate(p.d)} — ${unitMoney(p.v)}`}</title>
          </g>
        ))}
        <text x={P} y={14} fontSize="10" fill="var(--muted)">{unitMoney(hi)}</text>
        <text x={P} y={H - 6} fontSize="10" fill="var(--muted)">{unitMoney(lo)}</text>
      </svg>
    </div>
  )
}
