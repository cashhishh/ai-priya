/**
 * Fuzzy-match product names the seller said ("copper bottle", "cooker",
 * "chadar") to SKUs in the catalogue. Used so actions like "pause listings"
 * touch only the products the seller actually named.
 */
import { SKUS } from "@/data/seller";
import type { Sku } from "@/data/seller";

/** Hinglish / colloquial words → the word used in our product names. */
const SYNONYMS: Record<string, string> = {
  chadar: "bedsheet", chaddar: "bedsheet", bedsheets: "bedsheet", "bed sheet": "bedsheet",
  kukar: "cooker", cookar: "cooker",
  diye: "diya", diyas: "diya", deeya: "diya", deepak: "diya",
  tokri: "basket", tokra: "basket",
  chaku: "knife", chhuri: "knife", churi: "knife", knives: "knife",
  tauliya: "towel", towels: "towel",
  tiffin: "lunch", dibba: "box",
  kadhai: "kadai", karahi: "kadai",
  bottles: "bottle", botal: "bottle",
  jars: "jar", martaban: "jar",
  takiya: "cushion", "cushion cover": "cushion",
  mugs: "mug", plate: "plates", thali: "plates",
  dabba: "masala", "spice box": "masala",
  board: "chopping",
  taamba: "copper", tamba: "copper", tambe: "copper", taambe: "copper",
  peetal: "brass", pital: "brass",
};

/** Words that never identify a product on their own. */
const STOP = new Set([
  "set", "of", "with", "pack", "the", "and", "aur", "wala", "wale", "wali", "ki", "ka", "ke", "listing", "listings",
  "product", "products", "item", "items", "pause", "stock", "steel", "cotton", "kitchen", "1l", "2l", "3l", "28cm",
]);

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[()]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

function normalizePhrase(q: string): string {
  let out = ` ${q.toLowerCase()} `;
  for (const [from, to] of Object.entries(SYNONYMS)) out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  return out.trim();
}

/** Edit distance ≤ 1 (one typo / transcription slip), for words of 5+ letters. */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const stem = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

function score(query: string[], sku: Sku): number {
  const name = tokens(sku.name).map(stem);
  return query.reduce((s, q) => s + (name.some((n) => nearlyEqual(stem(q), n)) ? 1 : 0), 0);
}

export interface ProductMatch {
  query: string;
  skus: Sku[];
}

/** Split free text ("copper bottle aur brass diya, jute basket") into product phrases. */
export function splitProductPhrases(text: string): string[] {
  return text
    .split(/,|;|\band\b|\baur\b|\bplus\b|\n/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Match each phrase to the best-scoring SKU(s). Ties return all tied SKUs
 * (e.g. a bare "bottle" matches both bottles). Phrases with no match are
 * returned in `unmatched`.
 */
export function matchProducts(phrases: string[], catalogue: Sku[] = SKUS): { matches: ProductMatch[]; unmatched: string[] } {
  const matches: ProductMatch[] = [];
  const unmatched: string[] = [];
  for (const phrase of phrases) {
    const codes = catalogue.filter((s) => phrase.toUpperCase().includes(s.sku));
    if (codes.length) {
      matches.push({ query: phrase, skus: codes });
      continue;
    }
    const q = tokens(normalizePhrase(phrase));
    const scored = catalogue.map((sku) => ({ sku, s: score(q, sku) })).filter((x) => x.s > 0);
    const best = Math.max(0, ...scored.map((x) => x.s));
    if (best === 0) unmatched.push(phrase);
    else matches.push({ query: phrase, skus: scored.filter((x) => x.s === best).map((x) => x.sku) });
  }
  return { matches, unmatched };
}

/** Unique SKUs across all matches, in catalogue order. */
export function uniqueSkus(matches: ProductMatch[]): Sku[] {
  const ids = new Set(matches.flatMap((m) => m.skus.map((s) => s.sku)));
  return SKUS.filter((s) => ids.has(s.sku));
}
