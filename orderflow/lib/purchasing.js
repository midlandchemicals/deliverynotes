// Name matching for the Purchasing page.
//
// The monthly sheets are typed by hand, so the same thing appears under several
// spellings — "GRADE A METHYLENE CHLORIDE (1000 LTRS)" / "1000 LITRE" / "1000
// LTR", "HAMMOND CHEMICALS" / "HAMMONDS CHEMICALS". Left alone, each spelling
// becomes its own product with its own price history, which defeats the point.
//
// Two mechanisms:
//   normProduct()  collapses the differences that are certainly noise
//                  (punctuation, LTR/LITRE/L, spacing) so those group silently.
//   suggestMerges() finds the ones that are probably but not certainly the same
//                   and offers them, because guessing wrong would merge two real
//                   products.

export const UP = (s) => String(s || '').trim().toUpperCase()

// Punctuation → space, units spelled one way, runs of space collapsed.
export function normProduct(s) {
  let t = UP(s).replace(/[()[\]{}.,;:_/\\+*"'’-]+/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/\b(?:LTRS|LTR|LITRES|LITRE|LITERS|LITER|LTS|LT|L)\b/g, 'L')
  t = t.replace(/\b(?:KGS|KILOS|KILO|KILOGRAMS|KILOGRAMMES|KG)\b/g, 'KG')
  t = t.replace(/\b(?:IBCS|IBC)\b/g, 'IBC')
  t = t.replace(/\b(?:DRUMS|DRUM)\b/g, 'DRUM')
  // "1000L" and "1000 L" are the same thing
  t = t.replace(/(\d)\s*(L|KG)\b/g, '$1 $2')
  return t.replace(/\s+/g, ' ').trim()
}

export function normSupplier(s) {
  return UP(s).replace(/[()[\]{}.,;:_/\\&-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// Levenshtein, iterative with a single row — these are short strings.
export function lev(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[b.length]
}

const sim = (a, b) => (a === b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length))

// How well a typed query matches a name. Every word of the query has to appear
// somewhere in the name — as a prefix, inside a word, or close enough to be a
// typo — so "methylne chloride" still finds METHYLENE CHLORIDE, while an
// unrelated word rules the row out entirely. Returns 0 for no match.
export function fuzzyScore(query, text) {
  const q = normProduct(query), t = normProduct(text)
  if (!q) return 1
  if (t.includes(q)) return 1
  const words = t.split(' ')
  let total = 0
  for (const token of q.split(' ')) {
    let best = 0
    for (const w of words) {
      if (w.startsWith(token)) { best = 1; break }
      if (w.includes(token)) { best = Math.max(best, 0.92); continue }
      // only worth comparing words of a similar length
      if (Math.abs(w.length - token.length) <= 3) best = Math.max(best, sim(token, w))
    }
    if (best < 0.7) return 0        // that word isn't in this name at all
    total += best
  }
  return total / q.split(' ').length
}

// Group rows by their normalised name. The label shown is whichever spelling
// appears most often, so the tidiest common form wins by default.
export function groupBy(rows, field, norm) {
  const map = new Map()
  for (const r of rows) {
    const k = norm(r[field])
    if (!k) continue
    if (!map.has(k)) map.set(k, { key: k, rows: [], spellings: new Map() })
    const g = map.get(k)
    g.rows.push(r)
    const raw = String(r[field] || '').trim()
    g.spellings.set(raw, (g.spellings.get(raw) || 0) + 1)
  }
  for (const g of map.values()) {
    g.variants = [...g.spellings.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }))
    g.name = g.variants[0].name
  }
  return [...map.values()]
}

// Pairs that are probably the same but can't be merged silently: one name
// contained in the other ("NUTREL" / "NUTREL PRODUCTS"), or a near-miss spelling
// ("PHILIP KING" / "PHILLIP KING"). Returned worst-first so the most obvious
// duplicates are dealt with first.
// Words that distinguish one product from another rather than describing the
// same one — a front label is not a back label.
const DISCRIMINATORS = ['FRONT', 'BACK', 'BOX', 'SIDE', 'TOP', 'LID', 'NECK', 'CAP', 'BUNG']

const numbersIn = (s) => (s.match(/\d+(?:\.\d+)?/g) || []).sort().join(',')
const marksIn = (s) => DISCRIMINATORS.filter((w) => new RegExp(`\\b${w}\\b`).test(s)).join(',')

// Two names can only be the same thing if they carry the same numbers and the
// same distinguishing words. Without this, "CLEAR CONTAINERS 5LTR" and "CLEAR
// CONTAINERS 25LTR" look like a spelling slip — they are 95% identical as text
// and completely different as products.
function couldBeSameThing(a, b) {
  return numbersIn(a) === numbersIn(b) && marksIn(a) === marksIn(b)
}

export function suggestMerges(names, norm, { minSim = 0.86 } = {}) {
  const keys = names.map((n) => ({ raw: n, k: norm(n) })).filter((x) => x.k)
  const out = []
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j]
      if (a.k === b.k) continue                       // already grouped
      if (!couldBeSameThing(a.k, b.k)) continue       // different size or part
      let why = null, score = 0
      const [short, long] = a.k.length <= b.k.length ? [a.k, b.k] : [b.k, a.k]
      if (long.startsWith(short + ' ')) {
        // a longer name that simply adds words — only convincing when what's
        // shared is substantial, so "ACID GEL 4%" doesn't swallow "ACID GEL 8%"
        why = 'one name is the other plus more words'
        score = short.length / long.length
        if (short.length < 5) { why = null }
      } else {
        const s = sim(a.k, b.k)
        if (s >= minSim) { why = 'spelled almost the same'; score = s }
      }
      if (why) out.push({ a: a.raw, b: b.raw, why, score })
    }
  }
  return out.sort((x, y) => y.score - x.score)
}
