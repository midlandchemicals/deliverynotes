'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { computeLine, PRICE_LEVELS } from '@/lib/calc'
import PricingGuard from '@/app/(app)/PricingGuard'

const VAT_RATE = 0.20

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
        supabase.from('customer_product_prices').select('customer_id, product_id, packaging_id, price_per_litre, delivery_charge, qty_tiers, tier_basis, price_trade, price_buyer_group, price_retail'),
        supabase.from('customers').select('id, name, default_letterhead_id, three_tier_pricing'),
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
      const tierMap = {}
      const basisMap = {}
      const levelMap = {}   // key -> { trade, buyer_group, retail }
      for (const p of prices) {
        const key = `${p.customer_id}::${p.product_id}::${p.packaging_id}`
        priceMap[key] = p.price_per_litre || 0
        basisMap[key] = p.tier_basis || 'line'
        levelMap[key] = { trade: p.price_trade, buyer_group: p.price_buyer_group, retail: p.price_retail }
        tierMap[key] = (Array.isArray(p.qty_tiers) ? p.qty_tiers : [])
          .map((t) => ({ from: Number(t.from) || 0, to: t.to == null || t.to === '' ? null : Number(t.to), ppl: Number(t.ppl) || 0 }))
          .filter((t) => t.ppl > 0)
          .sort((a, b) => a.from - b.from)
      }
      const custThreeTier = Object.fromEntries(customers.map((c) => [c.id, !!c.three_tier_pricing]))
      const levelCol = (lvl) => (PRICE_LEVELS.find((l) => l.key === lvl) || PRICE_LEVELS[0]).col
      // Effective £/litre for a customer/product/packaging at a given pack qty,
      // matching the order page: a tier band overrides the base when qty fits.
      function pplFor(key, qty) {
        const tiers = tierMap[key] || []
        const hit = tiers.find((t) => qty >= t.from && (t.to == null || qty <= t.to))
        return hit ? hit.ppl : (priceMap[key] || 0)
      }
      const custName = Object.fromEntries(customers.map((c) => [c.id, c.name]))
      const custLh = Object.fromEntries(customers.map((c) => [c.id, c.default_letterhead_id || null]))
      const lhById = Object.fromEntries(letterheads.map((l) => [l.id, l]))
      const defaultLh = letterheads.find((l) =>
        l.name.toLowerCase().includes('midland') || l.company.toLowerCase().includes('midland')
      ) || letterheads[0] || { company: 'Midland Chemicals', color: '#1FA86B' }

      // Locked value from a dispatch-note snapshot — what the order was billed.
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
          const q = basisMap[key] === 'order' ? combined : c.qty
          // 3-tier customers price by buyer level; others use quantity tiers.
          const lvlPrice = threeTier ? levelMap[key]?.[lvlCol] : null
          const ppl = threeTier ? (lvlPrice != null ? lvlPrice : (priceMap[key] || 0)) : pplFor(key, q)
          const lineVal = ppl * (c.vol || 0) * c.qty
          total += lineVal
          byName[c.productName] = (byName[c.productName] || 0) + lineVal
        }
        return { total, byName }
      }

      const now = new Date()
      const thisMonthKey = `${now.getFullYear()}-${now.getMonth()}`
      const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastMonthKey = `${lastM.getFullYear()}-${lastM.getMonth()}`

      let totalRevenue = 0, dispatchedRevenue = 0, pipelineValue = 0
      let thisMonthRev = 0, lastMonthRev = 0
      const byMonth = {}            // 'YYYY-M' -> value
      const byCustomer = {}        // custId -> value
      const byProductTotal = {}    // productName -> value
      const byCompany = {}         // lhId|'default' -> value
      const statusCount = { 'New': 0, 'In progress': 0, 'Delivery Note Generated': 0 }

      for (const o of orders) {
        // Dispatched orders use their locked snapshot; the rest are pipeline.
        const dn = dnByOrder[o.id]
        const { total, byName } = dn ? lockedValue(dn) : estimateValue(o)
        totalRevenue += total
        if (dn) dispatchedRevenue += total
        else pipelineValue += total
        statusCount[o.status] = (statusCount[o.status] || 0) + 1

        const d = new Date(o.order_date || o.created_at)
        const mk = `${d.getFullYear()}-${d.getMonth()}`
        byMonth[mk] = (byMonth[mk] || 0) + total
        if (mk === thisMonthKey) thisMonthRev += total
        if (mk === lastMonthKey) lastMonthRev += total

        if (o.customer_id) byCustomer[o.customer_id] = (byCustomer[o.customer_id] || 0) + total
        for (const [name, v] of Object.entries(byName)) byProductTotal[name] = (byProductTotal[name] || 0) + v

        const lhId = (o.customer_id && custLh[o.customer_id]) || 'default'
        byCompany[lhId] = (byCompany[lhId] || 0) + total
      }

      // Build last-12-months series
      const monthSeries = []
      for (let i = 11; i >= 0; i--) {
        const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const mk = `${dt.getFullYear()}-${dt.getMonth()}`
        monthSeries.push({ label: MONTHS[dt.getMonth()], year: dt.getFullYear(), value: byMonth[mk] || 0 })
      }

      const topCustomers = Object.entries(byCustomer)
        .map(([id, v]) => ({ name: custName[id] || '—', value: v }))
        .sort((a, b) => b.value - a.value).slice(0, 8)

      const topProducts = Object.entries(byProductTotal)
        .map(([name, v]) => ({ name: name || '—', value: v }))
        .sort((a, b) => b.value - a.value).slice(0, 8)

      const companies = Object.entries(byCompany).map(([id, v]) => {
        const lh = id === 'default' ? defaultLh : lhById[id]
        return { name: lh?.company || lh?.name || 'Unknown', color: lh?.color || '#1FA86B', value: v }
      }).sort((a, b) => b.value - a.value)

      const orderCount = orders.length
      const avgOrder = orderCount ? totalRevenue / orderCount : 0
      const vatCollected = totalRevenue * VAT_RATE

      setData({
        totalRevenue, dispatchedRevenue, pipelineValue, orderCount, avgOrder, vatCollected,
        thisMonthRev, lastMonthRev, monthSeries, topCustomers, topProducts, companies, statusCount,
        hasPrices: prices.length > 0,
      })
    })()
  }, [])

  return (
    <PricingGuard>
      {data === null ? (
        <div className="card"><div className="empty">Crunching the numbers…</div></div>
      ) : (
        <Dashboard d={data} />
      )}
    </PricingGuard>
  )
}

function Dashboard({ d }) {
  const momDelta = d.lastMonthRev > 0 ? ((d.thisMonthRev - d.lastMonthRev) / d.lastMonthRev) * 100 : null

  return (
    <div>
      <div className="card">
        <div className="ttl">
          <h2>Financial Dashboard</h2>
          <span className="muted" style={{ fontSize: 12 }}>All figures ex-VAT · dispatched orders use the price billed at the time; pipeline uses current prices</span>
        </div>
        {!d.hasPrices && (
          <p className="hint" style={{ color: 'var(--bad, #b3261e)' }}>
            No customer prices are set yet, so revenue figures will read £0. Add prices under Price Entry to populate this dashboard.
          </p>
        )}

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 6 }}>
          <Kpi label="Total revenue" value={gbp(d.totalRevenue)} accent="#1FA86B" />
          <Kpi label="Orders placed" value={d.orderCount.toLocaleString()} accent="#2d6cdf" />
          <Kpi label="Average order" value={gbp(d.avgOrder)} accent="#7a5cff" />
          <Kpi
            label="This month"
            value={gbp(d.thisMonthRev)}
            accent="#e0892b"
            sub={momDelta === null ? null : `${momDelta >= 0 ? '▲' : '▼'} ${Math.abs(momDelta).toFixed(0)}% vs last month`}
            subColor={momDelta >= 0 ? '#1FA86B' : '#b3261e'}
          />
        </div>

        {/* Secondary KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 14 }}>
          <Kpi label="Dispatched revenue" value={gbp(d.dispatchedRevenue)} accent="#197B55" small />
          <Kpi label="Pipeline (not dispatched)" value={gbp(d.pipelineValue)} accent="#c2410c" small />
          <Kpi label="VAT @ 20%" value={gbp(d.vatCollected)} accent="#5C6B82" small />
          <Kpi label="Inc. VAT total" value={gbp(d.totalRevenue * 1.2)} accent="#16294F" small />
        </div>
      </div>

      {/* Revenue by month */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ttl" style={{ marginBottom: 16 }}><h3 style={{ margin: 0 }}>Revenue — last 12 months</h3></div>
        <MonthBars series={d.monthSeries} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        {/* Top customers */}
        <div className="card" style={{ margin: 0 }}>
          <div className="ttl" style={{ marginBottom: 14 }}><h3 style={{ margin: 0 }}>Top customers</h3></div>
          <RankBars rows={d.topCustomers} color="#2d6cdf" />
        </div>
        {/* Top products */}
        <div className="card" style={{ margin: 0 }}>
          <div className="ttl" style={{ marginBottom: 14 }}><h3 style={{ margin: 0 }}>Top products by revenue</h3></div>
          <RankBars rows={d.topProducts} color="#7a5cff" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        {/* Status donut */}
        <div className="card" style={{ margin: 0 }}>
          <div className="ttl" style={{ marginBottom: 14 }}><h3 style={{ margin: 0 }}>Orders by status</h3></div>
          <StatusDonut counts={d.statusCount} />
        </div>
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
      borderRadius: 14, padding: small ? '14px 16px' : '18px 20px',
      background: 'var(--panel)', border: '1px solid var(--border)',
      borderLeft: `4px solid ${accent}`,
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

function StatusDonut({ counts }) {
  const segs = [
    { label: 'New', value: counts['New'] || 0, color: '#2d6cdf' },
    { label: 'In progress', value: counts['In progress'] || 0, color: '#e0892b' },
    { label: 'Generated', value: counts['Delivery Note Generated'] || 0, color: '#1FA86B' },
  ]
  const total = segs.reduce((s, x) => s + x.value, 0)
  const R = 60, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={R} fill="none" stroke="var(--panel-2)" strokeWidth="22" />
        {total > 0 && segs.map((s, i) => {
          if (!s.value) return null
          const len = (s.value / total) * C
          const el = (
            <circle key={i} cx="75" cy="75" r={R} fill="none" stroke={s.color} strokeWidth="22"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 75 75)" />
          )
          offset += len
          return el
        })}
        <text x="75" y="71" textAnchor="middle" fontSize="26" fontWeight="800" fill="var(--ink)">{total}</text>
        <text x="75" y="90" textAnchor="middle" fontSize="11" fill="var(--muted)">orders</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 13, height: 13, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{s.label}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700, marginLeft: 4 }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
