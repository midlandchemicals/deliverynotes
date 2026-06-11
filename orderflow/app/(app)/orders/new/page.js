'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { nextNo } from '@/lib/calc'
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

  const [orderNo, setOrderNo] = useState('DN-1001')
  const [customerId, setCustomerId] = useState('')
  const [custDetails, setCustDetails] = useState('')
  const [custDeliver, setCustDeliver] = useState('')
  const [poRef, setPoRef] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [requestedDate, setRequestedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([])

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
    if (c) { setCustDetails(c.details || ''); setCustDeliver(c.deliver || '') }
  }

  async function saveOrder() {
    if (!custDetails.trim()) { alert('Add customer details first'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const name = customers.find((c) => c.id === customerId)?.name || custDetails.split('\n')[0]
    const { data, error } = await supabase.from('orders').insert({
      order_no: orderNo,
      customer_id: customerId || null,
      customer_snapshot: { name, details: custDetails, deliver: custDeliver },
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
      <div className="card">
        <div className="ttl"><h2>New Delivery Note</h2></div>
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
          <div className="field"><label>Pick saved customer</label>
            <Combobox
              options={customerOptions}
              value={customerId}
              onSelect={pickCustomer}
              placeholder="Type customer name to search…"
            />
          </div>
        </div>
        <div className="row c2">
          <div className="field"><label>Customer details</label>
            <textarea value={custDetails} onChange={(e) => setCustDetails(e.target.value)} /></div>
          <div className="field"><label>Delivery address</label>
            <textarea value={custDeliver} onChange={(e) => setCustDeliver(e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <div className="ttl"><h2>Order lines</h2></div>
        <LineEditor lines={lines} setLines={setLines} products={products} packaging={packaging} />
      </div>

      <div className="card">
        <div className="ttl"><h2>Notes</h2></div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything from the email — special instructions, carrier, etc." />
        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          <button className="btn btn-a" onClick={saveOrder} disabled={busy}>{busy ? 'Saving…' : 'Save to log'}</button>
          <button className="btn btn-g" onClick={() => router.push('/')}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
