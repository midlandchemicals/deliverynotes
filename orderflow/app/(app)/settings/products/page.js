'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { num } from '@/lib/calc'

export default function ProductsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('products').select('*').order('name')
    setRows(data || [])
  }
  async function update(id, patch) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('products').update(patch).eq('id', id)
  }
  async function add() {
    const { data } = await supabase.from('products').insert({ name: 'New product', sg: 1.0, pg: '—' }).select('*').single()
    setRows((r) => [...r, data])
  }
  async function remove(id) {
    setRows((r) => r.filter((x) => x.id !== id))
    await supabase.from('products').delete().eq('id', id)
  }

  if (rows === null) return <div className="card"><div className="empty">Loading…</div></div>

  return (
    <div className="card">
      <div className="ttl"><h2>Product Catalogue</h2></div>
      <table className="tbl">
        <thead><tr>
          <th style={{ width: '44%' }}>Product name</th>
          <th style={{ width: '20%' }}>Specific gravity (kg/L)</th>
          <th style={{ width: '30%' }}>Packaging class / PG</th>
          <th style={{ width: '6%' }}></th>
        </tr></thead>
        <tbody>
          {rows.map((it) => (
            <tr key={it.id}>
              <td><input value={it.name} onChange={(e) => update(it.id, { name: e.target.value })} /></td>
              <td><input className="mono" style={{ textAlign: 'right' }} value={it.sg}
                onChange={(e) => update(it.id, { sg: num(e.target.value) })} /></td>
              <td><input value={it.pg || ''} onChange={(e) => update(it.id, { pg: e.target.value })} /></td>
              <td><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="addrow" onClick={add}>+ Add product</button>
      <p className="hint">Net weight per unit = container volume × specific gravity. Water ≈ 1.00, sodium hypochlorite ≈ 1.20, sulphuric acid 98% ≈ 1.84.</p>
    </div>
  )
}
