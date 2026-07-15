'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { computeLine, PRICE_LEVELS, seasonalActive, parseTiers, resolveLinePpl, labelCount, normalizeStatus, STATUS_NEW, STATUS_DONE } from '@/lib/calc'
import PricingGuard from '@/app/(app)/PricingGuard'

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
          const ppl = seasonP != null
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

      const now = new Date()
      const thisMonthKey = `${now.getFullYear()}-${now.getMonth()}`
      const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastMonthKey = `${lastM.getFullYear()}-${lastM.getMonth()}`

      let totalRevenue = 0, dispatchedRevenue = 0, pipelineValue = 0
      let thisMonthRev = 0, lastMonthRev = 0
      const byMonth = {}            // 'YYYY-M' -> value
      const byCompany = {}          // lhId|'default' -> value
      // Per-company breakdowns for the toggleable panels — 'all' = overall.
      const custByCo = { all: {} }  // coKey -> { custId: value }
      const prodByCo = { all: {} }  // coKey -> { productName: value }
      const statusCount = { [STATUS_NEW]: 0, [STATUS_DONE]: 0 }

      for (const o of orders) {
        // Dispatched orders use their locked snapshot; the rest are pipeline.
        const dn = dnByOrder[o.id]
        const { total, byName } = dn ? lockedValue(dn) : estimateValue(o)
        totalRevenue += total
        if (dn) dispatchedRevenue += total
        else pipelineValue += total
        const st = normalizeStatus(o.status)
        statusCount[st] = (statusCount[st] || 0) + 1

        const d = new Date(o.order_date || o.created_at)
        const mk = `${d.getFullYear()}-${d.getMonth()}`
        byMonth[mk] = (byMonth[mk] || 0) + total
        if (mk === thisMonthKey) thisMonthRev += total
        if (mk === lastMonthKey) lastMonthRev += total

        const coKey = (o.customer_id && custLh[o.customer_id]) || 'default'
        byCompany[coKey] = (byCompany[coKey] || 0) + total
        if (!custByCo[coKey]) custByCo[coKey] = {}
        if (!prodByCo[coKey]) prodByCo[coKey] = {}
        if (o.customer_id) {
          custByCo.all[o.customer_id] = (custByCo.all[o.customer_id] || 0) + total
          custByCo[coKey][o.customer_id] = (custByCo[coKey][o.customer_id] || 0) + total
        }
        for (const [name, v] of Object.entries(byName)) {
          prodByCo.all[name] = (prodByCo.all[name] || 0) + v
          prodByCo[coKey][name] = (prodByCo[coKey][name] || 0) + v
        }
      }

      // Two revenue series: calendar year (Jan–Dec, default) and UK financial
      // year (Apr–Mar) — the chart toggles between them.
      function buildSeries(startYear, startMonth) {
        const series = []
        let total = 0
        for (let i = 0; i < 12; i++) {
          const dt = new Date(startYear, startMonth + i, 1)
          const mk = `${dt.getFullYear()}-${dt.getMonth()}`
          const v = byMonth[mk] || 0
          total += v
          series.push({ label: MONTHS[dt.getMonth()], year: dt.getFullYear(), value: v })
        }
        return { series, total }
      }
      const calYear = now.getFullYear()
      const cal = buildSeries(calYear, 0)
      const fyStartYear = now.getMonth() >= 3 ? calYear : calYear - 1
      const fy = buildSeries(fyStartYear, 3)
      const revenueViews = {
        cal: { label: String(calYear), name: 'Calendar year', series: cal.series, total: cal.total },
        fy: { label: `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`, name: 'Financial year', series: fy.series, total: fy.total },
      }

      // Top-8 lists per company key ('all' + each company with any revenue)
      const topCustomersBy = {}
      for (const [coKey, m] of Object.entries(custByCo)) {
        topCustomersBy[coKey] = Object.entries(m)
          .map(([id, v]) => ({ name: custName[id] || '—', value: v }))
          .sort((a, b) => b.value - a.value).slice(0, 8)
      }
      const topProductsBy = {}
      for (const [coKey, m] of Object.entries(prodByCo)) {
        topProductsBy[coKey] = Object.entries(m)
          .map(([name, v]) => ({ name: name || '—', value: v }))
          .sort((a, b) => b.value - a.value).slice(0, 8)
      }
      // Toggle options: Overall + every company that has revenue
      const coName = (coKey) => {
        const lh = coKey === 'default' ? defaultLh : lhById[coKey]
        return lh?.company || lh?.name || 'Unknown'
      }
      const companyOptions = [
        { key: 'all', label: 'Overall' },
        ...Object.keys(byCompany).sort((a, b) => byCompany[b] - byCompany[a]).map((coKey) => ({ key: coKey, label: coName(coKey) })),
      ]

      const companies = Object.entries(byCompany).map(([id, v]) => {
        const lh = id === 'default' ? defaultLh : lhById[id]
        return { name: lh?.company || lh?.name || 'Unknown', color: lh?.color || '#1FA86B', value: v }
      }).sort((a, b) => b.value - a.value)

      const orderCount = orders.length

      setData({
        totalRevenue, dispatchedRevenue, pipelineValue, orderCount,
        revenueViews, topCustomersBy, topProductsBy, companyOptions, companies,
        hasPrices: prices.length > 0,
      })
    })()
  }, [])

  return (
    <PricingGuard fallback={<div className="card"><div className="empty">This page is only available to admin logins.</div></div>}>
      {data === null ? (
        <div className="card"><div className="empty">Crunching the numbers…</div></div>
      ) : (
        <Dashboard d={data} />
      )}
    </PricingGuard>
  )
}

function Dashboard({ d }) {
  const [co, setCo] = useState('all') // company filter for the top panels
  const [revView, setRevView] = useState('cal') // 'cal' (default) | 'fy'
  const topCustomers = d.topCustomersBy[co] || d.topCustomersBy.all || []
  const topProducts = d.topProductsBy[co] || d.topProductsBy.all || []

  return (
    <div>
      <div className="card">
        <div className="ttl">
          <h2>Financial Dashboard</h2>
          <span className="muted" style={{ fontSize: 12 }}>All figures are the gross order total ex-VAT (products + delivery + labels) · dispatched orders use what was billed at the time; pipeline uses current prices</span>
        </div>
        {!d.hasPrices && (
          <p className="hint" style={{ color: 'var(--bad, #b3261e)' }}>
            No customer prices are set yet, so revenue figures will read £0. Add prices under Price Entry to populate this dashboard.
          </p>
        )}

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 6 }}>
          <Kpi label="Total revenue (ex VAT)" value={gbp(d.totalRevenue)} accent="#1FA86B" />
          <Kpi label="Dispatched revenue (ex VAT)" value={gbp(d.dispatchedRevenue)} accent="#197B55" />
          <Kpi label="Pipeline (ex VAT, not dispatched)" value={gbp(d.pipelineValue)} accent="#c2410c" />
          <Kpi label="Orders placed" value={d.orderCount.toLocaleString()} accent="#2d6cdf" />
        </div>
      </div>

      {/* Revenue — calendar year by default, toggleable to financial year */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ttl" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Revenue — {d.revenueViews[revView].label} <span style={{ color: 'var(--accent)', marginLeft: 8 }}>{gbp(d.revenueViews[revView].total)}</span></h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className={'chip' + (revView === 'cal' ? ' on' : '')} onClick={() => setRevView('cal')}>Calendar year</span>
            <span className={'chip' + (revView === 'fy' ? ' on' : '')} onClick={() => setRevView('fy')}>Financial year</span>
          </div>
        </div>
        <MonthBars series={d.revenueViews[revView].series} />
      </div>

      {/* Company toggle for the top-customer / top-product panels */}
      {d.companyOptions.length > 2 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {d.companyOptions.map((c) => (
            <span key={c.key} className={'chip' + (co === c.key ? ' on' : '')} onClick={() => setCo(c.key)}>{c.label}</span>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        {/* Top customers */}
        <div className="card" style={{ margin: 0 }}>
          <div className="ttl" style={{ marginBottom: 14 }}><h3 style={{ margin: 0 }}>Top customers{co !== 'all' ? ` — ${(d.companyOptions.find((c) => c.key === co) || {}).label}` : ''}</h3></div>
          <RankBars rows={topCustomers} color="#2d6cdf" />
        </div>
        {/* Top products */}
        <div className="card" style={{ margin: 0 }}>
          <div className="ttl" style={{ marginBottom: 14 }}><h3 style={{ margin: 0 }}>Top products by revenue{co !== 'all' ? ` — ${(d.companyOptions.find((c) => c.key === co) || {}).label}` : ''}</h3></div>
          <RankBars rows={topProducts} color="#7a5cff" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        {/* Revenue by company */}
        <div className="card" style={{ margin: 0 }}>
          <div className="ttl" style={{ marginBottom: 14 }}><h3 style={{ margin: 0 }}>Revenue by company</h3></div>
          {d.companies.length === 0 ? (
            <div className="empty">No data yet.</div>
          ) : (
            <RankBars rows={d.companies.map((c) => ({ name: c.name, value: c.value, color: c.color }))} color="#1FA86B" perRowColor />
          )}
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent, sub, subColor, small }) {
  return (
    <div style={{
      padding: small ? '4px 16px' : '6px 18px',
      borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: small ? 22 : 30, fontWeight: 800, color: 'var(--ink)', marginTop: 6, lineHeight: 1.1, fontFamily: 'var(--mono, monospace)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, fontWeight: 700, marginTop: 5, color: subColor || 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

function MonthBars({ series }) {
  const max = Math.max(1, ...series.map((s) => s.value))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'clamp(4px, 1.5vw, 14px)', height: 200, paddingTop: 20 }}>
      {series.map((s, i) => {
        const h = (s.value / max) * 100
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink)', marginBottom: 4, whiteSpace: 'nowrap' }}>
              {s.value > 0 ? gbp(s.value) : ''}
            </div>
            <div style={{
              width: '78%', height: `${h}%`, minHeight: s.value > 0 ? 3 : 0,
              background: 'linear-gradient(180deg, #2bc985 0%, #1FA86B 100%)',
              borderRadius: '5px 5px 0 0', transition: 'height 0.3s',
            }} />
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, fontWeight: 600 }}>{s.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function RankBars({ rows, color, perRowColor }) {
  if (!rows.length) return <div className="empty">No data yet.</div>
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {rows.map((r, i) => {
        const w = (r.value / max) * 100
        const c = perRowColor ? (r.color || color) : color
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 130, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</div>
            <div style={{ flex: 1, background: 'var(--panel-2)', borderRadius: 6, height: 22, position: 'relative', overflow: 'hidden' }}>
              <div style={{ width: `${w}%`, height: '100%', background: c, borderRadius: 6, minWidth: r.value > 0 ? 2 : 0, transition: 'width 0.3s' }} />
            </div>
            <div style={{ width: 72, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', fontFamily: 'monospace' }}>{gbp(r.value)}</div>
          </div>
        )
      })}
    </div>
  )
}
