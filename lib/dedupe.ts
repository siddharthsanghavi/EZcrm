/**
 * Deciding whether two rows are the same company.
 *
 * `/api/import` used to skip a row only on an exact case-insensitive name
 * match, so "Pennine Print Works", "Pennine Print Works, Inc." and "Pennine
 * Print Works Inc" all imported as three companies. Two members importing
 * overlapping lists forked the directory quietly, and nobody noticed until the
 * going-cold list showed the same factory three times.
 *
 * Done in JavaScript rather than with pg_trgm: no extension dependency, and —
 * more importantly — it keeps the decision in front of a human. A near match is
 * offered for review, never merged automatically, because "Halcyon Health" and
 * "Halcyon Health Labs" may well be two real companies.
 */

const SUFFIXES = [
  'inc', 'incorporated', 'llc', 'l l c', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'plc', 'gmbh', 'sa', 'nv', 'bv', 'group', 'holdings',
];

/** Lowercase, punctuation stripped, legal suffixes removed, spaces collapsed. */
export function normaliseCompanyName(name: string): string {
  let out = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  // Suffixes only count at the end, and more than one can stack ("Foo Co Ltd").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (out.endsWith(` ${suffix}`)) {
        out = out.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }

  return out.replace(/\s+/g, ' ');
}

/** "https://www.pennine.co.uk/about" → "pennine.co.uk". Null when unusable. */
export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  const cleaned = website.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const host = cleaned.split(/[/?#]/)[0].toLowerCase();
  return host.includes('.') ? host : null;
}

export type Candidate = { id: string; name: string; website?: string | null };

export type DuplicateMatch = {
  /** Why we think so, in words the importer can judge. */
  reason: 'same name' | 'same name once tidied' | 'same website';
  existing: Candidate;
};

/**
 * The first existing company that looks like this one, or null.
 *
 * Ordered by how confident each test is, because the reason is shown to a human
 * who has to decide: "same website" is nearly always right, "same name once
 * tidied" usually is, and anything vaguer is deliberately not attempted.
 */
export function findDuplicate(
  candidate: { name: string; website?: string | null },
  existing: Candidate[],
): DuplicateMatch | null {
  const name = candidate.name.trim().toLowerCase();
  const tidied = normaliseCompanyName(candidate.name);
  const domain = domainOf(candidate.website);

  for (const row of existing) {
    if (row.name.trim().toLowerCase() === name) {
      return { reason: 'same name', existing: row };
    }
  }

  if (domain) {
    for (const row of existing) {
      if (domainOf(row.website) === domain) {
        return { reason: 'same website', existing: row };
      }
    }
  }

  if (tidied) {
    for (const row of existing) {
      if (normaliseCompanyName(row.name) === tidied) {
        return { reason: 'same name once tidied', existing: row };
      }
    }
  }

  return null;
}
