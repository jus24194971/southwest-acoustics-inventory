/**
 * Squarespace style guide for southwestacousticproducts.com.
 *
 * Single source of truth used in two places:
 *   1. The AI description suggester (system prompt) so Claude
 *      generates copy that matches Dad's existing listings.
 *   2. The /help page so Dad can read the same conventions in
 *      plain English.
 *
 * Conventions derived from a structural read of the live shop —
 * see the WebFetch transcript in chat history. If Dad changes the
 * site's patterns, update this file and both places track it.
 *
 * This module is intentionally *not* server-only — the Help page
 * imports it directly. Nothing here is secret.
 */

export type CollectionStyle =
	| 'leo_jaymz'      // Consignment Leo Jaymz brand guitars
	| 'sw_build'       // Southwest Acoustics house builds
	| 'vintage'        // Vintage / second-hand guitars
	| 'parts_body'     // Guitar bodies (strats, teles, etc.)
	| 'parts_neck'     // Necks
	| 'parts_hardware' // Pickguards, knobs, bridges, etc.
	| 'pickups'        // Pickup sets, wire harnesses
	| 'strings'        // Guitar strings (D'Addario, Ernie Ball, etc.)
	| 'accessory'      // Tuners, straps, humidifiers, cleaning, etc.
	| 'default';       // Fallback — generic-but-tasteful

/**
 * Resolve our internal category code to a Squarespace collection
 * style. Keeps the mapping in one spot so adding a new category
 * doesn't mean editing the prompt.
 *
 * Codes are 2-letter prefixes (PU, BD, ST, etc.) — see seed.sql.
 */
export function resolveCollectionStyle(categoryCode: string): CollectionStyle {
	const c = categoryCode.toUpperCase();
	// Brand-driven collections take precedence over part-type ones —
	// a Leo Jaymz guitar is in LJ, not in "guitars".
	if (c === 'LJ') return 'leo_jaymz';
	if (c === 'SA') return 'sw_build';
	if (c === 'VG') return 'vintage';

	// Part-type collections.
	if (c === 'BD') return 'parts_body';
	if (c === 'NK') return 'parts_neck';
	if (c === 'PU') return 'pickups';
	if (c === 'ST') return 'strings';
	if (c === 'PG' || c === 'BR' || c === 'KN' || c === 'TU' || c === 'PT') return 'parts_hardware';
	if (c === 'AC' || c === 'WT' || c === 'EB' || c === 'GS' || c === 'MN' || c === 'HU') return 'accessory';

	return 'default';
}

/**
 * Per-collection style cards. The AI prompt picks the matching card
 * and inlines it; the Help page renders all of them as a reference.
 */
export interface StyleCard {
	style: CollectionStyle;
	displayName: string;
	collectionUrlSlug: string | null;
	titlePattern: string;
	titleExamples: string[];
	descriptionShape: 'narrative' | 'structured';
	descriptionGuide: string;
	// Optional ending — many parts/string listings end in
	// "Free Shipping" or similar inside the description.
	closer?: string;
}

export const STYLE_CARDS: Record<CollectionStyle, StyleCard> = {
	leo_jaymz: {
		style: 'leo_jaymz',
		displayName: 'Leo Jaymz Guitars',
		collectionUrlSlug: '/shop/leo-jaymz-guitars',
		titlePattern: 'Leo Jaymz [Model]/[Color]/Free Shipping/Set Up/[Tagline]',
		titleExamples: [
			'Leo Jaymz Monsoon/Ocean Blue/Free Shipping/Set Up/An Exceptional Instrument',
			'Leo Jaymz- Gloss White Double Cut Guitar/ Free Shipping/Fully set up/ Outstanding Value',
			'Leo Jaymz Classic Single Cut, Dark Sunburst, Free Shipping /Professional Setup'
		],
		descriptionShape: 'structured',
		descriptionGuide: [
			'Open with a one-paragraph hook that says what makes THIS specific guitar interesting.',
			'Three bold section headers, each followed by a short paragraph. Use em-dashes in headers.',
			'  - "Sound That Speaks Up" (tone / pickups / playability)',
			'  - "Designed to Play — and Be Seen" (looks / finish / hardware)',
			'  - "Built to Go the Distance" (build quality, materials, setup work)',
			'Then a bulleted "Tech Specs" section with bold labels — Body & Neck, Fretboard, Pickups, Controls, Finish.',
			'Close with one sentence that names the guitar in bold and makes the value case.'
		].join('\n'),
		closer: 'Free shipping. Set up before it leaves the shop.'
	},
	sw_build: {
		style: 'sw_build',
		displayName: 'Southwest Acoustic Guitars (house builds)',
		collectionUrlSlug: '/shop/southwest-acoustic-guitars',
		titlePattern:
			'[Weight/Style] [Color] [Body Type]/[Hardware] – [Pickups] – Southwest Acoustics™',
		titleExamples: [
			'Lightweight Butterscotch T-Style Electric Guitar/Chrome Hardware – Alnico Pickups – Southwest Acoustics™',
			'Telecaster Gold Standard Guitar – Southwest Acoustics™'
		],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Flowing paragraphs, no headers. Bold key specs (weight, finish name, pickup type) sparingly.',
			'Open with a punchy line that names the guitar\'s defining quality (e.g. "This one earns the name Lightweight Heavyweight").',
			'Mention the exact weight if known, and what it means for playability.',
			'Describe the finish and hardware as you would to a customer at the bench.',
			'Close by positioning it for a specific kind of player ("a working player\'s guitar").',
			'Always finish with "Southwest Acoustics™" somewhere in the title — the brand mark matters.'
		].join('\n'),
		closer: 'Set up and ready to ship.'
	},
	vintage: {
		style: 'vintage',
		displayName: 'Vintage Guitars',
		collectionUrlSlug: '/shop/vintage-guitars',
		titlePattern: '[Year] [Brand] [Model] [Condition Note] – Southwest Acoustics',
		titleExamples: [],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Narrative paragraphs. Lead with provenance — what is it, when was it made, how do we know.',
			'Be honest about wear and originality. Specifics over fluff: "frets show light wear, no fret-board divots".',
			'Mention what work the shop did to make it gig-ready (fret level, electronics check, etc.).',
			'Avoid hype — vintage buyers read carefully and notice puffery.'
		].join('\n')
	},
	parts_body: {
		style: 'parts_body',
		displayName: 'Guitar Bodies',
		collectionUrlSlug: '/shop/accessories',
		titlePattern:
			'[Body Style], Brand New/[Color]/[Tagline] – Great for Builders and DIY\'ers/Free Fast Shipping',
		titleExamples: [
			'Stratocaster Style Body-Gloss Black-Great for Builders and DIY\'ers/Free Fast Shipping',
			'Telecaster Style Body, Brand New/Olympic White',
			'Telecaster Style Body, Brand New/Medium Blue-Very Cool!'
		],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Short and concrete. 2-4 short paragraphs max.',
			'Lead with what it IS — strat-style body, alder, X color, gloss finish.',
			'Mention compatibility — fits standard Fender necks, standard pickguard mounting, etc.',
			'Address builders directly: "perfect starting point for a custom build" — that\'s who buys these.',
			'End with the shipping line.'
		].join('\n'),
		closer: 'Free fast shipping.'
	},
	parts_neck: {
		style: 'parts_neck',
		displayName: 'Guitar Necks',
		collectionUrlSlug: '/shop/accessories',
		titlePattern:
			'[Brand] Style [Body] Neck - [Frets], [Fretboard Wood], [Nut Width], [Pocket], Free Shipping',
		titleExamples: [
			'Fender Style Telecaster Neck - 22 Frets, Maple, 41mm Nut, 56mm Pocket, Free Shipping',
			'22 Fret Fender Style Stratocaster Neck - Rosewood, 41mm Nut, 56mm Pocket, Free Shipping'
		],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Spec-forward. State frets, scale length, nut width, pocket dimensions, fretboard wood.',
			'Builders need to know if it bolts up — say it explicitly: "fits standard Fender-spec pockets".',
			'Mention fret finish (polished, dressed, etc.) if known.',
			'Closing line about free shipping.'
		].join('\n'),
		closer: 'Free shipping.'
	},
	parts_hardware: {
		style: 'parts_hardware',
		displayName: 'Hardware (pickguards, bridges, knobs, tuners)',
		collectionUrlSlug: '/shop/accessories',
		titlePattern: '[What it is] – [Compatibility / variants] [Tagline]',
		titleExamples: [
			'Gold Locking Guitar Strap Holders – Schaller-Style Strap Lock Button Set of 2',
			'Speed Knobs for your Electric Guitar/Black Transparent/Upgrade the look on your guitar/Set of Four',
			'Tremolo Bridge Repalcement Kit for your Stratocaster/ with all parts and Tremolo Bar'
		],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Short. 1-3 paragraphs.',
			'Lead with what it is and what it fits ("for Strat-style guitars", "Schaller-compatible").',
			'Mention what\'s in the package (count, included hardware, screws, etc.).',
			'Mention finish/material/quality if relevant.'
		].join('\n')
	},
	pickups: {
		style: 'pickups',
		displayName: 'Pickups & Wire Harnesses',
		collectionUrlSlug: '/shop/accessories',
		titlePattern: '[Type] [Configuration] Set [for what guitar] / [Feature highlights]',
		titleExamples: [
			'Premium Humbucker Set for LP, SG, and Tele Deluxe Style Guitars/Split Coil Capability/Free Shipping',
			'Double Humbucker Solderless Wire Harness and Humbucker Pickups/Simple/Perfect Upgrade',
			'Southwest Acoustic Bliss: Pre-Wired HSH Pickguard Upgrade /Black'
		],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Lead with tone — bright, warm, vintage, modern. Buyers shop pickups by tone first.',
			'Then technical specs: DC resistance, magnet type (alnico II/III/V, ceramic), pole layout.',
			'Then compatibility: "drops into a standard Strat route", "solderless install".',
			'Mention any pre-wired / drop-in advantage (these are easier installs).'
		].join('\n')
	},
	strings: {
		style: 'strings',
		displayName: 'Guitar Strings',
		collectionUrlSlug: '/shop/accessories',
		titlePattern:
			'[Brand] [Model #] [Series Name] [Gauge] Gauge [Acoustic/Electric] Guitar Strings - [Quantity]/Free Shipping',
		titleExamples: [
			'Ernie Ball 2221 Regular Slinky 10-46 Gauge Electric Guitar Strings- 3 Sets/Free Shipping',
			'D\'Addario EJ16 Phosphor Bronze Acoustic Guitar Strings 12/53',
			'Elixir Nanoweb Electric Guitar Strings 10-46- 3 Sets'
		],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Very short — 2-3 sentences plus the value statement.',
			'Lead with brand + model + gauge and what it\'s for.',
			'Mention coating (Nanoweb, Polyweb, uncoated, phosphor bronze, nickel-plated) if applicable.',
			'Lead with the quantity-per-pack value — Dad\'s string listings often emphasize "3 sets" or "2 sets" as the deal.',
			'Close with free shipping.'
		].join('\n'),
		closer: 'Free shipping.'
	},
	accessory: {
		style: 'accessory',
		displayName: 'Accessories (tuners, straps, humidifiers, wireless, etc.)',
		collectionUrlSlug: '/shop/accessories',
		titlePattern: '[What it is] - [Key feature] / [Optional value statement]',
		titleExamples: [
			'Wireless Transmitter and Receiver for your guitar-No Cord!- New',
			'Guitar String Cleaner- A must for every guitar player',
			'Acoustic Guitar Sound Hole Humidifier/A Must Have for all Acoustic Guitar/3 Colors/Free Shipping!'
		],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Short. 1-2 paragraphs. Lead with the problem it solves.',
			'For tuners — clip-on or pedal, accuracy, battery life if known.',
			'For straps — material, length range, padding, pick-holder if any.',
			'For wireless — range, battery, channels.',
			'Close with shipping if it\'s "free fast".'
		].join('\n')
	},
	default: {
		style: 'default',
		displayName: 'Generic (no specific category match)',
		collectionUrlSlug: null,
		titlePattern: '[What it is] - [Key feature] / Free Shipping',
		titleExamples: [],
		descriptionShape: 'narrative',
		descriptionGuide: [
			'Flowing paragraphs, 100-200 words.',
			'Lead with what it is and who it\'s for.',
			'Be specific about included specs/attributes.',
			'Close with a one-line value statement.'
		].join('\n')
	}
};

/**
 * Voice rules — apply to every collection. Lifted from the original
 * AI suggester prompt and consolidated here so the Help page can
 * show them.
 */
export const VOICE_RULES: string[] = [
	'Friendly, expert, plainspoken — like a luthier talking to a customer at the bench.',
	'Be specific. Cite the actual attributes you were given; do not invent specs.',
	'Avoid hype words: "Elevate", "Unleash", "Take your tone to the next level", "Whether you\'re...".',
	'Avoid exclamation points except where Dad uses them on the live site (occasional "Free Fast Shipping!" is fine).',
	'Use em-dashes (–) and slashes (/) as separators in titles, matching the existing site.',
	'Don\'t repeat the title verbatim in the first sentence.',
	'Brand the house builds with the "Southwest Acoustics™" mark in titles where it appears today.'
];

/**
 * Brand-wide standard points Dad wants every AI-generated description to
 * make — scoped to the product class they truthfully apply to, so a string
 * pack never claims it was "set up and intonated". The AI weaves these into
 * the prose (it does NOT print them as a verbatim block).
 *
 * Edit the wording here and every generated description tracks it.
 */
export const STANDARD_POINTS = {
	guitarSetup: 'Every guitar is set up, intonated, and optimized before it leaves the shop.',
	houseBuilt: 'Southwest Acoustics guitars are hand-assembled in Tucson, Arizona.',
	partInspected:
		'Every part is hand-inspected for quality and correct function before it ships.',
	reputation:
		'Since 2019, Southwest Acoustics has earned a stellar reputation across eBay, Reverb, and Etsy — invite the buyer to research the shop before buying.'
};

/**
 * Which standard points apply to a given category, by product class:
 *   - reputation    → every listing
 *   - guitarSetup   → complete guitars (Leo Jaymz, house builds, vintage)
 *   - houseBuilt    → Southwest Acoustics house builds only
 *   - partInspected → everything that isn't a complete guitar (bodies,
 *     necks, pickups, hardware, strings, accessories)
 */
export function standardPointsFor(categoryCode: string): string[] {
	const style = resolveCollectionStyle(categoryCode);
	const isGuitar = style === 'leo_jaymz' || style === 'sw_build' || style === 'vintage';
	const points: string[] = [];
	if (isGuitar) {
		points.push(STANDARD_POINTS.guitarSetup);
		if (style === 'sw_build') points.push(STANDARD_POINTS.houseBuilt);
	} else {
		points.push(STANDARD_POINTS.partInspected);
	}
	points.push(STANDARD_POINTS.reputation);
	return points;
}

/**
 * Build a one-shot style hint block for the AI prompt. Inlines the
 * matching card + the universal voice rules + the standard points that
 * apply to this product. Returned as a single string ready to drop
 * into the user message.
 */
export function buildStyleHint(categoryCode: string): string {
	const style = resolveCollectionStyle(categoryCode);
	const card = STYLE_CARDS[style];

	const lines: string[] = [
		`## Site collection: ${card.displayName}`,
		card.collectionUrlSlug ? `URL slug: ${card.collectionUrlSlug}` : '',
		'',
		`Title pattern (match the shape, not the words):`,
		`  ${card.titlePattern}`,
		''
	];
	if (card.titleExamples.length > 0) {
		lines.push('Real titles already on the site:');
		for (const ex of card.titleExamples) lines.push(`  - "${ex}"`);
		lines.push('');
	}
	lines.push(
		`Description shape: ${card.descriptionShape === 'structured' ? 'STRUCTURED (bold headers + bulleted tech specs)' : 'NARRATIVE (flowing paragraphs, no headers)'}`,
		'',
		'Description guide:',
		card.descriptionGuide
	);
	if (card.closer) {
		lines.push('', `Common closer for this collection: "${card.closer}"`);
	}

	const points = standardPointsFor(categoryCode);
	if (points.length > 0) {
		lines.push(
			'Standard points to weave in naturally (work EACH into the prose — usually the opening or closing — NOT as a verbatim bullet list or a separate block):'
		);
		for (const p of points) lines.push(`  - ${p}`);
	}

	return lines.filter((l) => l !== '').join('\n');
}
