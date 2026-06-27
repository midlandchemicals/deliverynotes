'use client'
import { useEffect, useState } from 'react'

const THEMES = [
  ['midnight', '🌙', 'Dark'],
  ['ivory', '☀️', 'Light'],
]

export default function ThemeToggle() {
  const [theme, setTheme] = useState(null)

  // Read the theme the no-flash script already applied to <html>.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme') || 'ivory'
    setTheme(current)
  }, [])

  function pick(t) {
    setTheme(t)
    document.documentElement.setAttribute('data-theme', t)
    try { localStorage.setItem('of_theme', t) } catch (e) {}
  }

  if (theme === null) return <div className="theme-tog" aria-hidden style={{ visibility: 'hidden' }} />

  return (
    <div className="theme-tog" role="group" aria-label="Theme">
      {THEMES.map(([id, icon, label]) => (
        <button
          key={id}
          className={theme === id ? 'on' : ''}
          onClick={() => pick(id)}
          title={`${label} theme`}
        >
          <span aria-hidden>{icon}</span>{label}
        </button>
      ))}
    </div>
  )
}
