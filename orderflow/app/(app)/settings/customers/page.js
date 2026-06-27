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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((e, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
            <input style={{ flex: 1, fontSize: 12 }} placeholder={i === 0 ? 'Label (e.g. Main / Head Office)' : 'Label'}
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
          <th style={{ width: '13%' }}>Name</th>
          <th style={{ width: '24%' }}>Invoice addresses</th>
          <th style={{ width: '28%' }}>Delivery addresses (each with its own contact)</th>
          <th style={{ width: '7%' }}>£/label</th>
          <th style={{ width: '7%' }}>Flat del. £</th>
          <th style={{ width: '11%' }}>Default letterhead</th>
          <th style={{ width: '6%' }}>3-tier price</th>
          <th style={{ width: '8%' }}>Del. rules</th>
          <th style={{ width: '2%' }}></th>
        </tr></thead>
        <tbody>
          {rows.map((it) => {
            const tiersOpen = expandedTiersId === it.id
            const tiers = tierRows[it.id] || []
            return (
              <React.Fragment key={it.id}>
                <tr>
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
                  <td>
                    <input className="mono" style={{ textAlign: 'right' }}
                      value={it.default_delivery_charge ?? ''} placeholder="0.00"
                      onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, default_delivery_charge: e.target.value } : x)))}
                      onBlur={(e) => update(it.id, { default_delivery_charge: parseFloat(e.target.value) || 0 })} />
                  </td>
                  <td>
                    <select
                      value={it.default_letterhead_id || ''}
                      onChange={(e) => update(it.id, { default_letterhead_id: e.target.value || null })}
                      style={{ fontSize: 12, padding: '4px 6px', width: '100%' }}
                    >
                      <option value="">— default —</option>
                      {letterheads.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!!it.three_tier_pricing}
                      onChange={(e) => update(it.id, { three_tier_pricing: e.target.checked })}
                      style={{ width: 'auto', height: 16, accentColor: 'var(--accent)' }}
                      title="Trade / Buyer group / Retail pricing for this customer"
                    />
                  </td>
                  <td>
                    <button
                      className={'btn btn-sm ' + (tiersOpen ? 'btn-a' : 'btn-g')}
                      style={{ width: '100%', fontSize: 11 }}
                      onClick={() => toggleTiers(it.id)}
                    >
                      {tiersOpen ? 'Close' : tiers.length || (it.free_delivery_above > 0) ? '⚡ Edit' : '+ Set up'}
                    </button>
                  </td>
                  <td><button className="btn-dl" onClick={() => remove(it.id)}>×</button></td>
                </tr>

                {tiersOpen && (
                  <tr style={{ background: 'var(--panel-2)' }}>
                    <td colSpan={9} style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                        {/* Free delivery threshold */}
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 8 }}>Free delivery above order value</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: 'var(--muted)', fontSize: 13 }}>£</span>
                            <input className="mono" style={{ width: 90, textAlign: 'right' }}
                              value={it.free_delivery_above || ''} placeholder="0.00"
                              onChange={(e) => setRows((r) => r.map((x) => (x.id === it.id ? { ...x, free_delivery_above: e.target.value } : x)))}
                              onBlur={(e) => update(it.id, { free_delivery_above: parseFloat(e.target.value) || 0 })}
                            />
                          </div>
                          <p className="hint" style={{ marginTop: 6, maxWidth: 180 }}>Order subtotal at or above this → delivery auto-sets to £0. Leave blank or 0 to disable.</p>
                        </div>

                        {/* Pallet tiers */}
                        <div style={{ flex: 1, minWidth: 280 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', marginBottom: 8 }}>Pallet-based delivery tiers</div>
                          {tiers.length === 0 && (
                            <p className="hint" style={{ marginBottom: 8 }}>No tiers set — add one below.</p>
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
                          <p className="hint" style={{ marginTop: 8, maxWidth: 320 }}>Leave "to" blank (∞) for the top tier. The "to" value is exclusive — e.g. "0 to 1" applies when pallets &lt; 1 (i.e. no full pallet). When pallet count is entered on an order, the matching tier auto-fills the delivery charge (unless the free-delivery threshold is met).</p>
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
      <button className="addrow" onClick={add}>+ Add customer</button>
      <p className="hint">Add several invoice or delivery addresses per customer. Use <b>Del. rules</b> to set pallet-based delivery tiers or a free-delivery order threshold — both are optional and work independently per customer.</p>
    </div>
  )
}
