'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Build an editable address list for a customer, falling back to the legacy
// single text field when no array has been saved yet.
function addrList(arr, legacy) {
  if (Array.isArray(arr) && arr.length) return arr
  return [{ label: '', text: legacy || '' }]
}

function AddressListEditor({ list, kind, onChange }) {
  function setEntry(i, patch) {
    onChange(list.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  function addEntry() { onChange([...list, { label: '', text: '' }]) }
  function removeEntry(i) {
    const next = list.filter((_, idx) => idx !== i)
    onChange(next.length ? next : [{ label: '', text: '' }])
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
          <th style={{ width: '13%' }}>Name</th>
          <th style={{ width: '24%' }}>Invoice addresses</th>
          <th style={{ width: '24%' }}>Delivery addresses</th>
          <th style={{ width: '25%' }}>Contact (name / email / phone)</th>
          <th style={{ width: '6%' }}>£/label</th>
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
                  list={addrList(it.delivery_addresses, it.deliver)}
                  kind="delivery"
                  onChange={(list) => update(it.id, { delivery_addresses: list, deliver: list[0]?.text || '' })}
                />
              </td>
              <td>
                <input style={{ marginBottom: 5 }} placeholder="Contact name" value={it.contact_name || ''} onChange={(e) => update(it.id, { contact_name: e.target.value })} />
                <input style={{ marginBottom: 5 }} placeholder="Email" value={it.email || ''} onChange={(e) => update(it.id, { email: e.target.value })} />
                <input placeholder="Telephone" value={it.phone || ''} onChange={(e) => update(it.id, { phone: e.target.value })} />
              </td>
              <td>
                <input className="mono" style={{ textAlign: 'right' }}
                  value={it.label_price || ''} placeholder="0.00"
                  onChange={(e) => update(it.id, { label_price: parseFloat(e.target.value) || 0 })} />
              </td>
              <td><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="addrow" onClick={add}>+ Add customer</button>
      <p className="hint">Add several invoice or delivery addresses per customer, each with a short label. The first address is the default; when raising an order you choose which one to use from a dropdown.</p>
    </div>
  )
}
