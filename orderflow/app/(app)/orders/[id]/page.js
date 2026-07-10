'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { computeLine, docTotals, fmt, prettyDate, splitContact, labelCount, PRICE_LEVELS, seasonalActive } from '@/lib/calc'
import { generateDispatchPDF, generateOfficeCopyPDF, reprintPDF } from '@/lib/pdf'
import PricingGuard, { usePricingCheck } from '@/app/(app)/PricingGuard'
import { StatusBadge } from '../page'
import LineEditor from '../LineEditor'

const STATUS_FLOW = ['New', 'In progress', 'Delivery Note Generated']

// Build the productId::packagingId -> £/litre map for the active buyer level.
// For 3-tier customers, read the level's column (falling back to price_per_litre).
function buildPriceMap(rows, level, threeTier) {
  const col = (PRICE_LEVELS.find((l) => l.key === level) || PRICE_LEVELS[0]).col
  const map = {}
  for (const r of rows) {
    const key = `${r.product_id}::${r.packaging_id}`
    const v = threeTier ? (r[col] != null ? r[col] : r.price_per_litre) : r.price_per_litre
    map[key] = v || 0
  }
  return map
}

export default function OrderDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = createClient()

  const [order, setOrder] = useState(null)
  const [products, setProducts] = useState([])
  const [packaging, setPackaging] = useState([])
  const [letterheads, setLetterheads] = useState([])
  const [lines, setLines] = useState([])
  const [dispatched, setDispatched] = useState([])

  // pricing: { [productId::packagingId]: pricePerLitre } — base/fallback price
  const [prices, setPrices] = useState({})
  // quantity-break tiers: { [productId::packagingId]: [{from,to,ppl}] }
  const [priceTiers, setPriceTiers] = useState({})
  // tier basis per price row: { [productId::packagingId]: 'line' | 'order' }
  const [tierBasis, setTierBasis] = useState({})
  // seasonal pricing: { [productId::packagingId]: { from, to, ppl } }
  const [seasonMap, setSeasonMap] = useState({})
  // 3-tier buyer pricing
  const [customerThreeTier, setCustomerThreeTier] = useState(false)
  const [priceLevel, setPriceLevel] = useState('trade')
  const [priceRowsRaw, setPriceRowsRaw] = useState([])
  const [deliveryCharge, setDeliveryCharge] = useState('')
  const [labelPriceRaw, setLabelPriceRaw] = useState('')  // raw string while editing
  const labelPrice = parseFloat(labelPriceRaw) || 0

  // dispatch panel state
  const [lhIndex, setLhIndex] = useState(0)
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceTo, setInvoiceTo] = useState('')
  const [options, setOptions] = useState('')
  const [pallets, setPallets] = useState('')
  const [noPallets, setNoPallets] = useState(false)
  const [palletsFlash, setPalletsFlash] = useState(false)
  const [showHazard, setShowHazard] = useState(true)
  const [batchModal, setBatchModal] = useState(null) // null | [{ name, batch, na }]
  const [busy, setBusy] = useState(false)

  const [availableByProduct, setAvailableByProduct] = useState({}) // productId -> [packagingId] from price list
  const [custDeliveryTiers, setCustDeliveryTiers] = useState([])
  const [custFreeAbove, setCustFreeAbove] = useState(0)
  const [custPerPallet, setCustPerPallet] = useState(0)          // customer £/pallet base rate
  const [perPalletByKey, setPerPalletByKey] = useState({})       // { key: £/pallet } per-product override
  const [unpricedItems, setUnpricedItems] = useState([]) // lines missing a price for this customer
  const [unpricedModal, setUnpricedModal] = useState(null) // currently open item
  const [unpricedPackPrice, setUnpricedPackPrice] = useState('')

  useEffect(() => {
    (async () => {
      const [o, p, k, lh] = await Promise.all([
        supabase.from('orders').select('*').eq('id', id).single(),
        supabase.from('products').select('*').order('name'),
        supabase.from('packaging').select('*').order('volume'),
        supabase.from('letterheads').select('*').order('name'),
      ])
      const lhData = lh.data || []
      setOrder(o.data); setProducts(p.data || []); setPackaging(k.data || []); setLetterheads(lhData)
      setLines(o.data?.lines || [])

      // Default to Midland Chem letterhead if it exists
      const midlandIdx = lhData.findIndex(
        (l) => l.name.toLowerCase().includes('midland') || l.company.toLowerCase().includes('midland')
      )
      setLhIndex(midlandIdx >= 0 ? midlandIdx : 0)
      // Strip any contact lines so the Invoice To box never carries
      // tel / email / contact name
      setInvoiceTo(splitContact(o.data?.customer_snapshot?.details || '').address)

      const existing = await supabase.from('dispatch_notes').select('*').eq('order_id', id).order('created_at', { ascending: false })
      setDispatched(existing.data || [])

      if (o.data?.customer_id) {
        const [priceData, custData, tiersData] = await Promise.all([
          supabase.from('customer_product_prices')
            .select('product_id, packaging_id, price_per_litre, delivery_charge, delivery_per_pallet, qty_tiers, tier_basis, price_trade, price_buyer_group, price_retail, season_from, season_to, season_ppl').eq('customer_id', o.data.customer_id),
          supabase.from('customers').select('label_price, default_delivery_charge, free_delivery_above, delivery_per_pallet, default_letterhead_id, three_tier_pricing').eq('id', o.data.customer_id).single(),
          supabase.from('customer_delivery_tiers').select('*').eq('customer_id', o.data.customer_id).order('pallets_from'),
        ])
        const priceRows = priceData.data || []
        const orderLines = o.data?.lines || []
        // Map of which packaging sizes exist per product for this customer
        const availMap = {}
        for (const r of priceRows) {
          if (!availMap[r.product_id]) availMap[r.product_id] = []
          if (!availMap[r.product_id].includes(r.packaging_id)) availMap[r.product_id].push(r.packaging_id)
        }
        setAvailableByProduct(availMap)
        const threeTier = !!custData.data?.three_tier_pricing
        const initialLevel = o.data?.price_level || 'trade'
        setCustomerThreeTier(threeTier)
        setPriceLevel(initialLevel)
        setPriceRowsRaw(priceRows)
        if (priceRows.length) {
          setPrices(buildPriceMap(priceRows, initialLevel, threeTier))
          setPriceTiers(Object.fromEntries(priceRows.map((r) => [
            `${r.product_id}::${r.packaging_id}`,
            (Array.isArray(r.qty_tiers) ? r.qty_tiers : [])
              .map((t) => ({ from: Number(t.from) || 0, to: t.to == null || t.to === '' ? null : Number(t.to), ppl: Number(t.ppl) || 0 }))
              .filter((t) => t.ppl > 0)
              .sort((a, b) => a.from - b.from),
          ])))
          setTierBasis(Object.fromEntries(priceRows.map((r) => [`${r.product_id}::${r.packaging_id}`, r.tier_basis || 'line'])))
          setSeasonMap(Object.fromEntries(priceRows
            .filter((r) => r.season_from && r.season_to && r.season_ppl != null)
            .map((r) => [`${r.product_id}::${r.packaging_id}`, { from: r.season_from, to: r.season_to, ppl: Number(r.season_ppl) || 0 }])))
          // Auto-fill delivery charge from products in this order
          const autoDelivery = priceRows.reduce((sum, r) => {
            const inOrder = orderLines.some((l) => l.productId === r.product_id && l.packagingId === r.packaging_id)
            return sum + (inOrder ? (r.delivery_charge || 0) : 0)
          }, 0)
          if (autoDelivery > 0) setDeliveryCharge(autoDelivery.toFixed(2))
          else if ((custData.data?.default_delivery_charge || 0) > 0)
            setDeliveryCharge(Number(custData.data.default_delivery_charge).toFixed(2))
        } else if ((custData.data?.default_delivery_charge || 0) > 0) {
          setDeliveryCharge(Number(custData.data.default_delivery_charge).toFixed(2))
        }
        setPerPalletByKey(Object.fromEntries(priceRows
          .filter((r) => (r.delivery_per_pallet || 0) > 0)
          .map((r) => [`${r.product_id}::${r.packaging_id}`, Number(r.delivery_per_pallet) || 0])))
        setCustPerPallet(Number(custData.data?.delivery_per_pallet) || 0)
        setLabelPriceRaw(String(custData.data?.label_price || ''))
        setCustFreeAbove(custData.data?.free_delivery_above || 0)
        setCustDeliveryTiers(tiersData.data || [])
        // Override letterhead if customer has a default set
        const custLhId = custData.data?.default_letterhead_id
        if (custLhId) {
          const custLhIdx = lhData.findIndex((l) => l.id === custLhId)
          if (custLhIdx >= 0) setLhIndex(custLhIdx)
        }
        // Detect order lines with no price for this customer
        const seenKeys = new Set()
        const unpricedList = []
        for (const l of orderLines) {
          const c = computeLine(l, p.data || [], k.data || [])
          if (!c.product || !c.packaging) continue
          const key = `${c.product.id}::${c.packaging.id}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
          const hasPrice = priceRows.some(
            (r) => r.product_id === c.product.id && r.packaging_id === c.packaging.id && r.price_per_litre > 0
          )
          if (!hasPrice) {
            unpricedList.push({
              productId: c.product.id, packagingId: c.packaging.id,
              productName: c.productName, packagingName: c.packaging.name, vol: c.vol || 0,
            })
          }
        }
        if (unpricedList.length > 0) {
          const productIds = [...new Set(unpricedList.map((u) => u.productId))]
          const { data: othersData } = await supabase
            .from('customer_product_prices')
            .select('product_id, packaging_id, price_per_litre, customers(name)')
            .in('product_id', productIds)
            .neq('customer_id', o.data.customer_id)
            .gt('price_per_litre', 0)
          setUnpricedItems(unpricedList.map((u) => ({
            ...u,
            otherPrices: (othersData || [])
              .filter((r) => r.product_id === u.productId && r.packaging_id === u.packagingId)
              .map((r) => ({ customerName: r.customers?.name || 'Other customer', price_per_litre: r.price_per_litre })),
          })))
        }
      }
    })()
  }, [id])

  async function setStatus(status) {
    await supabase.from('orders').update({ status }).eq('id', id)
    setOrder({ ...order, status })
  }

  async function saveLines() {
    await supabase.from('orders').update({ lines }).eq('id', id)
    setOrder({ ...order, lines })
    toast('Products saved')
  }

  // The DB column the order's current buyer level writes to.
  function levelCol() {
    return (PRICE_LEVELS.find((l) => l.key === priceLevel) || PRICE_LEVELS[0]).col
  }

  // Switch buyer level: re-price every line and remember the choice on the order.
  function changeLevel(lvl) {
    setPriceLevel(lvl)
    setPrices(buildPriceMap(priceRowsRaw, lvl, customerThreeTier))
    if (order?.id) supabase.from('orders').update({ price_level: lvl }).eq('id', order.id)
  }

  // Build the price columns to upsert — includes the active level for 3-tier.
  function priceUpsertCols(ppl) {
    const cols = { price_per_litre: ppl }
    if (customerThreeTier) {
      cols[levelCol()] = ppl
      if (priceLevel === 'trade') cols.price_per_litre = ppl
    }
    return cols
  }

  async function saveUnpricedPrice(ppl) {
    const item = unpricedModal
    if (!item || !order?.customer_id || ppl <= 0) return
    await supabase.from('customer_product_prices').upsert(
      { customer_id: order.customer_id, product_id: item.productId, packaging_id: item.packagingId, ...priceUpsertCols(ppl), delivery_charge: 0, updated_at: new Date().toISOString() },
      { onConflict: 'customer_id,product_id,packaging_id', ignoreDuplicates: false }
    )
    setPrices((prev) => ({ ...prev, [`${item.productId}::${item.packagingId}`]: ppl }))
    setUnpricedItems((prev) => prev.filter((u) => !(u.productId === item.productId && u.packagingId === item.packagingId)))
    setUnpricedModal(null)
    setUnpricedPackPrice('')
    toast(`Price saved for ${item.productName}`)
  }

  async function savePrice(productId, packagingId, price) {
    if (!order?.customer_id) return
    await supabase.from('customer_product_prices').upsert(
      { customer_id: order.customer_id, product_id: productId, packaging_id: packagingId, ...priceUpsertCols(price), updated_at: new Date().toISOString() },
      { onConflict: 'customer_id,product_id,packaging_id', ignoreDuplicates: false }
    )
  }

  // Combined pack qty across every line whose price row is in 'order' (combined)
  // mode — this is the "mix of products" total that picks the band for them.
  function combinedSchemeQty() {
    return lines.reduce((sum, l) => {
      const c = computeLine(l, products, packaging)
      if (!c.product || !c.packaging) return sum
      const key = `${c.product.id}::${c.packaging.id}`
      return tierBasis[key] === 'order' ? sum + (c.qty || 0) : sum
    }, 0)
  }

  // Active seasonal £/litre for a price row, if the order's placement date falls
  // inside its recurring window. Returns null when no seasonal price applies.
  function seasonalPpl(key) {
    const s = seasonMap[key]
    if (!s) return null
    return seasonalActive(s.from, s.to, order?.order_date) ? s.ppl : null
  }

  // Effective £/litre for a line. Seasonal price wins; otherwise quantity-break
  // tiers (line or combined basis); otherwise the base/level price.
  function pplFor(productId, packagingId, lineQty) {
    const key = `${productId}::${packagingId}`
    const season = seasonalPpl(key)
    if (season != null) return season
    const base = parseFloat(prices[key]) || 0
    const tiers = priceTiers[key] || []
    const q = tierBasis[key] === 'order' ? combinedSchemeQty() : (parseFloat(lineQty) || 0)
    const hit = tiers.find((t) => q >= t.from && (t.to == null || q <= t.to))
    return hit ? hit.ppl : base
  }

  function printOfficeCopy(d) {
    const unpriced = lines.filter((l) => {
      const c = computeLine(l, products, packaging)
      return (parseFloat(prices[`${c.product?.id}::${c.packaging?.id}`]) || 0) === 0
    })
    if (unpriced.length > 0) {
      const names = unpriced.map((l) => computeLine(l, products, packaging).productName).join(', ')
      toast(`No price set for: ${names}`)
      return
    }
    const lh = letterheads[lhIndex]
    const batches = (d.lines_snapshot || []).map((s) => s.batch || '')
    const doc_ = {
      docNo: d.doc_no, date: d.doc_date,
      orderDate: order.order_date || null,
      invoiceTo: d.customer, deliver: d.deliver,
      contact: d.totals?.contact,
      customerName: order.customer_snapshot?.name || '',
      lines, options: d.options,
      pallets: d.totals?.pallets || 0, batches,
    }
    // Use the delivery charge stored ON this note (its snapshot), not the live
    // field — the live field may have changed since the note was generated.
    const snapDelivery = Number(d.totals?.delivery_charge || 0)
    generateOfficeCopyPDF(doc_, lh, products, packaging, prices, snapDelivery, labelTotal, priceTiers, tierBasis, seasonMap)
  }

  function printNote() {
    const items = lines.map((l) => {
      const c = computeLine(l, products, packaging)
      return { name: c.productName, qty: c.qty, pack: c.packaging?.name || '' }
    })
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${order.order_no}</title>
<style>
@page{size:80mm auto;margin:4mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:13pt;color:#000;background:#fff;width:72mm}
.dn{font-size:15pt;font-weight:700;border-bottom:2px solid #000;padding-bottom:2.5mm;margin-bottom:3mm}
.cust{font-size:18pt;font-weight:700;margin-bottom:3mm;line-height:1.2}
.dates{font-size:11pt;margin-bottom:4mm;line-height:1.6}
.ph{font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
    border-bottom:1px solid #000;padding-bottom:1mm;margin-bottom:2.5mm}
ul{list-style:disc;padding-left:5mm}
li{font-size:13pt;margin-bottom:2.5mm;line-height:1.3}
b{font-weight:700}
</style>
</head><body>
<div class="dn">${order.order_no}</div>
<div class="cust">${order.customer_snapshot?.name || ''}</div>
<div class="dates">
  <div>Ordered: <b>${prettyDate(order.order_date)}</b></div>
  ${order.requested_date ? `<div>Required: <b>${prettyDate(order.requested_date)}</b></div>` : ''}
</div>
<div class="ph">Products</div>
<ul>
${items.map((it) => `  <li>${it.name}${it.pack ? ` — ${it.qty} x ${it.pack}` : ` (qty ${it.qty})`}</li>`).join('\n')}
</ul>
</body></html>`
    const w = window.open('', '_blank', 'width=420,height=600')
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  // Per-pallet delivery, summed per product: each line is charged its own
  // per-pallet rate (the product override, else the customer's base rate) ×
  // the line's pack/IBC quantity. So products without their own rate fall back
  // to the customer tab rate, and each product keeps its own.
  function hasPerPalletPricing() {
    if ((custPerPallet || 0) > 0) return true
    return lines.some((l) => (perPalletByKey[`${l.productId}::${l.packagingId}`] || 0) > 0)
  }
  function perPalletDeliveryTotal() {
    return lines.reduce((sum, l) => {
      const c = computeLine(l, products, packaging)
      if (!c.product || !c.packaging) return sum
      // Only IBC-sized packs (>500 L, i.e. 600 L and 1000 L) count as 1 pallet
      // each. Smaller packs don't add a per-pallet charge.
      if ((c.vol || 0) <= 500) return sum
      const key = `${c.product.id}::${c.packaging.id}`
      const rate = (perPalletByKey[key] || 0) > 0 ? perPalletByKey[key] : (custPerPallet || 0)
      return sum + rate * (c.qty || 0)
    }, 0)
  }

  // Step 1 — validate, then open the batch-number modal
  // Re-evaluate delivery charge whenever anything that affects it changes.
  // Priority: free-delivery threshold (£0) > per-pallet rate (× pallets) > banded tiers.
  useEffect(() => {
    const usePerPallet = hasPerPalletPricing()
    if (!custFreeAbove && !custDeliveryTiers.length && !usePerPallet) return
    const subtotal = lines.reduce((sum, l) => {
      const c = computeLine(l, products, packaging)
      const ppl = pplFor(c.product?.id, c.packaging?.id, c.qty)
      return sum + ppl * (c.vol || 0) * c.qty
    }, 0)
    // Free-delivery threshold takes highest priority
    if (custFreeAbove > 0 && subtotal >= custFreeAbove) {
      setDeliveryCharge('0.00')
      return
    }
    // Per-pallet rate, summed per product (wins over banded tiers when set)
    if (!noPallets && usePerPallet) {
      setDeliveryCharge(perPalletDeliveryTotal().toFixed(2))
      return
    }
    // Pallet tier — runs even before pallet count is entered (p=0 matches a "0 to X" band)
    if (!noPallets && custDeliveryTiers.length > 0) {
      const p = parseInt(pallets) || 0
      const tier = [...custDeliveryTiers]
        .sort((a, b) => a.pallets_from - b.pallets_from)
        .find((t) => p >= t.pallets_from && (t.pallets_to == null || p < t.pallets_to))
      if (tier != null) setDeliveryCharge(Number(tier.charge).toFixed(2))
      else setDeliveryCharge('')
    }
  }, [custFreeAbove, custDeliveryTiers, custPerPallet, perPalletByKey, pallets, noPallets, lines, prices, priceTiers, tierBasis])

  function startDispatch() {
    const lh = letterheads[lhIndex]
    if (!lh) { alert('Add a letterhead first (Letterheads tab).'); return }
    if (!noPallets && (!pallets || parseInt(pallets, 10) <= 0)) {
      setPalletsFlash(true)
      setTimeout(() => setPalletsFlash(false), 1200)
      toast('Please enter number of pallets, or tick "No pallets"')
      return
    }
    // Warn if any hazmat product has not been verified against its SDS
    const unverifiedNames = lines.reduce((acc, l) => {
      const p = products.find((x) => x.id === l.productId)
      if (p?.un_number && !p?.adr_verified_by) acc.push(p.name)
      return acc
    }, [])
    if (unverifiedNames.length > 0) {
      const list = unverifiedNames.map((n) => `• ${n}`).join('\n')
      if (!confirm(`The following hazmat products have not been verified against their SDS:\n\n${list}\n\nADR hazard notation may be incomplete. Proceed anyway?`)) return
    }
    const rows = lines.map((l) => {
      const c = computeLine(l, products, packaging)
      return { name: c.packaging?.name ? `${c.productName} — ${c.qty} x ${c.packaging.name}` : c.productName, batch: '', na: false }
    })
    setBatchModal(rows)
  }

  function setBatchRow(i, patch) {
    setBatchModal((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  // Step 2 — every line must have a batch number OR be marked Not Applicable
  async function confirmDispatch() {
    const incomplete = batchModal.some((r) => !r.na && !r.batch.trim())
    if (incomplete) { toast('Enter a batch number or tick Not Applicable for each product'); return }
    setBusy(true)
    const lh = letterheads[lhIndex]
    const docNo = order.order_no
    const contact = orderContact(order)
    const batches = batchModal.map((r) => (r.na ? 'N/A' : r.batch.trim()))
    const docData = {
      type: 'Delivery Note', docNo, date: docDate,
      orderDate: order.order_date || null,
      invoiceTo,
      deliver: splitContact(order.customer_snapshot?.deliver || '').address,
      contact,
      customerName: order.customer_snapshot?.name || '',
      lines, options, pallets: noPallets ? 0 : pallets, showHazard, batches,
      deliveryCharge: parseFloat(deliveryCharge) || 0,
    }
    const { totals } = generateDispatchPDF(docData, lh, products, packaging, prices)
    const linesSnap = lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      const ppl = pplFor(c.product?.id, c.packaging?.id, c.qty)
      const unitPrice = ppl * (c.vol || 0)
      return {
        productName: c.productName, pg: c.pg, un_number: c.un_number,
        hazard: c.hazard, psn: c.psn, packDesc: c.packDesc, packQty: c.packQty,
        adr_transport_cat: c.product?.adr_transport_cat || '', batch: batches[i],
        vol: c.totalVol, net: c.net, gross: c.gross,
        price_per_litre: ppl, unit_price: unitPrice, line_total: unitPrice * c.qty,
      }
    })
    const orderTotal = linesSnap.reduce((s, l) => s + (l.line_total || 0), 0)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('dispatch_notes').insert({
      doc_no: docNo, doc_type: 'Delivery Note', doc_date: docDate, order_id: id,
      letterhead_snapshot: lh, customer: invoiceTo, deliver: docData.deliver,
      lines_snapshot: linesSnap, totals: { ...totals, contact, order_total: orderTotal, delivery_charge: parseFloat(deliveryCharge) || 0 }, options, created_by: user?.id || null,
    })
    await supabase.from('orders').update({ status: 'Delivery Note Generated' }).eq('id', id)
    setOrder({ ...order, status: 'Delivery Note Generated' })
    const refreshed = await supabase.from('dispatch_notes').select('*').eq('order_id', id).order('created_at', { ascending: false })
    setDispatched(refreshed.data || [])
    setPallets('')
    setNoPallets(false)
    setBatchModal(null)
    setBusy(false)
    toast('Delivery note generated')
  }

  // Remove a generated delivery-note copy (e.g. a mistaken regenerate). Deletes
  // it from this order and from the Delivery Notes library.
  async function deleteDispatchNote(d) {
    const when = d.created_at ? new Date(d.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : ''
    if (!confirm(`Delete this delivery-note copy${when ? ` (generated ${when})` : ''}? It will be removed from this order and the Delivery Notes library. This cannot be undone.`)) return
    await supabase.from('dispatch_notes').delete().eq('id', d.id)
    const next = dispatched.filter((x) => x.id !== d.id)
    setDispatched(next)
    // If that was the last copy, drop the order back out of "generated" status
    if (next.length === 0) {
      await supabase.from('orders').update({ status: 'In progress' }).eq('id', id)
      setOrder((o) => ({ ...o, status: 'In progress' }))
    }
    toast('Delivery note deleted')
  }

  const { guard: pricingGuard, ModalUI: PricingModal } = usePricingCheck()

  if (!order) return <div className="card"><div className="empty">Loading…</div></div>

  const totals = docTotals(lines, products, packaging)

  const orderTotal = lines.reduce((sum, l) => {
    const c = computeLine(l, products, packaging)
    const ppl = pplFor(c.product?.id, c.packaging?.id, c.qty)
    return sum + ppl * (c.vol || 0) * c.qty
  }, 0)

  const labelTotal = labelPrice > 0
    ? lines.reduce((sum, l) => sum + labelCount(l, products, packaging) * labelPrice, 0)
    : 0

  return (
    <div>
      <div className="card">
        <div className="ttl">
          <h2>{order.order_no} <StatusBadge status={order.status} /></h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-g btn-sm" onClick={printNote}>🖨 Print note</button>
            <button className="btn btn-g btn-sm" onClick={() => router.push('/orders')}>← Back to log</button>
          </div>
        </div>
        <div className="row c3">
          <Info label="Customer" value={order.customer_snapshot?.name} />
          <Info label="Customer Order Number" value={order.po_ref || '—'} />
          <Info label="Ordered" value={prettyDate(order.order_date)} />
        </div>
        <div className="row c2" style={{ marginTop: 4 }}>
          <div className="field"><label>Invoice to</label>
            <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit' }}>{splitContact(order.customer_snapshot?.details || '').address}</div></div>
          <div className="field"><label>Deliver to</label>
            <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit' }}>{splitContact(order.customer_snapshot?.deliver || '').address}</div>
            {contactLines(orderContact(order)).length > 0 && (
              <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit', marginTop: 6, fontSize: 12 }}>
                <b style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>Contact</b>{'\n'}{contactLines(orderContact(order)).join('\n')}
              </div>
            )}
          </div>
        </div>
        {order.notes ? <p className="hint"><b>Notes:</b> {order.notes}</p> : null}
        {order.added_by ? <p className="hint">Order added by <b>{order.added_by}</b></p> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={{ alignSelf: 'center' }}>Status:</label>
          {STATUS_FLOW.map((s) => (
            <span key={s} className={'chip' + (order.status === s ? ' on' : '')} onClick={() => setStatus(s)}>{s}</span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="ttl">
          <h2>Products</h2>
          <button className="btn btn-g btn-sm" onClick={saveLines}>Save products</button>
        </div>
        <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging} availableByProduct={availableByProduct} />
        <p className="hint">Totals: {fmt(totals.volume)} L · net {fmt(totals.net)} kg · gross {fmt(totals.gross)} kg</p>
      </div>

      {order.customer_id && (
        <PricingGuard>
        <div className="card">
          <div className="ttl">
            <h2>Pricing</h2>
            {customerThreeTier && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Buyer level:</span>
                <div className="theme-tog" style={{ background: 'var(--field-bg)' }}>
                  {PRICE_LEVELS.map((l) => (
                    <button key={l.key} className={priceLevel === l.key ? 'on' : ''} onClick={() => changeLevel(l.key)}>{l.label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <table className="tbl">
            <thead><tr>
              <th>Product</th>
              <th>Packaging</th>
              <th style={{ textAlign: 'right', width: '12%' }}>£ / Litre</th>
              <th style={{ textAlign: 'right', width: '12%' }}>Unit price</th>
              <th style={{ textAlign: 'right', width: '6%' }}>Qty</th>
              <th style={{ textAlign: 'right', width: '12%' }}>Line total</th>
            </tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const c = computeLine(l, products, packaging)
                if (!c.product) return null
                const priceKey = `${c.product.id}::${c.packaging?.id}`
                const ppl = parseFloat(prices[priceKey]) || 0     // base/list price (editable)
                const effPpl = pplFor(c.product.id, c.packaging?.id, c.qty) // resolved price
                const season = seasonMap[priceKey]
                const seasonApplied = seasonalPpl(priceKey) != null
                const tierApplied = !seasonApplied && (priceTiers[priceKey] || []).length > 0 && effPpl !== ppl
                const isOrderBasis = tierBasis[priceKey] === 'order'
                const bandQty = isOrderBasis ? combinedSchemeQty() : c.qty
                const unitPrice = effPpl * (c.vol || 0)
                const lineTotal = unitPrice * c.qty
                return (
                  <tr key={i}>
                    <td>
                      <span>{c.productName}</span>
                      {ppl === 0 && unpricedItems.some((u) => u.productId === c.product.id && u.packagingId === c.packaging?.id) && (
                        <button
                          style={{ marginLeft: 8, fontSize: 11, padding: '2px 7px', background: '#fff8e1', border: '1px solid #ffc107', borderRadius: 4, color: '#5a4200', cursor: 'pointer' }}
                          onClick={() => { setUnpricedModal(unpricedItems.find((u) => u.productId === c.product.id && u.packagingId === c.packaging?.id)); setUnpricedPackPrice('') }}>
                          Set price →
                        </button>
                      )}
                    </td>
                    <td>{c.packaging?.name || '—'}</td>
                    <td>
                      {seasonApplied ? (
                        // Seasonal price is active for the order date — it wins.
                        <div
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}
                          title={`Seasonal price ${prettyDate(season.from)} – ${prettyDate(season.to)}. Normal price £${(parseFloat(prices[priceKey]) || 0).toFixed(4)}/L is not charged in this window.`}
                        >
                          <span className="mono" style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>£{effPpl.toFixed(4)}</span>
                          <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>🗓 seasonal · {prettyDate(season.from)} – {prettyDate(season.to)}</span>
                        </div>
                      ) : tierApplied ? (
                        // A quantity tier is in effect — show ONLY the charged price.
                        // The base/list price doesn't apply here, so we keep it off the
                        // display (it's set in Price Entry, and shows inline again if an
                        // order qty ever falls outside the tier bands). Base on hover.
                        <div
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}
                          title={`Quantity-break tier for ${bandQty} ${isOrderBasis ? 'combined packs on the order' : 'packs'}. List price £${(parseFloat(prices[priceKey]) || 0).toFixed(4)}/L is not charged at this quantity.`}
                        >
                          <span className="mono" style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>£{effPpl.toFixed(4)}</span>
                          <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>⇅ tier price · {isOrderBasis ? `${bandQty} combined` : `${c.qty} packs`}</span>
                        </div>
                      ) : (
                        <input className="mono" style={{ textAlign: 'right' }}
                          value={prices[priceKey] ?? ''}
                          placeholder="0.0000"
                          onChange={(e) => setPrices((p) => ({ ...p, [priceKey]: e.target.value }))}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value) || 0
                            setPrices((p) => ({ ...p, [priceKey]: v }))
                            savePrice(c.product.id, c.packaging?.id, v)
                          }}
                        />
                      )}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{unitPrice > 0 ? `£${unitPrice.toFixed(2)}` : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{c.qty}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: lineTotal > 0 ? 700 : 400 }}>{lineTotal > 0 ? `£${lineTotal.toFixed(2)}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(() => {
            const delivery = parseFloat(deliveryCharge) || 0
            const vat = Math.round((orderTotal + labelTotal + delivery) * 0.20 * 100) / 100
            const grandTotal = orderTotal + labelTotal + delivery + vat
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Label price (£/label)</span>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: 8, color: 'var(--muted)', fontSize: 13 }}>£</span>
                    <input className="mono" style={{ textAlign: 'right', paddingLeft: 20, width: 90 }}
                      value={labelPriceRaw} placeholder="0.0000"
                      onChange={(e) => setLabelPriceRaw(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Delivery charge
                    {hasPerPalletPricing()
                      ? <span style={{ marginLeft: 5, color: 'var(--accent)', fontSize: 11 }}>⚡ per-pallet rate (per product)</span>
                      : custDeliveryTiers.length > 0 && <span style={{ marginLeft: 5, color: 'var(--accent)', fontSize: 11 }}>⚡ auto from pallet tiers</span>}
                    {custFreeAbove > 0 && <span style={{ marginLeft: 5, color: 'var(--accent)', fontSize: 11 }}>· free above £{custFreeAbove}</span>}
                  </span>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: 8, color: 'var(--muted)', fontSize: 13 }}>£</span>
                    <input className="mono" style={{ textAlign: 'right', paddingLeft: 20, width: 90 }}
                      value={deliveryCharge} placeholder="0.00"
                      onChange={(e) => setDeliveryCharge(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 8, minWidth: 220 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                    <span className="muted">Subtotal</span>
                    <span className="mono">{orderTotal > 0 ? `£${orderTotal.toFixed(2)}` : '—'}</span>
                  </div>
                  {labelTotal > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                      <span className="muted">Labels</span>
                      <span className="mono">£{labelTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {delivery > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                      <span className="muted">Delivery</span>
                      <span className="mono">£{delivery.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                    <span className="muted">VAT (20%)</span>
                    <span className="mono">{orderTotal > 0 || delivery > 0 ? `£${vat.toFixed(2)}` : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 17, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                    <span>Grand total</span>
                    <span className="mono">{grandTotal > 0 ? `£${grandTotal.toFixed(2)}` : '—'}</span>
                  </div>
                </div>
              </div>
            )
          })()}
          {labelPrice > 0 && labelTotal > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Label charges — £{labelPrice.toFixed(4)}/label</div>
              <table className="tbl" style={{ marginBottom: 0 }}>
                <thead><tr>
                  <th>Product</th>
                  <th>Packaging</th>
                  <th style={{ textAlign: 'right', width: '10%' }}>Labels</th>
                  <th style={{ textAlign: 'right', width: '12%' }}>Label cost</th>
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const c = computeLine(l, products, packaging)
                    const count = labelCount(l, products, packaging)
                    if (!count) return null
                    return (
                      <tr key={i}>
                        <td>{c.productName}</td>
                        <td>{c.packaging?.name || '—'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{count}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>£{(count * labelPrice).toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">Enter £ per litre — unit price and line total are calculated automatically. Prices are saved against this customer for future orders. Products marked with * attract a label charge — set the £/label rate above (pre-filled from customer settings).</p>
        </div>
        </PricingGuard>
      )}

      <div className="card">
        <div className="ttl"><h2>Create delivery note</h2></div>
        <div className="row c3">
          <div className="field"><label>Letterhead</label>
            <select value={lhIndex} onChange={(e) => setLhIndex(+e.target.value)}>
              {letterheads.map((l, i) => <option key={l.id} value={i}>{l.name} — {l.company}</option>)}
            </select></div>
          <div className="field"><label>Date</label>
            <input className="mono" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
          <div className="field"><label>Number of pallets</label>
            <input
              className={'mono' + (palletsFlash ? ' flash-error' : '')}
              type="number" min="0" value={pallets}
              disabled={noPallets}
              onChange={(e) => { setPallets(e.target.value); setPalletsFlash(false) }}
              placeholder={noPallets ? 'no pallets' : 'required'} />
            <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0, fontSize: 12, cursor: 'pointer', marginTop: 6 }}>
              <input type="checkbox" checked={noPallets}
                onChange={(e) => { setNoPallets(e.target.checked); if (e.target.checked) { setPallets(''); setPalletsFlash(false) } }}
                style={{ width: 'auto', height: 15, accentColor: 'var(--accent)' }} />
              No pallets required
            </label>
          </div>
        </div>
        <div className="row c2" style={{ marginBottom: 10 }}>
          <div className="field"><label>Invoice To (on PDF)</label>
            <textarea value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} style={{ minHeight: 62 }} /></div>
          <div className="field"><label>Additional options / notes on the note</label>
            <textarea value={options} onChange={(e) => setOptions(e.target.value)} placeholder="e.g. tail-lift required, deliver before noon…" style={{ minHeight: 62 }} /></div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={showHazard} onChange={(e) => setShowHazard(e.target.checked)} style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
            Include hazard summary on PDF
          </label>
        </div>
        <button className="btn btn-a" onClick={startDispatch}>Generate delivery note</button>
      </div>

      {dispatched.length > 0 && (
        <div className="card">
          <div className="ttl"><h2>Delivery notes on this order</h2></div>
          {dispatched.length > 1 && (
            <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              You’ve generated this note {dispatched.length} times. They share the same number ({dispatched[0].doc_no}) — use the time and totals below to tell them apart, and delete any mistaken copies.
            </p>
          )}
          {dispatched.map((d, idx) => {
            // Notes are newest-first; number them oldest = #1 so the label is stable
            const copyNo = dispatched.length - idx
            const gen = d.created_at ? new Date(d.created_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''
            const delivery = Number(d.totals?.delivery_charge || 0)
            return (
              <div key={d.id} className="list-row">
                <div>
                  <div className="ono">
                    {d.doc_no}
                    {dispatched.length > 1 && <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>copy {copyNo} of {dispatched.length}{idx === 0 ? ' · latest' : ''}</span>}
                  </div>
                  <div className="meta">
                    {prettyDate(d.doc_date)}{gen ? ` · generated ${gen}` : ''} · gross {fmt(d.totals?.gross || 0)} kg
                    {d.totals?.pallets > 0 ? ` · ${d.totals.pallets} pallet(s)` : ''}
                    {delivery > 0 ? ` · delivery £${delivery.toFixed(2)}` : ' · no delivery charge'}
                    {` · ${d.letterhead_snapshot?.name}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-g btn-sm" onClick={() => reprintPDF(d)}>Re-download PDF</button>
                  <button className="btn btn-g btn-sm" onClick={() => pricingGuard(() => printOfficeCopy(d))}>Print office copy</button>
                  <button className="btn-dl" style={{ width: 34, height: 30, fontSize: 14, flexShrink: 0 }} onClick={() => deleteDispatchNote(d)} title="Delete this copy">🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {unpricedModal && (() => {
        const item = unpricedModal
        const customPPL = item.vol > 0 ? (parseFloat(unpricedPackPrice) || 0) / item.vol : 0
        const custName = order?.customer_snapshot?.name || 'this customer'
        return (
          <div className="modal-bg" onClick={() => setUnpricedModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Product not in price list</div>
              <p className="hint" style={{ marginBottom: 14 }}>
                <strong>{item.productName}</strong> ({item.packagingName}) has no price set for <strong>{custName}</strong>.
                {item.otherPrices.length > 0
                  ? ' Copy a price from another customer below, or enter a custom price.'
                  : ' No other customers have a price for this product yet — enter one below to save it to this customer\'s list.'}
              </p>
              {item.otherPrices.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>Copy price from another customer</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {item.otherPrices.map((op, i) => (
                      <button key={i} className="btn btn-g"
                        style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: 13 }}
                        onClick={() => saveUnpricedPrice(op.price_per_litre)}>
                        {op.customerName}: £{op.price_per_litre.toFixed(4)}/L{item.vol > 0 ? ` · £${(op.price_per_litre * item.vol).toFixed(2)} per pack` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>
                {item.otherPrices.length > 0 ? 'Or enter a custom price' : 'Enter a price'}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 13 }}>£</span>
                  <input className="mono" type="number" min="0" step="0.01" autoFocus
                    value={unpricedPackPrice} placeholder={`Pack price (${item.packagingName})`}
                    style={{ paddingLeft: 20 }}
                    onChange={(e) => setUnpricedPackPrice(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && customPPL > 0 && saveUnpricedPrice(customPPL)} />
                </div>
                {item.vol > 0 && customPPL > 0 && (
                  <span style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>= £{customPPL.toFixed(4)}/L</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn btn-g" onClick={() => setUnpricedModal(null)}>Skip</button>
                <button className="btn btn-a"
                  disabled={!unpricedPackPrice || parseFloat(unpricedPackPrice) <= 0}
                  onClick={() => saveUnpricedPrice(customPPL)}>
                  Save to {custName}&apos;s list
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {PricingModal}

      {batchModal && (
        <div className="modal-bg" onClick={() => !busy && setBatchModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 6 }}>Batch numbers</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>Enter the batch number for each product, or tick <b>Not Applicable</b>.</p>
            <div className="batch-list">
              {batchModal.map((r, i) => (
                <div key={i} className="batch-row">
                  <div className="batch-name">{r.name}</div>
                  <input
                    value={r.batch}
                    disabled={r.na}
                    placeholder={r.na ? 'Not applicable' : 'Batch number'}
                    onChange={(e) => setBatchRow(i, { batch: e.target.value })}
                  />
                  <label className="batch-na">
                    <input type="checkbox" checked={r.na} onChange={(e) => setBatchRow(i, { na: e.target.checked, batch: e.target.checked ? '' : r.batch })} style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
                    Not Applicable
                  </label>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn btn-g" onClick={() => setBatchModal(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-a" onClick={confirmDispatch} disabled={busy}>{busy ? 'Generating…' : 'Generate delivery note'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Info({ label, value }) {
  return <div className="field"><label>{label}</label><div className="mono" style={{ paddingTop: 4 }}>{value || '—'}</div></div>
}

function contactLines(contact) {
  if (!contact) return []
  const out = []
  if (contact.name) out.push(contact.name)
  if (contact.phone) out.push('Tel: ' + contact.phone)
  if (contact.email) out.push(contact.email)
  return out
}

// Contact for an order: use the stored snapshot contact if present,
// otherwise extract it from the address text (older orders embed it there).
function orderContact(order) {
  const c = order?.customer_snapshot?.contact
  if (c && (c.name || c.email || c.phone)) return c
  const fromDetails = splitContact(order?.customer_snapshot?.details || '').contact
  const fromDeliver = splitContact(order?.customer_snapshot?.deliver || '').contact
  const merged = {
    name: fromDetails.name || fromDeliver.name,
    email: fromDetails.email || fromDeliver.email,
    phone: fromDetails.phone || fromDeliver.phone,
  }
  return (merged.name || merged.email || merged.phone) ? merged : null
}

function toast(msg) {
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg; t.classList.add('show')
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1900)
}
