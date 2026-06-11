// Pure calculation helpers shared across the app.

export function num(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

export function fmt(n) {
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function prettyDate(d) {
  if (!d) return ''
  const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d)
  return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Resolve a single order/dispatch line against the catalogs and compute weights.
// line = { productId, packagingId, qty }
export function computeLine(line, products, packaging) {
  const p = products.find((x) => x.id === line.productId)
  const k = packaging.find((x) => x.id === line.packagingId)
  const qty = num(line.qty)
  const vol = k ? num(k.volume) : 0
  const sg = p ? num(p.sg) : 0
  const tare = k ? num(k.tare) : 0
  const net = vol * sg * qty
  const gross = net + tare * qty
  const un = p?.un_number || ''
  const pg = p?.pg || ''
  const hazard = un ? `${un} · ${pg}` : (pg || '—')
  return {
    product: p, packaging: k, qty, vol, sg, tare, net, gross,
    totalVol: vol * qty,
    productName: p ? p.name : '',
    pg,
    un_number: un,
    hazard,
    packDesc: k ? `${qty} × ${k.name}` : `${qty} ×`,
  }
}

export function docTotals(lines, products, packaging) {
  let packages = 0, volume = 0, net = 0, gross = 0
  lines.forEach((l) => {
    const c = computeLine(l, products, packaging)
    packages += c.qty; volume += c.totalVol; net += c.net; gross += c.gross
  })
  return { packages, volume, net, gross }
}

// "DN-0007" -> "DN-0008"; "DN-1004" -> "DN-1005"
export function nextNo(s) {
  const r = String(s || '').replace(/(\d+)(?!.*\d)/, (m) => String(+m + 1).padStart(m.length, '0'))
  return r || s
}
