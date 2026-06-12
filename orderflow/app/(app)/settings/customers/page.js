'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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
    const { data } = await supabase.from('customers').insert({ name: 'New customer', details: '', deliver: '', contact_name: '', email: '', phone: '' }).select('*').single()
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
          <th style={{ width: '16%' }}>Name</th>
          <th style={{ width: '24%' }}>Invoice to</th>
          <th style={{ width: '24%' }}>Delivery address</th>
          <th style={{ width: '32%' }}>Contact (name / email / phone)</th>
          <th style={{ width: '4%' }}></th>
        </tr></thead>
        <tbody>
          {rows.map((it) => (
            <tr key={it.id}>
              <td><input value={it.name} onChange={(e) => update(it.id, { name: e.target.value })} /></td>
              <td><textarea style={{ minHeight: 72 }} value={it.details || ''} onChange={(e) => update(it.id, { details: e.target.value })} /></td>
              <td><textarea style={{ minHeight: 72 }} value={it.deliver || ''} onChange={(e) => update(it.id, { deliver: e.target.value })} /></td>
              <td>
                <input style={{ marginBottom: 5 }} placeholder="Contact name" value={it.contact_name || ''} onChange={(e) => update(it.id, { contact_name: e.target.value })} />
                <input style={{ marginBottom: 5 }} placeholder="Email" value={it.email || ''} onChange={(e) => update(it.id, { email: e.target.value })} />
                <input placeholder="Telephone" value={it.phone || ''} onChange={(e) => update(it.id, { phone: e.target.value })} />
              </td>
              <td><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="addrow" onClick={add}>+ Add customer</button>
    </div>
  )
}
