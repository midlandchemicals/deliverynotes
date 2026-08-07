'use client'
import { useState } from 'react'
import { prettyDate } from '@/lib/calc'

// One series, so no legend — the heading says what's plotted. Hairline grid,
// 2px line, 8px markers ringed in the surface colour so they stay legible where
// they overlap, and only the first, last and extreme points carry a label.
const ACCENT = '#1F6E4E'
const SURFACE = '#FFFFFF'

export default function PriceChart({ points, fmt }) {
  const [hover, setHover] = useState(null)
  if (!points || points.length < 2) return null

  const W = 680, H = 190, L = 58, R = 22, T = 22, B = 34
  const vals = points.map((p) => p.v)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo) * 0.15 || hi * 0.1 || 1
  const yMin = Math.max(0, lo - pad), yMax = hi + pad
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1)
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')

  // Label only what earns it: the ends and the extremes.
  const iMin = vals.indexOf(lo), iMax = vals.indexOf(hi)
  const labelled = new Set([0, points.length - 1, iMin, iMax])
  const ticks = [yMax, (yMax + yMin) / 2, yMin]

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }}
        role="img" aria-label="Unit price for each purchase, oldest first"
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} y1={y(t)} x2={W - R} y2={y(t)} stroke="#E8E4DA" strokeWidth="1" />
            <text x={L - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#9AA39B">{fmt(t)}</text>
          </g>
        ))}

        <path d={path} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <g key={i}>
            {/* generous invisible hit target — the visible dot is too small to aim at */}
            <rect x={x(i) - 16} y={T} width="32" height={H - T - B} fill="transparent"
              onMouseEnter={() => setHover(i)} />
            <circle cx={x(i)} cy={y(p.v)} r={hover === i ? 5.5 : 4}
              fill={ACCENT} stroke={SURFACE} strokeWidth="2" style={{ pointerEvents: 'none' }} />
            {labelled.has(i) && hover === null && (
              <text x={x(i)} y={y(p.v) - 11} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                fontSize="10.5" fontWeight="700" fill="#3D4A42" style={{ pointerEvents: 'none' }}>
                {fmt(p.v)}
              </text>
            )}
          </g>
        ))}

        {/* first and last dates only — enough to orient, no axis clutter */}
        <text x={L} y={H - 12} fontSize="10" fill="#9AA39B">{prettyDate(points[0].d)}</text>
        <text x={W - R} y={H - 12} textAnchor="end" fontSize="10" fill="#9AA39B">{prettyDate(points[points.length - 1].d)}</text>

        {hover !== null && (() => {
          const p = points[hover]
          const right = x(hover) > W / 2
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={x(hover)} y1={T} x2={x(hover)} y2={H - B} stroke="#DDD8CC" strokeWidth="1" />
              <g transform={`translate(${right ? x(hover) - 172 : x(hover) + 10}, ${Math.max(T, y(p.v) - 34)})`}>
                <rect width="162" height="46" rx="8" fill="#1D372B" opacity="0.96" />
                <text x="10" y="18" fontSize="11.5" fontWeight="700" fill="#FFFFFF">{fmt(p.v)} per unit</text>
                <text x="10" y="33" fontSize="10" fill="#9DB4A8">
                  {prettyDate(p.d)} · {String(p.supplier || '').slice(0, 22)}
                </text>
              </g>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
