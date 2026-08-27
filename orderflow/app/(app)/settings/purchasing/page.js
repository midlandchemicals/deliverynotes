'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prettyDate, dateISO, todayISO } from '@/lib/calc'
import { ok, toast, toastError } from '@/lib/notify'
import { useCanSeePurchasing } from '@/app/(app)/PricingGuard'
import { UP, normProduct, normSupplier, fuzzyScore, groupBy, suggestMerges } from '@/lib/purchasing'
import PriceChart from './PriceChart'
import SupplierBars from './SupplierBars'

// Purchasing — what we buy, who from, and what it has cost over time.
// Unit price is always derived (net ÷ qty), never stored, so it can't drift
// from the figures on the sheet it came from.

const money = (n) => '£' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Unit prices run from pennies (caps) to thousands (IBCs) — show enough
// decimals to be useful at the small end without noise at the large end.
const unitMoney = (n) => (n >= 100 ? money(n) : '£' + (Math.round((n || 0) * 10000) / 10000).toFixed(4))
// dateISO reads the local calendar — see the note on it in lib/calc.
const iso = (d) => dateISO(d)
const unitOf = (r) => (Number(r.qty) ? Number(r.net_total) / Number(r.qty) : 0)

export default function PurchasingPage() {
  const supabase = createClient()
  const canSee = useCanSeePurchasing()
  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState('catalogue')
  const [q, setQ] = useState('')
  const [openItem, setOpenItem] = useState(null)
  const [openSupplier, setOpenSupplier] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [add, setAdd] = useState(null)
  const fileRef = useRef(null)

  async function load() {
    const { data, error } = await supabase.from('purchases').select('*').order('purchase_date', { ascending: false })
    if (error) { toastError('Could not load purchases: ' + error.message); setRows([]); return }
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  // ── grouping ──────────────────────────────────────────────────────────────
  // Spellings that differ only by punctuation or LTR/LITRE/L are the same
  // product, so they're pooled here without anyone being asked.
  const items = useMemo(() => groupBy(rows || [], 'product', normProduct).map((g) => {
    const buys = [...g.rows].sort((a, b) => (a.purchase_date < b.purchase_date ? 1 : -1))
    const prices = buys.map(unitOf).filter((n) => n > 0)
    const bySup = new Map()
    for (const r of buys) {
      const k = UP(r.supplier)
      if (!bySup.has(k)) bySup.set(k, { name: r.supplier, tot: 0, n: 0 })
      const s = bySup.get(k); s.tot += unitOf(r); s.n++
    }
    return {
      ...g, buys,
      count: buys.length,
      spend: buys.reduce((s, r) => s + Number(r.net_total || 0), 0),
      last: buys[0] ? unitOf(buys[0]) : 0,
      prev: buys[1] ? unitOf(buys[1]) : null,
      lastDate: buys[0]?.purchase_date,
      lastSupplier: buys[0]?.supplier || '',
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      avg: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
      supplierRows: [...bySup.values()].map((s) => ({ name: s.name, avg: s.tot / s.n, n: s.n })).sort((a, b) => a.avg - b.avg),
    }
  }), [rows])

  const suppliers = useMemo(() => groupBy(rows || [], 'supplier', normSupplier).map((g) => ({
    ...g,
    count: g.rows.length,
    spend: g.rows.reduce((a, r) => a + Number(r.net_total || 0), 0),
    products: new Set(g.rows.map((r) => normProduct(r.product))).size,
    lastDate: g.rows.map((r) => r.purchase_date).sort().slice(-1)[0],
  })).sort((a, b) => b.spend - a.spend), [rows])

  // Names that are probably the same but can't be pooled safely — offered, not applied.
  const tidy = useMemo(() => ({
    products: suggestMerges(items.map((i) => i.name), normProduct).slice(0, 25),
    suppliers: suggestMerges(suppliers.map((s) => s.name), normSupplier).slice(0, 25),
  }), [items, suppliers])
  const tidyCount = tidy.products.length + tidy.suppliers.length

  // ── search ────────────────────────────────────────────────────────────────
  // Typo-tolerant: "methylne chloride" finds METHYLENE CHLORIDE.
  const shownItems = useMemo(() => {
    if (!q.trim()) return [...items].sort((a, b) => a.name.localeCompare(b.name))
    return items
      .map((i) => ({ i, s: Math.max(fuzzyScore(q, i.name), ...i.buys.map((b) => fuzzyScore(q, b.supplier) * 0.8)) }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.i)
  }, [items, q])
  const shownSuppliers = useMemo(() => {
    if (!q.trim()) return suppliers
    return suppliers.map((s) => ({ s, sc: fuzzyScore(q, s.name) })).filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc).map((x) => x.s)
  }, [suppliers, q])

  const totalSpend = (rows || []).reduce((a, r) => a + Number(r.net_total || 0), 0)

  // ── import ────────────────────────────────────────────────────────────────
  async function pickFile(file) {
    if (!file) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true })
      const headRow = grid.findIndex((r) => (r || []).some((c) => UP(c) === 'SUPPLIER'))
      if (headRow === -1) throw new Error('No SUPPLIER heading found — is this a purchases sheet?')
      const head = grid[headRow].map(UP)
      const col = (...names) => head.findIndex((h) => names.includes(h))
      const cDate = col('DATE'), cSup = col('SUPPLIER'), cQty = col('QTY')
      const cProd = col('PRODUCT'), cNet = col('NET PRICE', 'NET', 'NETPRICE')
      if ([cDate, cSup, cQty, cProd, cNet].some((i) => i === -1)) throw new Error('Missing one of DATE / SUPPLIER / QTY / PRODUCT / NET PRICE')

      const parsed = []
      for (const r of grid.slice(headRow + 1)) {
        if (!(r?.[cDate] instanceof Date)) continue    // skips blanks and the totals row
        const product = String(r[cProd] ?? '').trim()
        const supplier = String(r[cSup] ?? '').trim()
        if (!product && !supplier) continue
        parsed.push({
          purchase_date: iso(r[cDate]), supplier, product,
          qty: Number(r[cQty]) || 0, net_total: Number(r[cNet]) || 0, source: file.name,
        })
      }
      const existing = new Set((rows || []).map((r) => [r.purchase_date, UP(r.supplier), UP(r.product), Number(r.qty), Number(r.net_total)].join('|')))
      const dupes = new Set(parsed.filter((p) => existing.has([p.purchase_date, UP(p.supplier), UP(p.product), p.qty, p.net_total].join('|'))).map((d) => JSON.stringify(d)))
      setPreview({ name: file.name, rows: parsed, dupes })
      if (!parsed.length) toastError('No dated rows found in that sheet')
    } catch (e) {
      toastError('Could not read that file: ' + e.message)
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function confirmImport(includeDupes) {
    const toAdd = includeDupes ? preview.rows : preview.rows.filter((r) => !preview.dupes.has(JSON.stringify(r)))
    if (!toAdd.length) { toast('Nothing new to import'); setPreview(null); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const res = await supabase.from('purchases').insert(toAdd.map((r) => ({ ...r, created_by: user?.id || null })))
    setBusy(false)
    if (!ok(res, 'importing the purchases')) return
    toast(`Imported ${toAdd.length} purchase${toAdd.length === 1 ? '' : 's'} from ${preview.name}`)
    setPreview(null); load()
  }

  // ── rename / merge ────────────────────────────────────────────────────────
  async function applyRename(kind, from, to) {
    const clean = String(to || '').trim()
    if (!clean) { toastError('Enter the name to use'); return false }
    setBusy(true)
    const field = kind === 'supplier' ? 'supplier' : 'product'
    const norm = kind === 'supplier' ? normSupplier : normProduct
    // Match on the normalised name so every spelling in the group comes along.
    const ids = (rows || []).filter((r) => norm(r[field]) === norm(from)).map((r) => r.id)
    const res = await supabase.from('purchases').update({ [field]: clean }).in('id', ids)
    setBusy(false)
    if (!ok(res, 'renaming')) return false
    toast(`${ids.length} row${ids.length === 1 ? '' : 's'} now "${clean}"`)
    await load()
    return true
  }

  async function saveAdd() {
    if (!add.product.trim() || !add.supplier.trim()) { toastError('Supplier and product are both needed'); return }
    if (!(Number(add.qty) > 0)) { toastError('Quantity must be more than zero'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const res = await supabase.from('purchases').insert({
      purchase_date: add.purchase_date, supplier: add.supplier.trim(), product: add.product.trim(),
      qty: Number(add.qty), net_total: Number(add.net_total) || 0, source: 'entered by hand', created_by: user?.id || null,
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

  if (canSee === false) return <div className="card"><div className="empty">Purchasing is not available to your login.</div></div>
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
          <button className="btn btn-g" onClick={() => setAdd({ purchase_date: todayISO(), supplier: '', product: '', qty: '', net_total: '' })}>＋ Add a purchase</button>
          <button className="btn btn-a" onClick={() => setTab('import')}>⬆ Import a month</button>
        </div>
      </div>

      <div className="sub-nav">
        {[['catalogue', `Catalogue (${items.length})`], ['suppliers', `Suppliers (${suppliers.length})`],
          ['tidy', `Tidy up${tidyCount ? ` (${tidyCount})` : ''}`], ['import', 'Import']].map(([k, label]) => (
          <a key={k} className={tab === k ? 'on' : ''} style={{ cursor: 'pointer' }} onClick={() => setTab(k)}>{label}</a>
        ))}
      </div>

      {(tab === 'catalogue' || tab === 'suppliers') && (
        <div className="filters">
          <input placeholder="Search — spelling doesn't have to be perfect…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <span className="muted" style={{ fontSize: 12.5 }}>
            {(tab === 'catalogue' ? shownItems : shownSuppliers).length} match{(tab === 'catalogue' ? shownItems : shownSuppliers).length === 1 ? '' : 'es'}
          </span>}
        </div>
      )}

      {/* ── CATALOGUE ── */}
      {tab === 'catalogue' && (
        <div className="card">
          {items.length === 0 ? <div className="empty">Nothing yet — import a month of purchases to get started.</div>
            : shownItems.length === 0 ? <div className="empty">Nothing matches “{q}”.</div> : (
            <table className="tbl tbl-cards">
              <thead><tr>
                <th>Product</th><th>Last supplier</th>
                <th style={{ textAlign: 'right' }}>Latest unit price</th>
                <th style={{ textAlign: 'right' }}>Change</th>
                <th style={{ textAlign: 'right' }}>Bought</th>
                <th style={{ textAlign: 'right' }}>Total spend</th>
              </tr></thead>
              <tbody>
                {shownItems.map((it) => (
                  <tr key={it.key} style={{ cursor: 'pointer' }} onClick={() => setOpenItem(it.key)}>
                    <td data-label="Product">
                      <span style={{ fontWeight: 600, color: 'var(--heading)' }}>{it.name}</span>
                      {it.variants.length > 1 && (
                        <span title={it.variants.map((v) => v.name).join('\n')}
                          style={{ marginLeft: 7, fontSize: 10, fontWeight: 700, color: 'var(--muted)', background: 'var(--chip-bg)', borderRadius: 5, padding: '2px 6px' }}>
                          {it.variants.length} spellings
                        </span>
                      )}
                    </td>
                    <td data-label="Last supplier">{it.lastSupplier}</td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Latest unit price">{unitMoney(it.last)}</td>
                    <td style={{ textAlign: 'right' }} data-label="Change"><Delta last={it.last} prev={it.prev} /></td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Bought">{it.count}</td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Total spend">{money(it.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── SUPPLIERS ── */}
      {tab === 'suppliers' && (
        <div className="card">
          {shownSuppliers.length === 0 ? <div className="empty">Nothing matches.</div> : (
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
                    <td data-label="Supplier">
                      <span style={{ fontWeight: 600, color: 'var(--heading)' }}>{s.name}</span>
                      {s.variants.length > 1 && (
                        <span style={{ marginLeft: 7, fontSize: 10, fontWeight: 700, color: 'var(--muted)', background: 'var(--chip-bg)', borderRadius: 5, padding: '2px 6px' }}>
                          {s.variants.length} spellings
                        </span>
                      )}
                    </td>
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

      {/* ── TIDY UP ── */}
      {tab === 'tidy' && (
        <div className="card">
          <div className="ttl"><h2>Names that look like the same thing</h2></div>
          <p className="hint" style={{ marginTop: 0 }}>
            Spellings that differ only by punctuation or LTR/LITRE/L are already pooled automatically — these are the
            ones that need a human eye. Merging keeps the whole price history together under one name.
            <b> Different sizes and front/back labels are deliberately never suggested.</b>
          </p>
          {tidyCount === 0 ? <div className="empty">Nothing looks like a duplicate. 👍</div> : (
            <>
              {[['suppliers', 'supplier'], ['products', 'product']].map(([k, kind]) => tidy[k].length > 0 && (
                <div key={k} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>
                    {kind === 'supplier' ? 'Suppliers' : 'Products'} ({tidy[k].length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tidy[k].map((m, i) => (
                      <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px', background: 'var(--panel)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{m.why}</div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: 'var(--heading)', fontSize: 13 }}>{m.a}</span>
                          <span className="muted">↔</span>
                          <span style={{ fontWeight: 600, color: 'var(--heading)', fontSize: 13 }}>{m.b}</span>
                          <span style={{ flex: 1 }} />
                          <button className="btn btn-g btn-sm" disabled={busy}
                            onClick={() => applyRename(kind, m.b, m.a)}>Keep “{m.a}”</button>
                          <button className="btn btn-g btn-sm" disabled={busy}
                            onClick={() => applyRename(kind, m.a, m.b)}>Keep “{m.b}”</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
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
                Choose one of the monthly purchase spreadsheets. Columns are found by their headings —
                <b> DATE</b>, <b>SUPPLIER</b>, <b>QTY</b>, <b>PRODUCT</b>, <b>NET PRICE</b> — the title and totals rows
                are ignored, and everything is shown before anything is saved. Importing the same month twice is safe.
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
                          <tr key={i} style={dup ? { opacity: .45 } : undefined}>
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
                    <button className="btn btn-g" disabled={busy} onClick={() => confirmImport(true)}>Import all {preview.rows.length}, including repeats</button>
                  )}
                  <button className="btn btn-g" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ── PRODUCT ── */}
      {item && (() => {
        const points = [...item.buys].filter((b) => Number(b.qty) > 0).reverse()
          .map((b) => ({ d: b.purchase_date, v: unitOf(b), supplier: b.supplier }))
        // A 10× spread almost always means the quantity means something
        // different on different rows, not that the price moved.
        const suspect = item.min > 0 && item.max / item.min > 10
        return (
          <div className="modal-bg" onClick={() => setOpenItem(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, textAlign: 'left' }}>
              <div className="ttl" style={{ marginBottom: 4 }}>
                <h2 style={{ margin: 0 }}>{item.name}</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-g btn-sm" onClick={() => setRenaming({ kind: 'product', from: item.name, to: item.name })}>✎ Rename / merge</button>
                  <button className="btn btn-g btn-sm" onClick={() => setOpenItem(null)}>Close</button>
                </div>
              </div>
              {item.variants.length > 1 && (
                <p className="hint" style={{ marginTop: 0 }}>
                  Pooled from {item.variants.length} spellings: {item.variants.map((v) => `${v.name} (×${v.n})`).join(', ')}
                </p>
              )}

              <div className="stat-row">
                <Stat label="Latest unit price" value={unitMoney(item.last)} sub={`${prettyDate(item.lastDate)} · ${item.lastSupplier}`} big />
                <Stat label="Change" node={<Delta last={item.last} prev={item.prev} big />} sub={item.prev ? `from ${unitMoney(item.prev)}` : 'first purchase'} />
                <Stat label="Lowest" value={unitMoney(item.min)} sub={`average ${unitMoney(item.avg)}`} />
                <Stat label="Highest" value={unitMoney(item.max)} sub={`${item.count} purchase${item.count === 1 ? '' : 's'}`} />
                <Stat label="Total spend" value={money(item.spend)} sub={`${item.supplierRows.length} supplier${item.supplierRows.length === 1 ? '' : 's'}`} />
              </div>

              {suspect && (
                <p className="hint" style={{ background: '#FCF4E2', border: '1px solid var(--warn, #B07E28)', borderRadius: 8, padding: '9px 12px', color: '#7A5511', fontWeight: 600 }}>
                  ⚠ These unit prices range from {unitMoney(item.min)} to {unitMoney(item.max)}. That is usually the
                  quantity meaning different things on different rows — per drum on one, per kg on another — rather than
                  a real price change. Check the Qty column below.
                </p>
              )}

              {points.length > 1 && (
                <>
                  <div className="chart-title">Unit price for each purchase</div>
                  <PriceChart points={points} fmt={unitMoney} />
                </>
              )}

              {item.supplierRows.length > 1 && (
                <>
                  <div className="chart-title">Average unit price by supplier</div>
                  <SupplierBars rows={item.supplierRows} fmt={unitMoney} />
                </>
              )}

              <div className="chart-title">Every purchase</div>
              <table className="tbl" style={{ minWidth: 0 }}>
                <thead><tr><th>Date</th><th>Supplier</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Net total</th><th style={{ textAlign: 'right' }}>Unit price</th><th></th></tr></thead>
                <tbody>
                  {item.buys.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{prettyDate(r.purchase_date)}</td>
                      <td>{r.supplier}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{Number(r.qty)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(r.net_total)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{r.qty ? unitMoney(unitOf(r)) : '—'}</td>
                      <td><button className="btn-dl" onClick={() => removeRow(r)} title="Delete this purchase">×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* ── SUPPLIER ── */}
      {sup && (
        <div className="modal-bg" onClick={() => setOpenSupplier(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, textAlign: 'left' }}>
            <div className="ttl" style={{ marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>{sup.name}</h2>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-g btn-sm" onClick={() => setRenaming({ kind: 'supplier', from: sup.name, to: sup.name })}>✎ Rename / merge</button>
                <button className="btn btn-g btn-sm" onClick={() => setOpenSupplier(null)}>Close</button>
              </div>
            </div>
            <div className="stat-row">
              <Stat label="Total spend" value={money(sup.spend)} sub={`${sup.count} purchase${sup.count === 1 ? '' : 's'}`} big />
              <Stat label="Products" value={String(sup.products)} sub="different lines" />
              <Stat label="Last purchase" value={prettyDate(sup.lastDate)} />
            </div>
            <table className="tbl" style={{ minWidth: 0 }}>
              <thead><tr><th>Date</th><th>Product</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Net total</th><th style={{ textAlign: 'right' }}>Unit price</th></tr></thead>
              <tbody>
                {[...sup.rows].sort((a, b) => (a.purchase_date < b.purchase_date ? 1 : -1)).map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => { setOpenSupplier(null); setOpenItem(normProduct(r.product)) }}>
                    <td className="mono">{prettyDate(r.purchase_date)}</td>
                    <td>{r.product}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{Number(r.qty)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(r.net_total)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.qty ? unitMoney(unitOf(r)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── RENAME ── */}
      {renaming && (
        <div className="modal-bg" onClick={() => !busy && setRenaming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 6 }}>Rename this {renaming.kind}</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
              Every purchase recorded as <b>{renaming.from}</b> is renamed. Type the name of an existing{' '}
              {renaming.kind} to <b>merge</b> the two together.
            </p>
            <div className="field">
              <label>Name to use</label>
              <input value={renaming.to} autoFocus list="pur-names"
                onChange={(e) => setRenaming((r) => ({ ...r, to: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && applyRename(renaming.kind, renaming.from, renaming.to).then((v) => v && (setRenaming(null), setOpenItem(null), setOpenSupplier(null)))} />
              <datalist id="pur-names">
                {(renaming.kind === 'supplier' ? suppliers : items).map((x) => <option key={x.key} value={x.name} />)}
              </datalist>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-g" disabled={busy} onClick={() => setRenaming(null)}>Cancel</button>
              <button className="btn btn-a" disabled={busy}
                onClick={() => applyRename(renaming.kind, renaming.from, renaming.to).then((v) => v && (setRenaming(null), setOpenItem(null), setOpenSupplier(null)))}>
                {busy ? 'Saving…' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD ── */}
      {add && (
        <div className="modal-bg" onClick={() => !busy && setAdd(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 6 }}>Add a purchase</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>For anything bought outside the monthly sheet.</p>
            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Date</label>
                <input className="mono" type="date" value={add.purchase_date} onChange={(e) => setAdd((a) => ({ ...a, purchase_date: e.target.value }))} /></div>
              <div className="field"><label>Supplier</label>
                <input value={add.supplier} list="pur-sups" onChange={(e) => setAdd((a) => ({ ...a, supplier: e.target.value }))} />
                <datalist id="pur-sups">{suppliers.map((s) => <option key={s.key} value={s.name} />)}</datalist></div>
            </div>
            <div className="field"><label>Product</label>
              <input value={add.product} list="pur-prods" onChange={(e) => setAdd((a) => ({ ...a, product: e.target.value }))} />
              <datalist id="pur-prods">{items.map((i) => <option key={i.key} value={i.name} />)}</datalist></div>
            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Quantity</label>
                <input className="mono" type="number" min="0" step="any" value={add.qty} onChange={(e) => setAdd((a) => ({ ...a, qty: e.target.value }))} /></div>
              <div className="field"><label>Net total (£)</label>
                <input className="mono" type="number" min="0" step="0.01" value={add.net_total} onChange={(e) => setAdd((a) => ({ ...a, net_total: e.target.value }))} /></div>
            </div>
            {Number(add.qty) > 0 && Number(add.net_total) > 0 && (
              <p className="hint" style={{ marginTop: 0 }}>= <b>{unitMoney(Number(add.net_total) / Number(add.qty))}</b> per unit</p>
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

// Price movement. Status colours, so it always ships with an arrow and a number
// — never colour on its own, which red/green can't carry for everyone.
function Delta({ last, prev, big }) {
  if (!prev) return <span className="muted">—</span>
  const d = (last - prev) / prev
  const flat = Math.abs(d) < 0.0001
  const colour = flat ? 'var(--muted)' : d > 0 ? 'var(--bad, #C24E42)' : 'var(--accent)'
  return (
    <span style={{ fontWeight: 700, fontSize: big ? 21 : 12, color: colour, whiteSpace: 'nowrap' }}>
      {flat ? '=' : d > 0 ? '▲' : '▼'} {Math.abs(d * 100).toFixed(1)}%
    </span>
  )
}

function Stat({ label, value, node, sub, big }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={big ? { fontSize: 21 } : undefined}>{node || value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}
