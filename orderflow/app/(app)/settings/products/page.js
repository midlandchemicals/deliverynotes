'use client'
import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { num, prettyDate } from '@/lib/calc'
import { lookupADR, adrPgOptions, adrTunnelForPG } from '@/lib/adr'

function normPG(pg) {
  return String(pg || '').replace(/^PG\s*/i, '').trim()
}

export default function ProductsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('products').select('*').order('category').order('name')
    setRows(data || [])
  }

  async function update(id, patch) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('products').update(patch).eq('id', id)
  }

  async function handleUNChange(id, un) {
    const product = rows.find((r) => r.id === id)
    const entry = lookupADR(un)
    const patch = {
      un_number: un,
      adr_class: '',
      adr_subsidiary: '',
      adr_tunnel: '',
      adr_psn: '',
      adr_verified_by: '',
      adr_verified_at: null,
    }
    if (entry) {
      patch.adr_class = entry.class
      patch.adr_subsidiary = entry.subsidiary
      patch.adr_psn = entry.name
      // Keep existing PG if it's valid for this UN, else default to first option
      const currentPGNorm = normPG(product?.pg || '').toUpperCase()
      const pg = entry.pgOptions.includes(currentPGNorm) ? currentPGNorm : (entry.pgOptions[0] || '')
      if (pg !== currentPGNorm) patch.pg = pg
      patch.adr_tunnel = adrTunnelForPG(un, pg)
    }
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('products').update(patch).eq('id', id)
  }

  async function handlePGChange(id, pg) {
    const product = rows.find((r) => r.id === id)
    const patch = { pg, adr_verified_by: '', adr_verified_at: null }
    if (product?.un_number && lookupADR(product.un_number)) {
      patch.adr_tunnel = adrTunnelForPG(product.un_number, pg)
    }
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('products').update(patch).eq('id', id)
  }

  async function verifyProduct(id) {
    const { data: { user } } = await supabase.auth.getUser()
    const patch = { adr_verified_by: user?.email || 'unknown', adr_verified_at: new Date().toISOString() }
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('products').update(patch).eq('id', id)
  }

  async function add() {
    const { data } = await supabase.from('products')
      .insert({ name: 'New product', sg: 1.0, pg: '', un_number: '', category: '',
                adr_class: '', adr_subsidiary: '', adr_tunnel: '', adr_psn: '', adr_verified_by: '', adr_verified_at: null })
      .select('*').single()
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
          <th style={{ width: '15%' }}>Range</th>
          <th style={{ width: '28%' }}>Product name</th>
          <th style={{ width: '10%' }}>SG</th>
          <th style={{ width: '13%' }}>UN number</th>
          <th style={{ width: '14%' }}>Packing group</th>
          <th style={{ width: '14%' }}>ADR status</th>
          <th style={{ width: '6%' }}></th>
        </tr></thead>
        <tbody>
          {filtered.map((it) => {
            const entry = lookupADR(it.un_number)
            const pgOpts = adrPgOptions(it.un_number)  // null = unknown, [] = gas (no PG), [...] = list
            const isHazmat = Boolean(it.un_number)
            const isVerified = Boolean(it.adr_verified_by)
            const expanded = expandedId === it.id

            return (
              <React.Fragment key={it.id}>
                <tr>
                  <td><input value={it.category || ''} onChange={(e) => update(it.id, { category: e.target.value })} /></td>
                  <td><input value={it.name} onChange={(e) => update(it.id, { name: e.target.value })} /></td>
                  <td><input className="mono" style={{ textAlign: 'right' }} value={it.sg ?? ''}
                    onChange={(e) => update(it.id, { sg: num(e.target.value) })} /></td>
                  <td>
                    <input className="mono" value={it.un_number || ''}
                      onChange={(e) => handleUNChange(it.id, e.target.value)}
                      placeholder="—"
                    />
                  </td>
                  <td>
                    {pgOpts && pgOpts.length > 0 ? (
                      <select value={normPG(it.pg)} onChange={(e) => handlePGChange(it.id, e.target.value)}>
                        {!pgOpts.includes(normPG(it.pg).toUpperCase()) && <option value={normPG(it.pg)}>{normPG(it.pg) ? `PG ${normPG(it.pg)}` : '—'}</option>}
                        {pgOpts.map((pg) => <option key={pg} value={pg}>PG {pg}</option>)}
                      </select>
                    ) : (
                      <input value={it.pg || ''} onChange={(e) => handlePGChange(it.id, e.target.value)} placeholder="—" />
                    )}
                  </td>
                  <td>
                    {isHazmat ? (
                      <button
                        className={'adr-badge ' + (isVerified ? 'adr-verified' : 'adr-warning')}
                        onClick={() => setExpandedId(expanded ? null : it.id)}
                        title={expanded ? 'Collapse ADR details' : 'View / verify ADR details'}
                      >
                        {isVerified ? '✓ Verified' : '⚠ Unverified'}
                      </button>
                    ) : (
                      <span className="adr-badge adr-none">—</span>
                    )}
                  </td>
                  <td><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
                </tr>

                {expanded && (
                  <tr className="adr-expand-row">
                    <td colSpan={7}>
                      <div className="adr-panel">
                        <div className="adr-panel-title">
                          {entry ? 'ADR details — auto-filled from ADR 2023 Table A, editable' : 'ADR details — manual entry (UN number not in Table A)'}
                        </div>
                        <div className="adr-fields">
                          <div>
                            <label>Hazard class</label>
                            <input className="mono" value={it.adr_class || ''} onChange={(e) => update(it.id, { adr_class: e.target.value, adr_verified_by: '', adr_verified_at: null })} placeholder="e.g. 8" />
                          </div>
                          <div>
                            <label>Subsidiary risk</label>
                            <input className="mono" value={it.adr_subsidiary || ''} onChange={(e) => update(it.id, { adr_subsidiary: e.target.value, adr_verified_by: '', adr_verified_at: null })} placeholder="e.g. 6.1" />
                          </div>
                          <div>
                            <label>Tunnel code</label>
                            <input className="mono" value={it.adr_tunnel || ''} onChange={(e) => update(it.id, { adr_tunnel: e.target.value, adr_verified_by: '', adr_verified_at: null })} placeholder="e.g. (E)" />
                          </div>
                          <div>
                            <label>Packing group</label>
                            <input className="mono" value={it.pg || ''} onChange={(e) => handlePGChange(it.id, e.target.value)} placeholder="e.g. II" />
                          </div>
                        </div>
                        <div className="adr-psn-field">
                          <label>Proper shipping name {entry ? <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>— for N.O.S. entries add the technical name, e.g. (contains Hydrofluoric Acid)</span> : null}</label>
                          <input value={it.adr_psn || ''} onChange={(e) => update(it.id, { adr_psn: e.target.value, adr_verified_by: '', adr_verified_at: null })}
                            placeholder={entry ? entry.name : 'e.g. CORROSIVE LIQUID, TOXIC, N.O.S. (contains Hydrofluoric Acid)'} />
                        </div>

                        <div className="adr-verify-row">
                          {isVerified ? (
                            <>
                              <span className="adr-verified-info">✓ Verified by {it.adr_verified_by} on {prettyDate(it.adr_verified_at)}</span>
                              <button className="btn btn-g btn-sm" style={{ marginLeft: 12 }}
                                onClick={() => update(it.id, { adr_verified_by: '', adr_verified_at: null })}>
                                Clear verification
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="adr-unverified-warn">Cross-check these values against the product SDS before verifying.</span>
                              <button className="btn btn-a btn-sm" style={{ marginLeft: 12 }}
                                onClick={() => verifyProduct(it.id)}>
                                ✓ Mark as verified against SDS
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
      <p className="hint">Net weight = container volume × specific gravity. A blank UN number means non-hazardous. ADR details are auto-filled from ADR 2023 Table A where the UN number is recognised — verify each hazmat product against its SDS.</p>
    </div>
  )
}
