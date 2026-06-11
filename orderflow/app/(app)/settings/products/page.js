'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { num } from '@/lib/calc'

export default function ProductsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('products').select('*').order('category').order('name')
    setRows(data || [])
  }
  async function update(id, patch) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('products').update(patch).eq('id', id)
  }
  async function add() {
    const { data } = await supabase.from('products')
      .insert({ name: 'New product', sg: 1.0, pg: '', un_number: '', category: '' }).select('*').single()
    setRows((r) => [...r, data])
  }
  async function remove(id) {
    setRows((r) => r.filter((x) => x.id !== id))
    await supabase.from('products').delete().eq('id', id)
  }

  if (rows === null) return <div className="card"><div className="empty">Loading…</div></div>

  const filtered = rows.filter((it) => {
    if (!q) return true
    const hay = `${it.name} ${it.category || ''} ${it.un_number || ''} ${it.pg || ''}`.toLowerCase()
    return hay.includes(q.toLowerCase())
  })

  return (
    <div className="card">
      <div className="ttl">
        <h2>Product Catalogue <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({rows.length})</span></h2>
        <button className="btn btn-a btn-sm" onClick={add}>＋ Add product</button>
      </div>
      <div className="filters">
        <input placeholder="Search product, range, UN number…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table className="tbl">
        <thead><tr>
          <th style={{ width: '18%' }}>Range</th>
          <th style={{ width: '34%' }}>Product name</th>
          <th style={{ width: '14%' }}>Specific gravity</th>
          <th style={{ width: '15%' }}>UN number</th>
          <th style={{ width: '13%' }}>Packing group</th>
          <th style={{ width: '6%' }}></th>
        </tr></thead>
        <tbody>
          {filtered.map((it) => (
            <tr key={it.id}>
              <td><input value={it.category || ''} onChange={(e) => update(it.id, { category: e.target.value })} /></td>
              <td><input value={it.name} onChange={(e) => update(it.id, { name: e.target.value })} /></td>
              <td><input className="mono" style={{ textAlign: 'right' }} value={it.sg ?? ''}
                onChange={(e) => update(it.id, { sg: num(e.target.value) })} /></td>
              <td><input className="mono" value={it.un_number || ''} onChange={(e) => update(it.id, { un_number: e.target.value })} placeholder="—" /></td>
              <td><input value={it.pg || ''} onChange={(e) => update(it.id, { pg: e.target.value })} placeholder="—" /></td>
              <td><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Net weight per unit = container volume × specific gravity. A blank UN number means non-hazardous.</p>
    </div>
  )
}
