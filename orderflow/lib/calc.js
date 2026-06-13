// Pure calculation helpers shared across the app.
import { lookupADR } from './adr'

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

// Pull contact details (name / email / phone) OUT of an address block.
// Returns { address, contact: { name, email, phone } } — address has the
// contact lines stripped so the Invoice To box stays clean.
export function splitContact(text) {
  const contact = { name: '', email: '', phone: '' }
  const keep = []
  String(text || '').split('\n').forEach((raw) => {
    let line = raw

    // email — anywhere in the line
    const em = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
    if (em) {
      if (!contact.email) contact.email = em[0]
      // Remove the email and any preceding label like "Email:", "E-mail:", etc.
      line = line.replace(/(?:e[-.]?mail|email)[:.\s]*/i, '').replace(em[0], '')
    }

    // phone — "Tel: …" style, or a line that is purely a number
    let ph = line.match(/(?:tel|telephone|phone|mobile|mob|fax)[:.]?\s*([+()\d][\d\s()/-]{5,}\d)/i)
    if (!ph) ph = line.match(/(?:^|\s)([+(]?\d[\d\s()/-]{7,}\d)(?=\s|$)/)
    if (ph) {
      if (!contact.phone) contact.phone = ph[1].trim()
      line = line.replace(ph[0], '')
    }

    // contact name — "Attn:", "FAO", "Contact:" lines
    const at = line.match(/^\s*(?:attn|fao|contact)[:.]?\s*(.+)$/i)
    if (at) {
      if (!contact.name) contact.name = at[1].trim()
      line = ''
    }

    // keep the line only if something meaningful is left after stripping
    const residue = line.replace(/[\s·.,;|/-]+/g, '')
    if (residue.length > 1) keep.push(line.replace(/\s*[·|,;]\s*$/, '').replace(/^\s*[·|,;]\s*/, '').trim())
  })
  return { address: keep.join('\n'), contact }
}

// Build the full ADR hazard notation string.
// Uses stored adr_class if available, otherwise falls back to a live lookup.
function buildHazard(un, pg, product) {
  if (!un) return pg || '—'
  let adrClass = product?.adr_class || ''
  let adrSub = product?.adr_subsidiary || ''
  let adrTun = product?.adr_tunnel || ''
  if (!adrClass) {
    const entry = lookupADR(un)
    if (entry) {
      adrClass = entry.class
      adrSub = entry.subsidiary
      const pgKey = pg.replace(/^PG\s*/i, '').trim().toUpperCase()
      adrTun = entry.tunnelByPG?.[pgKey] ?? entry.tunnelByPG?.default ?? ''
    }
  }
  if (adrClass) {
    const pgNorm = pg.replace(/^PG\s*/i, '').trim()
    // Tunnel field may contain the transport category too (Table A col 15 reads
    // e.g. "3 (D/E)") — print only the bracketed tunnel code
    const tunClean = (String(adrTun).match(/\([A-E][A-E/]*\)/i) || [String(adrTun).trim()])[0]
    const subStr = adrSub ? ` (${adrSub})` : ''
    const pgStr = pgNorm ? `, PG ${pgNorm}` : ''
    const tunStr = tunClean ? `, ${tunClean}` : ''
    return `${un}, Class ${adrClass}${subStr}${pgStr}${tunStr}`
  }
  return `${un} · ${pg}`
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
  const hazard = buildHazard(un, pg, p)
  const pgNorm = pg.replace(/^PG\s*/i, '').trim()
  // Short form for the line-items table — UN number and packing group only
  const hazardShort = un ? `${un}${pgNorm ? ` PG ${pgNorm}` : ''}` : (pg || '—')
  return {
    product: p, packaging: k, qty, vol, sg, tare, net, gross,
    totalVol: vol * qty,
    productName: p ? p.name : '',
    pg,
    un_number: un,
    hazard,
    hazardShort,
    psn: p?.adr_psn || '',
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
