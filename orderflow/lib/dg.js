// Dangerous-goods tallies for the DGSA annual report.
//
// Worked out from the delivery notes themselves — the priced, printed snapshot
// of what actually left the building — so nobody has to keep a separate tally.
// The class is read from the hazard text that was printed on the note
// ("UN1263, Class 3, PG II, (D/E)"); if an older note didn't print one, the UN
// number is looked up in the ADR table instead.

import { lookupADR } from '@/lib/adr'
import { lineQty } from '@/lib/reports'

// The annual report asks for whole classes: 6.1 counts under Class 6, 4.1 under 4.
export const REPORT_CLASSES = ['2', '3', '4', '5', '6', '8', '9']
export const SEPARATE_CLASSES = ['1', '7']   // "generally not carried — separate sheet"

export function classOfLine(line) {
  const un = String(line?.un_number || '').trim()
  const printed = String(line?.hazard || '').match(/Class\s+(\d(?:\.\d)?)/i)
  if (printed) return printed[1]
  if (!un) return null
  const entry = lookupADR(un)
  return entry?.class ? String(entry.class) : null
}

export const majorClass = (cls) => String(cls || '').split('.')[0] || null

// Flatten notes into one row per dangerous line inside [from, to] (ISO dates).
// Lines with no UN number aren't dangerous goods and are skipped; lines with a
// UN number but no resolvable class are returned separately so they can be
// flagged rather than silently dropped.
export function dgRows(notes, from, to) {
  const rows = []
  const unclassified = []
  for (const n of notes || []) {
    const d = String(n.doc_date || '').slice(0, 10)
    if (!d || (from && d < from) || (to && d > to)) continue
    for (const l of n.lines_snapshot || []) {
      const un = String(l.un_number || '').trim()
      if (!un) continue
      const cls = classOfLine(l)
      const row = {
        date: d,
        month: d.slice(0, 7),
        docNo: n.doc_no,
        customer: n.customerName || '',
        product: l.productName || '',
        un,
        cls,
        major: majorClass(cls),
        qty: lineQty(l),
        litres: Number(l.vol) || 0,
        netKg: Number(l.net) || 0,
        grossKg: Number(l.gross) || 0,
      }
      if (!cls) unclassified.push(row)
      else rows.push(row)
    }
  }
  return { rows, unclassified }
}
