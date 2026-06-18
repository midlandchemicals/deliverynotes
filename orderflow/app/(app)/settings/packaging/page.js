'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { num } from '@/lib/calc'

export default function PackagingPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('packaging').select('*').order('volume')
    setRows(data || [])
  }
  async function update(id, patch) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('packaging').update(patch).eq('id', id)
  }
  async function add() {
    const { data } = await supabase.from('packaging').insert({ name: 'New container', volume: 0, tare: 0 }).select('*').single()
    setRows((r) => [...r, data])
  }
  async function remove(id) {
    setRows((r) => r.filter((x) => x.id !== id))
    await supabase.from('packaging').delete().eq('id', id)
  }

  if (rows === null) return <div className="card"><div className="empty">Loading…</div></div>

  return (
    <div className="card">
      <div className="ttl"><h2>Packaging / Containers</h2></div>
      <table className="tbl">
        <thead><tr>
          <th style={{ width: '48%' }}>Container name</th>
          <th style={{ width: '23%' }}>Volume (L)</th>
          <th style={{ width: '23%' }}>Tare weight (kg)</th>
          <th style={{ width: '6%' }}></th>
        </tr></thead>
        <tbody>
          {rows.map((it) => (
            <tr key={it.id}>
              <td><input value={it.name} onChange={(e) => update(it.id, { name: e.target.value })} /></td>
              <td><input className="mono" style={{ textAlign: 'right' }} value={it.volume}
                onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, volume: e.target.value } : x)))}
                onBlur={(e) => update(it.id, { volume: num(e.target.value) })} /></td>
              <td><input className="mono" style={{ textAlign: 'right' }} value={it.tare}
                onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, tare: e.target.value } : x)))}
                onBlur={(e) => update(it.id, { tare: num(e.target.value) })} /></td>
              <td><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="addrow" onClick={add}>+ Add container</button>
      <p className="hint"><b>Tare weight</b> is the mass of the empty container. Gross = product net weight + tare × quantity.</p>
    </div>
  )
}
