'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { nextNo, splitContact, unifiedAddresses, todayISO } from '@/lib/calc'
import { ok, toast, toastError } from '@/lib/notify'
import { useIsAdmin } from '@/app/(app)/PricingGuard'
import LineEditor from '../LineEditor'
import Combobox from '../../Combobox'
import AddProductModal from '../AddProductModal'

const firstLine = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || ''
const normAddr = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()

export default function NewOrderPage() {
  const supabase = createClient()
  const router = useRouter()

  const [products, setProducts] = useState([])
  const [packaging, setPackaging] = useState([])
  const [customers, setCustomers] = useState([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(1)

  const [orderNo, setOrderNo] = useState('ORD-1001')
  const [customerId, setCustomerId] = useState('')
  const [custDetails, setCustDetails] = useState('')
  const [custDeliver, setCustDeliver] = useState('')
  const [invoiceOptions, setInvoiceOptions] = useState([])
  const [deliveryOptions, setDeliveryOptions] = useState([])
  const [invoiceIdx, setInvoiceIdx] = useState(0)
  const [deliveryIdx, setDeliveryIdx] = useState(0)
  const [contactName, setContactName] = useState('')       // delivery contact
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [invContact, setInvContact] = useState({ name: '', email: '', phone: '' }) // invoice contact
  const [poRef, setPoRef] = useState('')
  const [orderDate, setOrderDate] = useState(todayISO())
  const [requestedDate, setRequestedDate] = useState('')
  // Which month this order counts towards on Insights and the Ilex/sales report.
  // null = its natural month (nothing changes). Admins are asked once, after the
  // customer details, before moving on to the products step.
  const [reportMonth, setReportMonth] = useState(null)
  const [monthAsked, setMonthAsked] = useState(false)
  const [monthModal, setMonthModal] = useState(false)
  const [lines, setLines] = useState([])
  const [notes, setNotes] = useState('')
  const [availableByProduct, setAvailableByProduct] = useState({})
  const [customerCatalog, setCustomerCatalog] = useState([]) // [{product, options:[{packaging}]}]
  const [pending, setPending] = useState({}) // key 'productId::packagingId' → qty string while entering
  // productId → { packagingId, qty, ppl } while adding a size outside their range
  const [otherSize, setOtherSize] = useState({})
  const [addrConfirmed, setAddrConfirmed] = useState(false)
  const custName = customers.find((x) => x.id === customerId)?.name || 'this customer'
  const isAdmin = useIsAdmin()
  const [showAdd, setShowAdd] = useState(false) // "add a product" modal

  useEffect(() => {
    (async () => {
      const [p, k, c, o] = await Promise.all([
        supabase.from('products').select('*').order('name'),
        supabase.from('packaging').select('*').order('volume'),
        supabase.from('customers').select('*').order('name'),
        // Orders carry an ORD- reference at entry; the DN number is only
        // allocated when the delivery note is generated (so DN numbers follow
        // dispatch order, not entry order).
        supabase.from('orders').select('order_no').ilike('order_no', 'ORD-%').order('created_at', { ascending: false }).limit(1),
      ])
      const prods = p.data || [], packs = k.data || [], custs = c.data || []
      setProducts(prods); setPackaging(packs); setCustomers(custs)
      if (o.data?.[0]?.order_no) setOrderNo(nextNo(o.data[0].order_no))
      if (prods.length && packs.length) setLines([{ productId: prods[0].id, packagingId: packs[0].id, qty: '1' }])
      setReady(true)
    })()
  }, [])

  // Refresh product/packaging catalogues on tab focus so SG/weight edits made
  // in the admin reflect here without a reload.
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

  async function loadAvailablePackaging(cid) {
    const { data } = await supabase.from('customer_product_prices')
      .select('product_id, packaging_id').eq('customer_id', cid)
    const rows = data || []
    const map = {}
    for (const r of rows) {
      if (!map[r.product_id]) map[r.product_id] = []
      if (!map[r.product_id].includes(r.packaging_id)) map[r.product_id].push(r.packaging_id)
    }
    setAvailableByProduct(map)
    // Build catalog for quick-add grid
    const catalog = []
    for (const [productId, packagingIds] of Object.entries(map)) {
      const product = products.find((p) => p.id === productId)
      if (!product) continue
      const options = packagingIds
        .map((pid) => packaging.find((k) => k.id === pid))
        .filter(Boolean)
        .sort((a, b) => (a.volume || 0) - (b.volume || 0))
      if (options.length) catalog.push({ product, options })
    }
    catalog.sort((a, b) => {
      const cc = (a.product.category || '').localeCompare(b.product.category || '')
      return cc !== 0 ? cc : a.product.name.localeCompare(b.product.name)
    })
    setCustomerCatalog(catalog)
  }

  function chipKey(productId, packagingId) { return `${productId}::${packagingId}` }

  // Idle chip clicked → enter qty mode
  function startChip(productId, packagingId) {
    setPending((p) => ({ ...p, [chipKey(productId, packagingId)]: '1' }))
  }

  // ✕ cancel qty input
  function cancelChip(productId, packagingId) {
    setPending((p) => { const n = { ...p }; delete n[chipKey(productId, packagingId)]; return n })
  }

  // ✓ confirm → add line and clear pending
  function confirmChip(productId, packagingId) {
    const qty = pending[chipKey(productId, packagingId)] || '1'
    setLines((ls) => [...ls, { productId, packagingId, qty: String(parseInt(qty) || 1) }])
    cancelChip(productId, packagingId)
  }

  // Click an "added" chip → remove the line
  function removeChip(productId, packagingId) {
    setLines((ls) => ls.filter((l) => !(l.productId === productId && l.packagingId === packagingId)))
  }

  // Take a product out of this customer's range for good. Deliberately NOT the
  // same thing as taking it off the order — that is the green chip. This deletes
  // their price for it, so the tile stops appearing on their orders.
  async function removeFromRange(product) {
    if (!customerId) return
    const warn = `Remove ${product.name} from ${custName}'s range?\n\n`
      + `This is NOT how you take it off this order — click the green chip for that.\n\n`
      + `It deletes ${custName}'s price for ${product.name}, so it will stop appearing here on their future orders. `
      + `The product itself stays in the product list and other customers are unaffected.`
    if (!confirm(warn)) return
    const res = await supabase.from('customer_product_prices').delete()
      .eq('customer_id', customerId).eq('product_id', product.id)
    if (!ok(res, 'removing it from their range')) return
    setCustomerCatalog((cat) => cat.filter((row) => row.product.id !== product.id))
    setAvailableByProduct((m) => { const n = { ...m }; delete n[product.id]; return n })
    toast(`${product.name} removed from ${custName}'s range`)
  }

  // ── "other size" on a quick-add card ──────────────────────────────────────
  // A size the customer has never been priced for. Admins are asked for the
  // price there and then; everyone else just adds it and it shows as unpriced,
  // which blocks the invoicing copy until an admin fills it in.
  function openOtherSize(productId) {
    setOtherSize((o) => ({ ...o, [productId]: { packagingId: '', qty: '1', ppl: '' } }))
  }
  function closeOtherSize(productId) {
    setOtherSize((o) => { const n = { ...o }; delete n[productId]; return n })
  }
  function setOtherSizeField(productId, patch) {
    setOtherSize((o) => ({ ...o, [productId]: { ...o[productId], ...patch } }))
  }

  async function addOtherSize(productId) {
    const s = otherSize[productId]
    if (!s?.packagingId) { toastError('Choose a size first'); return }
    const ppl = parseFloat(s.ppl) || 0
    if (isAdmin && ppl > 0 && customerId) {
      const { error } = await supabase.from('customer_product_prices').upsert(
        { customer_id: customerId, product_id: productId, packaging_id: s.packagingId, price_per_litre: ppl, updated_at: new Date().toISOString() },
        { onConflict: 'customer_id,product_id,packaging_id' })
      if (error) { toastError('Could not save the price: ' + error.message); return }
      // It's in their range now — show it as a permanent chip on the card.
      setAvailableByProduct((m) => ({ ...m, [productId]: [...new Set([...(m[productId] || []), s.packagingId])] }))
      setCustomerCatalog((cat) => cat.map((row) => (row.product.id === productId && !row.options.some((k) => k.id === s.packagingId)
        ? { ...row, options: [...row.options, packaging.find((k) => k.id === s.packagingId)].filter(Boolean).sort((a, b) => (a.volume || 0) - (b.volume || 0)) }
        : row)))
      toast(`Added to ${custName}'s price list at £${ppl.toFixed(4)}/L`)
    } else if (isAdmin) {
      toast('Added with no price — set one before the invoicing copy can be printed')
    } else {
      toast('Added — an admin will price it before invoicing')
    }
    setLines((ls) => [...ls, { productId, packagingId: s.packagingId, qty: String(parseInt(s.qty) || 1) }])
    closeOtherSize(productId)
  }

  // Handle a product added via the shared modal: register a new catalogue
  // product, extend the customer's available list if a price was saved, and
  // append the order line.
  // A product's SG or hazard details were edited from the line table — swap in
  // the saved version so weights and hazard text redraw straight away.
  function applyProductUpdate(updated) {
    setProducts((ps) => ps.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
  }

  function handleProductAdded({ line, product, packagingId, priceSaved, created, addedToRange }) {
    if (created && product) setProducts((ps) => [...ps, product].sort((a, b) => a.name.localeCompare(b.name)))
    if (addedToRange || priceSaved != null) {
      setAvailableByProduct((m) => ({ ...m, [line.productId]: [...new Set([...(m[line.productId] || []), packagingId])] }))
    }
    setLines((ls) => [...ls, line])
  }

  function pickCustomer(id) {
    setCustomerId(id)
    setCustomerCatalog([])
    setLines([])
    setPending({})
    loadAvailablePackaging(id)
    const c = customers.find((x) => x.id === id)
    if (!c) return
    // One address pool; the same list serves both invoice and delivery pickers.
    const list = unifiedAddresses(c)
    const options = list.length ? list : [{ label: 'Main', text: c.details || c.deliver || '', contact: { name: c.contact_name || '', email: c.email || '', phone: c.phone || '' } }]
    setInvoiceOptions(options); setDeliveryOptions(options)
    setAddrConfirmed(false)
    // Start on the address flagged as the customer's invoice default, if they
    // have one; otherwise the first in the list as before.
    const invIdx = Math.max(0, options.findIndex((a) => a.invoice_default))
    setInvoiceIdx(invIdx); setDeliveryIdx(0)
    setCustDetails(splitContact(options[invIdx]?.text || '').address)
    setCustDeliver(splitContact(options[0]?.text || '').address)
    const ctInv = options[invIdx]?.contact || {}
    const ctDel = options[0]?.contact || {}
    setInvContact({ name: ctInv.name || '', email: ctInv.email || '', phone: ctInv.phone || '' })
    setContactName(ctDel.name || ''); setContactEmail(ctDel.email || ''); setContactPhone(ctDel.phone || '')
  }

  function pickInvoiceAddr(i) {
    setInvoiceIdx(i)
    const opt = invoiceOptions[i] || {}
    setCustDetails(splitContact(opt.text || '').address)
    const ct = opt.contact || {}
    setInvContact({ name: ct.name || '', email: ct.email || '', phone: ct.phone || '' })
  }

  function pickDeliveryAddr(i) {
    setDeliveryIdx(i)
    const opt = deliveryOptions[i] || {}
    setCustDeliver(splitContact(opt.text || '').address)
    const ct = opt.contact || {}
    setContactName(ct.name || ''); setContactEmail(ct.email || ''); setContactPhone(ct.phone || '')
  }

  // Queue of manually-entered addresses we offer to save to the customer's
  // address book before moving on. Each: { kind:'invoice'|'delivery', label, text, contact? }
  const [addrQueue, setAddrQueue] = useState([])
  const addrPrompt = addrQueue[0] || null

  function proceedToStep2() {
    // Admins are asked once, here, which month to invoice this order in.
    if (isAdmin && !monthAsked) { setMonthModal(true); return }
    setStep(2)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Their choice from the month popup: 0 = this month (no change), +1 = next,
  // -1 = last. We proceed to step 2 directly because monthAsked won't have
  // updated in state yet on this same tick.
  function chooseInvoiceMonth(delta) {
    setReportMonth(delta === 0 ? null : shiftMonthISO(orderDate || todayISO(), delta))
    setMonthAsked(true)
    setMonthModal(false)
    setStep(2)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Step 1 is worked through in order: the section you're on is outlined, the
  // ones behind it are ticked off, the ones ahead sit quietly until you get
  // there. Nothing is locked — data doesn't always arrive in a tidy order, and
  // the Next button is what actually enforces the required fields.
  // Addresses fill themselves in from the customer, so "has text in it" would
  // mark the section finished before anyone had looked at it — it needs an
  // explicit "these are right" instead, which is worth confirming anyway.
  const sectionDone = {
    1: !!customerId,
    2: !!poRef.trim(),
    3: addrConfirmed && !!custDetails.trim() && !!custDeliver.trim(),
    4: !!(contactName.trim() || contactEmail.trim() || contactPhone.trim()),
  }
  // Strictly in order: the first unfinished section is the active one, so a
  // later section can never light up ahead of an earlier one.
  function sectionState(n) {
    let firstOpen = 5
    for (let i = 1; i <= 4; i++) if (!sectionDone[i]) { firstOpen = i; break }
    if (n < firstOpen) return 'done'
    if (n === firstOpen) return 'active'
    return 'todo'
  }

  function goToStep2() {
    // It prints on the delivery note, so it has to be captured up front.
    if (!poRef.trim()) {
      toastError('Enter the Customer No before carrying on — it prints on their delivery note')
      document.getElementById('po-ref-input')?.focus()
      return
    }
    if (!custDetails.trim()) { alert('Please fill in the invoice address'); return }
    // If an address was typed/edited by hand for a known customer (it doesn't
    // match any stored address), offer to save it to their address book —
    // label defaults to the first line (usually the head office / site name).
    if (customerId) {
      const queue = []
      const matchIdx = (opts, text) => opts.findIndex((a) =>
        normAddr(a.text) === normAddr(text) || normAddr(splitContact(a.text || '').address) === normAddr(text))
      // Invoice: unknown text → offer to save; known but never verified (e.g.
      // AI-imported from a screenshot) → one-time verification check.
      const invIdx = custDetails.trim() ? matchIdx(invoiceOptions, custDetails) : -1
      if (custDetails.trim() && invIdx === -1) {
        queue.push({ mode: 'save', kind: 'invoice', label: firstLine(custDetails), text: custDetails.trim() })
      } else if (invIdx >= 0 && !invoiceOptions[invIdx].verified) {
        queue.push({ mode: 'verify', kind: 'invoice', idx: invIdx, label: invoiceOptions[invIdx].label || '', text: invoiceOptions[invIdx].text || '' })
      }
      const delIdx = custDeliver.trim() ? matchIdx(deliveryOptions, custDeliver) : -1
      if (custDeliver.trim() && delIdx === -1) {
        queue.push({
          mode: 'save', kind: 'delivery', label: firstLine(custDeliver), text: custDeliver.trim(),
          contact: { name: contactName || '', email: contactEmail || '', phone: contactPhone || '' },
        })
      } else if (delIdx >= 0 && !deliveryOptions[delIdx].verified) {
        const e = deliveryOptions[delIdx]
        queue.push({
          mode: 'verify', kind: 'delivery', idx: delIdx, label: e.label || '', text: e.text || '',
          contact: { name: e.contact?.name || '', email: e.contact?.email || '', phone: e.contact?.phone || '' },
        })
      }
      if (queue.length) { setAddrQueue(queue); return } // modal takes over, then proceeds
    }
    proceedToStep2()
  }

  function patchAddrPrompt(patch) {
    setAddrQueue((q) => [{ ...q[0], ...patch }, ...q.slice(1)])
  }

  function advanceAddrQueue() {
    const rest = addrQueue.slice(1)
    setAddrQueue(rest)
    if (rest.length === 0) proceedToStep2()
  }

  // Persist the unified address list to the customer, mirroring legacy fields.
  function addrPatch(list) {
    const first = list.find((a) => a.text) || {}
    return {
      addresses: list, invoice_addresses: list, delivery_addresses: list,
      details: first.text || '', deliver: first.text || '',
      contact_name: first.contact?.name || '', email: first.contact?.email || '', phone: first.contact?.phone || '',
    }
  }

  // One-time verification of an AI-imported address: persist edits + the
  // verified flag onto the customer's address book, then update the form.
  async function confirmVerify() {
    const item = addrPrompt
    const c = customers.find((x) => x.id === customerId)
    if (!item || !c) { advanceAddrQueue(); return }
    const { data: { user } } = await supabase.auth.getUser()
    const stamp = { verified: true, verified_at: new Date().toISOString(), verified_by: user?.email || '' }
    const next = unifiedAddresses(c).map((a, ix) => (ix === item.idx ? { ...a, label: item.label || a.label, text: item.text, contact: item.contact || a.contact, ...stamp } : a))
    if (ok(await supabase.from('customers').update(addrPatch(next)).eq('id', customerId), 'saving verification')) {
      setCustomers((cs) => cs.map((x) => (x.id === customerId ? { ...x, ...addrPatch(next) } : x)))
      setInvoiceOptions(next); setDeliveryOptions(next)
      if (item.kind === 'invoice') { setCustDetails(splitContact(item.text).address); setInvContact(item.contact || { name: '', email: '', phone: '' }) }
      else { setCustDeliver(splitContact(item.text).address); setContactName(item.contact?.name || ''); setContactEmail(item.contact?.email || ''); setContactPhone(item.contact?.phone || '') }
      toast(`${item.kind === 'invoice' ? 'Invoice' : 'Delivery'} address verified ✓`)
    }
    advanceAddrQueue()
  }

  async function saveAddrPrompt() {
    const item = addrPrompt
    const c = customers.find((x) => x.id === customerId)
    if (!item || !c) { advanceAddrQueue(); return }
    const entryLabel = (item.label || firstLine(item.text)).trim()
    const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const cur = unifiedAddresses(c).filter((a) => a.text)
    const entry = { label: entryLabel, text: item.text, contact: item.contact || { name: '', email: '', phone: '' }, verified: true, verified_at: new Date().toISOString() }
    const hitIdx = cur.findIndex((a) => norm(a.text) === norm(item.text))
    const next = hitIdx >= 0
      ? cur.map((a, ix) => (ix === hitIdx ? { ...a, label: a.label || entry.label, verified: true, contact: (a.contact?.email || a.contact?.phone || a.contact?.name) ? a.contact : entry.contact } : a))
      : [...cur, entry]
    if (ok(await supabase.from('customers').update(addrPatch(next)).eq('id', customerId), 'saving the address')) {
      setCustomers((cs) => cs.map((x) => (x.id === customerId ? { ...x, ...addrPatch(next) } : x)))
      setInvoiceOptions(next); setDeliveryOptions(next)
      toast(`Address saved to ${c.name}`)
    }
    advanceAddrQueue()
  }

  async function saveOrder() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const name = customers.find((c) => c.id === customerId)?.name || custDetails.split('\n')[0]

    // Guard against duplicate DN numbers: if two people are entering orders at
    // once (or the number was edited to one that exists), bump to the next free
    // number instead of silently creating a duplicate.
    let useNo = orderNo
    let data = null, error = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: clash } = await supabase.from('orders').select('id').eq('order_no', useNo).limit(1)
      if (clash && clash.length) {
        const { data: latest } = await supabase.from('orders').select('order_no').order('created_at', { ascending: false }).limit(1)
        const bumped = nextNo(latest?.[0]?.order_no || useNo)
        useNo = bumped === useNo ? nextNo(useNo) : bumped
        continue
      }
      ;({ data, error } = await supabase.from('orders').insert({
        order_no: useNo,
        customer_id: customerId || null,
        customer_snapshot: {
          name, details: custDetails, deliver: custDeliver,
          contact: { name: contactName, email: contactEmail, phone: contactPhone }, // delivery contact (driver)
          delivery_contact: { name: contactName, email: contactEmail, phone: contactPhone },
          invoice_contact: { name: invContact.name, email: invContact.email, phone: invContact.phone },
        },
        po_ref: poRef,
        order_date: orderDate || null,
        report_month: reportMonth,
        requested_date: requestedDate || null,
        status: 'New',
        notes,
        lines,
        created_by: user?.id || null,
        added_by: user?.email || null,
      }).select('id').single())
      // 23505 = unique violation (someone grabbed the number between our check and insert)
      if (error && error.code === '23505') { error = null; data = null; useNo = nextNo(useNo); continue }
      break
    }
    setBusy(false)
    if (error) { alert('Could not save: ' + error.message); return }
    if (!data) { alert('Could not find a free delivery note number — please check the Order Book and try again.'); return }
    if (useNo !== orderNo) alert(`Note: ${orderNo} was already taken, so this order was saved as ${useNo}.`)
    router.push(`/orders/${data.id}`)
  }

  if (!ready) return <div className="card"><div className="empty">Loading…</div></div>

  const customerOptions = customers.map((c) => ({ id: c.id, label: c.name }))

  return (
    <div style={{ maxWidth: step === 2 ? 1180 : 760, margin: '0 auto', transition: 'max-width 0.2s' }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28, maxWidth: 760, marginLeft: 'auto', marginRight: 'auto' }}>
        <StepBubble n={1} active={step === 1} done={step > 1} label="Customer & Dates" />
        <div style={{ flex: 1, height: 2, background: step > 1 ? 'var(--accent)' : 'var(--border)', margin: '0 4px', transition: 'background 0.2s' }} />
        <StepBubble n={2} active={step === 2} done={false} label="Products" />
      </div>

      {step === 1 && (
        <div className="card">
          <div className="ttl"><h2>New Order</h2></div>

          <Section n={1} title="Customer" state={sectionState(1)}>
            <Field label="Customer">
              <Combobox options={customerOptions} value={customerId} onSelect={pickCustomer} placeholder="Type customer name to search…" />
            </Field>
          </Section>

          <Section n={2} title="Order details" state={sectionState(2)}>
            <Field label="Order Reference">
              <input className="mono" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
              <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>The DN number is assigned when the delivery note is created, so notes are numbered in dispatch order.</p>
            </Field>

            <div className="field" style={{ marginBottom: 14 }}>
              <label>
                Customer No
                <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: 'var(--faint)' }}> · required</span>
              </label>
              <input
                id="po-ref-input"
                value={poRef}
                onChange={(e) => setPoRef(e.target.value)}
                placeholder="Their own order number"
              />
              <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>Prints on their delivery note as <b>Customer No</b>.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 0 }}>
              <Field label="Order date">
                <input className="mono" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </Field>
              <Field label="Requested delivery date">
                <input className="mono" type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section n={3} title="Addresses" state={sectionState(3)}>
            <Field label="Invoice to">
              {invoiceOptions.length > 1 && (
                <div className="addr-picker">
                  <div className="addr-picker-label">
                    📍 {invoiceOptions.length} saved addresses — pick the right one
                  </div>
                  <Combobox
                    options={invoiceOptions.map((a, i) => ({ id: String(i), label: `${a.verified ? '✓ ' : ''}${a.invoice_default ? '🧾 ' : ''}${a.label || firstLine(a.text) || `Address ${i + 1}`}` }))}
                    value={String(invoiceIdx)}
                    onSelect={(id) => pickInvoiceAddr(+id)}
                    placeholder="Choose the invoice address…"
                  />
                  <div className="addr-picker-note">
                    Using <b>{invoiceOptions[invoiceIdx]?.label || firstLine(invoiceOptions[invoiceIdx]?.text) || 'the first one'}</b> — the box below fills in from this.
                  </div>
                </div>
              )}
              <textarea value={custDetails} onChange={(e) => setCustDetails(e.target.value)} placeholder="Company / invoice address — or type one in" style={{ minHeight: 90 }} />
            </Field>

            <Field label="Delivery address">
              {deliveryOptions.length > 1 && (
                <div className="addr-picker">
                  <div className="addr-picker-label">
                    📍 {deliveryOptions.length} saved addresses — pick the right one
                  </div>
                  <Combobox
                    options={deliveryOptions.map((a, i) => ({ id: String(i), label: `${a.verified ? '✓ ' : ''}${a.invoice_default ? '🧾 ' : ''}${a.label || firstLine(a.text) || `Address ${i + 1}`}` }))}
                    value={String(deliveryIdx)}
                    onSelect={(id) => pickDeliveryAddr(+id)}
                    placeholder="Choose the delivery address…"
                  />
                  <div className="addr-picker-note">
                    Using <b>{deliveryOptions[deliveryIdx]?.label || firstLine(deliveryOptions[deliveryIdx]?.text) || 'the first one'}</b> — the box below fills in from this.
                  </div>
                </div>
              )}
              <textarea value={custDeliver} onChange={(e) => { setCustDeliver(e.target.value); setAddrConfirmed(false) }} placeholder="Delivery address — or type one in" style={{ minHeight: 90 }} />
            </Field>
            <div className="step-check" style={{ marginBottom: 14 }}>
              <button className={'btn step-check-btn ' + (addrConfirmed ? 'btn-g' : 'btn-a')}
                onClick={() => setAddrConfirmed((v) => !v)}>
                {addrConfirmed ? '✓ Checked — click to undo' : 'Addresses are right — next'}
              </button>
            </div>
          </Section>

          <Section n={4} title="Contact details" state={sectionState(4)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <Field label="Contact name">
                <input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </Field>
              <Field label="Contact email">
                <input placeholder="Email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </Field>
              <Field label="Contact telephone">
                <input placeholder="Telephone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </Field>
            </div>
          </Section>

          <div style={{ marginTop: 24, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Left clickable on purpose — a dead grey button tells you nothing,
                whereas clicking says exactly what's missing and jumps to it. */}
            <button className="btn btn-a" style={poRef.trim() ? undefined : { opacity: .55 }} onClick={goToStep2}>Next — Add products →</button>
            <button className="btn btn-g" onClick={() => router.push('/orders')}>Cancel</button>
            {!poRef.trim() && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Customer No needed first</span>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          {customerCatalog.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="ttl" style={{ marginBottom: 14 }}>
                <h2 style={{ margin: 0 }}>Quick add</h2>
                <span className="muted" style={{ fontSize: 12 }}>
                  Click a size → enter qty → ✓ to add. Click a green chip to take it off this order.
                  {isAdmin && <> The 🗑 removes a product from {custName}&apos;s range for good — not from this order.</>}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                {customerCatalog.map(({ product, options }) => {
                  const anyAdded = options.some((pkg) => lines.some((l) => l.productId === product.id && l.packagingId === pkg.id))
                  return (
                    <div key={product.id} style={{
                      borderRadius: 12,
                      border: `2px solid ${anyAdded ? 'var(--accent)' : 'var(--border)'}`,
                      background: 'var(--panel)',
                      padding: '14px 16px',
                      transition: 'border-color 0.15s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1, fontWeight: 700, fontSize: 14, marginBottom: 4, lineHeight: 1.3, color: 'var(--fg)' }}>
                          {product.name}
                        </div>
                        {isAdmin && (
                          <button
                            onClick={() => removeFromRange(product)}
                            title={`Remove from ${custName}'s range — not the same as taking it off this order`}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 13, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                          >🗑</button>
                        )}
                      </div>
                      {product.category && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>{product.category}</div>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: product.category ? 0 : 10 }}>
                        {options.map((pkg) => {
                          const key = chipKey(product.id, pkg.id)
                          const line = lines.find((l) => l.productId === product.id && l.packagingId === pkg.id)
                          const added = !!line
                          const isPending = key in pending

                          // STATE 3: already in order — solid green chip, click to remove
                          if (added) return (
                            <button
                              key={pkg.id}
                              title="Click to remove from order"
                              onClick={() => removeChip(product.id, pkg.id)}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '7px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                                cursor: 'pointer', border: '2px solid var(--accent)',
                                background: 'var(--accent)', color: 'var(--on-accent)',
                                transition: 'opacity 0.1s',
                              }}
                            >
                              ✓ {pkg.name} <span style={{ opacity: 0.85, fontWeight: 400 }}>× {line.qty}</span>
                            </button>
                          )

                          // STATE 2: qty entry — label + number input + confirm + cancel
                          if (isPending) return (
                            <div key={pkg.id} style={{
                              display: 'inline-flex', alignItems: 'center',
                              border: '2px solid var(--accent)', borderRadius: 8, overflow: 'hidden',
                              background: 'var(--bg)',
                            }}>
                              <span style={{
                                padding: '6px 10px', fontSize: 12, fontWeight: 700,
                                borderRight: '1px solid var(--border)', color: 'var(--fg)',
                                whiteSpace: 'nowrap',
                              }}>{pkg.name}</span>
                              <input
                                autoFocus
                                type="number" min="1"
                                value={pending[key]}
                                onChange={(e) => setPending((p) => ({ ...p, [key]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') confirmChip(product.id, pkg.id)
                                  if (e.key === 'Escape') cancelChip(product.id, pkg.id)
                                }}
                                style={{
                                  width: 46, textAlign: 'center', fontSize: 13, fontWeight: 700,
                                  border: 'none', borderRight: '1px solid var(--border)',
                                  background: 'transparent', color: 'var(--fg)', padding: '6px 4px',
                                }}
                              />
                              <button
                                onClick={() => confirmChip(product.id, pkg.id)}
                                title="Add to order"
                                style={{
                                  padding: '6px 10px', background: 'var(--accent)', color: 'var(--on-accent)',
                                  border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 900,
                                  borderRight: '1px solid rgba(0,0,0,0.1)',
                                }}
                              >✓</button>
                              <button
                                onClick={() => cancelChip(product.id, pkg.id)}
                                style={{
                                  padding: '6px 9px', background: 'transparent', border: 'none',
                                  cursor: 'pointer', fontSize: 13, color: 'var(--muted)', fontWeight: 700,
                                }}
                              >✕</button>
                            </div>
                          )

                          // STATE 1: idle — solid raised "tablet", click to enter qty
                          return (
                            <button
                              key={pkg.id}
                              onClick={() => startChip(product.id, pkg.id)}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'var(--chip-bg-hover)'
                                e.currentTarget.style.borderColor = 'var(--accent)'
                                e.currentTarget.style.color = 'var(--accent)'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'var(--chip-bg)'
                                e.currentTarget.style.borderColor = 'var(--chip-border)'
                                e.currentTarget.style.color = 'var(--ink)'
                              }}
                              style={{
                                padding: '8px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                                cursor: 'pointer',
                                border: '1.5px solid var(--chip-border)',
                                background: 'var(--chip-bg)',
                                color: 'var(--ink)',
                                boxShadow: 'var(--chip-shadow)',
                                transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                              }}
                            >
                              {pkg.name}
                            </button>
                          )
                        })}

                        {/* A size this customer isn't priced for */}
                        {!(product.id in otherSize) && (
                          <button
                            onClick={() => openOtherSize(product.id)}
                            title="Add a size this customer hasn't had before"
                            style={{
                              padding: '8px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                              cursor: 'pointer', border: '1.5px dashed var(--line-solid)',
                              background: 'transparent', color: 'var(--muted)',
                            }}
                          >
                            ＋ other size
                          </button>
                        )}
                      </div>

                      {product.id in otherSize && (() => {
                        const s = otherSize[product.id]
                        const taken = options.map((k) => k.id)
                        const choices = packaging
                          .filter((k) => !taken.includes(k.id))
                          .sort((a, b) => (a.volume || 0) - (b.volume || 0))
                        const vol = packaging.find((k) => k.id === s.packagingId)?.volume || 0
                        const ppl = parseFloat(s.ppl) || 0
                        return (
                          <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                              <div className="field" style={{ flex: '1 1 130px', marginBottom: 0 }}>
                                <label style={{ fontSize: 9.5 }}>Size</label>
                                <select value={s.packagingId} style={{ fontSize: 12.5, padding: '7px 9px' }}
                                  onChange={(e) => setOtherSizeField(product.id, { packagingId: e.target.value })}>
                                  <option value="">— choose —</option>
                                  {choices.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                                </select>
                              </div>
                              <div className="field" style={{ width: 62, marginBottom: 0 }}>
                                <label style={{ fontSize: 9.5 }}>Qty</label>
                                <input className="mono" type="number" min="1" value={s.qty}
                                  style={{ fontSize: 12.5, padding: '7px 6px', textAlign: 'center' }}
                                  onChange={(e) => setOtherSizeField(product.id, { qty: e.target.value })} />
                              </div>
                            </div>
                            {isAdmin ? (
                              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                                <label style={{ fontSize: 9.5 }}>£ / litre for {custName}</label>
                                <input className="mono" value={s.ppl} placeholder="0.0000"
                                  style={{ fontSize: 12.5, padding: '7px 9px' }}
                                  onChange={(e) => setOtherSizeField(product.id, { ppl: e.target.value })} />
                                <p className="hint" style={{ marginTop: 3, marginBottom: 0, fontSize: 11 }}>
                                  {ppl > 0 && vol > 0
                                    ? `= £${(ppl * vol).toFixed(2)} per ${packaging.find((k) => k.id === s.packagingId)?.name} · saved to their price list`
                                    : 'Leave blank to price later — the invoicing copy stays blocked until it\'s set.'}
                                </p>
                              </div>
                            ) : (
                              <p className="hint" style={{ marginTop: 6, marginBottom: 0, fontSize: 11 }}>
                                💡 An admin will add the price — it shows as unpriced until then.
                              </p>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                              <button className="btn btn-a btn-sm" onClick={() => addOtherSize(product.id)}>Add to order</button>
                              <button className="btn btn-g btn-sm" onClick={() => closeOtherSize(product.id)}>Cancel</button>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div className="card">
            <div className="ttl">
              <h2>Products</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-a btn-sm" onClick={() => setShowAdd(true)}>＋ Add a product</button>
                <button className="btn btn-g btn-sm" onClick={() => setStep(1)}>← Back</button>
              </div>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>Item not in the grid above? Use <b>＋ Add a product</b> to add one in another size, or create a brand-new product.</p>
            <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging} availableByProduct={availableByProduct} onProductUpdated={applyProductUpdate} />
          </div>
          <div className="card">
            <div className="ttl"><h2>Notes</h2></div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions, carrier details, etc." />
            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button className="btn btn-a" onClick={saveOrder} disabled={busy}>{busy ? 'Saving…' : 'Save to log'}</button>
              <button className="btn btn-g" onClick={() => setStep(1)}>← Back</button>
            </div>
          </div>
        </>
      )}

      <AddProductModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        products={products}
        packaging={packaging}
        customerId={customerId}
        customerName={customers.find((x) => x.id === customerId)?.name || ''}
        isAdmin={isAdmin}
        availableByProduct={availableByProduct}
        onDone={handleProductAdded}
      />

      {/* Admin-only: which month should this order count towards on the reports? */}
      {monthModal && (
        <div className="modal-bg">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, textAlign: 'left' }}>
            <h2 style={{ marginBottom: 6 }}>Which month should this order be invoiced in?</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>
              This only affects where the order appears on <b>Insights</b> and the <b>Ilex / sales report</b> — the order
              itself, the delivery note and what the customer is charged are unchanged.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <button className="btn btn-a" onClick={() => chooseInvoiceMonth(0)} style={{ justifyContent: 'flex-start' }}>
                Invoice this month · <b style={{ marginLeft: 6 }}>{monthName(shiftMonthISO(orderDate || todayISO(), 0))}</b>
              </button>
              <button className="btn btn-g" onClick={() => chooseInvoiceMonth(1)} style={{ justifyContent: 'flex-start' }}>
                Invoice next month · <b style={{ marginLeft: 6 }}>{monthName(shiftMonthISO(orderDate || todayISO(), 1))}</b>
              </button>
              <button className="btn btn-g" onClick={() => chooseInvoiceMonth(-1)} style={{ justifyContent: 'flex-start' }}>
                Invoice last month · <b style={{ marginLeft: 6 }}>{monthName(shiftMonthISO(orderDate || todayISO(), -1))}</b>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offer to store a manually-entered address on the customer record */}
      {addrPrompt && (() => {
        const isInv = addrPrompt.kind === 'invoice'
        const isVerify = addrPrompt.mode === 'verify'
        return (
          <div className="modal-bg">
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'left' }}>
              <h2 style={{ marginBottom: 6 }}>{isVerify ? `Verify ${isInv ? 'invoice' : 'delivery'} address` : `New ${isInv ? 'invoice' : 'delivery'} address`}</h2>
              {isVerify ? (
                <p className="hint" style={{ marginTop: 0, marginBottom: 14, background: '#FCF4E2', border: '1px solid var(--warn)', borderRadius: 8, padding: '10px 12px', color: '#7A5511' }}>
                  ⚠ First time this address is being used. It was imported automatically — please <b>check it against the customer’s purchase order or a previous delivery note</b>, correct anything wrong, then mark it verified. This only needs doing once.
                </p>
              ) : (
              <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
                Do you wish to store this as {isInv ? 'an invoice' : 'a delivery'} address for <b>{custName}</b>?
                Check it one last time — it will appear in their address list on future orders.
              </p>
              )}
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Label</label>
                <input value={addrPrompt.label} placeholder="e.g. Head Office"
                  onChange={(e) => patchAddrPrompt({ label: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Address</label>
                <textarea style={{ minHeight: 90 }} value={addrPrompt.text}
                  onChange={(e) => patchAddrPrompt({ text: e.target.value })} />
              </div>
              {!isInv && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <input placeholder="Contact name" value={addrPrompt.contact?.name || ''}
                    onChange={(e) => patchAddrPrompt({ contact: { ...addrPrompt.contact, name: e.target.value } })} />
                  <input placeholder="Email" value={addrPrompt.contact?.email || ''}
                    onChange={(e) => patchAddrPrompt({ contact: { ...addrPrompt.contact, email: e.target.value } })} />
                  <input placeholder="Phone" value={addrPrompt.contact?.phone || ''}
                    onChange={(e) => patchAddrPrompt({ contact: { ...addrPrompt.contact, phone: e.target.value } })} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
                {isVerify ? (
                  <>
                    <button className="btn btn-g" onClick={advanceAddrQueue}>Skip for now</button>
                    <button className="btn btn-a" onClick={confirmVerify} disabled={!addrPrompt.text.trim()}>
                      ✓ Verified — checked against PO / delivery note
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-g" onClick={advanceAddrQueue}>Don’t save</button>
                    <button className="btn btn-a" onClick={saveAddrPrompt} disabled={!addrPrompt.text.trim()}>
                      Save to {custName}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// First day of the month `delta` months away from an ISO date, as 'YYYY-MM-01'.
// Read on the local calendar so it can't slip a day either side of midnight.
function shiftMonthISO(baseISO, delta) {
  const [y, m] = String(baseISO || '').slice(0, 10).split('-').map(Number)
  const base = (y && m) ? new Date(y, m - 1, 1) : new Date()
  const d = new Date(base.getFullYear(), base.getMonth() + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
// Long month name for a 'YYYY-MM-01' string, e.g. "September 2026".
function monthName(iso) {
  const [y, m] = String(iso || '').slice(0, 10).split('-').map(Number)
  if (!y || !m) return ''
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// One block of the form. 'active' is outlined and is where you should be
// working; 'done' is ticked and quiet; 'todo' is faded until its turn.
function Section({ n, title, state, children }) {
  const done = state === 'done'
  const active = state === 'active'
  return (
    <div style={{
      border: `${active ? 2 : 1}px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
      borderRadius: 11,
      background: active ? 'var(--panel)' : 'transparent',
      padding: active ? '15px 16px 3px' : '14px 16px 2px',
      marginBottom: 12,
      opacity: state === 'todo' ? 0.5 : 1,
      transition: 'opacity .2s, border-color .2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800,
          background: done ? 'var(--accent)' : active ? 'var(--accent-soft)' : 'var(--chip-bg)',
          color: done ? 'var(--on-accent)' : active ? 'var(--accent)' : 'var(--faint)',
        }}>{done ? '✓' : n}</span>
        <span style={{
          fontSize: 12.5, fontWeight: 700, letterSpacing: '.02em',
          color: active ? 'var(--accent)' : done ? 'var(--heading)' : 'var(--muted)',
        }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="field" style={{ marginBottom: 14 }}>
      <label>{label}</label>
      {children}
    </div>
  )
}

function StepBubble({ n, active, done, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: active || done ? 'var(--accent)' : 'var(--panel-2)',
        color: active || done ? 'var(--on-accent)' : 'var(--muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 15,
      }}>{done ? '✓' : n}</div>
      <span style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--muted)', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}
