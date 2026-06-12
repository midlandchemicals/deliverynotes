// ADR 2023 Table A — subset covering common industrial / chemical distribution UN entries.
// Keys: UN number without space (UN1791). pgOptions: valid PG Roman numerals, empty array for gases.
// tunnelByPG keys are uppercase Roman numerals (I / II / III) or 'default' for uniform codes.
const ADR_TABLE = {
  // ── Class 2 (Gases) ──────────────────────────────────────────────────────────
  UN1005: { name: 'AMMONIA, ANHYDROUS',                              class: '2.3', subsidiary: '8',         pgOptions: [], tunnelByPG: { default: '(C/D)' } },
  UN1017: { name: 'CHLORINE',                                        class: '2.3', subsidiary: '5.1, 8',    pgOptions: [], tunnelByPG: { default: '(B/D/E)' } },
  UN1073: { name: 'OXYGEN, REFRIGERATED LIQUID',                    class: '2.2', subsidiary: '5.1',       pgOptions: [], tunnelByPG: { default: '' } },

  // ── Class 3 (Flammable liquids) ───────────────────────────────────────────────
  UN1090: { name: 'ACETONE',                                         class: '3', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(D/E)' } },
  UN1114: { name: 'BENZENE',                                         class: '3', subsidiary: '6.1',  pgOptions: ['II'],              tunnelByPG: { II: '(D/E)' } },
  UN1170: { name: 'ETHANOL SOLUTION',                               class: '3', subsidiary: '',     pgOptions: ['II', 'III'],       tunnelByPG: { II: '(D/E)', III: '(E)' } },
  UN1193: { name: 'METHYL ETHYL KETONE (BUTANONE)',                 class: '3', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(D/E)' } },
  UN1219: { name: 'ISOPROPANOL (ISOPROPYL ALCOHOL)',                class: '3', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(D/E)' } },
  UN1230: { name: 'METHANOL',                                        class: '3', subsidiary: '6.1',  pgOptions: ['II'],              tunnelByPG: { II: '(D/E)' } },
  UN1263: { name: 'PAINT',                                           class: '3', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(D/E)', II: '(D/E)', III: '(E)' } },
  UN1294: { name: 'TOLUENE',                                         class: '3', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(D/E)' } },
  UN1307: { name: 'XYLENES',                                        class: '3', subsidiary: '',     pgOptions: ['II', 'III'],       tunnelByPG: { II: '(D/E)', III: '(E)' } },
  UN1866: { name: 'RESIN SOLUTION, FLAMMABLE',                      class: '3', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(D/E)', II: '(D/E)', III: '(E)' } },
  UN1993: { name: 'FLAMMABLE LIQUID, N.O.S.',                       class: '3', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(D/E)', II: '(D/E)', III: '(E)' } },
  UN2924: { name: 'FLAMMABLE LIQUID, CORROSIVE, N.O.S.',            class: '3', subsidiary: '8',    pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(D/E)', II: '(D/E)', III: '(E)' } },

  // ── Class 5.1 (Oxidising substances) ─────────────────────────────────────────
  UN1748: { name: 'CALCIUM HYPOCHLORITE MIXTURE, DRY',              class: '5.1', subsidiary: '8',        pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN2014: { name: 'HYDROGEN PEROXIDE, AQUEOUS SOLUTION (>8% ≤60%)', class: '5.1', subsidiary: '8',        pgOptions: ['II', 'III'],       tunnelByPG: { II: '(E)', III: '(E)' } },
  UN2015: { name: 'HYDROGEN PEROXIDE, STABILISED (>60%)',           class: '5.1', subsidiary: '5.2, 8',   pgOptions: ['I'],               tunnelByPG: { I: '(D/E)' } },

  // ── Class 6.1 (Toxic substances) ─────────────────────────────────────────────
  UN2810: { name: 'TOXIC LIQUID, ORGANIC, N.O.S.',                  class: '6.1', subsidiary: '',         pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(C/D/E)', II: '(D/E)', III: '(E)' } },

  // ── Class 8 (Corrosive substances) ───────────────────────────────────────────
  UN1719: { name: 'CAUSTIC ALKALI LIQUID, N.O.S.',                  class: '8', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },
  UN1728: { name: 'AMYLTRICHLOROSILANE',                            class: '8', subsidiary: '3',    pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN1730: { name: 'ANTIMONY PENTACHLORIDE, LIQUID',                 class: '8', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN1740: { name: 'HYDROFLUORIDES, SOLID, N.O.S.',                  class: '8', subsidiary: '6.1',  pgOptions: ['II', 'III'],       tunnelByPG: { II: '(E)', III: '(E)' } },
  UN1744: { name: 'BROMINE SOLUTION',                               class: '8', subsidiary: '6.1',  pgOptions: ['I'],               tunnelByPG: { I: '(B/D/E)' } },
  UN1760: { name: 'CORROSIVE LIQUID, N.O.S.',                        class: '8', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },
  UN1764: { name: 'DICHLOROACETIC ACID',                            class: '8', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN1779: { name: 'FORMIC ACID (>85%)',                              class: '8', subsidiary: '3',    pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN1780: { name: 'FUMARYL CHLORIDE',                               class: '8', subsidiary: '6.1',  pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN1789: { name: 'HYDROCHLORIC ACID SOLUTION',                     class: '8', subsidiary: '',     pgOptions: ['II', 'III'],       tunnelByPG: { II: '(E)', III: '(E)' } },
  UN1790: { name: 'HYDROFLUORIC ACID (>85%)',                       class: '8', subsidiary: '6.1',  pgOptions: ['I'],               tunnelByPG: { I: '(B/D/E)' } },
  UN1791: { name: 'HYPOCHLORITE SOLUTION',                          class: '8', subsidiary: '',     pgOptions: ['II', 'III'],       tunnelByPG: { II: '(E)', III: '(E)' } },
  UN1805: { name: 'PHOSPHORIC ACID SOLUTION',                       class: '8', subsidiary: '',     pgOptions: ['III'],             tunnelByPG: { III: '(E)' } },
  UN1823: { name: 'SODIUM HYDROXIDE, SOLID',                        class: '8', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN1824: { name: 'SODIUM HYDROXIDE SOLUTION',                      class: '8', subsidiary: '',     pgOptions: ['II', 'III'],       tunnelByPG: { II: '(E)', III: '(E)' } },
  UN1830: { name: 'SULPHURIC ACID (>51%)',                          class: '8', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN1831: { name: 'SULPHURIC ACID, FUMING (OLEUM)',                 class: '8', subsidiary: '6.1',  pgOptions: ['I'],               tunnelByPG: { I: '(B/D/E)' } },
  UN1832: { name: 'SULPHURIC ACID, SPENT',                          class: '8', subsidiary: '',     pgOptions: ['II'],              tunnelByPG: { II: '(E)' } },
  UN1906: { name: 'SLUDGE, ACID',                                   class: '8', subsidiary: '',     pgOptions: ['II', 'III'],       tunnelByPG: { II: '(E)', III: '(E)' } },
  UN1908: { name: 'CHLORITE SOLUTION',                              class: '8', subsidiary: '',     pgOptions: ['II', 'III'],       tunnelByPG: { II: '(E)', III: '(E)' } },
  UN2031: { name: 'NITRIC ACID (>70%)',                             class: '8', subsidiary: '5.1, 6.1', pgOptions: ['I'],           tunnelByPG: { I: '(E)' } },
  UN2289: { name: 'ISOPHORONEDIAMINE',                              class: '8', subsidiary: '6.1',  pgOptions: ['III'],             tunnelByPG: { III: '(E)' } },
  UN2491: { name: 'ETHANOLAMINE',                                   class: '8', subsidiary: '',     pgOptions: ['III'],             tunnelByPG: { III: '(E)' } },
  UN2734: { name: 'AMINES, LIQUID, CORROSIVE, FLAMMABLE, N.O.S.',   class: '8', subsidiary: '3',    pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },
  UN2735: { name: 'AMINES, LIQUID, CORROSIVE, N.O.S.',              class: '8', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },
  UN2801: { name: 'DYE, LIQUID, CORROSIVE, N.O.S.',                 class: '8', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },
  UN2922: { name: 'CORROSIVE LIQUID, TOXIC, N.O.S.',                class: '8', subsidiary: '6.1',  pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(B/D/E)', II: '(E)', III: '(E)' } },
  UN2923: { name: 'CORROSIVE SOLID, TOXIC, N.O.S.',                 class: '8', subsidiary: '6.1',  pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(B/D/E)', II: '(E)', III: '(E)' } },
  UN3264: { name: 'CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S.',    class: '8', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },
  UN3265: { name: 'CORROSIVE LIQUID, ACIDIC, ORGANIC, N.O.S.',      class: '8', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },
  UN3266: { name: 'CORROSIVE LIQUID, BASIC, INORGANIC, N.O.S.',     class: '8', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },
  UN3267: { name: 'CORROSIVE LIQUID, BASIC, ORGANIC, N.O.S.',       class: '8', subsidiary: '',     pgOptions: ['I', 'II', 'III'], tunnelByPG: { I: '(E)', II: '(E)', III: '(E)' } },

  // ── Class 9 (Miscellaneous) ───────────────────────────────────────────────────
  UN3077: { name: 'ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S.',  class: '9', subsidiary: '', pgOptions: ['III'], tunnelByPG: { III: '' } },
  UN3082: { name: 'ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S.', class: '9', subsidiary: '', pgOptions: ['III'], tunnelByPG: { III: '' } },
}

function normalizeUN(un) {
  return String(un || '').replace(/\s+/g, '').toUpperCase()
}

export function lookupADR(un) {
  return ADR_TABLE[normalizeUN(un)] || null
}

export function adrPgOptions(un) {
  return lookupADR(un)?.pgOptions ?? null
}

// Returns tunnel restriction code for a given UN + PG combination.
export function adrTunnelForPG(un, pg) {
  const entry = lookupADR(un)
  if (!entry) return ''
  const key = String(pg || '').replace(/^PG\s*/i, '').trim().toUpperCase()
  return entry.tunnelByPG?.[key] ?? entry.tunnelByPG?.default ?? ''
}

// Returns the full set of ADR fields for a product (class, subsidiary, tunnel) using stored values
// if present, otherwise falling back to a live lookup. Returns null if not hazmat.
export function resolveADR(product) {
  const un = product?.un_number || ''
  if (!un) return null
  if (product?.adr_class) {
    return {
      class: product.adr_class,
      subsidiary: product.adr_subsidiary || '',
      tunnel: product.adr_tunnel || '',
      fromTable: false,
    }
  }
  const entry = lookupADR(un)
  if (!entry) return null
  const pg = String(product?.pg || '').replace(/^PG\s*/i, '').trim().toUpperCase()
  return {
    class: entry.class,
    subsidiary: entry.subsidiary,
    tunnel: entry.tunnelByPG?.[pg] ?? entry.tunnelByPG?.default ?? '',
    fromTable: true,
  }
}
