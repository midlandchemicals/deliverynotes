'use client'
import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

function addrList(arr, legacy) {
  if (Array.isArray(arr) && arr.length) return arr
  return [{ label: '', text: legacy || '' }]
}

function deliveryAddrList(c) {
  if (Array.isArray(c.delivery_addresses) && c.delivery_addresses.length) return c.delivery_addresses
  return [{ label: '', text: c.deliver || '', contact: { name: c.contact_name || '', email: c.email || '', phone: c.phone || '' } }]
}

function AddressListEditor({ list, kind, withContact, onChange }) {
  function setEntry(i, patch) { onChange(list.map((e, idx) => (idx === i ? { ...e, ...patch } : e))) }
  function setContact(i, patch) { onChange(list.map((e, idx) => (idx === i ? { ...e, contact: { ...(e.contact || {}), ...patch } } : e))) }
  function addEntry() { onChange([...list, withContact ? { label: '', text: '', contact: { name: '', email: '', phone: '' } } : { label: '', text: '' }]) }
  function removeEntry(i) {
    const next = list.filter((_, idx) => idx !== i)
    onChange(next.length ? next : [withContact ? { label: '', text: '', contact: { name: '', email: '', phone: '' } } : { label: '', text: '' }])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {list.map((e, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 11, background: 'var(--panel)' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 7, alignItems: 'center' }}>
            <input style={{ flex: 1, fontSize: 12.5 }} placeholder={i === 0 ? 'Label (e.g. Main / Head Office)' : 'Label'}
              value={e.label || ''} onChange={(ev) => setEntry(i, { label: ev.target.value })} />
            {list.length > 1 && <button className="btn-dl" onClick={() => removeEntry(i)} title="Remove this address">×</button>}
          </div>
          <textarea style={{ minHeight: 72, fontSize: 12.5 }} placeholder="Address…" value={e.text || ''} onChange={(ev) => setEntry(i, { text: ev.target.value })} />
          {withContact && (
            <div style={{ marginTop: 9 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 5 }}>Contact for this address</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 7 }}>
                <input style={{ fontSize: 12.5 }} placeholder="Name" value={e.contact?.name || ''} onChange={(ev) => setContact(i, { name: ev.target.value })} />
                <input style={{ fontSize: 12.5 }} placeholder="Email" value={e.contact?.email || ''} onChange={(ev) => setContact(i, { email: ev.target.value })} />
                <input style={{ fontSize: 12.5 }} placeholder="Telephone" value={e.contact?.phone || ''} onChange={(ev) => setContact(i, { phone: ev.target.value })} />
              </div>
            </div>
          )}
        </div>
      ))}
      <button className="addrow" style={{ fontSize: 12.5, padding: '7px 10px' }} onClick={addEntry}>+ Add {kind} address</button>
    </div>
  )
}

export default function CustomersPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)
  const [letterheads, setLetterheads] = useState([])
  const [expandedTiersId, setExpandedTiersId] = useState(null)
  const [tierRows, setTierRows] = useState({}) // { [customerId]: [{id, pallets_from, pallets_to, charge}] }

  useEffect(() => { load() }, [])

  async function load() {
    const [custRes, lhRes] = await Promise.all([
      supabase.from('customers').select('*').order('name'),
      supabase.from('letterheads').select('id, name, company').order('name'),
    ])
    setRows(custRes.data || [])
    setLetterheads(lhRes.data || [])
  }

  async function update(id, patch) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await supabase.from('customers').update(patch).eq('id', id)
  }

  async function add() {
    const { data } = await supabase.from('customers')
      .insert({ name: 'New customer', details: '', deliver: '', contact_name: '', email: '', phone: '',
                invoice_addresses: [], delivery_addresses: [], default_delivery_charge: 0, free_delivery_above: 0 })
      .select('*').single()
    setRows((r) => [...r, data])
  }

  async function remove(id) {
    setRows((r) => r.filter((x) => x.id !== id))
    await supabase.from('customers').delete().eq('id', id)
  }

  async function toggleTiers(customerId) {
    if (expandedTiersId === customerId) { setExpandedTiersId(null); return }
    setExpandedTiersId(customerId)
    if (!tierRows[customerId]) {
      const { data } = await supabase.from('customer_delivery_tiers')
        .select('*').eq('customer_id', customerId).order('pallets_from')
      setTierRows((t) => ({ ...t, [customerId]: data || [] }))
    }
  }

  function setCustomerTiers(customerId, tiers) {
    setTierRows((t) => ({ ...t, [customerId]: tiers }))
  }

  async function addTier(customerId) {
    const existing = tierRows[customerId] || []
    const nextFrom = existing.length ? Math.max(...existing.map((t) => t.pallets_to || t.pallets_from)) + 1 : 1
    const { data } = await supabase.from('customer_delivery_tiers')
      .insert({ customer_id: customerId, pallets_from: nextFrom, pallets_to: null, charge: 0 })
      .select('*').single()
    if (data) setCustomerTiers(customerId, [...existing, data])
  }

  async function saveTier(customerId, tierId, patch) {
    await supabase.from('customer_delivery_tiers').update(patch).eq('id', tierId)
  }

  function updateTierLocal(customerId, tierId, patch) {
    setTierRows((t) => ({
      ...t,
      [customerId]: (t[customerId] || []).map((r) => (r.id === tierId ? { ...r, ...patch } : r)),
    }))
  }

  async function deleteTier(customerId, tierId) {
    setCustomerTiers(customerId, (tierRows[customerId] || []).filter((r) => r.id !== tierId))
    await supabase.from('customer_delivery_tiers').delete().eq('id', tierId)
  }

  if (rows === null) return <div className="card"><div className="empty">Loading…</div></div>

  return (
    <div className="card">
      <div className="ttl"><h2>Address Book</h2></div>
      <table className="tbl">
        <thead><tr>
          <th style={{ width: '16%' }}>Name</th>
          <th style={{ width: '30%' }}>Invoice addresses</th>
          <th style={{ width: '38%' }}>Delivery addresses (each with its own contact)</th>
          <th style={{ width: '12%' }}>Pricing &amp; delivery</th>
          <th style={{ width: '4%' }}></th>
        </tr></thead>
        <tbody>
          {rows.map((it) => {
            const tiersOpen = expandedTiersId === it.id
            const tiers = tierRows[it.id] || []
            const hasSettings = (it.free_delivery_above > 0) || (it.delivery_per_pallet > 0) || (it.default_delivery_charge > 0) || (it.label_price > 0) || it.default_letterhead_id || it.three_tier_pricing || tiers.length
            return (
              <React.Fragment key={it.id}>
                <tr>
                  <td style={{ verticalAlign: 'top' }}><input value={it.name} onChange={(e) => update(it.id, { name: e.target.value })} /></td>
                  <td style={{ verticalAlign: 'top' }}>
                    <AddressListEditor
                      list={addrList(it.invoice_addresses, it.details)}
                      kind="invoice"
                      onChange={(list) => update(it.id, { invoice_addresses: list, details: list[0]?.text || '' })}
                    />
                  </td>
                  <td style={{ verticalAlign: 'top' }}>
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
                  <td style={{ verticalAlign: 'top' }}>
                    <button
                      className={'btn btn-sm ' + (tiersOpen ? 'btn-a' : 'btn-g')}
                      style={{ width: '100%', fontSize: 11.5 }}
                      onClick={() => toggleTiers(it.id)}
                    >
                      {tiersOpen ? 'Close' : (hasSettings ? '⚙ Edit' : '＋ Set up')}
                    </button>
                  </td>
                  <td style={{ verticalAlign: 'top' }}><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
                </tr>

                {tiersOpen && (
                  <tr style={{ background: 'var(--panel-2)' }}>
                    <td colSpan={5} style={{ padding: '18px 20px' }}>

                      {/* Defaults */}
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 12 }}>Pricing &amp; delivery defaults</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px 20px', maxWidth: 900, marginBottom: 8 }}>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Label price (£/label)</label>
                          <input className="mono" style={{ textAlign: 'right' }}
                            value={it.label_price ?? ''} placeholder="0.00"
                            onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, label_price: e.target.value } : x)))}
                            onBlur={(e) => update(it.id, { label_price: parseFloat(e.target.value) || 0 })} />
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Flat delivery (£)</label>
                          <input className="mono" style={{ textAlign: 'right' }}
                            value={it.default_delivery_charge ?? ''} placeholder="0.00"
                            onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, default_delivery_charge: e.target.value } : x)))}
                            onBlur={(e) => update(it.id, { default_delivery_charge: parseFloat(e.target.value) || 0 })} />
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Default letterhead</label>
                          <select value={it.default_letterhead_id || ''}
                            onChange={(e) => update(it.id, { default_letterhead_id: e.target.value || null })}>
                            <option value="">— default —</option>
                            {letterheads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Buyer pricing</label>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 13, color: 'var(--ink)', margin: '4px 0 0', cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!it.three_tier_pricing}
                              onChange={(e) => update(it.id, { three_tier_pricing: e.target.checked })}
                              style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }} />
                            3-tier (Trade / Buyer / Retail)
                          </label>
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Free delivery above (£)</label>
                          <input className="mono" style={{ textAlign: 'right' }}
                            value={it.free_delivery_above || ''} placeholder="0.00 = off"
                            onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, free_delivery_above: e.target.value } : x)))}
                            onBlur={(e) => update(it.id, { free_delivery_above: parseFloat(e.target.value) || 0 })} />
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Delivery £ per pallet</label>
                          <input className="mono" style={{ textAlign: 'right' }}
                            value={it.delivery_per_pallet || ''} placeholder="0.00"
                            onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, delivery_per_pallet: e.target.value } : x)))}
                            onBlur={(e) => update(it.id, { delivery_per_pallet: parseFloat(e.target.value) || 0 })} />
                        </div>
                      </div>
                      <p className="hint" style={{ marginTop: 0, marginBottom: 18 }}>
                        <b>Free delivery above</b>: order subtotal ≥ this → delivery £0. <b>£ per pallet</b>: charges rate × pallets (per IBC), and takes priority over the banded tiers below.
                      </p>

                      {/* Pallet tiers */}
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>Pallet-based delivery tiers <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — fixed charge per band)</span></div>
                      {tiers.length === 0 && (
                        <p className="hint" style={{ marginBottom: 8, marginTop: 0 }}>No tiers set — add one below, or use “£ per pallet” above instead.</p>
                      )}
                      {tiers.map((tier) => (
                        <div key={tier.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 40 }}>Pallets</span>
                          <input className="mono" style={{ width: 52, textAlign: 'center' }}
                            value={tier.pallets_from}
                            onChange={(e) => updateTierLocal(it.id, tier.id, { pallets_from: e.target.value })}
                            onBlur={(e) => saveTier(it.id, tier.id, { pallets_from: e.target.value !== '' ? (parseInt(e.target.value) || 0) : 1 })}
                          />
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>to</span>
                          <input className="mono" style={{ width: 52, textAlign: 'center' }}
                            value={tier.pallets_to ?? ''}
                            placeholder="∞"
                            onChange={(e) => updateTierLocal(it.id, tier.id, { pallets_to: e.target.value })}
                            onBlur={(e) => saveTier(it.id, tier.id, { pallets_to: e.target.value ? parseInt(e.target.value) : null })}
                          />
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>= £</span>
                          <input className="mono" style={{ width: 72, textAlign: 'right' }}
                            value={tier.charge}
                            onChange={(e) => updateTierLocal(it.id, tier.id, { charge: e.target.value })}
                            onBlur={(e) => saveTier(it.id, tier.id, { charge: parseFloat(e.target.value) || 0 })}
                          />
                          <button className="btn-dl" onClick={() => deleteTier(it.id, tier.id)}>×</button>
                        </div>
                      ))}
                      <button className="addrow" style={{ fontSize: 12, marginTop: 4 }} onClick={() => addTier(it.id)}>+ Add tier</button>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
      <button className="addrow" onClick={add}>+ Add customer</button>
      <p className="hint">Add several invoice or delivery addresses per customer. Use <b>Del. rules</b> to set pallet-based delivery tiers or a free-delivery order threshold — both are optional and work independently per customer.</p>
    </div>
  )
}
