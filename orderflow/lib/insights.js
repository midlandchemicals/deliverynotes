// Grouping for the Insights page.
//
// Product names on delivery notes are typed by hand and drift: "CITURAL" and
// "CITURAL DEGREASER" are the same thing sold under a slightly longer name, and
// reporting them as two products makes the top-sellers list wrong. Names are
// merged automatically, shown with an indicator, and can be split apart again.

import { normProduct } from '@/lib/purchasing'

const DISCRIMINATORS = ['FRONT', 'BACK', 'BOX', 'SIDE', 'TOP', 'LID', 'NECK', 'CAP', 'BUNG']
const numbersIn = (s) => (s.match(/\d+(?:\.\d+)?/g) || []).sort().join(',')
const marksIn = (s) => DISCRIMINATORS.filter((w) => new RegExp(`\\b${w}\\b`).test(s)).join(',')

// The same guard the purchasing merge uses: two names can only be one product
// if they carry the same numbers and the same distinguishing words. Without it
// "ACID GEL 4%" would swallow "ACID GEL 8%".
function couldBeSameThing(a, b) {
  return numbersIn(a) === numbersIn(b) && marksIn(a) === marksIn(b)
}

// True when `short` is `long` with more words on the end — the shape that
// "CITURAL" / "CITURAL DEGREASER" takes.
function isWordPrefix(short, long) {
  return short.length >= 4 && long.startsWith(short + ' ')
}

// names: every product name seen. splitKeys: normalised names the user has
// pulled out of their group, which then stand alone.
// Returns [{ key, label, names: [...] }], one entry per product.
export function groupProductNames(names, splitKeys = new Set(), weights = {}) {
  const uniq = [...new Set(names.filter(Boolean))]
  const byBase = new Map()
  for (const n of uniq) {
    const b = normProduct(n)
    if (!b) continue
    if (!byBase.has(b)) byBase.set(b, [])
    byBase.get(b).push(n)
  }

  // Shortest first, so a root name is always established before the longer
  // variants that should join it.
  const bases = [...byBase.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b))
  const clusters = []
  for (const base of bases) {
    if (splitKeys.has(base)) { clusters.push({ key: base, bases: [base] }); continue }
    const host = clusters.find((c) => !splitKeys.has(c.key)
      && c.bases.some((hb) => isWordPrefix(hb, base) && couldBeSameThing(hb, base)))
    if (host) host.bases.push(base)
    else clusters.push({ key: base, bases: [base] })
  }

  return clusters.map((c) => {
    const namesIn = c.bases.flatMap((b) => byBase.get(b))
    // Label with whichever spelling carries the most value; shortest breaks a tie.
    const label = [...namesIn].sort((a, b) =>
      (weights[b] || 0) - (weights[a] || 0) || a.length - b.length || a.localeCompare(b))[0]
    return { key: c.key, label, names: namesIn }
  })
}

// name -> group key, for totting up sales against the merged product.
export function productKeyMap(groups) {
  const m = new Map()
  for (const g of groups) for (const n of g.names) m.set(n, g.key)
  return m
}
