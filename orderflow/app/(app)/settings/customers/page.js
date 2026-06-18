'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Build an editable invoice address list, falling back to the legacy single
// text field when no array has been saved yet.
function addrList(arr, legacy) {
  if (Array.isArray(arr) && arr.length) return arr
  return [{ label: '', text: legacy || '' }]
}

// Delivery addresses carry their own contact. Fall back to the legacy single
// delivery field + customer-level contact for un-migrated records.
function deliveryAddrList(c) {
  if (Array.isArray(c.delivery_addresses) && c.delivery_addresses.length) return c.delivery_addresses
  return [{ label: '', text: c.deliver || '', contact: { name: c.contact_name || '', email: c.email || '', phone: c.phone || '' } }]
}

function AddressListEditor({ list, kind, withContact, onChange }) {
  function setEntry(i, patch) {
    onChange(list.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  function setContact(i, patch) {
    onChange(list.map((e, idx) => (idx === i ? { ...e, contact: { ...(e.contact || {}), ...patch } } : e)))
  }
  function addEntry() { onChange([...list, withContact ? { label: '', text: '', contact: { name: '', email: '', phone: '' } } : { label: '', text: '' }]) }
  function removeEntry(i) {
    const next = list.filter((_, idx) => idx !== i)
    onChange(next.length ? next : [withContact ? { label: '', text: '', contact: { name: '', email: '', phone: '' } } : { label: '', text: '' }])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((e, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
            <input style={{ flex: 1, fontSize: 12 }}
              placeholder={i === 0 ? 'Label (e.g. Main / Head Office)' : 'Label'}
              value={e.label || ''} onChange={(ev) => setEntry(i, { label: ev.target.value })} />
            {list.length > 1 && <button className="btn-dl" onClick={() => removeEntry(i)}>×</button>}
          </div>
          <textarea style={{ minHeight: 64 }} value={e.text || ''} onChange={(ev) => setEntry(i, { text: ev.target.value })} />
          {withContact && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 5 }}>
              <input style={{ fontSize: 12 }} placeholder="Contact name" value={e.contact?.name || ''} onChange={(ev) => setContact(i, { name: ev.target.value })} />
              <input style={{ fontSize: 12 }} placeholder="Email" value={e.contact?.email || ''} onChange={(ev) => setContact(i, { email: ev.target.value })} />
              <input style={{ fontSize: 12 }} placeholder="Telephone" value={e.contact?.phone || ''} onChange={(ev) => setContact(i, { phone: ev.target.value })} />
            </div>
          )}
        </div>
      ))}
      <button className="addrow" style={{ fontSize: 12, padding: '5px 8px' }} onClick={addEntry}>+ Add {kind} address</button>
    </div>
  )
}

export default function CustomersPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('customers').select('*').order('name')
    setRows(data || [])
  }
  async function update(id, patch) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('customers').update(patch).eq('id', id)
  }
  async function add() {
    const { data } = await supabase.from('customers').insert({ name: 'New customer', details: '', deliver: '', contact_name: '', email: '', phone: '', invoice_addresses: [], delivery_addresses: [] }).select('*').single()
    setRows((r) => [...r, data])
  }
  async function remove(id) {
    setRows((r) => r.filter((x) => x.id !== id))
    await supabase.from('customers').delete().eq('id', id)
  }

  if (rows === null) return <div className="card"><div className="empty">Loading…</div></div>

  return (
    <div className="card">
      <div className="ttl"><h2>Address Book</h2></div>
      <table className="tbl">
        <thead><tr>
          <th style={{ width: '15%' }}>Name</th>
          <th style={{ width: '32%' }}>Invoice addresses</th>
          <th style={{ width: '40%' }}>Delivery addresses (each with its own contact)</th>
          <th style={{ width: '8%' }}>£/label</th>
          <th style={{ width: '4%' }}></th>
        </tr></thead>
        <tbody>
          {rows.map((it) => (
            <tr key={it.id}>
              <td><input value={it.name} onChange={(e) => update(it.id, { name: e.target.value })} /></td>
              <td>
                <AddressListEditor
                  list={addrList(it.invoice_addresses, it.details)}
                  kind="invoice"
                  onChange={(list) => update(it.id, { invoice_addresses: list, details: list[0]?.text || '' })}
                />
              </td>
              <td>
                <AddressListEditor
                  list={deliveryAddrList(it)}
                  kind="delivery"
                  withContact
                  onChange={(list) => update(it.id, {
                    delivery_addresses: list,
                    deliver: list[0]?.text || '',
                    contact_name: list[0]?.contact?.name || '',
                    email: list[0]?.contact?.email || '',
                    phone: list[0]?.contact?.phone || '',
                  })}
                />
              </td>
              <td>
                <input className="mono" style={{ textAlign: 'right' }}
                  value={it.label_price ?? ''} placeholder="0.00"
                  onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, label_price: e.target.value } : x)))}
                  onBlur={(e) => update(it.id, { label_price: parseFloat(e.target.value) || 0 })} />
              </td>
              <td><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="addrow" onClick={add}>+ Add customer</button>
      <p className="hint">Add several invoice or delivery addresses per customer, each with a short label. Each delivery address carries its own contact (name / email / phone). The first address is the default; when raising an order you choose which one to use from a dropdown and its contact fills in automatically.</p>
    </div>
  )
}
