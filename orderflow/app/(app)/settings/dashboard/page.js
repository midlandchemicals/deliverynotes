'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { computeLine, PRICE_LEVELS, seasonalActive, parseTiers, resolveLinePpl, labelCount, normalizeStatus, STATUS_NEW, STATUS_DONE } from '@/lib/calc'
import PricingGuard from '@/app/(app)/PricingGuard'
import { groupProductNames, productKeyMap } from '@/lib/insights'

function gbp(n) {
  return '£' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function gbp2(n) {
  return '£' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function DashboardPage() {
  const supabase = createClient()
  const [data, setData] = useState(null)

  useEffect(() => {
    (async () => {
      const [ordRes, prodRes, pkgRes, priceRes, custRes, lhRes, dnRes] = await Promise.all([
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('products').select('id, name, sg'),
        supabase.from('packaging').select('id, name, volume, tare'),
        supabase.from('customer_product_prices').select('customer_id, product_id, packaging_id, price_per_litre, delivery_charge, qty_tiers, tier_basis, price_trade, price_buyer_group, price_retail, season_from, season_to, season_ppl'),
        supabase.from('customers').select('id, name, default_letterhead_id, three_tier_pricing, label_price, default_delivery_charge'),
        supabase.from('letterheads').select('id, name, company, color'),
        supabase.from('dispatch_notes').select('order_id, doc_date, created_at, totals, lines_snapshot').order('created_at', { ascending: false }),
      ])
      const orders = ordRes.data || []
      const products = prodRes.data || []
      const packaging = pkgRes.data || []
      const prices = priceRes.data || []
      const customers = custRes.data || []
      const letterheads = lhRes.data || []
      const dispatchNotes = dnRes.data || []

      // Latest dispatch note per order — its snapshot holds the LOCKED price the
      // order was actually billed at. Revenue uses this, not current prices.
      const dnByOrder = {}
      for (const dn of dispatchNotes) {
        if (dn.order_id && !dnByOrder[dn.order_id]) dnByOrder[dn.order_id] = dn // first = newest (sorted desc)
      }

      // price lookup: `${customer}::${product}::${packaging}` -> ppl (base)
      // tierMap: same key -> [{from,to,ppl}] quantity-break bands
      const priceMap = {}
      const deliveryMap = {}   // key -> per-product delivery surcharge
      const tierMap = {}
      const basisMap = {}
      const levelMap = {}   // key -> { trade, buyer_group, retail }
      const seasonMap = {}  // key -> { from, to, ppl } | null
      for (const p of prices) {
        const key = `${p.customer_id}::${p.product_id}::${p.packaging_id}`
        priceMap[key] = p.price_per_litre || 0
        deliveryMap[key] = Number(p.delivery_charge) || 0
        basisMap[key] = p.tier_basis || 'line'
        levelMap[key] = { trade: p.price_trade, buyer_group: p.price_buyer_group, retail: p.price_retail }
        seasonMap[key] = (p.season_from && p.season_to && p.season_ppl != null)
          ? { from: p.season_from, to: p.season_to, ppl: Number(p.season_ppl) || 0 } : null
        tierMap[key] = parseTiers(p.qty_tiers)
      }
      const custThreeTier = Object.fromEntries(customers.map((c) => [c.id, !!c.three_tier_pricing]))
      const custLabelPrice = Object.fromEntries(customers.map((c) => [c.id, Number(c.label_price) || 0]))
      const custDefDelivery = Object.fromEntries(customers.map((c) => [c.id, Number(c.default_delivery_charge) || 0]))
      const levelCol = (lvl) => (PRICE_LEVELS.find((l) => l.key === lvl) || PRICE_LEVELS[0]).col
      const custName = Object.fromEntries(customers.map((c) => [c.id, c.name]))
      const custLh = Object.fromEntries(customers.map((c) => [c.id, c.default_letterhead_id || null]))
      const lhById = Object.fromEntries(letterheads.map((l) => [l.id, l]))
      const defaultLh = letterheads.find((l) =>
        l.name.toLowerCase().includes('midland') || l.company.toLowerCase().includes('midland')
      ) || letterheads[0] || { company: 'Midland Chemicals', color: '#1FA86B' }

      // Locked value from a dispatch-note snapshot — the ex-VAT total the order
      // was actually billed: product lines + delivery charge + label charges.
      // Breakdown keyed by product NAME (snapshots store names, not ids).
      function lockedValue(dn) {
        let total = 0
        const byName = {}
        for (const s of (dn.lines_snapshot || [])) {
          const v = Number(s.line_total) || 0
          total += v
          const name = s.productName || '—'
          byName[name] = (byName[name] || 0) + v
        }
        // Older snapshots may predate per-line totals — fall back to order_total.
        if (total === 0 && dn.totals?.order_total) total = Number(dn.totals.order_total) || 0
        total += Number(dn.totals?.delivery_charge) || 0
        total += Number(dn.totals?.label_total) || 0
        return { total, byName }
      }

      // Estimated value at CURRENT prices — only for orders not yet dispatched
      // (no locked snapshot exists yet, so this is pipeline, not realised revenue).
      function estimateValue(o) {
        // Combined pack qty across this order's 'order'-basis lines (the "mix").
        const combined = (o.lines || []).reduce((sum, l) => {
          const c = computeLine(l, products, packaging)
          if (!c.product || !c.packaging) return sum
          const k = `${o.customer_id}::${c.product.id}::${c.packaging.id}`
          return basisMap[k] === 'order' ? sum + (c.qty || 0) : sum
        }, 0)
        const threeTier = custThreeTier[o.customer_id]
        const lvlCol = levelCol(o.price_level || 'trade')
        let total = 0
        const byName = {}
        for (const l of (o.lines || [])) {
          const c = computeLine(l, products, packaging)
          if (!c.product || !c.packaging) continue
          const key = `${o.customer_id}::${c.product.id}::${c.packaging.id}`
          // Seasonal price wins; else 3-tier buyer level; else quantity tiers —
          // same resolver as the order page.
          const s = seasonMap[key]
          const seasonP = s && seasonalActive(s.from, s.to, o.order_date) ? s.ppl : null
          const lvlPrice = threeTier ? levelMap[key]?.[lvlCol] : null
          const override = (l.ppl_override != null && l.ppl_override !== '' && !isNaN(parseFloat(l.ppl_override))) ? parseFloat(l.ppl_override) : null
          const ppl = override != null
            ? override
            : seasonP != null
              ? seasonP
              : threeTier
                ? (lvlPrice != null ? lvlPrice : (priceMap[key] || 0))
                : resolveLinePpl({ base: priceMap[key], tiers: tierMap[key] || [], basis: basisMap[key], lineQty: c.qty, combinedQty: combined })
          const lineVal = ppl * (c.vol || 0) * c.qty
          total += lineVal
          byName[c.productName] = (byName[c.productName] || 0) + lineVal
        }
        // Estimated label charges (starred products × customer £/label)
        const lp = custLabelPrice[o.customer_id] || 0
        if (lp > 0) {
          for (const l of (o.lines || [])) total += labelCount(l, products, packaging) * lp
        }
        // Estimated delivery: per-product surcharges on this order, else the
        // customer's flat default. (Pallet-based rates need a pallet count,
        // which doesn't exist until dispatch — the locked note captures those.)
        let delivery = 0
        for (const l of (o.lines || [])) {
          const c = computeLine(l, products, packaging)
          if (c.product && c.packaging) delivery += deliveryMap[`${o.customer_id}::${c.product.id}::${c.packaging.id}`] || 0
        }
        if (delivery === 0) delivery = custDefDelivery[o.customer_id] || 0
        total += delivery
        return { total, byName }
      }

      // One record per order, so any period, company or customer view is just a
      // filter over the same list — rather than a fixed set of all-time totals,
      // which is what made this page unable to answer "what happened in July".
      const records = orders.map((o) => {
        const dn = dnByOrder[o.id]
        const { total, byName } = dn ? lockedValue(dn) : estimateValue(o)
        const iso = String(dn?.doc_date || o.order_date || o.created_at || '').slice(0, 10)
        let coKey = (o.customer_id && custLh[o.customer_id]) || 'default'
        if (coKey === defaultLh?.id) coKey = 'default'
        return {
          id: o.id,
          date: iso,
          month: iso.slice(0, 7),
          year: iso.slice(0, 4),
          customerId: o.customer_id || null,
          customerName: custName[o.customer_id] || '—',
          coKey,
          coName: (coKey === 'default' ? defaultLh : lhById[coKey])?.company
            || (coKey === 'default' ? defaultLh : lhById[coKey])?.name || 'Unknown',
          coColor: (coKey === 'default' ? defaultLh : lhById[coKey])?.color || '#1F6E4E',
          dispatched: !!dn,
          status: normalizeStatus(o.status),
          total,
          lines: Object.entries(byName).map(([name, value]) => ({ name, value })),
        }
      }).filter((r) => r.month)

      setData({ records, hasPrices: prices.length > 0 })
    })()
  }, [])

  return (
    <PricingGuard fallback={<div className="card"><div className="empty">This page is only available to admin logins.</div></div>}>
      {data === null ? (
        <div className="card"><div className="empty">Crunching the numbers…</div></div>
      ) : (
        <Insights records={data.records} hasPrices={data.hasPrices} />
      )}
    </PricingGuard>
  )
}

// ── the page ────────────────────────────────────────────────────────────────
// Everything is scoped to a period. A month by default, because that is the
// question people actually ask; a year or all time when they want the shape.
function Insights({ records, hasPrices }) {
  const [mode, setMode] = useState('month')      // 'month' | 'year' | 'all'
  const [periodKey, setPeriodKey] = useState('')
  const [co, setCo] = useState('all')
  const [drill, setDrill] = useState(null)       // customerId being examined
  const [splitKeys, setSplitKeys] = useState(new Set())

  // Splits are a display preference, so they live in the browser rather than
  // needing a table and a migration.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('insightsSplit')
      if (raw) setSplitKeys(new Set(JSON.parse(raw)))
    } catch { /* ignore malformed storage */ }
  }, [])
  function toggleSplit(key) {
    setSplitKeys((s) => {
      const n = new Set(s)
      n.has(key) ? n.delete(key) : n.add(key)
      try { localStorage.setItem('insightsSplit', JSON.stringify([...n])) } catch {}
      return n
    })
  }

  const months = useMemo(() => [...new Set(records.map((r) => r.month))].sort().reverse(), [records])
  const years = useMemo(() => [...new Set(records.map((r) => r.year))].sort().reverse(), [records])
  useEffect(() => {
    if (periodKey) return
    if (mode === 'month' && months.length) setPeriodKey(months[0])
    if (mode === 'year' && years.length) setPeriodKey(years[0])
  }, [mode, months, years, periodKey])

  function changeMode(m) {
    setMode(m)
    setPeriodKey(m === 'month' ? (months[0] || '') : m === 'year' ? (years[0] || '') : '')
  }

  const companies = useMemo(() => {
    const m = new Map()
    for (const r of records) {
      if (!m.has(r.coKey)) m.set(r.coKey, { key: r.coKey, label: r.coName, value: 0 })
      m.get(r.coKey).value += r.total
    }
    return [...m.values()].sort((a, b) => b.value - a.value)
  }, [records])

  // The records the whole page is about.
  const inPeriod = useMemo(() => records.filter((r) => {
    if (mode === 'month' && r.month !== periodKey) return false
    if (mode === 'year' && r.year !== periodKey) return false
    if (co !== 'all' && r.coKey !== co) return false
    return true
  }), [records, mode, periodKey, co])

  const scope = drill ? inPeriod.filter((r) => r.customerId === drill) : inPeriod
  const drillName = drill ? (records.find((r) => r.customerId === drill)?.customerName || '') : ''

  // ── figures for the chosen period ──
  const revenue = scope.reduce((a, r) => a + r.total, 0)
  const dispatched = scope.filter((r) => r.dispatched)
  const dispatchedRev = dispatched.reduce((a, r) => a + r.total, 0)
  const avg = scope.length ? revenue / scope.length : 0

  // Previous comparable period, so a figure has something to be judged against.
  const prevKey = mode === 'month'
    ? months[months.indexOf(periodKey) + 1]
    : mode === 'year' ? years[years.indexOf(periodKey) + 1] : null
  const prevRevenue = prevKey
    ? records.filter((r) => (mode === 'month' ? r.month : r.year) === prevKey)
        .filter((r) => co === 'all' || r.coKey === co)
        .filter((r) => !drill || r.customerId === drill)
        .reduce((a, r) => a + r.total, 0)
    : null

  const customers = useMemo(() => {
    const m = new Map()
    for (const r of inPeriod) {
      if (!r.customerId) continue
      if (!m.has(r.customerId)) m.set(r.customerId, { id: r.customerId, name: r.customerName, value: 0, orders: 0 })
      const c = m.get(r.customerId); c.value += r.total; c.orders++
    }
    return [...m.values()].sort((a, b) => b.value - a.value)
  }, [inPeriod])

  // ── products, with the near-duplicate names pooled ──
  const products = useMemo(() => {
    const weights = {}
    for (const r of scope) for (const l of r.lines) weights[l.name] = (weights[l.name] || 0) + l.value
    const groups = groupProductNames(Object.keys(weights), splitKeys, weights)
    const keyOf = productKeyMap(groups)
    const totals = new Map()
    for (const r of scope) {
      for (const l of r.lines) {
        const k = keyOf.get(l.name)
        if (!k) continue
        if (!totals.has(k)) totals.set(k, 0)
        totals.set(k, totals.get(k) + l.value)
      }
    }
    return groups
      .map((g) => ({ ...g, value: totals.get(g.key) || 0 }))
      .filter((g) => g.value !== 0)
      .sort((a, b) => b.value - a.value)
  }, [scope, splitKeys])
  const mergedCount = products.filter((p) => p.names.length > 1).length

  // Twelve periods of context behind the chart.
  const trend = useMemo(() => {
    const keys = (mode === 'year' ? years : months).slice(0, 12).reverse()
    return keys.map((k) => ({
      key: k,
      label: mode === 'year' ? k : monthShort(k),
      value: records
        .filter((r) => (mode === 'year' ? r.year : r.month) === k)
        .filter((r) => co === 'all' || r.coKey === co)
        .filter((r) => !drill || r.customerId === drill)
        .reduce((a, r) => a + r.total, 0),
    }))
  }, [records, months, years, mode, co, drill])

  const periodLabel = mode === 'all' ? 'All time' : mode === 'year' ? periodKey : monthLong(periodKey)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Insights</h1>
          <div className="sub">
            {drill ? <>{drillName} · {periodLabel}</> : <>{periodLabel}{co !== 'all' ? ` · ${companies.find((c) => c.key === co)?.label}` : ''}</>}
            {' '}· {scope.length} order{scope.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="theme-tog" style={{ background: 'var(--field-bg)' }}>
          {[['month', 'Monthly'], ['year', 'Yearly'], ['all', 'All time']].map(([k, label]) => (
            <button key={k} className={mode === k ? 'on' : ''} onClick={() => changeMode(k)}>{label}</button>
          ))}
        </div>
      </div>

      {!hasPrices && (
        <p className="hint" style={{ background: '#FCF4E2', border: '1px solid var(--warn, #B07E28)', borderRadius: 8, padding: '9px 12px', color: '#7A5511', fontWeight: 600 }}>
          ⚠ No prices are set up yet, so revenue will read zero.
        </p>
      )}

      {mode !== 'all' && (
        <div className="card">
          <div className="ttl"><h2>{mode === 'month' ? 'Month' : 'Year'}</h2></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {(mode === 'month' ? months : years).map((k) => (
              <button key={k} className={'chip' + (periodKey === k ? ' on' : '')} onClick={() => setPeriodKey(k)}>
                {mode === 'month' ? monthLong(k) : k}
              </button>
            ))}
          </div>
        </div>
      )}

      {companies.length > 1 && (
        <div className="card">
          <div className="ttl"><h2>Company</h2></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <button className={'chip' + (co === 'all' ? ' on' : '')} onClick={() => { setCo('all'); setDrill(null) }}>All companies</button>
            {companies.map((c) => (
              <button key={c.key} className={'chip' + (co === c.key ? ' on' : '')} onClick={() => { setCo(c.key); setDrill(null) }}>{c.label}</button>
            ))}
          </div>
        </div>
      )}

      {drill && (
        <p className="hint" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 8, padding: '9px 12px' }}>
          Showing <b>{drillName}</b> only.{' '}
          <a style={{ color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setDrill(null)}>
            Back to everyone
          </a>
        </p>
      )}

      <div className="stat-row">
        <Stat label={`Revenue · ${periodLabel}`} value={gbp(revenue)}
          sub={prevRevenue != null ? deltaText(revenue, prevRevenue, mode) : `${scope.length} orders`} big />
        <Stat label="Orders" value={String(scope.length)} sub={`${dispatched.length} dispatched`} />
        <Stat label="Average order" value={gbp2(avg)} />
        <Stat label="Dispatched value" value={gbp(dispatchedRev)} sub={gbp(revenue - dispatchedRev) + ' still open'} />
        <Stat label={drill ? 'Products bought' : 'Customers'} value={String(drill ? products.length : customers.length)}
          sub={drill ? `${products.length} after merging` : 'with an order'} />
      </div>

      <div className="card">
        <div className="ttl">
          <h2>{mode === 'year' ? 'Revenue by year' : 'Revenue by month'}</h2>
          <span className="muted" style={{ fontSize: 12 }}>{mode === 'all' ? 'last 12 months' : 'the chosen period is highlighted'}</span>
        </div>
        <TrendChart points={trend} selected={periodKey} onPick={(k) => { if (mode !== 'all') setPeriodKey(k) }} />
      </div>

      {!drill && (
        <div className="card">
          <div className="ttl">
            <h2>Customers</h2>
            <span className="muted" style={{ fontSize: 12 }}>click one for its own breakdown</span>
          </div>
          {customers.length === 0 ? <div className="empty">Nothing in {periodLabel}.</div> : (
            <RankBars rows={customers.map((c) => ({ key: c.id, label: c.name, value: c.value, note: `${c.orders} order${c.orders === 1 ? '' : 's'}` }))}
              onPick={(id) => setDrill(id)} />
          )}
        </div>
      )}

      <div className="card">
        <div className="ttl">
          <h2>Products{drill ? ` — ${drillName}` : ''}</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {mergedCount > 0 ? `${mergedCount} name${mergedCount === 1 ? '' : 's'} merged automatically` : 'no duplicate names found'}
          </span>
        </div>
        {products.length === 0 ? <div className="empty">Nothing in {periodLabel}.</div> : (
          <RankBars
            rows={products.map((p) => ({
              key: p.key, label: p.label, value: p.value,
              merged: p.names.length > 1 ? p.names : null,
              split: splitKeys.has(p.key),
            }))}
            onSplit={toggleSplit}
          />
        )}
      </div>

      {drill && (
        <div className="card">
          <div className="ttl"><h2>{drillName} — orders in {periodLabel}</h2></div>
          <table className="tbl tbl-cards">
            <thead><tr><th>Date</th><th>Products</th><th>Status</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
            <tbody>
              {[...scope].sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => (
                <tr key={r.id}>
                  <td className="mono" data-label="Date">{r.date}</td>
                  <td data-label="Products">{r.lines.map((l) => l.name).join(', ') || '—'}</td>
                  <td data-label="Status">{r.status}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }} data-label="Value">{gbp2(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── little pieces ───────────────────────────────────────────────────────────
const monthShort = (k) => {
  const [y, m] = k.split('-')
  return `${MONTHS[+m - 1]} ${String(y).slice(2)}`
}
const monthLong = (k) => {
  const [y, m] = String(k || '').split('-')
  return y && m ? new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : k || ''
}
function deltaText(now, prev, mode) {
  const unit = mode === 'year' ? 'year' : 'month'
  if (!prev) return `nothing in the previous ${unit}`
  const d = ((now - prev) / prev) * 100
  const dir = d > 0.5 ? '▲' : d < -0.5 ? '▼' : '='
  return `${dir} ${Math.abs(d).toFixed(0)}% on the previous ${unit} (${gbp(prev)})`
}

function Stat({ label, value, sub, big }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={big ? { fontSize: 21 } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

// Revenue over time. One measure, one colour; the chosen period is the only
// thing picked out, and clicking a column selects that period.
function TrendChart({ points, selected, onPick }) {
  if (!points.length) return <div className="empty">Nothing to chart yet.</div>
  const max = Math.max(...points.map((p) => p.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 170, padding: '4px 0' }}>
      {points.map((p) => {
        const on = p.key === selected
        return (
          <button key={p.key} onClick={() => onPick?.(p.key)} title={`${p.label} · ${gbp(p.value)}`}
            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: onPick ? 'pointer' : 'default',
                     display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 4 }}>
            <div style={{ fontSize: 9.5, color: on ? 'var(--accent)' : 'var(--faint)', fontWeight: on ? 800 : 600, whiteSpace: 'nowrap' }}>
              {p.value ? gbp(p.value) : ''}
            </div>
            <div style={{
              height: `${Math.max((p.value / max) * 100, p.value ? 2 : 0.5)}%`,
              background: on ? 'var(--accent)' : 'var(--chip-bg)',
              borderRadius: '4px 4px 0 0', transition: 'background .15s',
            }} />
            <div style={{ fontSize: 10, color: on ? 'var(--accent)' : 'var(--muted)', fontWeight: on ? 800 : 500, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {p.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// Ranked bars. One measure across names, so every bar is the same colour —
// length already carries the value.
function RankBars({ rows, onPick, onSplit }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {rows.slice(0, 15).map((r) => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,30%) 1fr auto', gap: 10, alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <button
              onClick={() => onPick?.(r.key)}
              style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', font: 'inherit',
                       cursor: onPick ? 'pointer' : 'default', color: onPick ? 'var(--accent)' : 'var(--ink)',
                       fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
              title={r.merged ? r.merged.join('\n') : r.label}>
              {r.label}
            </button>
            {r.merged && (
              <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--chip-bg)', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }}
                title={`Merged from:\n${r.merged.join('\n')}`}>
                {r.merged.length} names
                <button onClick={() => onSplit?.(r.key)} title="Keep these names apart"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '0 0 0 4px', font: 'inherit' }}>✂</button>
              </span>
            )}
            {r.split && (
              <button onClick={() => onSplit?.(r.key)} title="Merge similar names again"
                style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--warn, #B07E28)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                kept apart · undo
              </button>
            )}
            {r.note && <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>{r.note}</div>}
          </div>
          <div style={{ background: 'var(--panel-2)', borderRadius: 4, height: 18 }}>
            <div style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%`, height: '100%', background: 'var(--accent)', borderRadius: '0 4px 4px 0' }} />
          </div>
          <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{gbp(r.value)}</div>
        </div>
      ))}
    </div>
  )
}
