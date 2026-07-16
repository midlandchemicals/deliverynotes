'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { computeLine, docTotals, fmt, prettyDate, splitContact, labelCount, PRICE_LEVELS, seasonalActive, resolveLinePpl, parseTiers, VAT_RATE, VAT_LABEL, ORDER_STATUSES, STATUS_NEW, STATUS_BOARD, STATUS_DONE, normalizeStatus, extractDeliveryInstructions, nextNo } from '@/lib/calc'
import { generateDispatchPDF, generateOfficeCopyPDF, reprintPDF, generatePurchaseOrderPDF, generateProformaPDF } from '@/lib/pdf'
import { printBoardNote } from '@/lib/boardnote'
import { toast, ok } from '@/lib/notify'
import PricingGuard, { usePricingCheck } from '@/app/(app)/PricingGuard'
import { StatusBadge } from '../page'
import LineEditor from '../LineEditor'

const STATUS_FLOW = ORDER_STATUSES

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
  // Once a delivery note exists the order is frozen against accidental edits;
  // the ✏️ button unlocks it deliberately.
  const [editLocked, setEditLocked] = useState(false)

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
  const [palletsTouched, setPalletsTouched] = useState(false)
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
  const [editInfo, setEditInfo] = useState(null) // null | {po_ref, order_date, requested_date, notes}
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
      setEditLocked((existing.data || []).length > 0)

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
            `${r.product_id}::${r.packaging_id}`, parseTiers(r.qty_tiers),
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

  // Order header details stay editable after saving to the log.
  async function saveInfo() {
    const patch = {
      po_ref: editInfo.po_ref,
      order_date: editInfo.order_date || null,
      requested_date: editInfo.requested_date || null,
      notes: editInfo.notes,
    }
    if (!ok(await supabase.from('orders').update(patch).eq('id', id), 'saving order details')) return
    setOrder({ ...order, ...patch })
    setEditInfo(null)
    toast('Order details saved')
  }

  async function setStatus(status) {
    if (!ok(await supabase.from('orders').update({ status }).eq('id', id), 'updating status')) return
    setOrder({ ...order, status })
  }

  async function saveLines() {
    if (!ok(await supabase.from('orders').update({ lines }).eq('id', id), 'saving products')) return
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
    ok(await supabase.from('customer_product_prices').upsert(
      { customer_id: order.customer_id, product_id: productId, packaging_id: packagingId, ...priceUpsertCols(price), updated_at: new Date().toISOString() },
      { onConflict: 'customer_id,product_id,packaging_id', ignoreDuplicates: false }
    ), 'saving price')
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

  // Effective £/litre for a line — a negotiated per-order agreed price wins
  // over everything; otherwise the shared resolver (seasonal > tiers > base).
  function pplFor(productId, packagingId, lineQty, override) {
    if (override != null && override !== '' && !isNaN(parseFloat(override))) return parseFloat(override)
    const key = `${productId}::${packagingId}`
    return resolveLinePpl({
      base: prices[key], tiers: priceTiers[key] || [], basis: tierBasis[key],
      season: seasonMap[key] || null, orderDate: order?.order_date,
      lineQty, combinedQty: combinedSchemeQty(),
    })
  }

  // Set / update / clear the one-off agreed price on a line. Persists straight
  // to the order (it lives on the order, not the customer's price list).
  async function setAgreedPrice(i, value) {
    const next = lines.map((x, idx) => (idx === i ? { ...x, ppl_override: value } : x))
    setLines(next)
    ok(await supabase.from('orders').update({ lines: next }).eq('id', id), 'saving agreed price')
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
    const mfgDates = (d.lines_snapshot || []).map((s) => s.mfg_date || '')
    const doc_ = {
      docNo: d.doc_no, date: d.doc_date,
      orderDate: order.order_date || null,
      invoiceTo: d.customer, deliver: d.deliver,
      contact: d.totals?.contact,
      customerName: order.customer_snapshot?.name || '',
      lines, options: d.options,
      pallets: d.totals?.pallets || 0, batches, mfgDates,
    }
    // Use the charges stored ON this note (its snapshot), not the live fields —
    // they may have changed since the note was generated.
    const snapDelivery = Number(d.totals?.delivery_charge || 0)
    const snapLabels = d.totals?.label_total != null ? Number(d.totals.label_total) : labelTotal
    generateOfficeCopyPDF(doc_, lh, products, packaging, prices, snapDelivery, snapLabels, priceTiers, tierBasis, seasonMap)
  }

  // Print the 80mm board note; a New order moves to "On Board" once printed.
  function printNote() {
    printBoardNote({ ...order, lines }, products, packaging)
    if (normalizeStatus(order.status) === STATUS_NEW) setStatus(STATUS_BOARD)
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

  // Every 600 L / 1000 L IBC is one pallet — prefill the pallet count so it
  // doesn't need typing. Stops auto-filling as soon as the user edits the box.
  useEffect(() => {
    if (palletsTouched || noPallets) return
    const ibc = lines.reduce((sum, l) => {
      const c = computeLine(l, products, packaging)
      return sum + (((c.vol || 0) > 500) ? (c.qty || 0) : 0)
    }, 0)
    if (ibc > 0) setPallets(String(ibc))
  }, [lines, products, packaging, palletsTouched, noPallets])

  // Step 1 — validate, then open the batch-number modal
  // Re-evaluate delivery charge whenever anything that affects it changes.
  // Priority: free-delivery threshold (£0) > per-pallet rate (× pallets) > banded tiers.
  useEffect(() => {
    const usePerPallet = hasPerPalletPricing()
    if (!custFreeAbove && !custDeliveryTiers.length && !usePerPallet) return
    const subtotal = lines.reduce((sum, l) => {
      const c = computeLine(l, products, packaging)
      const ppl = pplFor(c.product?.id, c.packaging?.id, c.qty, l.ppl_override)
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
      return { name: c.packaging?.name ? `${c.productName} — ${c.qty} x ${c.packaging.name}` : c.productName, batch: '', na: false, mfg: '' }
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
    // DN numbers are allocated HERE, at delivery-note creation, so notes are
    // numbered in dispatch order. Orders entered earlier keep their ORD- ref
    // until their note is made. Once allocated, the number sticks.
    let docNo = order.order_no
    if (!/^DN-\d+$/i.test(docNo)) {
      const [a, b] = await Promise.all([
        supabase.from('orders').select('order_no').ilike('order_no', 'DN-%').order('created_at', { ascending: false }).limit(100),
        supabase.from('dispatch_notes').select('doc_no').order('created_at', { ascending: false }).limit(100),
      ])
      const nums = [...(a.data || []).map((x) => x.order_no), ...(b.data || []).map((x) => x.doc_no)]
        .map((v) => String(v || '').match(/^DN-(\d+)$/i)).filter(Boolean).map((m) => +m[1])
      docNo = `DN-${(nums.length ? Math.max(...nums) : 1000) + 1}`
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await supabase.from('orders').update({ order_no: docNo }).eq('id', id)
        if (res.error && res.error.code === '23505') { docNo = nextNo(docNo); continue }
        if (!ok(res, 'assigning the DN number')) { setBusy(false); return }
        break
      }
      setOrder((o) => ({ ...o, order_no: docNo }))
    }
    const contact = orderContact(order)
    const batches = batchModal.map((r) => (r.na ? 'N/A' : r.batch.trim()))
    const mfgDates = batchModal.map((r) => (r.na ? '' : (r.mfg || '')))
    const docData = {
      type: 'Delivery Note', docNo, date: docDate,
      orderDate: order.order_date || null,
      invoiceTo,
      deliver: splitContact(order.customer_snapshot?.deliver || '').address,
      contact,
      customerName: order.customer_snapshot?.name || '',
      lines, options, pallets: noPallets ? 0 : pallets, showHazard, batches, mfgDates,
      deliveryCharge: parseFloat(deliveryCharge) || 0,
    }
    const { totals } = generateDispatchPDF(docData, lh, products, packaging, prices)
    const linesSnap = lines.map((l, i) => {
      const c = computeLine(l, products, packaging)
      const ppl = pplFor(c.product?.id, c.packaging?.id, c.qty, l.ppl_override)
      const unitPrice = ppl * (c.vol || 0)
      return {
        productName: c.productName, pg: c.pg, un_number: c.un_number,
        hazard: c.hazard, psn: c.psn, packDesc: c.packDesc, packQty: c.packQty,
        adr_transport_cat: c.product?.adr_transport_cat || '', batch: batches[i],
        mfg_date: mfgDates[i] || '',
        vol: c.totalVol, net: c.net, gross: c.gross,
        price_per_litre: ppl, unit_price: unitPrice, line_total: unitPrice * c.qty,
      }
    })
    const orderTotal = linesSnap.reduce((s, l) => s + (l.line_total || 0), 0)
    const { data: { user } } = await supabase.auth.getUser()
    // Slim letterhead snapshot — keep everything needed to reprint EXCEPT the
    // logo image, which is fetched by id at reprint time (keeps the DB small).
    const lhSnap = { id: lh.id, name: lh.name, company: lh.company, color: lh.color, address: lh.address, footer: lh.footer }
    const inserted = await supabase.from('dispatch_notes').insert({
      doc_no: docNo, doc_type: 'Delivery Note', doc_date: docDate, order_id: id,
      letterhead_snapshot: lhSnap, customer: invoiceTo, deliver: docData.deliver,
      lines_snapshot: linesSnap,
      totals: {
        ...totals, contact, order_total: orderTotal,
        delivery_charge: parseFloat(deliveryCharge) || 0,
        label_total: labelTotal || 0,
      },
      options, created_by: user?.id || null,
    })
    if (!ok(inserted, 'saving the delivery note record')) { setBusy(false); return }
    ok(await supabase.from('orders').update({ status: STATUS_DONE }).eq('id', id), 'updating order status')
    setOrder({ ...order, status: STATUS_DONE })
    const refreshed = await supabase.from('dispatch_notes').select('*').eq('order_id', id).order('created_at', { ascending: false })
    setDispatched(refreshed.data || [])
    setEditLocked(true)
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
    if (!ok(await supabase.from('dispatch_notes').delete().eq('id', d.id), 'deleting the note')) return
    const next = dispatched.filter((x) => x.id !== d.id)
    setDispatched(next)
    // If that was the last copy, drop the order back out of "generated" status
    // and unlock editing again.
    if (next.length === 0) {
      ok(await supabase.from('orders').update({ status: STATUS_BOARD }).eq('id', id), 'updating order status')
      setOrder((o) => ({ ...o, status: STATUS_BOARD }))
      setEditLocked(false)
    }
    toast('Delivery note deleted')
  }

  const { guard: pricingGuard, ModalUI: PricingModal, isAdmin } = usePricingCheck()

  if (!order) return <div className="card"><div className="empty">Loading…</div></div>

  const totals = docTotals(lines, products, packaging)

  const orderTotal = lines.reduce((sum, l) => {
    const c = computeLine(l, products, packaging)
    const ppl = pplFor(c.product?.id, c.packaging?.id, c.qty, l.ppl_override)
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-g btn-sm" onClick={() => setEditInfo({ po_ref: order.po_ref || '', order_date: order.order_date || '', requested_date: order.requested_date || '', notes: order.notes || '' })}>✏️ Edit details</button>
            <button className="btn btn-g btn-sm" onClick={() => generatePurchaseOrderPDF({ ...order, lines }, products, packaging, letterheads[lhIndex] || {})}>📄 Purchase order</button>
            <button className="btn btn-g btn-sm" onClick={printNote}>🖨 Print for board</button>
            <button className="btn btn-g btn-sm" onClick={() => router.push('/orders')}>← Back to log</button>
          </div>
        </div>
        {editInfo ? (
          <div style={{ border: '1.5px solid var(--accent)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div className="row c3">
              <div className="field"><label>Customer Order Number</label>
                <input value={editInfo.po_ref} onChange={(e) => setEditInfo((x) => ({ ...x, po_ref: e.target.value }))} /></div>
              <div className="field"><label>Order date</label>
                <input className="mono" type="date" value={editInfo.order_date} onChange={(e) => setEditInfo((x) => ({ ...x, order_date: e.target.value }))} /></div>
              <div className="field"><label>Requested delivery date</label>
                <input className="mono" type="date" value={editInfo.requested_date} onChange={(e) => setEditInfo((x) => ({ ...x, requested_date: e.target.value }))} /></div>
            </div>
            <div className="field"><label>Notes</label>
              <textarea value={editInfo.notes} onChange={(e) => setEditInfo((x) => ({ ...x, notes: e.target.value }))} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-a btn-sm" onClick={saveInfo}>Save details</button>
              <button className="btn btn-g btn-sm" onClick={() => setEditInfo(null)}>Cancel</button>
            </div>
          </div>
        ) : (
        <div className="row c3">
          <Info label="Customer" value={order.customer_snapshot?.name} />
          <Info label="Customer Order Number" value={order.po_ref || '—'} />
          <Info label="Ordered" value={`${prettyDate(order.order_date)}${order.requested_date ? ` · required ${prettyDate(order.requested_date)}` : ''}`} />
        </div>
        )}
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
            {(() => {
              const ins = extractDeliveryInstructions(order.customer_snapshot?.deliver || '').instructions
              return ins.length ? (
                <div style={{ marginTop: 8, padding: '12px 14px', border: '2px solid var(--warn)', borderRadius: 10, background: '#FCF4E2', fontWeight: 800, fontSize: 15, color: '#7A5511', lineHeight: 1.35 }}>
                  🚚 DELIVERY INSTRUCTIONS{'\n'}
                  <span style={{ whiteSpace: 'pre-line' }}>{ins.join('\n')}</span>
                </div>
              ) : null
            })()}
          </div>
        </div>
        {order.notes ? <p className="hint"><b>Notes:</b> {order.notes}</p> : null}
        {order.added_by ? <p className="hint">Order added by <b>{order.added_by}</b></p> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={{ alignSelf: 'center' }}>Status:</label>
          {STATUS_FLOW.map((s) => (
            <span key={s} className={'chip' + (normalizeStatus(order.status) === s ? ' on' : '')} onClick={() => setStatus(s)}>{s}</span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="ttl">
          <h2>Products</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {editLocked ? (
              <button className="btn btn-g btn-sm" onClick={() => {
                if (confirm('A delivery note has already been generated from this order. Unlock editing anyway?\n\nIf you change anything, generate a new delivery note and delete the old copy so they stay in step.')) setEditLocked(false)
              }}>✏️ Unlock editing</button>
            ) : (
              <button className="btn btn-g btn-sm" onClick={saveLines}>Save products</button>
            )}
          </div>
        </div>
        {editLocked && (
          <p className="hint" style={{ marginTop: 0, background: 'var(--accent-soft, #eef6f1)', border: '1px solid var(--accent)', borderRadius: 8, padding: '8px 12px' }}>
            🔒 This order is locked because a delivery note has been generated from it. Click <b>✏️ Unlock editing</b> to make changes.
          </p>
        )}
        <div style={editLocked ? { pointerEvents: 'none', opacity: 0.6 } : undefined}>
          <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging} availableByProduct={availableByProduct} />
        </div>
        <p className="hint">Totals: {fmt(totals.volume)} L · net {fmt(totals.net)} kg · gross {fmt(totals.gross)} kg</p>
      </div>

      {order.customer_id && (
        <PricingGuard>
        <div className="card" style={editLocked ? { position: 'relative' } : undefined}>
          {editLocked && (
            <div
              style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'not-allowed', borderRadius: 'inherit', background: 'rgba(255,255,255,0.35)' }}
              title="Locked — a delivery note has been generated. Use ✏️ Unlock editing in the Products card to change pricing."
            />
          )}
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
                const effPpl = pplFor(c.product.id, c.packaging?.id, c.qty, l.ppl_override) // resolved price
                const hasOverride = l.ppl_override != null && l.ppl_override !== ''
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
                      {hasOverride ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          <input className="mono" style={{ textAlign: 'right', borderColor: 'var(--gold)', fontWeight: 700 }}
                            value={l.ppl_override}
                            onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, ppl_override: e.target.value } : x)))}
                            onBlur={(e) => setAgreedPrice(i, e.target.value)}
                          />
                          <span style={{ fontSize: 10.5, color: 'var(--gold)', fontWeight: 700 }}>
                            ✎ agreed price · <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setAgreedPrice(i, null)}>remove</a>
                          </span>
                        </div>
                      ) : seasonApplied ? (
                        // Seasonal price is active for the order date — it wins.
                        <div
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}
                          title={`Seasonal price ${prettyDate(season.from)} – ${prettyDate(season.to)}. Normal price £${(parseFloat(prices[priceKey]) || 0).toFixed(4)}/L is not charged in this window.`}
                        >
                          <span className="mono" style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>£{effPpl.toFixed(4)}</span>
                          <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>🗓 seasonal · {prettyDate(season.from)} – {prettyDate(season.to)}</span>
                          <a style={{ fontSize: 10.5, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}
                            title="Set a negotiated one-off price for this order — the price list is not changed"
                            onClick={() => setAgreedPrice(i, effPpl ? effPpl.toFixed(4) : '')}>✎ agreed price</a>
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
                          <a style={{ fontSize: 10.5, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}
                            title="Set a negotiated one-off price for this order — the price list is not changed"
                            onClick={() => setAgreedPrice(i, effPpl ? effPpl.toFixed(4) : '')}>✎ agreed price</a>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
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
                          <a style={{ fontSize: 10.5, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}
                            title="Set a negotiated one-off price for this order — the price list is not changed"
                            onClick={() => setAgreedPrice(i, effPpl ? effPpl.toFixed(4) : '')}>✎ agreed price</a>
                        </div>
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
            const vat = Math.round((orderTotal + labelTotal + delivery) * VAT_RATE * 100) / 100
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13, fontWeight: 600, color: 'var(--heading)' }}>
                    <span>Total (ex VAT)</span>
                    <span className="mono">{(orderTotal + labelTotal + delivery) > 0 ? `£${(orderTotal + labelTotal + delivery).toFixed(2)}` : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13 }}>
                    <span className="muted">{VAT_LABEL}</span>
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
          {/* zIndex lifts this above the edit-lock overlay — the proforma is a
              read-only document, so it must stay printable on locked orders */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, position: 'relative', zIndex: 6 }}>
            <button className="btn btn-a" onClick={() => generateProformaPDF(
              {
                docNo: order.order_no, date: new Date().toISOString().slice(0, 10),
                orderDate: order.order_date || null,
                invoiceTo, deliver: splitContact(order.customer_snapshot?.deliver || '').address,
                lines,
              },
              letterheads[lhIndex] || {}, products, packaging, prices,
              parseFloat(deliveryCharge) || 0, labelTotal, priceTiers, tierBasis, seasonMap,
            )}>📄 Proforma invoice</button>
          </div>
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
              onChange={(e) => { setPallets(e.target.value); setPalletsTouched(true); setPalletsFlash(false) }}
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
                    {isAdmin ? (delivery > 0 ? ` · delivery £${delivery.toFixed(2)}` : ' · no delivery charge') : ''}
                    {` · ${d.letterhead_snapshot?.name}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-g btn-sm" onClick={() => generatePurchaseOrderPDF({ ...order, lines }, products, packaging, letterheads[lhIndex] || {})}>Purchase order</button>
                  <button className="btn btn-g btn-sm" onClick={() => reprintPDF(d)}>Delivery Note</button>
                  {isAdmin && (
                    <>
                      <button className="btn btn-g btn-sm" onClick={() => generateProformaPDF(
                        {
                          docNo: d.doc_no || order.order_no, date: new Date().toISOString().slice(0, 10),
                          orderDate: order.order_date || null,
                          invoiceTo: d.customer || invoiceTo,
                          deliver: d.deliver || splitContact(order.customer_snapshot?.deliver || '').address,
                          lines,
                        },
                        letterheads[lhIndex] || {}, products, packaging, prices,
                        Number(d.totals?.delivery_charge || 0),
                        d.totals?.label_total != null ? Number(d.totals.label_total) : labelTotal,
                        priceTiers, tierBasis, seasonMap,
                      )}>Proforma</button>
                      <button className="btn btn-g btn-sm" onClick={() => printOfficeCopy(d)}>For Invoicing</button>
                    </>
                  )}
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
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>Enter the batch number for each product, or tick <b>Not Applicable</b>. Date of manufacture is optional — if set, it prints under the batch number.</p>
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
                  <input
                    className="mono" type="date"
                    value={r.mfg || ''}
                    disabled={r.na}
                    title="Date of manufacture (optional)"
                    style={{ width: 150 }}
                    onChange={(e) => setBatchRow(i, { mfg: e.target.value })}
                  />
                  <label className="batch-na">
                    <input type="checkbox" checked={r.na} onChange={(e) => setBatchRow(i, { na: e.target.checked, batch: e.target.checked ? '' : r.batch, mfg: e.target.checked ? '' : r.mfg })} style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
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

