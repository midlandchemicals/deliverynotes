'use client'
import { useState, useRef, useEffect } from 'react'

// options: [{ id, label }]
// value: currently selected id
// onSelect: (id) => void
export default function Combobox({ options, value, onSelect, placeholder }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const selected = options.find((o) => o.id === value)

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleFocus() {
    setOpen(true)
    setQuery('')
  }

  function handleChange(e) {
    setQuery(e.target.value)
    setOpen(true)
  }

  function handleSelect(opt) {
    onSelect(opt.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={open ? query : (selected?.label || '')}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder={placeholder || 'Type to search…'}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="combo-list">
          {filtered.map((opt) => (
            <div
              key={opt.id}
              className={'combo-item' + (opt.id === value ? ' sel' : '')}
              onMouseDown={() => handleSelect(opt)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
