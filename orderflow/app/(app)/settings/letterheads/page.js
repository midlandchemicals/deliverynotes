'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const PALETTE = ['#e8853a', '#0f6b62', '#1d3f72', '#7a2f2f', '#3a3a3a', '#5a3d7a', '#1f6f3a', '#8a6d1f']

// Logos are embedded into every PDF, so a full-res upload makes 8 MB files.
// Downscale to a print-sharp width and re-encode (keeps transparency as PNG),
// which shrinks both the PDFs and the database. ~600px ≈ 300 dpi at 50 mm wide.
function downscaleLogo(dataUrl, maxW = 600) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      if (img.width <= maxW) { resolve(dataUrl); return } // already small
      const scale = maxW / img.width
      const c = document.createElement('canvas')
      c.width = maxW
      c.height = Math.round(img.height * scale)
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, c.width, c.height)
      try { resolve(c.toDataURL('image/png')) } catch { resolve(dataUrl) }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export default function LetterheadsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(0)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('letterheads').select('*').order('created_at')
    setRows(data || [])
    // One-time cleanup: shrink any oversized logos already stored (they bloat
    // every PDF). Runs quietly in the background and saves the smaller version.
    for (const lh of (data || [])) {
      if (lh.logo && lh.logo.length > 120000) {
        const small = await downscaleLogo(lh.logo)
        if (small && small.length < lh.logo.length) {
          await supabase.from('letterheads').update({ logo: small }).eq('id', lh.id)
          setRows((r) => r.map((x) => (x.id === lh.id ? { ...x, logo: small } : x)))
        }
      }
    }
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
    reader.onload = async (ev) => {
      const small = await downscaleLogo(ev.target.result)
      update(id, { logo: small })
    }
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
