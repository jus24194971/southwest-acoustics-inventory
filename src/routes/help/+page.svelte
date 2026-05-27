<script lang="ts">
	import { STYLE_CARDS, VOICE_RULES, type CollectionStyle } from '$lib/squarespace_style_guide';

	// Help content lives as data, not as a forest of templates — adding
	// a new topic is appending one object to SECTIONS. This mirrors the
	// pattern in Listing Studio's help.js.
	//
	// Content can use raw HTML (rendered via {@html}) so we can style
	// inline code, lists, callouts, etc. The strings are trusted since
	// they're authored in this file, not user input.
	interface HelpSection {
		id: string;
		icon: string;
		title: string;
		subtitle: string;
		content: string;
	}

	// Build the Squarespace style guide HTML from the shared style
	// module so this page and the AI suggester can never drift apart.
	// HTML-escape interpolated values defensively — the cards come from
	// a static module today, but if they ever pull from the DB the
	// escaping is already wired.
	function esc(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	const COLLECTION_ORDER: CollectionStyle[] = [
		'leo_jaymz',
		'sw_build',
		'vintage',
		'parts_body',
		'parts_neck',
		'parts_hardware',
		'pickups',
		'strings',
		'accessory',
		'default'
	];

	const styleGuideContent = (() => {
		const parts: string[] = [];

		parts.push(`<p>Dad's Squarespace shop at
			<a href="https://www.southwestacousticproducts.com/shop"
				target="_blank"
				class="text-[color:var(--color-gold-bright)] hover:underline"
			>southwestacousticproducts.com/shop</a>
			has a fixed set of conventions for titles and descriptions. The AI description
			suggester already knows them — use this page when you're writing copy by hand
			and want to match.</p>`);

		// Voice rules ---------------------------------------------------
		parts.push('<p><strong>Voice (applies to every listing):</strong></p>');
		parts.push('<ul>');
		for (const r of VOICE_RULES) parts.push(`<li>${esc(r)}</li>`);
		parts.push('</ul>');

		// Per-collection cards -----------------------------------------
		parts.push('<p><strong>Per-collection conventions:</strong></p>');
		for (const key of COLLECTION_ORDER) {
			const c = STYLE_CARDS[key];
			parts.push(
				`<div style="border-left: 3px solid var(--color-gold-dim); padding-left: 0.75rem; margin: 1rem 0;">`
			);
			parts.push(`<p><strong>${esc(c.displayName)}</strong>`);
			if (c.collectionUrlSlug) {
				parts.push(
					` <span class="font-mono text-xs" style="color: var(--color-ink-3)">${esc(c.collectionUrlSlug)}</span>`
				);
			}
			parts.push('</p>');

			parts.push(
				`<p style="margin-top: 0.25rem;">Title pattern:
				<span class="font-mono text-xs" style="color: var(--color-gold)">${esc(c.titlePattern)}</span></p>`
			);

			if (c.titleExamples.length > 0) {
				parts.push('<ul style="margin-top: 0.25rem;">');
				for (const ex of c.titleExamples) {
					parts.push(
						`<li><span class="font-mono text-xs" style="color: var(--color-ink-2)">${esc(ex)}</span></li>`
					);
				}
				parts.push('</ul>');
			}

			parts.push(
				`<p style="margin-top: 0.5rem;">
				<em>Description shape:</em> ${c.descriptionShape === 'structured' ? '<strong>STRUCTURED</strong> — bold headers + bulleted Tech Specs' : '<strong>NARRATIVE</strong> — flowing paragraphs, no headers'}.
			</p>`
			);

			parts.push(`<p style="margin-top: 0.25rem; white-space: pre-wrap;">${esc(c.descriptionGuide)}</p>`);

			if (c.closer) {
				parts.push(
					`<p style="margin-top: 0.25rem; font-style: italic; color: var(--color-ink-3);">Closer: "${esc(c.closer)}"</p>`
				);
			}
			parts.push('</div>');
		}

		return parts.join('\n');
	})();

	const SECTIONS: HelpSection[] = [
		{
			id: 'getting-started',
			icon: '🏁',
			title: 'Getting started',
			subtitle: 'What this app is and how to navigate it',
			content: `
				<p>This is the inventory system for Southwest Acoustics. Every part, body, neck, pickup,
				and complete guitar lives here — this is the single source of truth, and Squarespace
				mirrors what's listed here.</p>
				<p>The top navigation has five main areas:</p>
				<ul>
					<li><strong>Overview</strong> — a dashboard with current totals and quick actions.</li>
					<li><strong>Items</strong> — every part and guitar. Click any row to see its detail page.</li>
					<li><strong>Locations</strong> — the Garage Workshop and Storage Warehouse. Each has bins.</li>
					<li><strong>Categories</strong> — taxonomy (Bodies, Necks, Pickups, etc.).</li>
					<li><strong>Movements</strong> — the audit ledger of every receive / transfer / sale.</li>
				</ul>
				<p>Help and Settings live on the right side of the toolbar.</p>
			`
		},
		{
			id: 'adding-items',
			icon: '➕',
			title: 'Adding an item',
			subtitle: 'How to enter a new part or guitar',
			content: `
				<p>Go to <strong>Items → Add item</strong>. The form picks the category-specific attribute
				fields automatically based on what category you pick — for example, choosing
				<strong>Pickups</strong> reveals fields for Type, Position, Brand, Output, and Active/passive.</p>
				<p>You only need to fill in:</p>
				<ol>
					<li><strong>Title</strong> — a human description (e.g. "Seymour Duncan JB Jr, neck position")</li>
					<li><strong>Category</strong> — what kind of thing it is</li>
					<li><strong>Condition</strong> — New, Used, Refurbished, or Broken/parts</li>
					<li><strong>Model</strong> — a 3-letter code used in the SKU</li>
				</ol>
				<p>The SKU is generated for you in the format
				<span class="font-mono">CAT-BRAND-MODEL-COND-YY-SEQ-A1-A2-A3-A4-A5</span> — 40 characters,
				always the same length. See the <a href="#sku">SKU primer</a> below for what each part means.</p>
				<p>If a part is something you have many of (like screws or knobs), pick
				<strong>Stocked</strong> for tracking mode and set the on-hand count. One row covers all of them.</p>
			`
		},
		{
			id: 'sku',
			icon: '🏷️',
			title: 'SKU primer',
			subtitle: 'What every part of an SKU means',
			content: `
				<p>SKUs are 40 characters in a fixed format:</p>
				<pre class="rounded bg-[color:var(--color-input)] p-3 font-mono text-xs">CAT - BRAND - MODEL - COND - YY - SEQ  - A1  - A2  - A3  - A4  - A5
 2     3       3       1     2    4      3     3     3     3     3</pre>
				<p>For example, <span class="font-mono text-[color:var(--color-gold)]">PU-SEY-JBJ-U-26-0017-HUM-NEK-SEY-MED-PAS</span> reads as:</p>
				<ul>
					<li><strong>PU</strong> — Pickup</li>
					<li><strong>SEY</strong> — Seymour Duncan</li>
					<li><strong>JBJ</strong> — JB Jr model</li>
					<li><strong>U</strong> — Used</li>
					<li><strong>26</strong> — Received in 2026</li>
					<li><strong>0017</strong> — 17th pickup received this year</li>
					<li><strong>HUM</strong> — Humbucker type</li>
					<li><strong>NEK</strong> — Neck position</li>
					<li><strong>SEY</strong> — Seymour Duncan brand</li>
					<li><strong>MED</strong> — Medium output</li>
					<li><strong>PAS</strong> — Passive</li>
				</ul>
				<p>The attribute slots (A1–A5) mean different things depending on the category. The Add
				Item form shows you the right labels for whichever category you pick.</p>
				<p><strong>Special codes:</strong></p>
				<ul>
					<li><span class="font-mono">XXX</span> — "no value" / not meaningful for this item</li>
					<li><span class="font-mono">UNQ</span> — "one-of-a-kind" — there's a freeform description on the item</li>
				</ul>
			`
		},
		{
			id: 'locations',
			icon: '📍',
			title: 'Locations & bins',
			subtitle: 'Where things physically live',
			content: `
				<p>Two locations are seeded:</p>
				<ul>
					<li><strong>GAR — Garage Workshop</strong> — Dad's main work area</li>
					<li><strong>WHS — Storage Warehouse</strong> — overflow + bulk storage</li>
				</ul>
				<p>Inside each location, you add <strong>bins</strong> — shelves, drawers, boxes — and
				give each one a short code like <span class="font-mono">A-12</span> or
				<span class="font-mono">DRAWER-3</span>. Items live in exactly one bin at a time.</p>
				<p>From <strong>Locations → [click a location]</strong> you can:</p>
				<ul>
					<li><strong>Add a single bin</strong> with code + optional friendly name + notes</li>
					<li><strong>Bulk-add a range</strong> — type a prefix like <span class="font-mono">A-</span>
					and a range like 1-10 to make <span class="font-mono">A-1</span> through
					<span class="font-mono">A-10</span> in one click</li>
					<li><strong>Edit or retire</strong> existing bins (retiring is soft-delete — the history
					of items that used to live there stays intact)</li>
				</ul>
			`
		},
		{
			id: 'tracking',
			icon: '📦',
			title: 'Serialized vs Stocked',
			subtitle: 'Two ways to track inventory',
			content: `
				<p>Every item has a <strong>tracking mode</strong>:</p>
				<ul>
					<li><strong>Serialized</strong> — one row per physical object. Use this for guitars,
					premium pickups, custom builds — anything where each unit is unique or expensive enough
					to track individually.</li>
					<li><strong>Stocked</strong> — one row represents a count of identical items. Use this
					for knobs, screws, strings, common hardware — anything where "I have 47 of these"
					is the answer Dad needs.</li>
				</ul>
				<p>For stocked items, scanning a part out decrements the count instead of retiring an
				individual row.</p>
			`
		},
		{
			id: 'squarespace',
			icon: '🔄',
			title: 'Squarespace import',
			subtitle: 'Bootstrapping from the existing catalog',
			content: `
				<p>The first time we ran this, we pulled Dad's full Squarespace catalog into inventory.
				Every Squarespace product variant became an inventory item. Photos got downloaded into
				R2 so we own copies. The original Squarespace product ID, variant ID, and SKU all get
				stored as cross-references.</p>
				<p>To re-run the import (Dad added new products on Squarespace, or you want to refresh
				prices/descriptions), go to
				<a href="/import/squarespace" class="text-[color:var(--color-gold-bright)] hover:underline">/import/squarespace</a>
				and click <strong>Continue / refresh import</strong>. The importer is idempotent —
				existing items get their metadata refreshed, new ones get created, nothing gets duplicated.</p>
				<p>If some items are missing photos, click <strong>Backfill missing photos</strong> — it
				re-scans the catalog and fetches just the gaps.</p>
				<p>All imported items default to category <strong>MS (Misc / Consumables)</strong>. You
				need to recategorize them — go to the item's detail page, click "Change category" in
				the sidebar.</p>
			`
		},
		{
			id: 'movements',
			icon: '📊',
			title: 'Movements & stock-on-hand',
			subtitle: 'How quantities get tracked',
			content: `
				<p><strong>Stock-on-hand is never stored directly.</strong> It's derived from the
				<strong>movement</strong> ledger — every receive, transfer, sale, scrap, and build-consume
				is one row.</p>
				<p>You can see the full ledger at <a href="/movements" class="text-[color:var(--color-gold-bright)] hover:underline">/movements</a>,
				or per-item on each item's detail page.</p>
				<p>The advantage: the audit trail is impossible to disagree with the count. If you ever
				wonder "where did this 7 come from," you can scroll back through the movements.</p>
				<p>You can't edit a movement — it's append-only. To correct a mistake, log an
				<strong>adjust</strong> movement with a note explaining what changed.</p>
			`
		},
		{
			id: 'unique',
			icon: '🎨',
			title: 'One-of-a-kind items',
			subtitle: "When a 3-letter code isn't enough",
			content: `
				<p>For Leo Jaymez bodies (and any custom finish where "BLK" or "BST" doesn't capture
				it), use the special code <span class="font-mono">UNQ</span> in the body-finish slot.</p>
				<p>When you type UNQ in any attribute field, a description box appears below it.
				Describe the finish in plain words — "Psychedelic blue/purple swirl with gold leaf accent."
				That description shows on the item detail page next to the UNQ tag.</p>
				<p>The photo carries the actual visual identification; the DB description gives a searchable
				narrative.</p>
			`
		},
		{
			id: 'accessibility',
			icon: '♿',
			title: 'Font size & high contrast',
			subtitle: 'Making the app easier to read',
			content: `
				<p>From <a href="/settings" class="text-[color:var(--color-gold-bright)] hover:underline">Settings</a>,
				you can change:</p>
				<ul>
					<li><strong>Font size</strong> — Normal (100%), Large (120%), Extra large (140%).
					Scales everything proportionally.</li>
					<li><strong>High contrast mode</strong> — Brighter text and sharper colour separation
					for daylight or dust-heavy environments.</li>
				</ul>
				<p>Both settings sync across whichever devices you sign in on, since they're stored
				server-side rather than per-browser.</p>
			`
		},
		{
			id: 'squarespace-style',
			icon: '✍️',
			title: 'Squarespace style guide',
			subtitle: 'How titles and descriptions should read on the shop',
			content: styleGuideContent
		}
	];

	let activeId = $state<string>(SECTIONS[0].id);
	let activeSection = $derived(SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]);
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Reference</p>
		<h1 class="headline text-3xl">Help</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			How to use this app, what each concept means, and how to recover when something looks
			weird.
		</p>
	</header>

	<div class="grid gap-6 lg:grid-cols-[260px_1fr]">
		<!-- TOC -->
		<aside class="panel space-y-1 px-3 py-3">
			{#each SECTIONS as section (section.id)}
				<button
					type="button"
					onclick={() => (activeId = section.id)}
					class="flex w-full items-start gap-3 rounded px-3 py-2 text-left transition-colors {section.id ===
					activeId
						? 'bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
						: 'text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-hover)]'}"
				>
					<span class="text-base leading-tight">{section.icon}</span>
					<div class="min-w-0">
						<div class="text-sm font-medium leading-tight">{section.title}</div>
						<div class="mt-0.5 text-[11px] text-[color:var(--color-ink-3)] leading-tight">
							{section.subtitle}
						</div>
					</div>
				</button>
			{/each}
		</aside>

		<!-- Content -->
		<article class="panel space-y-4 px-6 py-5">
			<header class="space-y-1 border-b border-[color:var(--color-line-dim)] pb-3">
				<p class="eyebrow">{activeSection.icon} {activeSection.subtitle}</p>
				<h2 class="headline text-2xl">{activeSection.title}</h2>
			</header>
			<div
				class="prose prose-invert max-w-none space-y-3 text-sm text-[color:var(--color-ink-2)]
				       [&_a]:text-[color:var(--color-gold-bright)] [&_a]:underline
				       [&_strong]:text-[color:var(--color-ink)] [&_ul]:list-disc [&_ul]:pl-5
				       [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1
				       [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-[color:var(--color-line-dim)]
				       [&_p]:leading-relaxed"
			>
				{@html activeSection.content}
			</div>
		</article>
	</div>
</section>
