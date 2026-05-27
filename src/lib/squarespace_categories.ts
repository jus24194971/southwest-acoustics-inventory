/**
 * Squarespace product categories — the "sub-shops" on Dad's site.
 *
 * Squarespace's Products API doesn't expose categories as a first-class
 * field, so the sub-shop filtering at URLs like /shop/leo-jaymz-guitars
 * is powered by **tags** matching the slug. To make a product appear
 * on /shop/leo-jaymz-guitars, the product needs the tag
 * "leo-jaymz-guitars" (or however Dad's site is configured).
 *
 * This module is the source of truth for which categories exist. Used
 * by the listing edit page (multi-select picker) and by the push action
 * (merges the picked slugs into the product's tag list).
 *
 * Slugs match the URL slugs on Dad's actual storefront — verified by
 * scraping https://www.southwestacousticproducts.com/shop in the
 * style-guide research earlier in this project.
 */

export interface SquarespaceCategory {
	slug: string;
	label: string;
	group: 'guitars' | 'parts' | 'special';
}

export const SQUARESPACE_CATEGORIES: SquarespaceCategory[] = [
	// Guitars
	{ slug: 'southwest-acoustic-guitars', label: 'Southwest Acoustic Guitars', group: 'guitars' },
	{
		slug: 'sw-acoustic-semi-hollow-jazz-guitars',
		label: '↳ Semi-Hollow Jazz Guitars',
		group: 'guitars'
	},
	{ slug: 'sw-acoustic-stratocasters', label: '↳ Stratocasters', group: 'guitars' },
	{ slug: 'sw-acoustic-telecasters', label: '↳ Telecasters', group: 'guitars' },
	{ slug: 'leo-jaymz-guitars', label: 'Leo Jaymz Guitars', group: 'guitars' },
	{ slug: 'vintage-guitars', label: 'Vintage Guitars', group: 'guitars' },

	// Parts & accessories
	{ slug: 'accessories', label: 'Parts and Accessories', group: 'parts' },
	{ slug: 'guitar-bodies', label: '↳ Guitar Bodies', group: 'parts' },
	{ slug: 'guitar-parts', label: '↳ Guitar Parts', group: 'parts' },
	{ slug: 'guitar-strings', label: '↳ Guitar Strings', group: 'parts' },
	{ slug: 'wireless-transmitter-receiver', label: '↳ Wireless TX/RX', group: 'parts' },
	{ slug: 'wireless-earbuds', label: '↳ Wireless Earbuds', group: 'parts' },
	{ slug: 'music-nomad-guitar-care', label: '↳ Music Nomad Care', group: 'parts' },
	{ slug: 'electronic-tuner', label: '↳ Electronic Tuner', group: 'parts' },
	{ slug: 'guitar-straps', label: '↳ Guitar Straps', group: 'parts' },

	// Cross-cutting
	{ slug: 'on-sale', label: 'Special Value Guitars (/shop/on-sale)', group: 'special' },
	{ slug: 'new', label: 'New', group: 'special' },
	{ slug: 'used-and-consignment', label: 'Used / Refurbished / Consignment', group: 'special' }
];

/** Look up a category by slug. Returns undefined for unknown slugs. */
export function categoryBySlug(slug: string): SquarespaceCategory | undefined {
	return SQUARESPACE_CATEGORIES.find((c) => c.slug === slug);
}
