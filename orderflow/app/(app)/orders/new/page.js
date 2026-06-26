'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { nextNo, splitContact } from '@/lib/calc'
import LineEditor from '../LineEditor'
import Combobox from '../../Combobox'

export default function NewOrderPage() {
  const supabase = createClient()
  const router = useRouter()

  const [products, setProducts] = useState([])
  const [packaging, setPackaging] = useState([])
  const [customers, setCustomers] = useState([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(1)

  const [orderNo, setOrderNo] = useState('DN-1001')
  const [customerId, setCustomerId] = useState('')
  const [custDetails, setCustDetails] = useState('')
  const [custDeliver, setCustDeliver] = useState('')
  const [invoiceOptions, setInvoiceOptions] = useState([])
  const [deliveryOptions, setDeliveryOptions] = useState([])
  const [invoiceIdx, setInvoiceIdx] = useState(0)
  const [deliveryIdx, setDeliveryIdx] = useState(0)
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [poRef, setPoRef] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [requestedDate, setRequestedDate] = useState('')
  const [lines, setLines] = useState([])
  const [notes, setNotes] = useState('')
  const [availableByProduct, setAvailableByProduct] = useState({})
  const [customerCatalog, setCustomerCatalog] = useState([]) // [{product, options:[{packaging}]}]
  const [pending, setPending] = useState({}) // key 'productId::packagingId' → qty string while entering

  useEffect(() => {
    (async () => {
      const [p, k, c, o] = await Promise.all([
        supabase.from('products').select('*').order('name'),
        supabase.from('packaging').select('*').order('volume'),
        supabase.from('customers').select('*').order('name'),
        supabase.from('orders').select('order_no').order('created_at', { ascending: false }).limit(1),
      ])
      const prods = p.data || [], packs = k.data || [], custs = c.data || []
      setProducts(prods); setPackaging(packs); setCustomers(custs)
      if (o.data?.[0]?.order_no) setOrderNo(nextNo(o.data[0].order_no))
      if (prods.length && packs.length) setLines([{ productId: prods[0].id, packagingId: packs[0].id, qty: '1' }])
      setReady(true)
    })()
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

  function pickCustomer(id) {
    setCustomerId(id)
    setCustomerCatalog([])
    setLines([])
    setPending({})
    loadAvailablePackaging(id)
    const c = customers.find((x) => x.id === id)
    if (!c) return
    const inv = splitContact(c.details || '')
    const del = splitContact(c.deliver || '')
    const invList = (Array.isArray(c.invoice_addresses) && c.invoice_addresses.length)
      ? c.invoice_addresses : [{ label: 'Main', text: inv.address }]
    const delList = (Array.isArray(c.delivery_addresses) && c.delivery_addresses.length)
      ? c.delivery_addresses
      : [{ label: 'Main', text: del.address, contact: { name: c.contact_name || del.contact.name || '', email: c.email || del.contact.email || '', phone: c.phone || del.contact.phone || '' } }]
    setInvoiceOptions(invList); setDeliveryOptions(delList)
    setInvoiceIdx(0); setDeliveryIdx(0)
    setCustDetails(splitContact(invList[0]?.text || '').address)
    setCustDeliver(splitContact(delList[0]?.text || '').address)
    const ct0 = delList[0]?.contact || {}
    setContactName(ct0.name || c.contact_name || inv.contact.name || '')
    setContactEmail(ct0.email || c.email || inv.contact.email || '')
    setContactPhone(ct0.phone || c.phone || del.contact.phone || '')
  }

  function pickInvoiceAddr(i) {
    setInvoiceIdx(i)
    setCustDetails(splitContact(invoiceOptions[i]?.text || '').address)
  }

  function pickDeliveryAddr(i) {
    setDeliveryIdx(i)
    const opt = deliveryOptions[i] || {}
    setCustDeliver(splitContact(opt.text || '').address)
    const ct = opt.contact || {}
    setContactName(ct.name || ''); setContactEmail(ct.email || ''); setContactPhone(ct.phone || '')
  }

  function goToStep2() {
    if (!custDetails.trim()) { alert('Please fill in the invoice address'); return }
    setStep(2)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveOrder() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const name = customers.find((c) => c.id === customerId)?.name || custDetails.split('\n')[0]
    const { data, error } = await supabase.from('orders').insert({
      order_no: orderNo,
      customer_id: customerId || null,
      customer_snapshot: { name, details: custDetails, deliver: custDeliver, contact: { name: contactName, email: contactEmail, phone: contactPhone } },
      po_ref: poRef,
      order_date: orderDate || null,
      requested_date: requestedDate || null,
      status: 'New',
      notes,
      lines,
      created_by: user?.id || null,
      added_by: user?.email || null,
    }).select('id').single()
    setBusy(false)
    if (error) { alert('Could not save: ' + error.message); return }
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

          <Field label="Customer">
            <Combobox options={customerOptions} value={customerId} onSelect={pickCustomer} placeholder="Type customer name to search…" />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Field label="Delivery Note Number">
              <input className="mono" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
            </Field>
            <Field label="Customer Order Number">
              <input value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="optional" />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Field label="Order date">
              <input className="mono" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </Field>
            <Field label="Requested delivery date">
              <input className="mono" type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
            </Field>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0' }} />

          <Field label="Invoice to">
            {invoiceOptions.length > 1 && (
              <select style={{ marginBottom: 6 }} value={invoiceIdx} onChange={(e) => pickInvoiceAddr(+e.target.value)}>
                {invoiceOptions.map((a, i) => <option key={i} value={i}>{a.label || `Address ${i + 1}`}</option>)}
              </select>
            )}
            <textarea value={custDetails} onChange={(e) => setCustDetails(e.target.value)} placeholder="Company / invoice address" style={{ minHeight: 90 }} />
          </Field>

          <Field label="Delivery address">
            {deliveryOptions.length > 1 && (
              <select style={{ marginBottom: 6 }} value={deliveryIdx} onChange={(e) => pickDeliveryAddr(+e.target.value)}>
                {deliveryOptions.map((a, i) => <option key={i} value={i}>{a.label || `Address ${i + 1}`}</option>)}
              </select>
            )}
            <textarea value={custDeliver} onChange={(e) => setCustDeliver(e.target.value)} style={{ minHeight: 90 }} />
          </Field>

          <Field label="Contact name">
            <input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label="Contact email">
            <input placeholder="Email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </Field>
          <Field label="Contact telephone">
            <input placeholder="Telephone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </Field>

          <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
            <button className="btn btn-a" onClick={goToStep2}>Next — Add products →</button>
            <button className="btn btn-g" onClick={() => router.push('/orders')}>Cancel</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          {customerCatalog.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="ttl" style={{ marginBottom: 14 }}>
                <h2 style={{ margin: 0 }}>Quick add</h2>
                <span className="muted" style={{ fontSize: 12 }}>Click a size → enter qty → ✓ to add. Click a green chip to remove.</span>
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
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, lineHeight: 1.3, color: 'var(--fg)' }}>
                        {product.name}
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
                                background: 'var(--accent)', color: '#fff',
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
                                  padding: '6px 10px', background: 'var(--accent)', color: '#fff',
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
                                e.currentTarget.style.background = '#dfe6f2'
                                e.currentTarget.style.borderColor = 'var(--accent)'
                                e.currentTarget.style.color = 'var(--accent-dark)'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = '#e9eef7'
                                e.currentTarget.style.borderColor = '#b9c4d9'
                                e.currentTarget.style.color = 'var(--ink)'
                              }}
                              style={{
                                padding: '8px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                                cursor: 'pointer',
                                border: '1.5px solid #b9c4d9',
                                background: '#e9eef7',
                                color: 'var(--ink)',
                                boxShadow: '0 1px 0 #c5cfe0, 0 2px 4px rgba(22,41,79,0.10)',
                                transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                              }}
                            >
                              {pkg.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div className="card">
            <div className="ttl">
              <h2>Products</h2>
              <button className="btn btn-g btn-sm" onClick={() => setStep(1)}>← Back</button>
            </div>
            <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging} availableByProduct={availableByProduct} />
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
        background: active || done ? 'var(--accent)' : 'var(--border)',
        color: active || done ? '#fff' : 'var(--muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 15,
      }}>{done ? '✓' : n}</div>
      <span style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--muted)', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}
