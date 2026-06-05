'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const PALETTE = ['#e8853a', '#0f6b62', '#1d3f72', '#7a2f2f', '#3a3a3a', '#5a3d7a', '#1f6f3a', '#8a6d1f']

export default function LetterheadsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(0)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('letterheads').select('*').order('created_at')
    setRows(data || [])
  }
  async function update(id, patch) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('letterheads').update(patch).eq('id', id)
  }
  async function add() {
    const { data } = await supabase.from('letterheads')
      .insert({ name: 'New letterhead', company: '', address: '', footer: '', color: '#e8853a' }).select('*').single()
    setRows((r) => [...r, data]); setSel(rows.length)
  }
  async function remove(id) {
    const idx = rows.findIndex((x) => x.id === id)
    setRows((r) => r.filter((x) => x.id !== id))
    setSel((s) => Math.max(0, s >= idx ? s - 1 : s))
    await supabase.from('letterheads').delete().eq('id', id)
  }
  function onLogo(id, file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => update(id, { logo: ev.target.result })
    reader.readAsDataURL(file)
  }

  if (rows === null) return <div className="card"><div className="empty">Loading…</div></div>
  const lh = rows[sel]

  return (
    <div className="card">
      <div className="ttl">
        <h2>Letterheads</h2>
        <button className="btn btn-g btn-sm" onClick={add}>＋ Add</button>
      </div>
      <div className="filters">
        {rows.map((l, i) => (
          <span key={l.id} className={'chip' + (i === sel ? ' on' : '')} onClick={() => setSel(i)}>
            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: l.color, marginRight: 7, verticalAlign: 'middle' }} />
            {l.name}
          </span>
        ))}
      </div>

      {!lh ? <div className="empty">No letterheads — add one.</div> : (
        <div>
          <div className="row c2">
            <div className="field"><label>Profile label</label>
              <input value={lh.name} onChange={(e) => update(lh.id, { name: e.target.value })} /></div>
            <div className="field"><label>Company name</label>
              <input value={lh.company || ''} onChange={(e) => update(lh.id, { company: e.target.value })} /></div>
          </div>
          <div className="row"><div className="field"><label>Address &amp; contact block</label>
            <textarea value={lh.address || ''} onChange={(e) => update(lh.id, { address: e.target.value })} /></div></div>
          <div className="row"><div className="field"><label>Footer line</label>
            <textarea style={{ minHeight: 46 }} value={lh.footer || ''} onChange={(e) => update(lh.id, { footer: e.target.value })} /></div></div>
          <div className="row c2">
            <div className="field"><label>Accent colour</label>
              <div className="filters" style={{ margin: 0 }}>
                {PALETTE.map((c) => (
                  <span key={c} onClick={() => update(lh.id, { color: c })}
                    style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer',
                      border: '2px solid ' + (c === lh.color ? 'var(--ink)' : 'transparent') }} />
                ))}
              </div>
            </div>
            <div className="field"><label>Logo (optional)</label>
              <label className="addrow" style={{ display: 'block', textAlign: 'center', marginTop: 0 }}>
                {lh.logo ? <img src={lh.logo} alt="logo" style={{ maxHeight: 40, display: 'block', margin: '0 auto 6px' }} /> : null}
                {lh.logo ? 'Replace logo' : 'Click to upload PNG / JPG'}
                <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
                  onChange={(e) => onLogo(lh.id, e.target.files[0])} />
              </label>
            </div>
          </div>
          <button className="btn-dl" style={{ width: 'auto', padding: '7px 12px' }} onClick={() => remove(lh.id)}>Delete this letterhead</button>
        </div>
      )}
    </div>
  )
}
