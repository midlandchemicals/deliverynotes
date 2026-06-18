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

  // Step 1 fields
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

  // Step 2 fields
  const [lines, setLines] = useState([])
  const [notes, setNotes] = useState('')

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

  function pickCustomer(id) {
    setCustomerId(id)
    const c = customers.find((x) => x.id === id)
    if (c) {
      const inv = splitContact(c.details || '')
      const del = splitContact(c.deliver || '')
      const invList = (Array.isArray(c.invoice_addresses) && c.invoice_addresses.length)
        ? c.invoice_addresses : [{ label: 'Main', text: inv.address }]
      const delList = (Array.isArray(c.delivery_addresses) && c.delivery_addresses.length)
        ? c.delivery_addresses
        : [{ label: 'Main', text: del.address, contact: { name: c.contact_name || del.contact.name || '', email: c.email || del.contact.email || '', phone: c.phone || del.contact.phone || '' } }]
      setInvoiceOptions(invList)
      setDeliveryOptions(delList)
      setInvoiceIdx(0)
      setDeliveryIdx(0)
      setCustDetails(splitContact(invList[0]?.text || '').address)
      setCustDeliver(splitContact(delList[0]?.text || '').address)
      const ct0 = delList[0]?.contact || {}
      setContactName(ct0.name || c.contact_name || inv.contact.name || del.contact.name || '')
      setContactEmail(ct0.email || c.email || inv.contact.email || del.contact.email || '')
      setContactPhone(ct0.phone || c.phone || del.contact.phone || '')
    }
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
    setContactName(ct.name || '')
    setContactEmail(ct.email || '')
    setContactPhone(ct.phone || '')
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
      customer_snapshot: {
        name, details: custDetails, deliver: custDeliver,
        contact: { name: contactName, email: contactEmail, phone: contactPhone },
      },
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
    <div>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24, maxWidth: 480, margin: '0 auto 28px' }}>
        <StepBubble n={1} active={step === 1} done={step > 1} label="Customer & Dates" />
        <div style={{ flex: 1, height: 2, background: step > 1 ? 'var(--accent)' : 'var(--border)', transition: 'background 0.2s' }} />
        <StepBubble n={2} active={step === 2} done={false} label="Products" />
      </div>

      {step === 1 && (
        <>
          <div className="card">
            <div className="ttl"><h2>Order Details</h2></div>
            <div className="row c3">
              <div className="field"><label>Delivery Note Number</label>
                <input className="mono" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} /></div>
              <div className="field"><label>Customer Order Number</label>
                <input value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="optional" /></div>
              <div className="field"><label>Order date</label>
                <input className="mono" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
            </div>
            <div className="row c2">
              <div className="field"><label>Requested delivery date</label>
                <input className="mono" type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} /></div>
              <div className="field"><label>Customer</label>
                <Combobox
                  options={customerOptions}
                  value={customerId}
                  onSelect={pickCustomer}
                  placeholder="Type customer name to search…"
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="ttl"><h2>Addresses</h2></div>
            <div className="row c2">
              <div className="field"><label>Invoice to</label>
                {invoiceOptions.length > 1 && (
                  <select style={{ marginBottom: 6 }} value={invoiceIdx} onChange={(e) => pickInvoiceAddr(+e.target.value)}>
                    {invoiceOptions.map((a, i) => <option key={i} value={i}>{a.label || `Address ${i + 1}`}</option>)}
                  </select>
                )}
                <textarea value={custDetails} onChange={(e) => setCustDetails(e.target.value)} placeholder="Company / invoice address" style={{ minHeight: 88 }} />
              </div>
              <div className="field"><label>Delivery address</label>
                {deliveryOptions.length > 1 && (
                  <select style={{ marginBottom: 6 }} value={deliveryIdx} onChange={(e) => pickDeliveryAddr(+e.target.value)}>
                    {deliveryOptions.map((a, i) => <option key={i} value={i}>{a.label || `Address ${i + 1}`}</option>)}
                  </select>
                )}
                <textarea value={custDeliver} onChange={(e) => setCustDeliver(e.target.value)} style={{ minHeight: 88 }} />
              </div>
            </div>
            <div className="field" style={{ marginTop: 4 }}>
              <label>Delivery contact</label>
              <div className="row c3" style={{ marginBottom: 0 }}>
                <input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                <input placeholder="Email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
                <input placeholder="Telephone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
              <button className="btn btn-a" onClick={goToStep2}>Next — Add products →</button>
              <button className="btn btn-g" onClick={() => router.push('/orders')}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="card">
            <div className="ttl">
              <h2>Products</h2>
              <button className="btn btn-g btn-sm" onClick={() => setStep(1)}>← Back</button>
            </div>
            <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging} />
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

function StepBubble({ n, active, done, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: active ? 'var(--accent)' : done ? 'var(--accent)' : 'var(--border)',
        color: active || done ? '#fff' : 'var(--muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 15, transition: 'background 0.2s',
      }}>{done ? '✓' : n}</div>
      <span style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--muted)', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}
