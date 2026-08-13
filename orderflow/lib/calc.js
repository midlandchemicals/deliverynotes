// Pure calculation helpers shared across the app.
import { lookupADR } from './adr'

// Buyer price levels for three_tier_pricing customers. `col` is the DB column
// on customer_product_prices; `key` is stored on the order's price_level.
export const PRICE_LEVELS = [
  { key: 'trade', label: 'Trade', col: 'price_trade' },
  { key: 'buyer_group', label: 'Buyer group', col: 'price_buyer_group' },
  { key: 'retail', label: 'Retail', col: 'price_retail' },
]

// Is `dateStr` inside the season window [fromD, toD]? All are 'YYYY-MM-DD'
// (specific dates including year). Inclusive of both ends.
export function seasonalActive(fromD, toD, dateStr) {
  if (!fromD || !toD || !dateStr) return false
  const d = String(dateStr).slice(0, 10)
  return d >= fromD && d <= toD
}

// ---- order statuses ----------------------------------------------------
// Three stages: entered → printed to the board → delivery note printed.
// Older rows may hold legacy values until migration 011 runs — normalizeStatus
// maps them so the app treats both eras the same.
export const STATUS_NEW = 'New Order'
export const STATUS_BOARD = 'On Board'
export const STATUS_DONE = 'Delivery Note Printed'
export const ORDER_STATUSES = [STATUS_NEW, STATUS_BOARD, STATUS_DONE]
export function normalizeStatus(s) {
  if (s === 'Delivery Note Generated' || s === 'Delivery Note Created' || s === STATUS_DONE) return STATUS_DONE
  if (s === STATUS_BOARD) return STATUS_BOARD
  return STATUS_NEW // 'New', 'New Order', 'In progress', anything else
}

// ---- delivery instructions ------------------------------------------------
// Customers bury driver instructions inside the delivery address ("PLEASE CALL
// 1HR BEFORE", "24HRS NOTICE REQUIRED", …), usually after the postcode. Pull
// those lines out so they can be shown prominently instead of being missed.
const INSTRUCTION_RE = /\b(call|ring|phone|tel|contact|notice|advance|prior|booking|book in|appointment|before deliver|before del|hrs? before|hours? before|hr notice|deliver between|am only|pm only|fork ?lift|tail ?lift)\b/i
export function extractDeliveryInstructions(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const address = [], instructions = []
  lines.forEach((line, i) => {
    // Never treat the first line (the name) as an instruction
    if (i > 0 && INSTRUCTION_RE.test(line)) instructions.push(line)
    else address.push(line)
  })
  return { address: address.join('\n'), instructions }
}

export function num(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

// ---- unified address book -------------------------------------------------
// One address list per customer. Each entry: { label, text, contact:{name,
// email,phone}, verified, verified_at, verified_by }. On the order the same
// address can be used for invoicing and/or delivery.
const normAddrKey = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()

// Ensure an address entry has a usable contact: if its structured contact is
// empty, pull name/email/phone out of the address text (many were typed as
// "Contact: … Tel: … Email: …" lines rather than into the fields).
function withContact(e) {
  const c = e?.contact || {}
  if (c.name || c.email || c.phone) return { ...e, contact: { name: c.name || '', email: c.email || '', phone: c.phone || '' } }
  const derived = splitContact(e?.text || '').contact
  return { ...e, contact: { name: derived.name || '', email: derived.email || '', phone: derived.phone || '' } }
}

export function unifiedAddresses(c) {
  if (Array.isArray(c?.addresses) && c.addresses.length) return c.addresses.map(withContact)
  // Lazily merge the legacy invoice + delivery lists (and legacy single fields),
  // de-duplicated by address text, so old data flows into the one list.
  const out = []
  const seen = new Map()
  const blankContact = () => ({ name: '', email: '', phone: '' })
  const add = (e0) => {
    if (!e0 || !String(e0.text || '').trim()) return
    const e = withContact(e0) // fill contact from address text if the fields were empty
    const key = normAddrKey(e.text)
    const ct = { name: e.contact?.name || '', email: e.contact?.email || '', phone: e.contact?.phone || '' }
    if (seen.has(key)) {
      const ex = out[seen.get(key)]
      const exEmpty = !(ex.contact.name || ex.contact.email || ex.contact.phone)
      if (exEmpty && (ct.name || ct.email || ct.phone)) ex.contact = ct
      if (!ex.label && e.label) ex.label = e.label
      if (e.verified && !ex.verified) { ex.verified = true; ex.verified_at = e.verified_at || null; ex.verified_by = e.verified_by || '' }
      if (e.invoice_default) ex.invoice_default = true
      return
    }
    seen.set(key, out.length)
    out.push({ label: e.label || '', text: e.text, contact: ct, verified: !!e.verified, verified_at: e.verified_at || null, verified_by: e.verified_by || '', invoice_default: !!e.invoice_default })
  }
  ;(Array.isArray(c?.invoice_addresses) ? c.invoice_addresses : []).forEach(add)
  ;(Array.isArray(c?.delivery_addresses) ? c.delivery_addresses : []).forEach(add)
  if (!out.length) {
    if (c?.details) add({ text: c.details, contact: blankContact() })
    if (c?.deliver) add({ text: c.deliver, contact: { name: c?.contact_name || '', email: c?.email || '', phone: c?.phone || '' } })
  }
  return out
}

export function fmt(n) {
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function prettyDate(d) {
  if (!d) return ''
  const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d)
  return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// UK numeric date for printed documents: dd/mm/yyyy
export function ukDate(d) {
  if (!d) return ''
  const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d)
  if (isNaN(dt)) return d
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
}

// Single VAT rate used across the app and PDFs.
export const VAT_RATE = 0.20
export const VAT_LABEL = `VAT (${Math.round(VAT_RATE * 100)}%)`

// ---- shared price resolution ------------------------------------------------
// One implementation of "which £/litre applies to this line", used by the order
// page, the financial dashboard and the office-copy PDF so they can never drift.
// Priority: seasonal window > quantity-break tier > base price.

// Normalise a qty_tiers jsonb value into sorted, valid bands.
// Each band carries its own basis, so one product can price on its own
// quantity AND on the combined order quantity at the same time — "1–5 of this
// → £1.32, but 12+ across the order → £1.18". Bands saved before that was
// possible have no basis of their own and fall back to the row's.
export function parseTiers(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((t) => ({
      from: Number(t.from) || 0,
      to: t.to == null || t.to === '' ? null : Number(t.to),
      ppl: Number(t.ppl) || 0,
      basis: t.basis === 'order' || t.basis === 'line' ? t.basis : null,
    }))
    .filter((t) => t.ppl > 0)
    .sort((a, b) => a.from - b.from)
}

// Does this price row take part in the combined whole-order count? True when
// the row itself is set that way, or any single band is.
export function usesCombinedQty(tiers = [], basis = 'line') {
  return basis === 'order' || (tiers || []).some((t) => t.basis === 'order')
}

// base: base/list £/L · tiers: parsed bands · basis: 'line' | 'order'
// season: {from,to,ppl} | null · orderDate: 'YYYY-MM-DD'
// lineQty: packs on this line · combinedQty: total packs of 'order'-basis lines
export function resolveLinePpl({ base = 0, tiers = [], basis = 'line', season = null, orderDate = null, lineQty = 0, combinedQty = 0 }) {
  if (season && seasonalActive(season.from, season.to, orderDate)) return Number(season.ppl) || 0
  const lineN = parseFloat(lineQty) || 0
  const orderN = parseFloat(combinedQty) || 0
  // A band is measured against whichever quantity it names — its own, or the
  // row's setting when it doesn't name one.
  const matches = tiers.filter((t) => {
    const q = (t.basis || basis) === 'order' ? orderN : lineN
    return q >= t.from && (t.to == null || q <= t.to)
  })
  if (!matches.length) return parseFloat(base) || 0
  // Where a product band and a combined-order band both apply, the customer
  // gets the better of the two — the cheaper price they have qualified for.
  return matches.reduce((best, t) => (t.ppl < best ? t.ppl : best), matches[0].ppl)
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

// Compact container size from a packaging name, e.g. "25 L Container" -> "25L".
export function packSize(name) {
  const m = String(name || '').match(/(\d+(?:\.\d+)?)\s*(ml|cl|l|kg|g)\b/i)
  if (!m) return ''
  const unit = /^l$/i.test(m[2]) ? 'L' : m[2].toLowerCase()
  return `${m[1]}${unit}`
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
    // Compact quantity label for its own table column, e.g. "25x25L"
    packQty: k ? `${qty}x${packSize(k.name) || (vol ? fmt(vol) + 'L' : '')}` : `${qty}`,
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

// Number of labels required for a line item.
// Products must have a name ending with '*' to qualify.
// 5L containers:  1 label/bottle + 1 box label per 4 bottles
// ≤500L drums:    1 label per container
// >500L IBCs:     2 labels per IBC
export function labelCount(line, products, packaging) {
  const p = products.find((x) => x.id === line.productId)
  if (!p || !String(p.name).trim().endsWith('*')) return 0
  const k = packaging.find((x) => x.id === line.packagingId)
  if (!k) return 0
  const vol = num(k.volume)
  const qty = num(line.qty)
  if (vol <= 5)   return qty + Math.floor(qty / 4)
  if (vol <= 500) return qty
  return qty * 2
}

// "DN-0007" -> "DN-0008"; "DN-1004" -> "DN-1005"
// A calendar date as YYYY-MM-DD, read from the LOCAL calendar.
//
// toISOString() converts to UTC first, so through British Summer Time it
// reports the previous day for anything at or near midnight — a spreadsheet
// date of 17 June arrives as 16 June, and "today" is yesterday until 1am.
// Always use this for a date the user thinks of as a day rather than an instant.
export function dateISO(d = new Date()) {
  if (!(d instanceof Date) || isNaN(d)) return String(d || '').slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const todayISO = () => dateISO(new Date())

export function nextNo(s) {
  const r = String(s || '').replace(/(\d+)(?!.*\d)/, (m) => String(+m + 1).padStart(m.length, '0'))
  return r || s
}
