'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { nextNo } from '@/lib/calc'
import LineEditor from '../LineEditor'

export default function NewOrderPage() {
  const supabase = createClient()
  const router = useRouter()

  const [products, setProducts] = useState([])
  const [packaging, setPackaging] = useState([])
  const [customers, setCustomers] = useState([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const [orderNo, setOrderNo] = useState('ORD-1001')
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
    }).select('id').single()
    setBusy(false)
    if (error) { alert('Could not save: ' + error.message); return }
    router.push(`/orders/${data.id}`)
  }

  if (!ready) return <div className="card"><div className="empty">Loading…</div></div>

  return (
    <div>
      <div className="card">
        <div className="ttl"><h2>New Order</h2></div>
        <div className="row c3">
          <div className="field"><label>Order no.</label>
            <input className="mono" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} /></div>
          <div className="field"><label>Customer PO / ref</label>
            <input value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="optional" /></div>
          <div className="field"><label>Order date</label>
            <input className="mono" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
        </div>
        <div className="row c2">
          <div className="field"><label>Requested delivery date</label>
            <input className="mono" type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} /></div>
          <div className="field"><label>Pick saved customer</label>
            <select value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
              <option value="">— select to auto-fill —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
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
          <button className="btn btn-a" onClick={saveOrder} disabled={busy}>{busy ? 'Saving…' : 'Save order to log'}</button>
          <button className="btn btn-g" onClick={() => router.push('/')}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
