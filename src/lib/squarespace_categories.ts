/**
 * Squarespace product categories — the "sub-shops" on Dad's site.
 *
 * Squarespace has TWO separate organization concepts in the admin UI:
 *
 *   - Categories: max 25 chars, drive sub-shop navigation on the
 *     storefront (e.g. /shop/leo-jaymz-guitars, /shop/category/...).
 *     Per-product, can be assigned to multiple.
 *   - Tags: max 80 chars, generic searchable labels.
 *
 * The Commerce Products API publicly documents `tags` on products but
 * doesn't document a categories field. Empirically, sending a
 * `categories: string[]` array in the product payload appears to work
 * — APIs commonly accept extra fields silently. We send both:
 *   - Each picked entry's `name` goes into `payload.categories[]`
 *   - Each picked entry's `slug` also goes into `payload.tags[]` for
 *     storefronts that filter by tag-slug (older templates do this).
 * Belt + suspenders. If SS ignores the categories field we still get
 * tag-based filtering; if it accepts it we get true SS Categories.
 *
 * The slug list is sourced from Dad's live storefront URLs (verified
 * during the style-guide research). The `name` is what we believe SS
 * stores internally — display names matching what Dad sees in admin.
 * If any of the names don't match exactly, Dad can rename in SS admin
 * once and from then on the API name will match.
 */

export interface SquarespaceCategory {
	/** URL slug — pushed as a tag for slug-based storefront filtering. */
	slug: string;
	/** Exact category display name as it appears in SS admin (≤25 chars).
	 *  This is what gets sent in payload.categories[] on push. */
	name: string;
	/** UI display label in our app's picker — may include hierarchy
	 *  glyphs (↳) and parenthetical hints; never sent to SS. */
	label: string;
	group: 'guitars' | 'parts' | 'special';
}

export const SQUARESPACE_CATEGORIES: SquarespaceCategory[] = [
	// Guitars
	{
		slug: 'southwest-acoustic-guitars',
		name: 'Southwest Acoustic Guitars',
		label: 'Southwest Acoustic Guitars',
		group: 'guitars'
	},
	{
		slug: 'sw-acoustic-semi-hollow-jazz-guitars',
		name: 'SW Acoustic Semi-Hollow',
		label: '↳ Semi-Hollow Jazz Guitars',
		group: 'guitars'
	},
	{
		slug: 'sw-acoustic-stratocasters',
		name: 'SW Acoustic Stratocasters',
		label: '↳ Stratocasters',
		group: 'guitars'
	},
	{
		slug: 'sw-acoustic-telecasters',
		name: 'SW Acoustic Telecasters',
		label: '↳ Telecasters',
		group: 'guitars'
	},
	{ slug: 'leo-jaymz-guitars', name: 'Leo Jaymz Guitars', label: 'Leo Jaymz Guitars', group: 'guitars' },
	{ slug: 'vintage-guitars', name: 'Vintage Guitars', label: 'Vintage Guitars', group: 'guitars' },

	// Parts & accessories
	{ slug: 'accessories', name: 'Parts and Accessories', label: 'Parts and Accessories', group: 'parts' },
	{ slug: 'guitar-bodies', name: 'Guitar Bodies', label: '↳ Guitar Bodies', group: 'parts' },
	{ slug: 'guitar-parts', name: 'Guitar Parts', label: '↳ Guitar Parts', group: 'parts' },
	{ slug: 'guitar-strings', name: 'Guitar Strings', label: '↳ Guitar Strings', group: 'parts' },
	{
		slug: 'wireless-transmitter-receiver',
		name: 'Wireless TX/RX',
		label: '↳ Wireless TX/RX',
		group: 'parts'
	},
	{ slug: 'wireless-earbuds', name: 'Wireless Earbuds', label: '↳ Wireless Earbuds', group: 'parts' },
	{
		slug: 'music-nomad-guitar-care',
		name: 'Music Nomad Guitar Care',
		label: '↳ Music Nomad Care',
		group: 'parts'
	},
	{ slug: 'electronic-tuner', name: 'Electronic Tuner', label: '↳ Electronic Tuner', group: 'parts' },
	{ slug: 'guitar-straps', name: 'Guitar Straps', label: '↳ Guitar Straps', group: 'parts' },

	// Cross-cutting
	{ slug: 'on-sale', name: 'Special Value Guitars', label: 'Special Value Guitars (on sale)', group: 'special' },
	{ slug: 'new', name: 'New', label: 'New', group: 'special' },
	{
		slug: 'used-and-consignment',
		name: 'Used / Consignment',
		label: 'Used / Refurbished / Consignment',
		group: 'special'
	}
];

/** Look up a category by slug. Returns undefined for unknown slugs. */
export function categoryBySlug(slug: string): SquarespaceCategory | undefined {
	return SQUARESPACE_CATEGORIES.find((c) => c.slug === slug);
}

/** Resolve an array of picked slugs to the actual SS category names. */
export function categoryNamesFromSlugs(slugs: string[]): string[] {
	return slugs
		.map((s) => categoryBySlug(s)?.name)
		.filter((name): name is string => typeof name === 'string');
}
