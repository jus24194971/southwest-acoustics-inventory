/**
 * eBay item-aspect auto-mapper.
 *
 * eBay's Inventory API rejects a publish when a category's REQUIRED
 * aspects (their term for structured "item specifics" — Brand, Body
 * Type, Body Color, String Configuration, etc.) are missing. For
 * SELECTION_ONLY aspects it also rejects free-text values that aren't
 * in eBay's allowed-value list.
 *
 * We already hold rich structured data per item:
 *   - brand_name, model
 *   - 5 attribute slots, each a (label, context_key, friendly value)
 *     triple — e.g. ("Body Finish", "body_finish", "Sunburst").
 *
 * This module maps that data onto eBay's per-category aspect list so
 * Dad doesn't re-type what we already know. It's intentionally PURE
 * (no network, no DB) so it's trivially testable and reusable — the
 * network fetch of the aspect list lives in ebay.ts, the DB read of
 * the item lives in the route.
 *
 * Matching is three-layered, best-first:
 *   1. Direct field rules   — "Brand" → brand, "Model" → model, etc.
 *   2. Attribute fuzzy match — token overlap (with synonyms) between
 *                              the aspect name and our slot labels.
 *   3. Nothing             — left blank for manual entry.
 *
 * For SELECTION_ONLY aspects we additionally coerce the mapped value
 * to one of eBay's allowed values (exact → case-insensitive → token
 * overlap). If no allowed value matches, we keep the raw value but
 * flag `valueInAllowedList = false` so the UI renders a picker rather
 * than silently pushing a value eBay will reject.
 */

/** One eBay aspect, normalized from the Taxonomy API response. */
export interface EbayAspectMeta {
	name: string;
	required: boolean;
	/** REQUIRED | RECOMMENDED | OPTIONAL */
	usage: string;
	/** FREE_TEXT lets us send any string; SELECTION_ONLY must match an allowed value. */
	mode: 'FREE_TEXT' | 'SELECTION_ONLY';
	cardinality: 'SINGLE' | 'MULTI';
	dataType: string;
	/** Allowed values when mode === SELECTION_ONLY (empty for FREE_TEXT). */
	allowedValues: string[];
}

/** One resolved attribute from an item's 5 slots. */
export interface ResolvedAttribute {
	label: string; // "Body Finish"
	contextKey: string | null; // "body_finish"
	value: string; // "Sunburst" (friendly, resolved from code)
}

/** The slice of item data the mapper needs. */
export interface ItemForAspectMapping {
	brand: string | null;
	model: string | null;
	title: string;
	attributes: ResolvedAttribute[];
}

export type AspectSource =
	| 'brand'
	| 'model'
	| 'mpn'
	| 'attribute'
	| 'none';

/** The mapping result for one aspect. */
export interface AspectMapping {
	aspect: EbayAspectMeta;
	/** Best-guess value (already coerced to an allowed value where possible). */
	suggestedValue: string | null;
	source: AspectSource;
	/** Which of our attribute labels fed this, if source === 'attribute'. */
	matchedAttributeLabel?: string;
	/**
	 * For SELECTION_ONLY aspects: true when suggestedValue is in
	 * allowedValues (safe to push), false when we have a value but it
	 * isn't a legal eBay option (UI must surface a picker). Always true
	 * for FREE_TEXT aspects (any string is legal) and when there's no
	 * suggestion.
	 */
	valueInAllowedList: boolean;
}

// ---------------------------------------------------------------------
// Normalization + tokenization
// ---------------------------------------------------------------------

function norm(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function tokenize(s: string): string[] {
	return norm(s).split(' ').filter(Boolean);
}

/**
 * Synonym groups. Each token expands to a canonical SET so "color",
 * "colour", and "finish" all collide in scoring. Tuned for guitar/
 * music-gear vocabulary. Tokens not in the map expand to just
 * themselves.
 */
const SYNONYM_GROUPS: string[][] = [
	['color', 'colour', 'finish'],
	['material', 'wood', 'tonewood', 'timber'],
	['type', 'style', 'configuration', 'config'],
	['fretboard', 'fingerboard', 'board'],
	['pickup', 'pickups', 'pickup configuration'],
	['string', 'strings'],
	['hand', 'handed', 'handedness', 'orientation'],
	['model', 'series'],
	['brand', 'make', 'manufacturer'],
	['size', 'scale']
];

/** token → set of equivalent tokens (including itself). */
const SYNONYM_INDEX: Map<string, Set<string>> = (() => {
	const idx = new Map<string, Set<string>>();
	for (const group of SYNONYM_GROUPS) {
		const set = new Set(group.flatMap((g) => tokenize(g)));
		for (const t of set) {
			const existing = idx.get(t);
			if (existing) {
				for (const s of set) existing.add(s);
			} else {
				idx.set(t, new Set(set));
			}
		}
	}
	return idx;
})();

function expand(token: string): Set<string> {
	return SYNONYM_INDEX.get(token) ?? new Set([token]);
}

/**
 * Score the overlap between an aspect name and an attribute's
 * label+context_key. Higher = stronger match. Each aspect token that
 * finds a synonym-equivalent token on the attribute side scores 1;
 * an exact full-string match gets a big bonus so "Color" beats a
 * partial "Body Color" tie, etc.
 */
function matchScore(aspectName: string, attr: ResolvedAttribute): number {
	const aspectToks = tokenize(aspectName);
	const attrToks = new Set([
		...tokenize(attr.label),
		...(attr.contextKey ? tokenize(attr.contextKey.replace(/_/g, ' ')) : [])
	]);
	// Expand attribute tokens through synonyms once.
	const attrExpanded = new Set<string>();
	for (const t of attrToks) for (const e of expand(t)) attrExpanded.add(e);

	let score = 0;
	for (const at of aspectToks) {
		const variants = expand(at);
		let hit = false;
		for (const v of variants) {
			if (attrExpanded.has(v)) {
				hit = true;
				break;
			}
		}
		if (hit) score += 1;
	}
	// Exact normalized-name equality is the strongest signal.
	if (norm(aspectName) === norm(attr.label)) score += 5;
	return score;
}

// ---------------------------------------------------------------------
// Allowed-value coercion (for SELECTION_ONLY aspects)
// ---------------------------------------------------------------------

/**
 * Try to coerce `value` to one of `allowed`. Returns the matched
 * allowed value (eBay's exact casing) or null if nothing reasonable
 * matches. Match tiers: exact (case-insensitive) → one contains the
 * other → token overlap ≥1.
 */
function coerceToAllowed(value: string, allowed: string[]): string | null {
	if (allowed.length === 0) return null;
	const nv = norm(value);
	if (!nv) return null;

	// Tier 1: exact case-insensitive.
	for (const a of allowed) {
		if (norm(a) === nv) return a;
	}
	// Tier 2: substring either direction (e.g. "Sunburst" ⊂ "Tobacco Sunburst").
	for (const a of allowed) {
		const na = norm(a);
		if (na.includes(nv) || nv.includes(na)) return a;
	}
	// Tier 3: token overlap. Pick the allowed value sharing the most tokens.
	const vToks = new Set(tokenize(value));
	let best: { a: string; n: number } | null = null;
	for (const a of allowed) {
		const aToks = tokenize(a);
		let n = 0;
		for (const t of aToks) if (vToks.has(t)) n++;
		if (n > 0 && (!best || n > best.n)) best = { a, n };
	}
	return best?.a ?? null;
}

// ---------------------------------------------------------------------
// Direct field rules
// ---------------------------------------------------------------------

/**
 * Returns a direct field value for well-known aspect names, or
 * undefined to fall through to attribute matching. Kept separate from
 * fuzzy matching because these are high-confidence and shouldn't be
 * out-competed by a stray attribute token collision.
 */
function directFieldValue(
	aspectName: string,
	item: ItemForAspectMapping
): { value: string; source: AspectSource } | undefined {
	const n = norm(aspectName);
	if ((n === 'brand' || n === 'make' || n === 'manufacturer' || n === 'brand name') && item.brand) {
		return { value: item.brand, source: 'brand' };
	}
	if ((n === 'model' || n === 'model name') && item.model) {
		return { value: item.model, source: 'model' };
	}
	// MPN: use the model as a reasonable default when present. For
	// custom/vintage gear eBay accepts "Does Not Apply", but a model
	// string is a better default than blank and Dad can clear it.
	if ((n === 'mpn' || n === 'manufacturer part number') && item.model) {
		return { value: item.model, source: 'mpn' };
	}
	return undefined;
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/** Minimum fuzzy score for an attribute to be accepted as a match. */
const MATCH_THRESHOLD = 1;

/**
 * Map an item's data onto a category's aspect list. Returns one
 * AspectMapping per aspect, ordered required-first then by eBay's
 * original order (the caller passes them in eBay's order).
 */
export function mapItemToAspects(
	aspects: EbayAspectMeta[],
	item: ItemForAspectMapping
): AspectMapping[] {
	// Track which attribute indices we've consumed so two aspects don't
	// both claim the same slot (e.g. "Color" and "Body Color" both
	// matching our single "Body Finish" slot — first/strongest wins).
	const usedAttrIdx = new Set<number>();

	// Pre-rank: process required aspects first so they get first dibs
	// on attribute slots. Stable within each group.
	const ordered = aspects
		.map((a, i) => ({ a, i }))
		.sort((x, y) => {
			if (x.a.required !== y.a.required) return x.a.required ? -1 : 1;
			return x.i - y.i;
		});

	const resultByName = new Map<string, AspectMapping>();

	for (const { a: aspect } of ordered) {
		// 1. Direct field rule.
		const direct = directFieldValue(aspect.name, item);
		if (direct) {
			resultByName.set(aspect.name, finalize(aspect, direct.value, direct.source));
			continue;
		}

		// 2. Best attribute match (not already consumed).
		let best: { idx: number; score: number } | null = null;
		for (let idx = 0; idx < item.attributes.length; idx++) {
			if (usedAttrIdx.has(idx)) continue;
			const score = matchScore(aspect.name, item.attributes[idx]);
			if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
				best = { idx, score };
			}
		}
		if (best) {
			usedAttrIdx.add(best.idx);
			const attr = item.attributes[best.idx];
			const mapping = finalize(aspect, attr.value, 'attribute');
			mapping.matchedAttributeLabel = attr.label;
			resultByName.set(aspect.name, mapping);
			continue;
		}

		// 3. No match.
		resultByName.set(aspect.name, finalize(aspect, null, 'none'));
	}

	// Return in the ORIGINAL eBay order (not the required-first order
	// we processed in) so the UI matches eBay's expected layout, but
	// the caller typically re-sorts required-first for display anyway.
	return aspects.map((a) => resultByName.get(a.name)!);
}

/**
 * Build the final AspectMapping for one aspect + candidate value,
 * applying allowed-value coercion for SELECTION_ONLY aspects.
 */
function finalize(
	aspect: EbayAspectMeta,
	value: string | null,
	source: AspectSource
): AspectMapping {
	if (value == null || value.trim() === '') {
		return { aspect, suggestedValue: null, source: 'none', valueInAllowedList: true };
	}

	if (aspect.mode === 'SELECTION_ONLY' && aspect.allowedValues.length > 0) {
		const coerced = coerceToAllowed(value, aspect.allowedValues);
		if (coerced) {
			return { aspect, suggestedValue: coerced, source, valueInAllowedList: true };
		}
		// We have a value but it's not a legal eBay option — keep it so
		// the UI can show "we think it's X, pick the closest" but mark
		// it unsafe to push as-is.
		return { aspect, suggestedValue: value, source, valueInAllowedList: false };
	}

	// FREE_TEXT — any string is legal.
	return { aspect, suggestedValue: value, source, valueInAllowedList: true };
}

/**
 * Validate a set of chosen aspect values against the aspect list.
 * Returns the names of REQUIRED aspects that are still empty — the
 * push path uses this to block with a clear message instead of
 * letting eBay 400.
 */
export function missingRequiredAspects(
	aspects: EbayAspectMeta[],
	chosen: Record<string, string[]>
): string[] {
	const missing: string[] = [];
	for (const a of aspects) {
		if (!a.required) continue;
		const vals = chosen[a.name];
		if (!vals || vals.length === 0 || vals.every((v) => v.trim() === '')) {
			missing.push(a.name);
		}
	}
	return missing;
}
