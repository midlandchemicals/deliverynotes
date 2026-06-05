'use client'
import { computeLine, fmt } from '@/lib/calc'

// A controlled editor for an array of { productId, packagingId, qty } lines.
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

  return (
    <div>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: '26%' }}>Product</th>
            <th style={{ width: '16%' }}>Pkg class</th>
            <th style={{ width: '24%' }}>Packaging</th>
            <th style={{ width: '9%' }}>Qty</th>
            <th style={{ width: '12%', textAlign: 'right' }}>Net kg</th>
            <th style={{ width: '12%', textAlign: 'right' }}>Gross kg</th>
            <th style={{ width: '4%' }}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const c = computeLine(l, products, packaging)
            return (
              <tr key={i}>
                <td>
                  <select value={l.productId || ''} onChange={(e) => update(i, 'productId', e.target.value)}>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td><span className="pgtag">{c.pg}</span></td>
                <td>
                  <select value={l.packagingId || ''} onChange={(e) => update(i, 'packagingId', e.target.value)}>
                    {packaging.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
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
      <button type="button" className="addrow" onClick={add}>+ Add line</button>
    </div>
  )
}
