'use client'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { computeLine, fmt } from '@/lib/calc'

function InlineCombo({ options, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [dropStyle, setDropStyle] = useState(null)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const selected = options.find((o) => o.id === value)
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  function calcDrop() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200), zIndex: 9999 })
    }
  }

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const dropdown = open && filtered.length > 0 && dropStyle ? createPortal(
    <div className="combo-list" style={dropStyle}>
      {filtered.map((opt) => (
        <div
          key={opt.id}
          className={'combo-item' + (opt.id === value ? ' sel' : '')}
          onMouseDown={() => { onChange(opt.id); setQuery(''); setOpen(false) }}
        >
          {opt.label}
        </div>
      ))}
    </div>,
    document.body
  ) : null

  return (
    <div ref={wrapRef}>
      <input
        ref={inputRef}
        value={open ? query : (selected?.label || '')}
        onChange={(e) => { setQuery(e.target.value); calcDrop(); setOpen(true) }}
        onFocus={() => { calcDrop(); setOpen(true); setQuery('') }}
        placeholder="Search…"
        autoComplete="off"
        style={{ fontSize: 12.5, padding: '7px 8px' }}
      />
      {dropdown}
    </div>
  )
}

export default function LineEditor({ lines, setLines, products, packaging }) {
  function update(i, k, v) {
    const next = lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l))
    setLines(next)
  }
  function add() {
    setLines([...lines, { productId: products[0]?.id || null, packagingId: packaging[0]?.id || null, qty: '1' }])
  }
  function remove(i) {
    setLines(lines.filter((_, idx) => idx !== i))
  }

  const productOptions = products.map((p) => ({ id: p.id, label: p.name }))
  const packagingOptions = packaging.map((k) => ({ id: k.id, label: k.name }))

  return (
    <div>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: '28%' }}>Product</th>
            <th style={{ width: '18%' }}>Hazard / UN</th>
            <th style={{ width: '22%' }}>Packaging</th>
            <th style={{ width: '9%' }}>Qty</th>
            <th style={{ width: '11%', textAlign: 'right' }}>Net kg</th>
            <th style={{ width: '11%', textAlign: 'right' }}>Gross kg</th>
            <th style={{ width: '4%' }}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const c = computeLine(l, products, packaging)
            return (
              <tr key={i}>
                <td>
                  <InlineCombo
                    options={productOptions}
                    value={l.productId || ''}
                    onChange={(v) => update(i, 'productId', v)}
                  />
                </td>
                <td><span className="pgtag">{c.hazard}</span></td>
                <td>
                  <InlineCombo
                    options={packagingOptions}
                    value={l.packagingId || ''}
                    onChange={(v) => update(i, 'packagingId', v)}
                  />
                </td>
                <td>
                  <input className="mono" style={{ textAlign: 'right' }} value={l.qty}
                    onChange={(e) => update(i, 'qty', e.target.value)} />
                </td>
                <td className="calc">{fmt(c.net)}</td>
                <td className="calc">{fmt(c.gross)}</td>
                <td><button type="button" className="btn-dl" onClick={() => remove(i)}>×</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button type="button" className="addrow" onClick={add}>+ Add product</button>
    </div>
  )
}
