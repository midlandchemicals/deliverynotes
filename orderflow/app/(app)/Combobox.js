'use client'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

// options: [{ id, label }]
// value: currently selected id
// onSelect: (id) => void
export default function Combobox({ options, value, onSelect, placeholder }) {
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
      setDropStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, width: r.width, zIndex: 9999 })
    }
  }

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false); setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleFocus() { calcDrop(); setOpen(true); setQuery('') }
  function handleChange(e) { setQuery(e.target.value); calcDrop(); setOpen(true) }
  function handleSelect(opt) { onSelect(opt.id); setQuery(''); setOpen(false) }

  const dropdown = open && filtered.length > 0 && dropStyle ? createPortal(
    <div className="combo-list" style={dropStyle}>
      {filtered.map((opt) => (
        <div
          key={opt.id}
          className={'combo-item' + (opt.id === value ? ' sel' : '')}
          onMouseDown={() => handleSelect(opt)}
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
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder={placeholder || 'Type to search…'}
        autoComplete="new-password"
      />
      {dropdown}
    </div>
  )
}
