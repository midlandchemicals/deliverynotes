'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { computeLine, docTotals, fmt, prettyDate, splitContact, labelCount, PRICE_LEVELS, seasonalActive, resolveLinePpl, parseTiers, VAT_RATE, VAT_LABEL, ORDER_STATUSES, STATUS_NEW, STATUS_BOARD, STATUS_DONE, normalizeStatus, extractDeliveryInstructions, nextNo, unifiedAddresses, todayISO } from '@/lib/calc'
import { generateDispatchPDF, generateOfficeCopyPDF, reprintPDF, generatePurchaseOrderPDF, generateProformaPDF } from '@/lib/pdf'
import { printBoardNote } from '@/lib/boardnote'
import { toast, toastError, ok } from '@/lib/notify'
import PricingGuard, { usePricingCheck } from '@/app/(app)/PricingGuard'
import { StatusBadge } from '../page'
import LineEditor from '../LineEditor'
import Combobox from '@/app/(app)/Combobox'
import AddProductModal from '../AddProductModal'

const STATUS_FLOW = ORDER_STATUSES
const firstLineOf = (t) => String(t || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || ''

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
  // A typed price change never saves silently — it opens the "where does this
  // price go?" prompt below. This holds the price as it was before they typed.
  const priceBefore = useRef({})
  const [priceScope, setPriceScope] = useState(null)
  const custName = order?.customer_snapshot?.name || 'this customer'
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
  const [docDate, setDocDate] = useState(todayISO())
  const [invoiceTo, setInvoiceTo] = useState('')
  const [options, setOptions] = useState('')
  // IBCs are counted from the products themselves; this is only the ADDITIONAL
  // pallets of smaller packs, which nothing can work out for us.
  const [extraPallets, setExtraPallets] = useState('')
  // "I've looked at this" ticks that walk the user down the page
  const [checked, setChecked] = useState({ details: false, products: false, pricing: false })
  const [noPallets, setNoPallets] = useState(false)   // only asked when there are no IBCs
  const [palletsFlash, setPalletsFlash] = useState(false)
  const [docNoOverride, setDocNoOverride] = useState('') // optional manual DN number
  const [deliveryTouched, setDeliveryTouched] = useState(false) // user typed a delivery charge by hand
  const [showHazard, setShowHazard] = useState(true)
  const [batchModal, setBatchModal] = useState(null) // null | [{ name, batch, na }]
  const [busy, setBusy] = useState(false)

  const [availableByProduct, setAvailableByProduct] = useState({}) // productId -> [packagingId] from price list
  const [custDeliveryTiers, setCustDeliveryTiers] = useState([])
  const [custFreeAbove, setCustFreeAbove] = useState(0)
  const [custPerPallet, setCustPerPallet] = useState(0)          // customer £/pallet base rate
  const [perPalletByKey, setPerPalletByKey] = useState({})       // { key: £/pallet } per-product override
  const [editInfo, setEditInfo] = useState(null) // null | {po_ref, order_date, requested_date, notes}
  const [emailModal, setEmailModal] = useState(null) // null | { to, name, link, busy }
  const [custAddresses, setCustAddresses] = useState([]) // customer's saved addresses for the Edit-details pickers
  const [showAdd, setShowAdd] = useState(false) // "add a product" modal

  // Product added via the shared modal: register it, price it locally, add line.
  // A product's SG or hazard details were edited from the line table — swap in
  // the saved version so weights and hazard text redraw straight away.
  function applyProductUpdate(updated) {
    setProducts((ps) => ps.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
  }

  function handleProductAdded({ line, product, packagingId, priceSaved }) {
    if (product && !products.find((p) => p.id === product.id)) setProducts((ps) => [...ps, product])
    if (priceSaved != null) {
      const key = `${line.productId}::${packagingId}`
      setPrices((p) => ({ ...p, [key]: priceSaved }))
      setAvailableByProduct((m) => ({ ...m, [line.productId]: [...new Set([...(m[line.productId] || []), packagingId])] }))
    }
    setLines((ls) => [...ls, line])
    toast('Added — remember to Save products')
  }
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
          supabase.from('customers').select('label_price, default_delivery_charge, free_delivery_above, delivery_per_pallet, default_letterhead_id, three_tier_pricing, addresses, invoice_addresses, delivery_addresses, details, deliver, contact_name, email, phone').eq('id', o.data.customer_id).single(),
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
        if (custData.data) setCustAddresses(unifiedAddresses(custData.data))
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

  // Re-fetch the product & packaging catalogues whenever the tab regains focus,
  // so an SG / weight edit made in the admin shows up here without a reload.
  useEffect(() => {
    async function refresh() {
      if (document.visibilityState !== 'visible') return
      const [p, k] = await Promise.all([
        supabase.from('products').select('*').order('name'),
        supabase.from('packaging').select('*').order('volume'),
      ])
      if (p.data) setProducts(p.data)
      if (k.data) setPackaging(k.data)
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [])

  // Order header details stay editable after saving to the log. The order keeps
  // its own snapshot of the customer's contact (frozen at order time), so we
  // update that here too when the contact fields change.
  async function saveInfo() {
    const contact = {
      name: editInfo.contact?.name || '',
      email: editInfo.contact?.email || '',
      phone: editInfo.contact?.phone || '',
    }
    // Store the contact in all three slots so it flows to the delivery note AND
    // the proforma/invoicing regardless of which resolver reads it.
    const snapshot = {
      ...(order.customer_snapshot || {}),
      details: editInfo.details ?? order.customer_snapshot?.details ?? '',
      deliver: editInfo.deliver ?? order.customer_snapshot?.deliver ?? '',
      contact, delivery_contact: contact, invoice_contact: contact,
    }
    const patch = {
      po_ref: editInfo.po_ref,
      order_date: editInfo.order_date || null,
      requested_date: editInfo.requested_date || null,
      notes: editInfo.notes,
      customer_snapshot: snapshot,
    }
    if (!ok(await supabase.from('orders').update(patch).eq('id', id), 'saving order details')) return
    setOrder({ ...order, ...patch })
    setInvoiceTo(splitContact(snapshot.details || '').address)
    setEditInfo(null)
    toast('Order details saved')
  }

  // Build the proforma PDF for the current order (opens it in a new tab).
  function runProforma() {
    generateProformaPDF(
      {
        docNo: order.order_no, poRef: order.po_ref || '', date: todayISO(),
        orderDate: order.order_date || null,
        invoiceTo, deliver: splitContact(order.customer_snapshot?.deliver || '').address,
        lines,
      },
      letterheads[lhIndex] || {}, products, packaging, prices,
      parseFloat(deliveryCharge) || 0, labelTotal, priceTiers, tierBasis, seasonMap,
    )
  }

  // Build the proforma, upload it to Supabase Storage, and open a compose popup
  // with a secure 90-day link so it can be emailed with the mail client's own
  // signature (mailto hands off to the client, which appends the signature).
  async function emailProforma() {
    const c = invoiceContact(order) || {}
    const email = (c.email || '').trim()
    if (!email) { toast('No email address on file for this order'); return }
    const greetName = c.name || order.customer_snapshot?.name || 'Sir/Madam'
    setEmailModal({ to: email, name: greetName, link: '', busy: true })
    try {
      const blob = generateProformaPDF(
        {
          docNo: order.order_no, date: todayISO(),
          orderDate: order.order_date || null,
          invoiceTo, deliver: splitContact(order.customer_snapshot?.deliver || '').address,
          lines,
        },
        letterheads[lhIndex] || {}, products, packaging, prices,
        parseFloat(deliveryCharge) || 0, labelTotal, priceTiers, tierBasis, seasonMap,
        { returnBlob: true },
      )
      const safe = String(order.order_no || 'proforma').replace(/[^a-z0-9\-_]/gi, '_')
      const path = `${order.id}/${safe}-${Date.now()}.pdf`
      const up = await supabase.storage.from('proformas').upload(path, blob, { contentType: 'application/pdf', upsert: true })
      if (up.error) { setEmailModal(null); toastError(`Couldn't upload the proforma: ${up.error.message}. Is the private 'proformas' storage bucket set up?`); return }
      const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() // link inactive after 14 days
      // Prefer a short, on-our-domain link (/p/<token>); fall back to the raw
      // signed URL if the link table isn't set up yet.
      let link = ''
      const token = (crypto.randomUUID().replace(/-/g, '')).slice(0, 14)
      const linkIns = await supabase.from('proforma_links').insert({ token, order_id: order.id, doc_no: order.order_no, path, expires_at: expires })
      if (!linkIns.error) {
        // Always use the branded domain for customer links when configured
        // (NEXT_PUBLIC_APP_URL), regardless of which URL staff are browsing on.
        const base = (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '')
        link = `${base}/p/${token}`
      } else {
        const signed = await supabase.storage.from('proformas').createSignedUrl(path, 60 * 60 * 24 * 14)
        if (signed.error || !signed.data?.signedUrl) { setEmailModal(null); toastError('Uploaded, but could not create the link.'); return }
        link = signed.data.signedUrl
      }
      setEmailModal((m) => ({ ...m, link, busy: false }))
    } catch (e) {
      setEmailModal(null); toastError('Could not prepare the proforma: ' + (e?.message || 'unknown'))
    }
  }

  // Compose the message body and hand off to the mail client (adds signature).
  function sendProformaEmail() {
    const m = emailModal
    const subject = `Proforma Invoice ${order.order_no} — Midland Chemicals Ltd`
    const body =
      `Dear ${m.name},\n\n` +
      `Please find your proforma invoice for your order at the link below:\n${m.link}\n\n` +
      `Please note this is not a V.A.T. invoice.\n\n` +
      `Once payment has been received we will arrange dispatch. If you have any questions please don't hesitate to get in touch.`
    window.location.href = `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    setEmailModal(null)
  }

  // Pull the customer's CURRENT contact from the address book into this order.
  // Matches the delivery address in use to its stored contact; falls back to
  // the first delivery address, then the legacy contact columns.
  async function refreshContactFromCustomer() {
    if (!order.customer_id) { toast('This order has no linked customer'); return }
    const { data: c } = await supabase.from('customers').select('*').eq('id', order.customer_id).single()
    if (!c) { toast('Could not load the customer'); return }
    const norm = (t) => splitContact(String(t || '')).address.replace(/\s+/g, ' ').trim().toLowerCase()
    const list = unifiedAddresses(c) // contact is derived from address text when the fields were blank
    // Match the delivery address in use; else the invoice address; else the first.
    const target = norm(order.customer_snapshot?.deliver) || norm(order.customer_snapshot?.details)
    const match = list.find((a) => norm(a.text) === target) || list[0] || {}
    const ct = match.contact || {}
    setEditInfo((x) => ({
      ...x,
      contact: { name: ct.name || '', email: ct.email || '', phone: ct.phone || '' },
    }))
    toast(ct.email || ct.phone || ct.name ? 'Pulled latest contact — review, then Save details' : 'No contact found on this customer’s address')
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

  // order.lines is what's actually on file — anything different on screen is
  // unsaved, and drives the sticky "you haven't saved" bar at the bottom.
  const linesDirty = !editLocked && !!order && JSON.stringify(lines) !== JSON.stringify(order.lines || [])
  // Notes are held newest-first, so the top one is the current paperwork.
  const latestNote = dispatched[0] || null

  // Lines with nothing to invoice against — these gate the invoicing copy.
  const unpricedLines = lines.filter((l) => {
    const c = computeLine(l, products, packaging)
    return c.product && pplFor(c.product.id, c.packaging?.id, c.qty, l.ppl_override) <= 0
  })

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

  // A price was typed into the £/Litre box. Nothing is saved yet — put the box
  // back to what it was and ask where the new price should go, because "fix it
  // for this order" and "fix it for good" are very different things.
  function askPriceScope(i, c, priceKey, typed) {
    const before = parseFloat(priceBefore.current[priceKey]) || 0
    const next = parseFloat(typed) || 0
    if (next === before) { setPrices((p) => ({ ...p, [priceKey]: before || '' })); return }
    setPrices((p) => ({ ...p, [priceKey]: before || '' }))
    setPriceScope({
      i, productId: c.product.id, packagingId: c.packaging?.id, priceKey,
      productName: c.productName, packName: c.packaging?.name || '', vol: c.vol || 0,
      before, next,
    })
  }

  // "Every future order" — write it to the customer's price list on file.
  async function commitPriceToList() {
    const s = priceScope
    if (!s) return
    setPrices((p) => ({ ...p, [s.priceKey]: s.next }))
    // A one-off agreed price on this line would hide the new list price.
    if (lines[s.i]?.ppl_override != null && lines[s.i]?.ppl_override !== '') await setAgreedPrice(s.i, null)
    await savePrice(s.productId, s.packagingId, s.next)
    setPriceScope(null)
    toast(`${custName}'s price list updated — ${s.productName} is now £${s.next.toFixed(4)}/L`)
  }

  // "This order only" — the price list on file is left exactly as it was.
  async function commitPriceToOrderOnly() {
    const s = priceScope
    if (!s) return
    await setAgreedPrice(s.i, String(s.next))
    setPriceScope(null)
    toast(`Agreed price for this order only — ${custName}'s price list is unchanged`)
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
    if (!ok(await supabase.from('orders').update({ lines: next }).eq('id', id), 'saving agreed price')) return
    setOrder((o) => (o ? { ...o, lines: next } : o))   // it's on file now — not "unsaved"
  }

  function printOfficeCopy(d) {
    // Blocked until everything has a price to invoice against — the charged
    // price, so a one-off agreed price counts just as a list price does.
    const unpriced = lines.filter((l) => {
      const c = computeLine(l, products, packaging)
      if (!c.product) return false
      return pplFor(c.product.id, c.packaging?.id, c.qty, l.ppl_override) <= 0
    })
    if (unpriced.length > 0) {
      const names = [...new Set(unpriced.map((l) => computeLine(l, products, packaging).productName))].join(', ')
      toastError(`Can't print the invoicing copy — no price yet for: ${names}. Set it in Pricing above.`)
      return
    }
    const lh = letterheads[lhIndex]
    const batches = (d.lines_snapshot || []).map((s) => s.batch || '')
    const mfgDates = (d.lines_snapshot || []).map((s) => s.mfg_date || '')
    const doc_ = {
      docNo: d.doc_no, poRef: order.po_ref || '', date: d.doc_date,
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

  // Every 600 L / 1000 L IBC travels on its own pallet, so the count comes
  // straight off the order — it's shown, not typed. Anything else on pallets
  // (drums, kegs, cases of small packs) is the user's call.
  const ibcCount = lines.reduce((sum, l) => {
    const c = computeLine(l, products, packaging)
    return sum + (((c.vol || 0) > 500) ? (c.qty || 0) : 0)
  }, 0)
  const totalPallets = ibcCount + (parseInt(extraPallets, 10) || 0)

  // Step 1 — validate, then open the batch-number modal
  // Re-evaluate delivery charge whenever anything that affects it changes.
  // Priority: free-delivery threshold (£0) > per-pallet rate (× pallets) > banded tiers.
  useEffect(() => {
    if (deliveryTouched) return // a manually-typed charge must never be overwritten
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
    if (usePerPallet) {
      setDeliveryCharge(perPalletDeliveryTotal().toFixed(2))
      return
    }
    // Pallet tier — runs even before pallet count is entered (p=0 matches a "0 to X" band)
    if (custDeliveryTiers.length > 0) {
      const p = totalPallets
      const tier = [...custDeliveryTiers]
        .sort((a, b) => a.pallets_from - b.pallets_from)
        .find((t) => p >= t.pallets_from && (t.pallets_to == null || p < t.pallets_to))
      if (tier != null) setDeliveryCharge(Number(tier.charge).toFixed(2))
      else setDeliveryCharge('')
    }
  }, [deliveryTouched, custFreeAbove, custDeliveryTiers, custPerPallet, perPalletByKey, totalPallets, lines, prices, priceTiers, tierBasis])

  function startDispatch() {
    const lh = letterheads[lhIndex]
    if (!lh) { alert('Add a letterhead first (Letterheads tab).'); return }
    // Only ask about pallets when nothing can be worked out for us: with IBCs
    // on the order the count is already known, so extras stay optional.
    if (ibcCount === 0 && !noPallets && (parseInt(extraPallets, 10) || 0) <= 0) {
      setPalletsFlash(true)
      setTimeout(() => setPalletsFlash(false), 1200)
      toast('No IBCs on this order — enter the number of pallets, or tick "No pallets needed"')
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
    if (!docDate) { toastError('Set the dispatch date before generating the note'); return }
    const incomplete = batchModal.some((r) => !r.na && !r.batch.trim())
    if (incomplete) { toast('Enter a batch number or tick Not Applicable for each product'); return }
    setBusy(true)
    const lh = letterheads[lhIndex]
    // DN numbers are allocated HERE, at delivery-note creation, so notes are
    // numbered in dispatch order. Orders entered earlier keep their ORD- ref
    // until their note is made. Once allocated, the number sticks.
    let docNo = order.order_no
    const manual = docNoOverride.trim()
    if (manual && manual !== order.order_no) {
      // User set their own DN number — use it exactly (must be unique).
      const res = await supabase.from('orders').update({ order_no: manual }).eq('id', id)
      if (res.error && res.error.code === '23505') { toast(`Delivery note number ${manual} is already in use — pick another.`); setBusy(false); return }
      if (!ok(res, 'setting the DN number')) { setBusy(false); return }
      docNo = manual
      setOrder((o) => ({ ...o, order_no: manual }))
    } else if (!/^DN-\d+$/i.test(docNo)) {
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
      type: 'Delivery Note', docNo, poRef: order.po_ref || '', date: docDate,
      orderDate: order.order_date || null,
      invoiceTo,
      deliver: splitContact(order.customer_snapshot?.deliver || '').address,
      contact,
      customerName: order.customer_snapshot?.name || '',
      lines, options, pallets: totalPallets, showHazard, batches, mfgDates,
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
        po_ref: order.po_ref || '',
      },
      options, created_by: user?.id || null,
    })
    if (!ok(inserted, 'saving the delivery note record')) { setBusy(false); return }
    ok(await supabase.from('orders').update({ status: STATUS_DONE }).eq('id', id), 'updating order status')
    setOrder({ ...order, status: STATUS_DONE })
    const refreshed = await supabase.from('dispatch_notes').select('*').eq('order_id', id).order('created_at', { ascending: false })
    setDispatched(refreshed.data || [])
    setEditLocked(true)
    setExtraPallets('')
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

  // Work through the order in order: check the details, then the products,
  // then the pricing — only then does the paperwork come forward. Ticks last
  // for this visit; nothing is locked, the sections just lead the eye.
  const pricingChecked = !isAdmin || checked.pricing   // no pricing card to check without admin
  // An order that already has a delivery note has been through this once.
  // Coming back to it — to unlock and fix something — shouldn't mean walking
  // the whole review again, so everything is open from the start.
  const orderComplete = dispatched.length > 0
  const reviewDone = orderComplete
    ? { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true }
    : { 1: checked.details, 2: checked.products, 3: pricingChecked, 4: pricingChecked, 5: pricingChecked, 6: !!latestNote }
  function reviewState(n) {
    if (orderComplete) return 'active'   // nothing faded, nothing to re-tick
    if (reviewDone[n]) return n <= 3 ? 'done' : 'active'
    for (let i = 1; i < n; i++) if (!reviewDone[i]) return 'todo'
    return 'active'
  }
  const tick = (k) => setChecked((c) => ({ ...c, [k]: !c[k] }))

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
      <div className={'card step-card step-' + reviewState(1)}>
        <StepHead n={1} title={`${order.order_no} — check the details`} state={reviewState(1)}>
          <StatusBadge status={order.status} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-g btn-sm" onClick={() => { const c = orderContact(order) || {}; setEditInfo({ po_ref: order.po_ref || '', order_date: order.order_date || '', requested_date: order.requested_date || '', notes: order.notes || '', contact: { name: c.name || '', email: c.email || '', phone: c.phone || '' }, details: order.customer_snapshot?.details || '', deliver: order.customer_snapshot?.deliver || '' }) }}>✏️ Edit details</button>
            <button className="btn btn-g btn-sm" onClick={() => router.push('/orders')}>← Back to log</button>
          </div>
        </StepHead>
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
            <div className="row c2" style={{ marginTop: 4 }}>
              <div className="field">
                <label>Invoice address</label>
                {custAddresses.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <Combobox
                      options={custAddresses.map((a, i) => ({ id: String(i), label: `${a.verified ? '✓ ' : ''}${a.invoice_default ? '🧾 ' : ''}${a.label || firstLineOf(a.text) || `Address ${i + 1}`}` }))}
                      value=""
                      onSelect={(id) => { const a = custAddresses[+id]; if (a) setEditInfo((x) => ({ ...x, details: splitContact(a.text).address, contact: { ...x.contact } })) }}
                      placeholder="Choose a saved address…"
                    />
                  </div>
                )}
                <textarea style={{ minHeight: 84 }} value={editInfo.details || ''} onChange={(e) => setEditInfo((x) => ({ ...x, details: e.target.value }))} placeholder="Invoice address" />
              </div>
              <div className="field">
                <label>Delivery address</label>
                {custAddresses.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <Combobox
                      options={custAddresses.map((a, i) => ({ id: String(i), label: `${a.verified ? '✓ ' : ''}${a.invoice_default ? '🧾 ' : ''}${a.label || firstLineOf(a.text) || `Address ${i + 1}`}` }))}
                      value=""
                      onSelect={(id) => { const a = custAddresses[+id]; if (a) { const ct = a.contact || {}; setEditInfo((x) => ({ ...x, deliver: splitContact(a.text).address, contact: { name: ct.name || '', email: ct.email || '', phone: ct.phone || '' } })) } }}
                      placeholder="Choose a saved address…"
                    />
                  </div>
                )}
                <textarea style={{ minHeight: 84 }} value={editInfo.deliver || ''} onChange={(e) => setEditInfo((x) => ({ ...x, deliver: e.target.value }))} placeholder="Delivery address" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0 6px' }}>
              <label style={{ margin: 0 }}>Contact for this order</label>
              <button className="btn btn-g btn-sm" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={refreshContactFromCustomer}>↻ Pull latest from address book</button>
            </div>
            <div className="row c3">
              <div className="field"><label>Name</label>
                <input value={editInfo.contact?.name || ''} onChange={(e) => setEditInfo((x) => ({ ...x, contact: { ...x.contact, name: e.target.value } }))} /></div>
              <div className="field"><label>Email</label>
                <input value={editInfo.contact?.email || ''} onChange={(e) => setEditInfo((x) => ({ ...x, contact: { ...x.contact, email: e.target.value } }))} /></div>
              <div className="field"><label>Telephone</label>
                <input value={editInfo.contact?.phone || ''} onChange={(e) => setEditInfo((x) => ({ ...x, contact: { ...x.contact, phone: e.target.value } }))} /></div>
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
            <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit' }}>{splitContact(order.customer_snapshot?.details || '').address}</div>
            {contactLines(invoiceContact(order)).length > 0 && (
              <div className="paper" style={{ background: 'var(--panel-2)', color: 'var(--ink)', boxShadow: 'none', whiteSpace: 'pre-line', fontFamily: 'inherit', marginTop: 6, fontSize: 12 }}>
                <b style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>Accounts contact</b>{'\n'}{contactLines(invoiceContact(order)).join('\n')}
              </div>
            )}
          </div>
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
        {!orderComplete && <StepCheck done={reviewDone[1]} onCheck={() => tick('details')} label="Details are right — next" />}
      </div>


      <div className={'card step-card step-' + reviewState(2)}>
        <StepHead n={2} title="Check the products" state={reviewState(2)}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {editLocked ? (
              <button className="btn btn-g btn-sm" onClick={() => {
                if (confirm('A delivery note has already been generated from this order. Unlock editing anyway?\n\nIf you change anything, generate a new delivery note and delete the old copy so they stay in step.')) setEditLocked(false)
              }}>✏️ Unlock editing</button>
            ) : (
              <>
                <button className="btn btn-g btn-sm" onClick={saveLines}>Save products</button>
              </>
            )}
          </div>
        </StepHead>
        {editLocked && (
          <p className="hint" style={{ marginTop: 0, background: 'var(--accent-soft, #eef6f1)', border: '1px solid var(--accent)', borderRadius: 8, padding: '8px 12px' }}>
            🔒 This order is locked because a delivery note has been generated from it. Click <b>✏️ Unlock editing</b> to make changes.
          </p>
        )}
        <div style={editLocked ? { pointerEvents: 'none', opacity: 0.6 } : undefined}>
          <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging}
            availableByProduct={availableByProduct} onProductUpdated={applyProductUpdate}
            onAddProduct={editLocked ? undefined : () => setShowAdd(true)} />
        </div>
        <p className="hint">Totals: {fmt(totals.volume)} L · net {fmt(totals.net)} kg · gross {fmt(totals.gross)} kg</p>
        {/* Repeated here so a long product list never means scrolling back up to save. */}
        {!editLocked && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
            <button className={'btn btn-sm ' + (linesDirty ? 'btn-a' : 'btn-g')} onClick={saveLines}>💾 Save products</button>
            {linesDirty && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bad, #C24E42)' }}>You have unsaved changes</span>}
          </div>
        )}
        {!orderComplete && <StepCheck done={reviewDone[2]} onCheck={() => tick('products')} label="Products are right — next" />}
      </div>

      {order.customer_id && (
        <PricingGuard>
        <div className={'card step-card step-' + reviewState(3)} style={editLocked ? { position: 'relative' } : undefined}>
          {editLocked && (
            <div
              style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'not-allowed', borderRadius: 'inherit', background: 'rgba(255,255,255,0.35)' }}
              title="Locked — a delivery note has been generated. Use ✏️ Unlock editing in the Products card to change pricing."
            />
          )}
          <StepHead n={3} title="Check the pricing" state={reviewState(3)}>
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
          </StepHead>
          <table className="tbl tbl-cards">
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
                    <td data-label="Product">
                      <span>{c.productName}</span>
                      {ppl === 0 && unpricedItems.some((u) => u.productId === c.product.id && u.packagingId === c.packaging?.id) && (
                        <button
                          style={{ marginLeft: 8, fontSize: 11, padding: '2px 7px', background: '#fff8e1', border: '1px solid #ffc107', borderRadius: 4, color: '#5a4200', cursor: 'pointer' }}
                          onClick={() => { setUnpricedModal(unpricedItems.find((u) => u.productId === c.product.id && u.packagingId === c.packaging?.id)); setUnpricedPackPrice('') }}>
                          Set price →
                        </button>
                      )}
                    </td>
                    <td data-label="Packaging">{c.packaging?.name || '—'}</td>
                    <td data-label="£ / Litre">
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
                          <a style={{ fontSize: 10.5, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}
                            title={`Make this ${custName}'s standard price for every future order`}
                            onClick={() => setPriceScope({
                              i, productId: c.product.id, packagingId: c.packaging?.id, priceKey,
                              productName: c.productName, packName: c.packaging?.name || '', vol: c.vol || 0,
                              before: ppl, next: parseFloat(l.ppl_override) || 0,
                            })}>
                            → make this the standard price
                          </a>
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
                            onFocus={() => { priceBefore.current[priceKey] = prices[priceKey] ?? '' }}
                            onChange={(e) => setPrices((p) => ({ ...p, [priceKey]: e.target.value }))}
                            onBlur={(e) => askPriceScope(i, c, priceKey, e.target.value)}
                          />
                          <a style={{ fontSize: 10.5, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}
                            title="Set a negotiated one-off price for this order — the price list is not changed"
                            onClick={() => setAgreedPrice(i, effPpl ? effPpl.toFixed(4) : '')}>✎ agreed price</a>
                        </div>
                      )}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Unit price">{unitPrice > 0 ? `£${unitPrice.toFixed(2)}` : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }} data-label="Qty">{c.qty}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: lineTotal > 0 ? 700 : 400 }} data-label="Line total">{lineTotal > 0 ? `£${lineTotal.toFixed(2)}` : '—'}</td>
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
                    {deliveryTouched ? (
                      <span style={{ marginLeft: 5, color: 'var(--gold)', fontSize: 11 }}>✎ manual · <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setDeliveryTouched(false)}>reset to auto</a></span>
                    ) : hasPerPalletPricing()
                      ? <span style={{ marginLeft: 5, color: 'var(--accent)', fontSize: 11 }}>⚡ per-pallet rate (per product)</span>
                      : custDeliveryTiers.length > 0 && <span style={{ marginLeft: 5, color: 'var(--accent)', fontSize: 11 }}>⚡ auto from pallet tiers</span>}
                    {!deliveryTouched && custFreeAbove > 0 && <span style={{ marginLeft: 5, color: 'var(--accent)', fontSize: 11 }}>· free above £{custFreeAbove}</span>}
                    {!deliveryTouched && <a style={{ marginLeft: 8, cursor: 'pointer', textDecoration: 'underline', color: 'var(--muted)', fontSize: 11 }}
                      title="Force no delivery charge for this order (stops the pallet-tier auto-calc adding one)"
                      onClick={() => { setDeliveryCharge('0.00'); setDeliveryTouched(true) }}>set no charge</a>}
                  </span>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: 8, color: 'var(--muted)', fontSize: 13 }}>£</span>
                    <input className="mono" style={{ textAlign: 'right', paddingLeft: 20, width: 90 }}
                      value={deliveryCharge} placeholder="0.00"
                      onChange={(e) => { setDeliveryCharge(e.target.value); setDeliveryTouched(true) }} />
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10, position: 'relative', zIndex: 6 }}>
            <button className="btn btn-g" onClick={emailProforma}
              title={(invoiceContact(order)?.email || '').trim() ? `Email proforma to ${invoiceContact(order).email}` : 'No email on file — add one via Edit details'}>
              ✉ Email proforma
            </button>
            <button className="btn btn-a" onClick={runProforma}>📄 Proforma invoice</button>
          </div>
          {!orderComplete && <StepCheck done={reviewDone[3]} onCheck={() => tick('pricing')} label="Pricing is right — next" />}
        </div>
        </PricingGuard>
      )}

      {/* Paperwork lives here, near the top — it's what people come to an order
          for, and it used to be buried at the very bottom of the page. */}
      <div className={'card step-card step-' + reviewState(4)}>
        <StepHead n={4} title="Documents" state={reviewState(4)} />
        <div className="doc-actions">
          <button className="doc-btn" onClick={() => generatePurchaseOrderPDF({ ...order, lines }, products, packaging, letterheads[lhIndex] || {})}>
            <span className="doc-ico">📄</span>
            <span className="doc-name">Purchase order</span>
            <span className="doc-sub">To buy the stock in</span>
          </button>
          <button className="doc-btn" onClick={printNote}>
            <span className="doc-ico">🖨</span>
            <span className="doc-name">Print for board</span>
            <span className="doc-sub">80mm wall-board slip</span>
          </button>
          {isAdmin && (
            <button className="doc-btn" onClick={runProforma}>
              <span className="doc-ico">🧾</span>
              <span className="doc-name">Proforma</span>
              <span className="doc-sub">Priced quote for the customer</span>
            </button>
          )}
          {latestNote ? (
            <>
              <button className="doc-btn" onClick={() => reprintPDF(latestNote)}>
                <span className="doc-ico">📋</span>
                <span className="doc-name">Delivery note</span>
                <span className="doc-sub">Reprint {latestNote.doc_no}</span>
              </button>
              {isAdmin && (
                <button
                  className={'doc-btn' + (unpricedLines.length ? ' doc-btn-off' : '')}
                  onClick={() => printOfficeCopy(latestNote)}
                  title={unpricedLines.length ? 'Every product needs a price before this can be printed' : ''}
                >
                  <span className="doc-ico">💷</span>
                  <span className="doc-name">For invoicing</span>
                  <span className="doc-sub">
                    {unpricedLines.length
                      ? `🔒 ${unpricedLines.length} product${unpricedLines.length === 1 ? '' : 's'} still unpriced`
                      : 'Office copy with prices'}
                  </span>
                </button>
              )}
            </>
          ) : (
            <div className="doc-btn doc-btn-off">
              <span className="doc-ico">📋</span>
              <span className="doc-name">Delivery note</span>
              <span className="doc-sub">Create one below first</span>
            </div>
          )}
        </div>
      </div>

      <div className={'card step-card step-' + reviewState(5)}>
        <StepHead n={5} title="Generate the delivery note" state={reviewState(5)} />
        <div className="row c3" style={{ marginBottom: 4 }}>
          <div className="field"><label>Delivery note number</label>
            <input className="mono" value={docNoOverride}
              placeholder={/^DN-\d+$/i.test(order.order_no) ? order.order_no : 'auto (next DN number)'}
              onChange={(e) => setDocNoOverride(e.target.value)} />
            <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>Leave blank to use {/^DN-\d+$/i.test(order.order_no) ? `${order.order_no}` : 'the next number automatically'}. Type here to set your own.</p>
          </div>
          <div className="field"><label>Letterhead</label>
            <select value={lhIndex} onChange={(e) => setLhIndex(+e.target.value)}>
              {letterheads.map((l, i) => <option key={l.id} value={i}>{l.name} — {l.company}</option>)}
            </select></div>
          <div className="field"><label>Date</label>
            <input className="mono" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
          <div className="field"><label>Load</label>
            {/* IBCs are counted off the order; only extra pallets get typed. */}
            <div className="mono" style={{
              background: ibcCount > 0 ? 'var(--accent-soft)' : 'var(--panel-2)',
              border: `1px solid ${ibcCount > 0 ? 'var(--accent)' : 'var(--line-solid)'}`,
              borderRadius: 9, padding: '9px 13px', fontSize: 14, fontWeight: 700,
              color: ibcCount > 0 ? 'var(--accent)' : 'var(--muted)',
            }}>
              {ibcCount > 0 ? `${ibcCount} IBC${ibcCount === 1 ? '' : 's'}` : 'No IBCs'}
            </div>
            <p className="hint" style={{ marginTop: 4, marginBottom: 8 }}>
              Counted from the 600 L / 1000 L lines on this order.
            </p>
            <label style={{ marginBottom: 5 }}>
              {ibcCount > 0 ? 'Extra pallets' : 'Number of pallets'}
              <span style={{
                textTransform: 'none', letterSpacing: 0, fontWeight: 500,
                color: ibcCount > 0 ? 'var(--faint)' : 'var(--warn, #B07E28)',
              }}> · {ibcCount > 0 ? 'optional' : 'required'}</span>
            </label>
            <input className={'mono' + (palletsFlash ? ' flash-error' : '')}
              type="number" min="0" value={extraPallets}
              disabled={noPallets}
              placeholder={noPallets ? 'no pallets' : '0'}
              onChange={(e) => { setExtraPallets(e.target.value); setPalletsFlash(false) }} />
            {ibcCount === 0 && (
              <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0, fontSize: 12, cursor: 'pointer', marginTop: 6 }}>
                <input type="checkbox" checked={noPallets}
                  onChange={(e) => { setNoPallets(e.target.checked); if (e.target.checked) { setExtraPallets(''); setPalletsFlash(false) } }}
                  style={{ width: 'auto', height: 15, accentColor: 'var(--accent)' }} />
                No pallets needed
              </label>
            )}
            <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
              {ibcCount > 0
                ? 'Only pallets of smaller packs — leave blank if there aren’t any.'
                : 'No IBCs on this order, so the pallet count can’t be worked out — enter it or tick above.'}
              {totalPallets > 0 && <> Note will read <b>{ibcCount > 0
                ? `${ibcCount} IBC${ibcCount === 1 ? '' : 's'}${(parseInt(extraPallets, 10) || 0) > 0 ? ` + ${parseInt(extraPallets, 10)} pallet${parseInt(extraPallets, 10) === 1 ? '' : 's'}` : ''}`
                : `${totalPallets} pallet${totalPallets === 1 ? '' : 's'}`}</b>.</>}
            </p>
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
          <StepHead n={6} title="Delivery notes on this order" state={reviewState(6)} />
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
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-g btn-sm" onClick={() => reprintPDF(d)}>Delivery Note</button>
                  {isAdmin && (
                    <>
                      <button className="btn btn-g btn-sm" onClick={() => generateProformaPDF(
                        {
                          docNo: d.doc_no || order.order_no, date: todayISO(),
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

      {priceScope && (() => {
        const s = priceScope
        const packLabel = s.packName || 'pack'
        const perPack = (p) => (s.vol > 0 ? ` = £${(p * s.vol).toFixed(2)} per ${packLabel}` : '')
        return (
          <div className="modal-bg" onClick={() => setPriceScope(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, textAlign: 'left', padding: 0, overflow: 'hidden' }}>
              <div style={{ background: '#C24E42', color: '#fff', padding: '14px 20px' }}>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '.02em' }}>⚠ STOP AND READ — you changed a price</div>
                <div style={{ fontSize: 13, marginTop: 2, opacity: 0.95 }}>Choose where this new price applies. Nothing has been saved yet.</div>
              </div>
              <div style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{s.productName}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                  {packLabel} · customer: <b style={{ color: 'var(--ink)' }}>{custName}</b>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', fontWeight: 700 }}>Was</div>
                    <div className="mono" style={{ fontSize: 17, textDecoration: 'line-through', color: 'var(--muted)' }}>£{s.before.toFixed(4)}/L</div>
                  </div>
                  <div style={{ fontSize: 22, color: 'var(--muted)' }}>→</div>
                  <div>
                    <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--accent)', fontWeight: 700 }}>New</div>
                    <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>£{s.next.toFixed(4)}/L{perPack(s.next)}</div>
                  </div>
                </div>

                <button
                  onClick={commitPriceToList}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 12,
                    border: '2px solid var(--accent)', background: 'var(--accent-soft, #E7F2EB)', borderRadius: 12, padding: '16px 18px', fontFamily: 'inherit',
                  }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)' }}>💾 SAVE TO {custName.toUpperCase()}&apos;S PRICE LIST</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4 }}>
                    <b>Every future order</b> of {s.productName} in {packLabel} for {custName} will be
                    {' '}<b>£{s.next.toFixed(4)} per litre{perPack(s.next)}</b>. This changes their price on file for good.
                  </div>
                </button>

                <button
                  onClick={commitPriceToOrderOnly}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    border: '2px solid var(--warn, #B07E28)', background: '#FCF4E2', borderRadius: 12, padding: '16px 18px', fontFamily: 'inherit',
                  }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#7A5511' }}>📄 THIS ORDER ONLY</div>
                  <div style={{ fontSize: 13, color: '#7A5511', marginTop: 4 }}>
                    A one-off agreed price for this order. {custName}&apos;s price list <b>stays at £{s.before.toFixed(4)}/L</b> for next time.
                  </div>
                </button>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn btn-g" onClick={() => setPriceScope(null)}>Cancel — leave the price as it was</button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {unpricedModal && (() => {
        const item = unpricedModal
        const customPPL = item.vol > 0 ? (parseFloat(unpricedPackPrice) || 0) / item.vol : 0
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

      {emailModal && (
        <div className="modal-bg" onClick={() => !emailModal.busy && setEmailModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 6 }}>Email proforma</h2>
            {emailModal.busy ? (
              <p className="hint" style={{ marginTop: 0 }}>Preparing the secure link…</p>
            ) : (
              <>
                <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
                  Opens your mail app with the message below and a secure link (valid 90 days). Your own email signature is added by your mail app.
                </p>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>To</label>
                  <input value={emailModal.to} onChange={(e) => setEmailModal((m) => ({ ...m, to: e.target.value }))} />
                </div>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>Greeting name (Dear …)</label>
                  <input value={emailModal.name} onChange={(e) => setEmailModal((m) => ({ ...m, name: e.target.value }))} />
                </div>
                <div className="field" style={{ marginBottom: 4 }}>
                  <label>Secure link</label>
                  <input className="mono" style={{ fontSize: 11 }} readOnly value={emailModal.link} onFocus={(e) => e.target.select()} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                  <button className="btn btn-g" onClick={() => setEmailModal(null)}>Cancel</button>
                  <button className="btn btn-a" onClick={sendProformaEmail} disabled={!emailModal.to.trim() || !emailModal.link}>✉ Open email</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <AddProductModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        products={products}
        packaging={packaging}
        customerId={order.customer_id}
        customerName={order.customer_snapshot?.name || ''}
        isAdmin={isAdmin}
        availableByProduct={availableByProduct}
        onDone={handleProductAdded}
      />

      {PricingModal}

      {batchModal && (
        <div className="modal-bg" onClick={() => !busy && setBatchModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 6 }}>Before the delivery note is generated</h2>

            {/* The dispatch date is the day the goods actually go out, which
                isn't always the day the note is printed — so it's confirmed
                here rather than silently defaulting to today. */}
            <div style={{ border: '2px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 10, padding: '12px 14px', marginTop: 10, marginBottom: 14 }}>
              <label style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 6 }}>Dispatch Date — check this is right</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="mono" type="date" value={docDate}
                  style={{ maxWidth: 190, fontSize: 15, fontWeight: 700, borderColor: 'var(--accent)' }}
                  onChange={(e) => setDocDate(e.target.value)} />
                {docDate !== todayISO() && (
                  <button className="btn btn-g btn-sm" onClick={() => setDocDate(todayISO())}>Set to today</button>
                )}
              </div>
              <p className="hint" style={{ marginTop: 5, marginBottom: 0 }}>
                The day the goods actually leave — this prints on the note as <b>Dispatch Date</b>. Change it if you&apos;re printing ahead or after the event.
              </p>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Batch numbers</div>
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

      {/* Follows you down the page — you can save from wherever you are. */}
      {linesDirty && !batchModal && !priceScope && !unpricedModal && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
          display: 'flex', justifyContent: 'center', pointerEvents: 'none',
          padding: '0 12px calc(16px + env(safe-area-inset-bottom))',
        }}>
          <div style={{
            pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            background: '#C24E42', color: '#fff', borderRadius: 12, padding: '12px 18px',
            boxShadow: '0 6px 24px rgba(0,0,0,.28)', maxWidth: '100%',
          }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>⚠ You have unsaved changes to the products</span>
            <button className="btn btn-sm" style={{ background: '#fff', color: '#C24E42', fontWeight: 800, border: 'none' }} onClick={saveLines}>
              💾 Save products
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Numbered step header for the order page. 'active' is where you should be,
// 'done' is ticked and quiet, 'todo' waits its turn. onCheck adds the
// "I've checked this" button that moves you on.
function StepHead({ n, title, state, children }) {
  const done = state === 'done'
  const active = state === 'active'
  return (
    <div className="ttl" style={{ alignItems: 'center' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{
          width: 21, height: 21, borderRadius: '50%', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800,
          background: done ? 'var(--accent)' : active ? 'var(--accent-soft)' : 'var(--chip-bg)',
          color: done ? 'var(--on-accent)' : active ? 'var(--accent)' : 'var(--faint)',
        }}>{done ? '✓' : n}</span>
        <span style={{ color: active ? 'var(--accent)' : undefined }}>{title}</span>
      </h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  )
}

// The "I've looked at this" button — big, and at the bottom right of the
// section, which is where you are once you've actually read the section.
function StepCheck({ done, onCheck, label }) {
  return (
    <div className="step-check">
      <button className={'btn step-check-btn ' + (done ? 'btn-g' : 'btn-a')} onClick={onCheck}>
        {done ? '✓ Checked — click to undo' : (label || 'Checked — next step')}
      </button>
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
// Merge a contact field (name/email/phone) from several possible sources,
// taking the first non-empty value for EACH field independently — so an email
// held in one source isn't lost just because another source has a name.
function mergeContactField(field, ...sources) {
  for (const s of sources) { const v = s?.[field]; if (v) return v }
  return ''
}

// The delivery-side contact (for the driver / delivery note).
function orderContact(order) {
  const s = order?.customer_snapshot || {}
  const del = s.delivery_contact || s.contact || {}
  const fromDeliver = splitContact(s.deliver || '').contact
  const fromDetails = splitContact(s.details || '').contact
  const m = {
    name: mergeContactField('name', del, fromDeliver, fromDetails),
    email: mergeContactField('email', del, fromDeliver, fromDetails),
    phone: mergeContactField('phone', del, fromDeliver, fromDetails),
  }
  return (m.name || m.email || m.phone) ? m : null
}

// The invoice-side contact (for the proforma / invoicing). Draws each field
// from the invoice contact, then the invoice address text, then the delivery
// contact — so the email is found wherever it happens to be stored.
function invoiceContact(order) {
  const s = order?.customer_snapshot || {}
  const inv = s.invoice_contact || {}
  const fromDetails = splitContact(s.details || '').contact
  const del = orderContact(order) || {}
  const m = {
    name: mergeContactField('name', inv, fromDetails, del),
    email: mergeContactField('email', inv, fromDetails, del),
    phone: mergeContactField('phone', inv, fromDetails, del),
  }
  return (m.name || m.email || m.phone) ? m : null
}

