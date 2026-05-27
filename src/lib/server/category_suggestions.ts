/**
 * Squarespace category suggestion engine.
 *
 * Goal: as Dad uses the system, manual sub-shop picking becomes
 * obsolete. Suggestions fold three layers into a single ranked list
 * per item:
 *
 *   1. Rule-based: hard-coded mappings from internal category code
 *      (PU, BD, LJ, SA, ...) to SS sub-shop slug(s). Gives sensible
 *      defaults from the first listing of a new category type, before
 *      any learning has happened.
 *
 *   2. Title/model heuristics: scan the title + model code for known
 *      sub-shop keywords (Stratocaster, Telecaster, semi-hollow,
 *      blemished, etc.). Used to refine SA / BD builds into the right
 *      sub-sub-shop.
 *
 *   3. Learned patterns: every save/push of a listing inserts a row
 *      into listing_category_pattern keyed on (internal category,
 *      condition, ss slug). The suggestion engine reads these counts
 *      and boosts the score for slugs Dad's actually picked before.
 *      Over time this dominates the rule-based layer and matches his
 *      real workflow.
 *
 * Returned suggestions are sorted by score descending. The UI uses
 * the top scoring slugs to pre-check the categories multi-select on
 * fresh listings, and shows a small ✨ marker so it's transparent
 * what was suggested vs. manually picked.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface SuggestionInput {
	cat_code: string;
	brand_code: string | null;
	model: string | null;
	condition: string;
	tracking_mode: string;
	stock_qty: number;
	title: string;
}

export interface CategorySuggestion {
	slug: string;
	score: number;
	reasons: string[];
}

// Rule-based base mappings — internal category code → SS sub-shop
// slugs that almost always apply. "accessories" is the parts-page
// catch-all; specific accessories add a second slug.
const BASE_RULES: Record<string, string[]> = {
	LJ: ['leo-jaymz-guitars'],
	SA: ['southwest-acoustic-guitars'],
	VG: ['vintage-guitars'],
	BD: ['accessories', 'guitar-bodies'],
	NK: ['accessories', 'guitar-parts'],
	PU: ['accessories', 'guitar-parts'],
	ST: ['accessories', 'guitar-strings'],
	WT: ['accessories', 'wireless-transmitter-receiver'],
	EB: ['accessories', 'wireless-earbuds'],
	MN: ['accessories', 'music-nomad-guitar-care'],
	TU: ['accessories', 'electronic-tuner'],
	GS: ['accessories', 'guitar-straps'],
	// Generic hardware groupings fall under guitar-parts
	PG: ['accessories', 'guitar-parts'],
	BR: ['accessories', 'guitar-parts'],
	KN: ['accessories', 'guitar-parts'],
	PT: ['accessories', 'guitar-parts'],
	AC: ['accessories']
};

const SCORE_RULE_BASE = 100;
const SCORE_TITLE_HEURISTIC = 80;
const SCORE_CONDITION_HEURISTIC = 60;
const SCORE_PER_LEARNED_PICK = 12;
// Auto-check threshold — slugs above this score get pre-selected
// on a fresh listing. Calibrated so a single rule-based mapping
// (100) clears it, and a couple of learned picks (24) on their own
// don't (we want learning to confirm rules, not invent slugs).
export const AUTO_CHECK_SCORE = 90;

/**
 * Compute a ranked list of SS sub-shop slug suggestions for `item`.
 * Returned in descending score order; callers usually use the top N
 * above AUTO_CHECK_SCORE for pre-checking.
 */
export async function suggestCategoriesForItem(
	db: D1Database,
	item: SuggestionInput
): Promise<CategorySuggestion[]> {
	const scores = new Map<string, { score: number; reasons: string[] }>();

	const add = (slug: string, delta: number, reason: string) => {
		const cur = scores.get(slug) ?? { score: 0, reasons: [] };
		cur.score += delta;
		cur.reasons.push(reason);
		scores.set(slug, cur);
	};

	const cat = item.cat_code.toUpperCase();
	const model = (item.model ?? '').toUpperCase();
	const title = item.title.toLowerCase();

	// ---- Layer 1: rule-based base mappings ----------------------------
	const baseSlugs = BASE_RULES[cat] ?? ['accessories'];
	for (const slug of baseSlugs) {
		add(slug, SCORE_RULE_BASE, `Internal category ${cat}`);
	}

	// ---- Layer 2: title / model heuristics ----------------------------
	// Refine SA builds and bodies into the right sub-sub-shop.
	if (cat === 'SA' || cat === 'BD') {
		if (
			/strat(ocaster)?/.test(title) ||
			/\bt-style strat\b/.test(title) ||
			model.includes('STR')
		) {
			add('sw-acoustic-stratocasters', SCORE_TITLE_HEURISTIC, 'Title/model mentions Stratocaster');
		}
		if (/tele(caster)?/.test(title) || /\bt-style\b/.test(title) || model.includes('TEL')) {
			add('sw-acoustic-telecasters', SCORE_TITLE_HEURISTIC, 'Title/model mentions Telecaster/T-Style');
		}
		if (/semi[-\s]?hollow/.test(title) || /\bjazz\b/.test(title) || model.includes('JAZ')) {
			add(
				'sw-acoustic-semi-hollow-jazz-guitars',
				SCORE_TITLE_HEURISTIC,
				'Title mentions semi-hollow or jazz'
			);
		}
	}

	// "Blemished", "demo", "open-box" in the title → likely on-sale
	if (
		/blemish(ed)?|demo|open\s?box|b-stock|refurb(ished)?|defect/i.test(item.title)
	) {
		add('on-sale', SCORE_TITLE_HEURISTIC, 'Title suggests sale/discount');
	}

	// ---- Layer 3: condition-based suggestions -------------------------
	if (item.condition === 'R') {
		add('on-sale', SCORE_CONDITION_HEURISTIC, 'Refurbished — typically on sale');
		add('used-and-consignment', SCORE_CONDITION_HEURISTIC, 'Refurbished — under consignment');
	} else if (item.condition === 'B') {
		add('on-sale', SCORE_CONDITION_HEURISTIC + 10, 'For-parts — on sale');
	} else if (item.condition === 'U') {
		add('used-and-consignment', SCORE_CONDITION_HEURISTIC, 'Used — under consignment');
	} else if (item.condition === 'N' && item.tracking_mode === 'serialized') {
		// Only suggest "new" tag for one-off serialized items; stocked
		// items aren't really "new arrivals" on the storefront.
		add('new', SCORE_CONDITION_HEURISTIC - 20, 'New serialized item — newcomer filter');
	}

	// ---- Layer 4: learned patterns from past listings -----------------
	// Pull counts for this exact (category, condition) combo. If the
	// table is empty (first run) this adds nothing — the rule-based
	// layers still produce defaults. As Dad pushes more listings, this
	// layer's contribution grows.
	try {
		const { results: learned } = await db
			.prepare(
				`SELECT squarespace_category_slug AS slug, count
				 FROM listing_category_pattern
				 WHERE item_category_code = ? AND item_condition = ?
				 ORDER BY count DESC
				 LIMIT 20`
			)
			.bind(cat, item.condition)
			.all<{ slug: string; count: number }>();

		for (const row of learned) {
			add(
				row.slug,
				row.count * SCORE_PER_LEARNED_PICK,
				`Learned — picked ${row.count}× for ${cat}/${item.condition}`
			);
		}
	} catch {
		// Table missing or query failed — fall through to rule-only.
		// Shouldn't happen post-migration but is a safe no-op fallback.
	}

	return Array.from(scores.entries())
		.map(([slug, { score, reasons }]) => ({ slug, score, reasons }))
		.sort((a, b) => b.score - a.score);
}

/**
 * Record that Dad picked `squarespaceCategorySlug` for an item with
 * the given internal category + condition. Called from save() and
 * push() — every confirmed selection feeds the learning loop.
 *
 * Idempotent in the "increments by one" sense: every save bumps the
 * count, so the more often Dad re-saves with a slug picked, the more
 * weight it gets. Acceptable since pushes are intentional actions.
 */
export async function recordCategoryUsage(
	db: D1Database,
	itemCategoryCode: string,
	itemCondition: string,
	squarespaceCategorySlug: string
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO listing_category_pattern
				(item_category_code, item_condition, squarespace_category_slug, count, last_used_at)
			 VALUES (?, ?, ?, 1, datetime('now'))
			 ON CONFLICT (item_category_code, item_condition, squarespace_category_slug) DO UPDATE SET
				count = count + 1,
				last_used_at = datetime('now')`
		)
		.bind(
			itemCategoryCode.toUpperCase(),
			itemCondition,
			squarespaceCategorySlug
		)
		.run();
}

/**
 * Rule-based free-shipping heuristic. Small accessories (strings,
 * straps, picks, tuners, etc.) typically ship free on Dad's store;
 * heavier items (bodies, necks, guitars) use weight-based shipping.
 *
 * Not learned yet — kept simple as a UI default. The user can always
 * override per listing.
 */
export function suggestFreeShipping(item: SuggestionInput): {
	suggested: boolean;
	reason: string;
} {
	const cat = item.cat_code.toUpperCase();
	const lightCategories = ['ST', 'KN', 'PT', 'PG', 'GS', 'MN', 'TU', 'EB', 'AC'];
	if (lightCategories.includes(cat)) {
		return {
			suggested: true,
			reason: `Small ${cat} items ship free per the live site's title patterns`
		};
	}
	return {
		suggested: false,
		reason: 'Heavier item — use weight-based shipping or per-listing tag rule'
	};
}
