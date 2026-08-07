// Shared shaping for the admin monthly reports.
//
// Both reports are built from dispatch_notes rather than orders: a note is what
// actually went out, and it carries a priced snapshot of every line taken at
// dispatch. Re-pricing today's price list against last month's deliveries would
// silently restate history, which is exactly what a commission statement must
// never do.

export const monthKey = (d) => String(d || '').slice(0, 7)          // 'YYYY-MM'
export const monthLabel = (k) => {
  const [y, m] = String(k || '').split('-')
  if (!y || !m) return k || ''
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// Letterheads whose sales belong on the Ilex report. Matched loosely because
// the letterhead is named by hand — "A P FARM SOLUTIONS LIMITED", "AP Farms".
const SALES_LETTERHEADS = [
  { key: 'ilex', test: (s) => s.includes('ILEX') },
  { key: 'apfarm', test: (s) => /A\s?P\s?FARM/.test(s) },
  { key: 'fielder', test: (s) => s.includes('FIELDER') },
]

// The letterhead a note was printed on. Reports pull the name and company out
// of the snapshot as their own columns (lh_name / lh_company) so the query
// never drags the embedded logo across — older notes hold a whole base64 image
// in there, which is what made loading every note grind to a halt.
export function letterheadName(note) {
  const lh = note?.letterhead_snapshot || {}
  return String(note?.lh_company || note?.lh_name || lh.company || lh.name || '').trim()
}

export function salesLetterheadOf(note) {
  const s = `${note?.lh_name || ''} ${note?.lh_company || ''} ${note?.letterhead_snapshot?.name || ''} ${note?.letterhead_snapshot?.company || ''}`.toUpperCase()
  return SALES_LETTERHEADS.find((x) => x.test(s))?.key || null
}
export const isSalesLetterhead = (note) => salesLetterheadOf(note) !== null

// Every distinct letterhead present in a set of notes, with counts — so the
// report can show what it actually found instead of silently matching nothing.
export function letterheadsPresent(notes) {
  const map = new Map()
  for (const n of notes) {
    const name = letterheadName(n) || '(no letterhead)'
    if (!map.has(name)) map.set(name, { name, count: 0, auto: isSalesLetterhead(n) })
    map.get(name).count++
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

// Quantity and pack size aren't stored as numbers on older notes, but packDesc
// is written as "25 × 25 L Container", so both can be read back from it.
export function lineQty(line) {
  if (Number(line?.qty) > 0) return Number(line.qty)
  const fromDesc = parseInt(String(line?.packDesc || ''), 10)
  if (fromDesc > 0) return fromDesc
  // last resort: the line total divided by the price of one pack
  const unit = Number(line?.unit_price) || 0
  return unit > 0 ? Math.round((Number(line?.line_total) || 0) / unit) : 0
}

export function packName(line) {
  if (line?.packaging) return line.packaging
  const m = String(line?.packDesc || '').split('×')
  return m.length > 1 ? m.slice(1).join('×').trim() : ''
}

// vol on a line is the TOTAL volume for that line, so one pack is vol ÷ qty.
export function unitVolume(line) {
  const q = lineQty(line)
  const total = Number(line?.vol) || 0
  return q > 0 ? total / q : total
}

// One row per product line, which is what both reports print.
export function noteLines(note) {
  return (note.lines_snapshot || []).map((l) => ({
    date: note.doc_date,
    docNo: note.doc_no,
    poRef: note.totals?.po_ref || '',
    customer: customerNameOf(note),
    deliverTo: compactOneLine(note.deliver),
    product: l.productName || '',
    pack: packName(l),
    unitVol: unitVolume(l),
    totalVol: Number(l.vol) || 0,
    qty: lineQty(l),
    net: Number(l.line_total) || 0,
  }))
}

// The invoice block's first meaningful line is the company name.
export function customerNameOf(note) {
  const first = String(note?.customer || '').split('\n').map((s) => s.trim()).filter(Boolean)[0]
  return first || ''
}

export function compactOneLine(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean).join(', ')
}

// Net goods value of a note — the sum of its priced lines. Delivery and label
// charges are deliberately excluded: they are recharged costs, not sales.
export function noteNet(note) {
  return (note.lines_snapshot || []).reduce((a, l) => a + (Number(l.line_total) || 0), 0)
}

// Group notes into months, newest month first, each with its notes newest first.
export function byMonth(notes) {
  const map = new Map()
  for (const n of notes) {
    const k = monthKey(n.doc_date)
    if (!k) continue
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(n)
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      label: monthLabel(key),
      notes: list.sort((a, b) => (a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : String(b.doc_no).localeCompare(String(a.doc_no)))),
      net: list.reduce((a, n) => a + noteNet(n), 0),
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1))
}
