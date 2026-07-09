'use client'
import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { splitContact } from '@/lib/calc'
import Combobox from '@/app/(app)/Combobox'

function addrList(arr, legacy) {
  if (Array.isArray(arr) && arr.length) return arr
  return [{ label: '', text: legacy || '' }]
}

function deliveryAddrList(c) {
  if (Array.isArray(c.delivery_addresses) && c.delivery_addresses.length) return c.delivery_addresses
  return [{ label: '', text: c.deliver || '', contact: { name: c.contact_name || '', email: c.email || '', phone: c.phone || '' } }]
}

// Address editor: collapsed one-line cards, one address expanded at a time.
// onChange = update local state only (no DB write); onCommit = persist.
// Smart paste: drop a whole block from an email into the paste box and the
// contact details (name / email / phone) are picked out automatically.
function AddressListEditor({ list, kind, withContact, onChange, onCommit }) {
  const blank = () => (withContact ? { label: '', text: '', contact: { name: '', email: '', phone: '' } } : { label: '', text: '' })
  // Auto-open the only entry when it's still empty (fresh customer)
  const [openIdx, setOpenIdx] = useState(list.length === 1 && !list[0]?.text ? 0 : null)

  function setEntry(i, patch) { onChange(list.map((e, idx) => (idx === i ? { ...e, ...patch } : e))) }
  function setContact(i, patch) { onChange(list.map((e, idx) => (idx === i ? { ...e, contact: { ...(e.contact || {}), ...patch } } : e))) }
  const commit = () => onCommit(list)

  function addEntry() {
    const next = [...list, blank()]
    onChange(next)
    setOpenIdx(next.length - 1)
  }
  function removeEntry(i) {
    const next = list.filter((_, idx) => idx !== i)
    const final = next.length ? next : [blank()]
    onChange(final)
    onCommit(final)
    setOpenIdx(null)
  }

  // Parse a pasted block: contact lines become the contact, the rest the address.
  function smartPaste(i, raw) {
    if (!raw || !raw.trim()) return
    let next
    if (withContact) {
      const { address, contact } = splitContact(raw)
      next = list.map((e, idx) => (idx === i ? {
        ...e,
        text: address || raw.trim(),
        contact: {
          name: contact.name || e.contact?.name || '',
          email: contact.email || e.contact?.email || '',
          phone: contact.phone || e.contact?.phone || '',
        },
      } : e))
    } else {
      next = list.map((e, idx) => (idx === i ? { ...e, text: raw.trim() } : e))
    }
    onChange(next)
    onCommit(next)
  }

  const firstLine = (t) => String(t || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {list.map((e, i) => {
        const open = openIdx === i
        if (!open) {
          // Collapsed: one compact line
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--panel)' }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <b style={{ color: 'var(--heading)' }}>{e.label || firstLine(e.text) || `Address ${i + 1}`}</b>
                {e.label && firstLine(e.text) ? <span style={{ color: 'var(--muted)' }}> · {firstLine(e.text)}</span> : null}
                {withContact && e.contact?.name ? <span style={{ color: 'var(--faint)' }}> · {e.contact.name}</span> : null}
                {!firstLine(e.text) && <span style={{ color: 'var(--faint)' }}> (empty)</span>}
              </div>
              <button className="btn btn-g btn-sm" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={() => setOpenIdx(i)}>Edit</button>
              {list.length > 1 && (
                <button className="btn-dl" style={{ width: 30, height: 28, fontSize: 13 }}
                  onClick={() => { if (confirm('Delete this address?')) removeEntry(i) }}
                  title="Delete this address">🗑</button>
              )}
            </div>
          )
        }
        // Expanded editor
        return (
          <div key={i} style={{ border: '1.5px solid var(--accent)', borderRadius: 10, padding: 12, background: 'var(--panel)' }}>
            <textarea
              placeholder={withContact
                ? '✨ Paste the full address block from an email here — name, email & phone are picked out automatically'
                : '✨ Paste the full address block here'}
              style={{ minHeight: 46, fontSize: 12, background: 'var(--accent-soft)', border: '1px dashed var(--accent)', marginBottom: 9 }}
              defaultValue=""
              onPaste={(ev) => {
                ev.preventDefault()
                smartPaste(i, ev.clipboardData.getData('text'))
                ev.target.value = ''
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginBottom: 7, alignItems: 'center' }}>
              <input style={{ flex: 1, fontSize: 12.5 }} placeholder="Label (e.g. Main / Head Office)"
                value={e.label || ''} onChange={(ev) => setEntry(i, { label: ev.target.value })} onBlur={commit} />
            </div>
            <textarea style={{ minHeight: 72, fontSize: 12.5 }} placeholder="Address…" value={e.text || ''}
              onChange={(ev) => setEntry(i, { text: ev.target.value })} onBlur={commit} />
            {withContact && (
              <div style={{ marginTop: 9 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 5 }}>Contact for this address</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 7 }}>
                  <input style={{ fontSize: 12.5 }} placeholder="Name" value={e.contact?.name || ''} onChange={(ev) => setContact(i, { name: ev.target.value })} onBlur={commit} />
                  <input style={{ fontSize: 12.5 }} placeholder="Email" value={e.contact?.email || ''} onChange={(ev) => setContact(i, { email: ev.target.value })} onBlur={commit} />
                  <input style={{ fontSize: 12.5 }} placeholder="Telephone" value={e.contact?.phone || ''} onChange={(ev) => setContact(i, { phone: ev.target.value })} onBlur={commit} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button className="btn btn-a btn-sm" onClick={() => { commit(); setOpenIdx(null) }}>Done</button>
              {list.length > 1 && (
                <button className="btn btn-g btn-sm" onClick={() => removeEntry(i)}>Remove</button>
              )}
            </div>
          </div>
        )
      })}
      <button className="addrow" style={{ fontSize: 12.5, padding: '7px 10px', marginTop: 2 }} onClick={addEntry}>+ Add {kind} address</button>
    </div>
  )
}

export default function CustomersPage() {
  const supabase = createClient()
  const [rows, setRows] = useState(null)
  const [letterheads, setLetterheads] = useState([])
  const [expandedTiersId, setExpandedTiersId] = useState(null)
  const [tierRows, setTierRows] = useState({}) // { [customerId]: [{id, pallets_from, pallets_to, charge}] }
  const [q, setQ] = useState('')
  // Screenshot import
  const [impCustId, setImpCustId] = useState('')
  const [impBusy, setImpBusy] = useState(false)
  const [impErr, setImpErr] = useState('')
  const [impMsg, setImpMsg] = useState('')
  const [impData, setImpData] = useState(null) // { delivery:{name,address,contact}, invoice:{...} }

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

  // Local-only update while typing — persisted on blur / Done via update()
  function updateLocal(id, patch) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  // Paste a delivery-note screenshot → read it with Claude vision → preview
  function handleImportPaste(e) {
    const items = e.clipboardData?.items || []
    const imgItem = [...items].find((it) => it.type && it.type.startsWith('image/'))
    if (!imgItem) return
    e.preventDefault()
    const file = imgItem.getAsFile()
    if (!file) return
    setImpBusy(true); setImpErr(''); setImpMsg(''); setImpData(null)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const b64 = String(reader.result).split(',')[1]
        const res = await fetch('/api/extract-address', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image: b64, mediaType: file.type }),
        })
        const json = await res.json()
        if (!res.ok || json.error) { setImpErr(json.error || 'Extraction failed'); setImpBusy(false); return }
        setImpData(json.result)
      } catch (err) { setImpErr('Upload failed: ' + (err?.message || '')) }
      setImpBusy(false)
    }
    reader.readAsDataURL(file)
  }

  function setImpField(side, path, value) {
    setImpData((d) => {
      const next = JSON.parse(JSON.stringify(d))
      if (path.length === 1) next[side][path[0]] = value
      else next[side][path[0]][path[1]] = value
      return next
    })
  }

  // Append the extracted addresses to the selected customer
  async function applyImport() {
    const cust = rows.find((r) => r.id === impCustId)
    if (!cust) { setImpErr('Choose a customer first.'); return }
    if (!impData) return
    const d = impData.delivery || {}, i = impData.invoice || {}
    const c = (x) => ({ name: x?.name || '', email: x?.email || '', phone: x?.phone || '' })

    const delEntry = { label: '', text: (d.address || d.name || '').trim(), contact: c(d.contact) }
    const invText = (i.address && i.address.trim()) ? i.address.trim() : cust.name  // blank invoice → company name
    const invEntry = { label: '', text: invText, contact: c(i.contact) }

    const curDel = deliveryAddrList(cust).filter((a) => a.text)
    const curInv = addrList(cust.invoice_addresses, cust.details).filter((a) => a.text)
    const nextDel = delEntry.text ? [...curDel, delEntry] : curDel
    const nextInv = [...curInv, invEntry]

    await update(cust.id, {
      delivery_addresses: nextDel,
      deliver: nextDel[0]?.text || '',
      contact_name: nextDel[0]?.contact?.name || '',
      email: nextDel[0]?.contact?.email || '',
      phone: nextDel[0]?.contact?.phone || '',
      invoice_addresses: nextInv,
      details: nextInv[0]?.text || '',
    })
    setImpData(null)
    setImpMsg(`Added to ${cust.name}. Paste the next screenshot when ready.`)
  }

  async function add() {
    const { data } = await supabase.from('customers')
      .insert({ name: 'New customer', details: '', deliver: '', contact_name: '', email: '', phone: '',
                invoice_addresses: [], delivery_addresses: [], default_delivery_charge: 0, free_delivery_above: 0 })
      .select('*').single()
    setRows((r) => [data, ...r])
    setQ('')
    setExpandedTiersId(data.id)  // open the new customer straight away
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

  const filtered = rows.filter((it) => !q || (it.name || '').toLowerCase().includes(q.toLowerCase()))

  function customerSummary(it) {
    const inv = addrList(it.invoice_addresses, it.details).filter((a) => a.text).length
    const del = deliveryAddrList(it).filter((a) => a.text).length
    const bits = []
    if (del) bits.push(`${del} delivery address${del !== 1 ? 'es' : ''}`)
    if (it.delivery_per_pallet > 0) bits.push(`£${Number(it.delivery_per_pallet).toFixed(2)}/pallet`)
    else if ((tierRows[it.id] || []).length) bits.push('pallet tiers')
    else if (it.default_delivery_charge > 0) bits.push(`£${Number(it.default_delivery_charge).toFixed(2)} delivery`)
    if (it.three_tier_pricing) bits.push('3-tier pricing')
    return bits.join(' · ') || (inv ? 'address on file' : 'no addresses yet')
  }

  const impCust = rows.find((r) => r.id === impCustId)

  return (
    <div>
      {/* Screenshot import */}
      <div className="card">
        <div className="ttl" style={{ marginBottom: 12 }}>
          <h2>📷 Import from a delivery-note screenshot</h2>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ minWidth: 260, flex: '0 1 320px' }}>
            <label style={{ marginBottom: 4 }}>Add to customer</label>
            <Combobox
              options={rows.map((r) => ({ id: r.id, label: r.name }))}
              value={impCustId}
              onSelect={(id) => { setImpCustId(id); setImpMsg('') }}
              placeholder="Search customer…"
            />
          </div>
        </div>
        <textarea
          onPaste={handleImportPaste}
          value=""
          readOnly
          placeholder={impBusy ? '⏳ Reading the screenshot…' : '📋 Click here and press Ctrl+V to paste a delivery-note screenshot. It will read the delivery & invoice addresses automatically.'}
          style={{
            width: '100%', minHeight: 64, cursor: 'text', resize: 'none',
            background: 'var(--accent-soft)', border: '1.5px dashed var(--accent)',
            color: 'var(--muted)', fontSize: 13,
          }}
        />
        {impErr && <p style={{ color: 'var(--bad)', fontSize: 12.5, marginTop: 8 }}>{impErr}</p>}
        {impMsg && <p style={{ color: 'var(--accent)', fontSize: 12.5, marginTop: 8 }}>{impMsg}</p>}

        {impData && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 10 }}>
              Check &amp; edit before adding{impCust ? ` to ${impCust.name}` : ''}
            </div>
            <div className="row c2">
              {[['delivery', 'Delivery address'], ['invoice', 'Invoice address']].map(([side, title]) => (
                <div key={side} style={{ minWidth: 0 }}>
                  <label>{title}</label>
                  <input style={{ fontSize: 12.5, marginBottom: 6 }} placeholder="Name (first line)"
                    value={impData[side]?.name || ''} onChange={(e) => setImpField(side, ['name'], e.target.value)} />
                  <textarea style={{ minHeight: 84, fontSize: 12.5 }} placeholder={side === 'invoice' ? 'Leave blank to use the company name' : 'Address…'}
                    value={impData[side]?.address || ''} onChange={(e) => setImpField(side, ['address'], e.target.value)} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginTop: 6 }}>
                    <input style={{ fontSize: 12 }} placeholder="Contact name" value={impData[side]?.contact?.name || ''} onChange={(e) => setImpField(side, ['contact', 'name'], e.target.value)} />
                    <input style={{ fontSize: 12 }} placeholder="Email" value={impData[side]?.contact?.email || ''} onChange={(e) => setImpField(side, ['contact', 'email'], e.target.value)} />
                    <input style={{ fontSize: 12 }} placeholder="Phone" value={impData[side]?.contact?.phone || ''} onChange={(e) => setImpField(side, ['contact', 'phone'], e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <button className="btn btn-a btn-sm" onClick={applyImport} disabled={!impCustId}>
                {impCustId ? `＋ Add to ${impCust?.name || 'customer'}` : 'Pick a customer above'}
              </button>
              <button className="btn btn-g btn-sm" onClick={() => { setImpData(null); setImpMsg('') }}>Discard</button>
            </div>
          </div>
        )}
        <p className="hint">Pick the customer, then paste (Ctrl+V) a screenshot of their delivery note. The delivery and invoice addresses (plus contact name/email/phone) are read automatically — check them and click add. If the invoice box was blank, it fills with the company name.</p>
      </div>

      <div className="card">
        <div className="ttl">
          <h2>Address Book <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({rows.length})</span></h2>
          <button className="btn btn-a btn-sm" onClick={add}>＋ Add customer</button>
        </div>
        <div className="filters" style={{ marginBottom: 0 }}>
          <input placeholder="Search customer by name…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} autoFocus />
          {q && <span className="muted" style={{ fontSize: 12.5 }}>{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</span>}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="card"><div className="empty">{q ? `No customer matches “${q}”.` : 'No customers yet — add one above.'}</div></div>
      )}

      {filtered.map((it) => {
        const open = expandedTiersId === it.id
        const tiers = tierRows[it.id] || []
        return (
          <div key={it.id} className="card" style={{ marginBottom: 10, padding: open ? 22 : '12px 16px', border: open ? '1.5px solid var(--accent)' : undefined }}>
            {/* Collapsed header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--heading)', fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name || '(unnamed)'}</div>
                {!open && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{customerSummary(it)}</div>}
              </div>
              <button className={'btn btn-sm ' + (open ? 'btn-a' : 'btn-g')} style={{ flexShrink: 0 }} onClick={() => toggleTiers(it.id)}>
                {open ? 'Close' : 'Edit'}
              </button>
              <button className="btn-dl" style={{ flexShrink: 0 }} onClick={() => remove(it.id)} title="Delete customer">×</button>
            </div>

            {open && (
              <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
                <div className="field" style={{ maxWidth: 380, marginBottom: 18 }}>
                  <label>Customer name</label>
                  <input value={it.name}
                    onChange={(e) => updateLocal(it.id, { name: e.target.value })}
                    onBlur={(e) => update(it.id, { name: e.target.value })} />
                </div>

                <div className="row c2" style={{ marginBottom: 4 }}>
                  <div style={{ minWidth: 0 }}>
                    <label>Invoice addresses</label>
                    <AddressListEditor
                      list={addrList(it.invoice_addresses, it.details)}
                      kind="invoice"
                      onChange={(list) => updateLocal(it.id, { invoice_addresses: list, details: list[0]?.text || '' })}
                      onCommit={(list) => update(it.id, { invoice_addresses: list, details: list[0]?.text || '' })}
                    />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <label>Delivery addresses (each with its own contact)</label>
                    <AddressListEditor
                      list={deliveryAddrList(it)}
                      kind="delivery"
                      withContact
                      onChange={(list) => updateLocal(it.id, {
                        delivery_addresses: list,
                        deliver: list[0]?.text || '',
                        contact_name: list[0]?.contact?.name || '',
                        email: list[0]?.contact?.email || '',
                        phone: list[0]?.contact?.phone || '',
                      })}
                      onCommit={(list) => update(it.id, {
                        delivery_addresses: list,
                        deliver: list[0]?.text || '',
                        contact_name: list[0]?.contact?.name || '',
                        email: list[0]?.contact?.email || '',
                        phone: list[0]?.contact?.phone || '',
                      })}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
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
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
