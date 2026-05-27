<script lang="ts">
	import { STYLE_CARDS, VOICE_RULES, type CollectionStyle } from '$lib/squarespace_style_guide';

	// Help is written for Dad — plain English, task-first, no jargon.
	// Each section answers a question he might actually ask out loud
	// ("How do I print a label?") and walks him through it.
	//
	// Visual aids are inline HTML "mockups" — styled <div>s that look
	// like the real UI elements (buttons, panels, fields). We don't
	// embed real screenshots because they go stale fast, but the
	// mockups stay in sync with the app's design tokens since they
	// pull from the same CSS variables.
	//
	// Content can use raw HTML (rendered via {@html}) — strings are
	// authored in this file, not user input, so it's trusted.

	interface HelpSection {
		id: string;
		icon: string;
		title: string;
		subtitle: string;
		content: string;
	}

	// ---------- Mockup helpers ----------------------------------------
	// Inline-styled snippets that look like the real UI elements.
	// Centralized here so the whole help page has a consistent look.

	function btnPrimary(label: string): string {
		return `<span style="display: inline-block; background: linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dim) 100%); border: 1px solid var(--color-gold-dim); color: #1a1612; padding: 5px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);">${label}</span>`;
	}
	function btnGhost(label: string): string {
		return `<span style="display: inline-block; background: var(--color-panel-2); border: 1px solid var(--color-line); color: var(--color-ink); padding: 5px 12px; border-radius: 4px; font-size: 12px;">${label}</span>`;
	}
	function field(placeholder: string): string {
		return `<span style="display: inline-block; min-width: 200px; background: var(--color-input); border: 1px solid var(--color-line-dim); color: var(--color-ink-3); padding: 5px 10px; border-radius: 4px; font-size: 12px; font-style: italic;">${placeholder}</span>`;
	}
	function pill(label: string, kind: 'default' | 'success' | 'warn' | 'danger' = 'default'): string {
		const colors: Record<typeof kind, string> = {
			default: 'background: rgba(184, 152, 86, 0.12); border: 1px solid var(--color-gold-dim); color: var(--color-gold-bright);',
			success: 'background: rgba(108, 142, 90, 0.15); border: 1px solid var(--color-moss); color: var(--color-moss-bright);',
			warn: 'background: rgba(184, 152, 86, 0.18); border: 1px solid var(--color-gold); color: var(--color-gold-bright);',
			danger: 'background: rgba(170, 80, 60, 0.15); border: 1px solid var(--color-rust); color: var(--color-rust-bright);'
		};
		return `<span style="display: inline-block; ${colors[kind]} padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">${label}</span>`;
	}
	function eyebrow(label: string): string {
		return `<span style="font-family: var(--font-mono, monospace); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-ink-3);">${label}</span>`;
	}
	function panel(inner: string): string {
		return `<div style="border: 1px solid var(--color-line-dim); background: var(--color-panel); padding: 12px 14px; border-radius: 6px; margin: 8px 0;">${inner}</div>`;
	}
	function callout(emoji: string, text: string, tone: 'tip' | 'warn' = 'tip'): string {
		const color = tone === 'warn' ? 'var(--color-rust)' : 'var(--color-gold-dim)';
		return `<div style="border-left: 3px solid ${color}; background: var(--color-input); padding: 10px 14px; border-radius: 0 6px 6px 0; margin: 12px 0;"><span style="font-size: 18px; margin-right: 6px;">${emoji}</span><span style="color: var(--color-ink-2); font-size: 13px;">${text}</span></div>`;
	}
	function tryItLink(href: string, label: string): string {
		return `<p style="margin-top: 12px;"><a href="${href}" style="display: inline-block; color: var(--color-gold-bright); font-weight: 600; text-decoration: none; border-bottom: 1px solid var(--color-gold-dim); padding-bottom: 1px;">▶ Try it now: ${label}</a></p>`;
	}
	function steps(items: string[]): string {
		const lis = items
			.map(
				(s, i) =>
					`<li style="margin: 10px 0; padding-left: 6px;"><span style="display: inline-block; width: 22px; height: 22px; border-radius: 50%; background: var(--color-gold-dim); color: #1a1612; text-align: center; font-weight: 700; font-size: 12px; line-height: 22px; margin-right: 10px; vertical-align: top;">${i + 1}</span><span style="display: inline-block; width: calc(100% - 50px); vertical-align: top;">${s}</span></li>`
			)
			.join('');
		return `<ol style="list-style: none; padding-left: 0; margin: 12px 0;">${lis}</ol>`;
	}

	// ---------- Squarespace style guide (auto-generated) --------------
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
			<a href="https://www.southwestacousticproducts.com/shop" target="_blank" style="color: var(--color-gold-bright);">southwestacousticproducts.com/shop</a>
			has a fixed set of conventions for titles and descriptions. The AI button already knows them — use this page when you're writing copy by hand and want to match.</p>`);
		parts.push('<p><strong>Voice (applies to every listing):</strong></p><ul>');
		for (const r of VOICE_RULES) parts.push(`<li>${esc(r)}</li>`);
		parts.push('</ul><p><strong>Per-collection conventions:</strong></p>');
		for (const key of COLLECTION_ORDER) {
			const c = STYLE_CARDS[key];
			parts.push(`<div style="border-left: 3px solid var(--color-gold-dim); padding-left: 0.75rem; margin: 1rem 0;">`);
			parts.push(`<p><strong>${esc(c.displayName)}</strong>`);
			if (c.collectionUrlSlug) {
				parts.push(` <span class="font-mono text-xs" style="color: var(--color-ink-3)">${esc(c.collectionUrlSlug)}</span>`);
			}
			parts.push('</p>');
			parts.push(`<p style="margin-top: 0.25rem;">Title pattern: <span class="font-mono text-xs" style="color: var(--color-gold)">${esc(c.titlePattern)}</span></p>`);
			if (c.titleExamples.length > 0) {
				parts.push('<ul style="margin-top: 0.25rem;">');
				for (const ex of c.titleExamples) {
					parts.push(`<li><span class="font-mono text-xs" style="color: var(--color-ink-2)">${esc(ex)}</span></li>`);
				}
				parts.push('</ul>');
			}
			parts.push(`<p style="margin-top: 0.5rem;"><em>Description shape:</em> ${c.descriptionShape === 'structured' ? '<strong>STRUCTURED</strong> — bold headers + bulleted Tech Specs' : '<strong>NARRATIVE</strong> — flowing paragraphs, no headers'}.</p>`);
			parts.push(`<p style="margin-top: 0.25rem; white-space: pre-wrap;">${esc(c.descriptionGuide)}</p>`);
			if (c.closer) {
				parts.push(`<p style="margin-top: 0.25rem; font-style: italic; color: var(--color-ink-3);">Closer: "${esc(c.closer)}"</p>`);
			}
			parts.push('</div>');
		}
		return parts.join('\n');
	})();

	// ==================================================================
	// SECTIONS
	// ==================================================================
	const SECTIONS: HelpSection[] = [
		// ---------- Start here ---------------------------------------
		{
			id: 'welcome',
			icon: '👋',
			title: 'Start here',
			subtitle: "What this app is for, in plain words",
			content: `
				<p style="font-size: 15px; line-height: 1.6;">
					This is your shop's notebook. Every guitar, every body, every set of strings, every
					pickup you have — it all goes in here. When you sell something, you tell the
					notebook. When something new shows up, you add it.
				</p>
				<p style="font-size: 15px; line-height: 1.6;">
					This app is also how new listings get to your website. You enter the item here,
					and when you're ready, you push it to Squarespace with one button.
				</p>

				<p style="margin-top: 20px;"><strong>The bar at the top is how you move around.</strong>
					Here's what each button does, from left to right:</p>

				${panel(`
					<div style="font-size: 13px; line-height: 2;">
						<div><strong>Overview</strong> &mdash; the front page. Shows what you have, what sold this week.</div>
						<div><strong>Items</strong> &mdash; every single thing in the shop. You'll spend most of your time here.</div>
						<div><strong>Locations</strong> &mdash; the Garage and the Warehouse, and the bins inside them.</div>
						<div><strong>Labels</strong> &mdash; when a new box comes in, you go here to enter it and print labels.</div>
						<div><strong>Scan</strong> &mdash; for your phone. Point at a label, find the item.</div>
						<div><strong>Categories</strong> &mdash; the list of "what kinds of things we sell" (guitars, pickups, strings, etc.).</div>
						<div><strong>Movements</strong> &mdash; the history book. Every receive, sale, and move shows up here.</div>
						<div style="margin-top: 8px; color: var(--color-ink-3); font-size: 12px;">
							On the far right: <strong>Help</strong> (this page) and <strong>Settings</strong>.
						</div>
					</div>
				`)}

				${callout('💡', "If you ever get lost, click the Southwest logo on the top-left to go back to the front page.")}

				<p style="margin-top: 20px;"><strong>The two most common things you'll do:</strong></p>
				<ul>
					<li>"I got a new box of something. Where does it go?" → Read <a href="#add-stocked">Adding new parts</a>.</li>
					<li>"Something sold and the count is wrong." → Read <a href="#fix-count">Fixing a count that's wrong</a>.</li>
				</ul>
			`
		},

		// ---------- Cheat sheet --------------------------------------
		{
			id: 'cheat-sheet',
			icon: '⚡',
			title: 'Cheat sheet',
			subtitle: 'The 5 most common things, on one page',
			content: `
				<p>Quick reference — each one links to the full step-by-step further down.</p>

				${panel(`
					<p style="margin: 0;"><strong>1. New box came in — guitar, parts, anything</strong></p>
					<p style="margin: 4px 0 0 0; font-size: 13px; color: var(--color-ink-3);">
						Top bar → <strong>Labels</strong> → fill out form → click Save & print.
						See <a href="#add-guitar">Adding a guitar</a> or <a href="#add-stocked">Adding parts</a>.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>2. Find something you already have</strong></p>
					<p style="margin: 4px 0 0 0; font-size: 13px; color: var(--color-ink-3);">
						Type into the search bar at the top — it searches names, brands, descriptions.
						Or scan a label with your phone (<strong>Scan</strong> button).
						See <a href="#find">Finding something</a>.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>3. Mark something as sold (or fix the count)</strong></p>
					<p style="margin: 4px 0 0 0; font-size: 13px; color: var(--color-ink-3);">
						Find the item → its detail page → "On hand" panel on the right → Adjust.
						See <a href="#fix-count">Fixing a count</a>.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>4. Add or change photos on an item</strong></p>
					<p style="margin: 4px 0 0 0; font-size: 13px; color: var(--color-ink-3);">
						Open the item → "Manage photos" panel below the photo → pick photos to upload.
						See <a href="#photos">Adding photos</a>.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>5. Put a new listing on the website</strong></p>
					<p style="margin: 4px 0 0 0; font-size: 13px; color: var(--color-ink-3);">
						Item detail → sidebar Listings → click <strong>Squarespace</strong> → fill out → Push.
						Or use the AI button (✨ Suggest with AI) to draft the title and description.
						See <a href="#post-website">Posting to the website</a>.
					</p>
				`)}
			`
		},

		// ---------- Adding a guitar ---------------------------------
		{
			id: 'add-guitar',
			icon: '🎸',
			title: 'Adding a new guitar',
			subtitle: "When a complete guitar comes in",
			content: `
				<p><strong>The scenario:</strong> A Leo Jaymz guitar showed up. You want to enter it,
				print a label, and stick the label on the case.</p>

				${steps([
					`Up on the top bar, click <strong>Labels</strong>. This is the page for "I have something physical here, and I want to add it and print a label all at once".`,
					`The form opens. You'll see a bunch of fields. Don't worry — only some are required (they have a red asterisk).`,
					`<strong>Category</strong> — pick the right one. For a Leo Jaymz guitar, pick <strong>LJ — Leo Jaymz Guitars</strong>. For one of your own builds, pick <strong>SA — Southwest Acoustics Builds</strong>.`,
					`<strong>Title</strong> — type a friendly description. Example: <span style="font-family: monospace; color: var(--color-ink);">"Leo Jaymz Monsoon Ocean Blue Double Cut"</span>. Doesn't have to be the final website title — you can prettier it later.`,
					`<strong>Brand</strong> — pick from the dropdown if it's there, or type a 3-letter code (LEO for Leo Jaymz, SWA for Southwest, etc.).`,
					`<strong>Model</strong> — short code like <span style="font-family: monospace;">MNS</span> for Monsoon, <span style="font-family: monospace;">HUR</span> for Hurricane. Used in the printed label.`,
					`<strong>Condition</strong> — New, Used, Refurbished, or For parts. Pick what's true.`,
					`<strong>Tracking mode</strong> — for a single guitar, pick <strong>Serialized</strong>. (One row per guitar.)`,
					`<strong>Bin</strong> — where in the shop is it going? Pick from the dropdown. If you don't know yet, leave it as "unassigned" and assign it later.`,
					`Below that, the form shows extra fields based on the category you picked — things like Color, Body Style, Pickups. Fill in what you know.`,
					`<strong>Quantity</strong> = 1 for one guitar. <strong>Labels per item</strong> = 1 unless you want spare labels.`,
					`Click the gold button at the bottom: ${btnPrimary('Save and print labels')}. A new browser tab opens with the PDF label — print it on your DYMO or Primera.`
				])}

				${callout('💡', `The long code that gets generated (something like <span style="font-family: monospace;">LJ-LEO-MNS-N-26-0001</span>) is the item's permanent ID. It's on the label as a QR code so your phone can scan it.`)}

				${tryItLink('/labels', 'open the Labels page')}
			`
		},

		// ---------- Adding parts (stocked) --------------------------
		{
			id: 'add-stocked',
			icon: '📦',
			title: 'Adding new parts (strings, knobs, etc.)',
			subtitle: 'When you have many of the same thing',
			content: `
				<p><strong>The scenario:</strong> A case of 12 sets of D'Addario strings came in.
				You don't need 12 separate rows — you want one row that says "I have 12 of these".</p>

				${steps([
					`Click <strong>Labels</strong> on the top bar.`,
					`Fill in the basics like for a guitar — <strong>Category</strong> (ST for strings, AC for accessories, etc.), <strong>Title</strong> (e.g. "D'Addario EXL120 9-42 Electric Strings"), <strong>Brand</strong>, <strong>Model</strong>, <strong>Condition</strong>.`,
					`Here's the important part: <strong>Tracking mode</strong> → pick <strong>Stocked</strong>. This means "one row, with a count, instead of one row per pack".`,
					`<strong>Quantity</strong> = 12 (or however many came in).`,
					`<strong>Labels per item</strong> — if you want one label for the case, leave at 1. If you want a label for every pack, set this to 12.`,
					`Click ${btnPrimary('Save and print labels')}.`
				])}

				${callout('💡', `Later, when one set sells, you'll go to the item's page and change the on-hand count from 12 to 11. See <a href="#fix-count">Fixing a count</a>.`)}

				<p style="margin-top: 20px;"><strong>When should I use Stocked vs Serialized?</strong></p>
				<ul>
					<li><strong>Serialized</strong> — one row per physical thing. Use for guitars, expensive pickup sets, anything where each one is unique. Selling one means retiring that exact row.</li>
					<li><strong>Stocked</strong> — one row with a count. Use for strings, screws, knobs, common hardware. Selling one means decrementing the count.</li>
				</ul>

				${tryItLink('/labels', 'open the Labels page')}
			`
		},

		// ---------- Finding something -------------------------------
		{
			id: 'find',
			icon: '🔍',
			title: 'Finding something',
			subtitle: 'Three ways to look up an item',
			content: `
				<p>You've got three ways to find any item. Use whichever's closest to hand.</p>

				<p style="margin-top: 18px;"><strong>Way 1: Type into the search bar at the top.</strong></p>
				<p>The search bar is on every page, in the top toolbar — it looks like:</p>
				${panel(`<div style="display: inline-block; background: var(--color-input); border: 1px solid var(--color-line-dim); color: var(--color-ink-3); padding: 6px 12px; border-radius: 4px; font-size: 13px; font-style: italic; min-width: 280px;">Search SKU, title, brand…</div>`)}
				<p>Type the brand, the color, the model — anything you remember. Hit Enter. You'll land on the Items page with matches.</p>

				<p style="margin-top: 18px;"><strong>Way 2: Click "Items" and use the filters.</strong></p>
				<p>Top bar → <strong>Items</strong>. Under the search bar, you'll see filter dropdowns:
					Category, Condition, Location, Tracking. Pick whatever narrows it down.</p>
				<p>For example, "Show me all Leo Jaymz guitars in the Garage": pick
					<strong>Category: Leo Jaymz</strong> and <strong>Location: GAR</strong>.</p>

				<p style="margin-top: 18px;"><strong>Way 3: Scan a label with your phone.</strong></p>
				<p>If you have the item in your hand and there's a printed label on it:</p>
				${steps([
					`Open the inventory app on your phone.`,
					`Tap <strong>Scan</strong> in the top bar.`,
					`Allow camera access if it asks.`,
					`Point your phone at the QR code on the label. The page jumps straight to that item.`
				])}

				${callout('💡', `Every label has a QR code that links right to that item's page. Scan it and you're there in two seconds.`)}

				${tryItLink('/items', 'open the Items list')}
			`
		},

		// ---------- Photos -------------------------------------------
		{
			id: 'photos',
			icon: '📷',
			title: 'Adding photos to an item',
			subtitle: 'Upload, set primary, delete',
			content: `
				<p><strong>The scenario:</strong> You just took photos of a new guitar with your phone
				and want to add them to its page so they show up on the listing.</p>

				${steps([
					`Find the item — search bar, scan, or click through Items. Click its row to open the detail page.`,
					`Scroll down past the photo area. You'll see a panel titled <strong>Manage photos</strong> on the right side. It has a dashed box that says "📷 Choose photos to upload".`,
					`Click that dashed box. Your computer's file picker opens.`,
					`Pick the photos. Hold Ctrl (or Cmd on Mac) to select multiple. Click Open.`,
					`The photos upload automatically — no separate Submit button. When done, they appear in the grid above.`
				])}

				<p style="margin-top: 18px;"><strong>The "Primary" photo:</strong></p>
				<p>The first photo (top-left, with a gold "Primary" badge) is the one that shows up on
				the Items list, the dashboard, and the website. To pick a different one as primary:</p>
				${steps([
					`Click the thumbnail you want as primary — it'll get a gold border.`,
					`Below the gallery, click ${btnGhost('★ Make primary')}.`
				])}

				<p style="margin-top: 18px;"><strong>Deleting a bad photo:</strong></p>
				${steps([
					`Click the bad thumbnail so it's selected.`,
					`Click the red <span style="color: var(--color-rust-bright);">✕ Delete</span> button. Confirm.`
				])}

				${callout('💡', `Deleting is "soft" — the photo isn't gone forever, just hidden. If you need it back, ask Justin.`)}

				${callout('⚠️', `Photos can be up to 15 MB each. You can upload up to 20 at a time. JPG, PNG, WEBP all work — but iPhone HEIC files won't. Convert first.`, 'warn')}
			`
		},

		// ---------- Fixing a count ----------------------------------
		{
			id: 'fix-count',
			icon: '🔢',
			title: "Fixing a count that's wrong",
			subtitle: 'When something sold off-website or got miscounted',
			content: `
				<p><strong>The scenario:</strong> Something sold on eBay or you sold it cash at the
				shop, and you forgot to mark it. Now the count in the app says 7 but there are really
				only 4 left.</p>

				${steps([
					`Find the item (search bar, or click through Items).`,
					`On its detail page, look at the right sidebar. You'll see a panel called <strong>On hand</strong> showing the current count in big numbers.`,
					panel(`
						<div style="display: flex; align-items: baseline; justify-content: space-between;">
							${eyebrow('ON HAND')}
							<span style="color: var(--color-gold-bright); font-size: 11px;">Adjust</span>
						</div>
						<div style="font-family: monospace; font-size: 22px; color: var(--color-ink); margin-top: 4px;">7</div>
						<div style="font-size: 11px; font-style: italic; color: var(--color-ink-3); margin-top: 4px;">Off-platform sale, miscount, or breakage — click Adjust to fix.</div>
					`),
					`Click the gold <strong>Adjust</strong> link in that panel.`,
					`A small form opens. <strong>New quantity</strong> — type the real count (4 in our example). Or click the ${btnGhost('0')} button if it's all gone.`,
					`<strong>Reason</strong> — pick what fits:
						<ul style="margin-top: 6px; font-size: 13px;">
							<li><em>Sold off-platform</em> — eBay, Reverb, cash sale, etc.</li>
							<li><em>Count correction</em> — we just miscounted</li>
							<li><em>Damaged / discarded</em> — broken, thrown out</li>
							<li><em>Found extra</em> — we found more than we thought</li>
							<li><em>Other</em> — anything else</li>
						</ul>`,
					`<strong>Note</strong> (optional) — order number, buyer name, anything you want to remember later.`,
					`Click ${btnPrimary('Save adjustment')}.`
				])}

				${callout('💡', "The change shows up in that item's history (scroll down on the same page to <strong>Provenance</strong>) so you can always see what happened. Nothing gets erased — every change leaves a trace.")}

				<p style="margin-top: 18px;"><strong>For serialized items (single guitars / one-off builds):</strong></p>
				<p>Same panel, same flow — set quantity to <span style="font-family: monospace;">0</span>
				when it sells, and pick the matching reason. The listing stays in the system and
				stays searchable. If a similar one ever comes in again, open the page and set qty
				back to <span style="font-family: monospace;">1</span> with the
				<em>Restocked</em> reason — the original listing comes right back to life.</p>

				${callout('💡', "Serialized + qty=0 means \"out of stock, listing preserved for restock\". That's different from <strong>Retire</strong> (in the panel below), which means \"this listing is discontinued forever\". Use Retire when you're certain nothing like it will ever come in again.")}
			`
		},

		// ---------- Transferring ------------------------------------
		{
			id: 'move',
			icon: '↔️',
			title: 'Moving something to a different place',
			subtitle: 'Changing the bin or location',
			content: `
				<p><strong>The scenario:</strong> You moved a guitar from the workshop bench to the
				warehouse shelf, or shifted strings from one drawer to another.</p>

				${steps([
					`Find the item and open its detail page.`,
					`Right sidebar, top panel: <strong>Location</strong>. Shows where it lives now.`,
					`Click ${btnGhost('Transfer')} (or ${btnGhost('Assign bin')} if it doesn't have one yet).`,
					`A dropdown opens with every bin in every location. Pick the new spot.`,
					`Optional: type a note about why you moved it.`,
					`Click ${btnPrimary('Save')}.`
				])}

				${callout('💡', "Like everything else, this leaves a record in the Provenance section of the item — so you can see when it was where.")}
			`
		},

		// ---------- Labels -------------------------------------------
		{
			id: 'print-labels',
			icon: '🏷️',
			title: 'Printing labels',
			subtitle: 'For items and for bins',
			content: `
				<p>Two kinds of labels: one for an item (sticks on the guitar or part), and one for
				a bin (sticks on the shelf or drawer). Both have QR codes.</p>

				<p style="margin-top: 18px;"><strong>Printing an item label (one item):</strong></p>
				${steps([
					`Open the item's page.`,
					`Top-right of the title section: click ${btnGhost('Print label')}.`,
					`A new tab opens with the PDF. Hit Ctrl+P or Cmd+P, pick your DYMO or Primera, print.`
				])}

				<p style="margin-top: 18px;"><strong>Printing item labels in a batch (when receiving):</strong></p>
				<p>If you're entering a new box of stuff, use the Labels page — it makes the items
					and prints labels all at once. See <a href="#add-guitar">Adding a guitar</a> or
					<a href="#add-stocked">Adding parts</a>.</p>

				<p style="margin-top: 18px;"><strong>Printing a bin label:</strong></p>
				${steps([
					`Top bar: <strong>Locations</strong>.`,
					`Click a location (e.g. GAR).`,
					`Find the bin in the list. Click ${btnGhost('Print label')} next to it.`,
					`PDF opens — print it on your label printer.`
				])}

				<p style="margin-top: 18px;"><strong>Picking which label size to print on:</strong></p>
				<p>The Labels page has a dropdown for <strong>Label size</strong>. The options are:</p>
				<ul>
					<li><strong>DYMO LW Durable 19×64mm</strong> — your small DYMO labels, the everyday choice</li>
					<li><strong>DYMO 30320 (1″ × 3.5″)</strong> — slightly bigger DYMO size</li>
					<li><strong>Primera LX-610 Color 2″ × 3″</strong> — full-color, includes the logo + a short description</li>
				</ul>

				${callout('💡', "Color labels on the Primera look great on the showroom side, but cost more per label. DYMO is fine for everyday inventory work.")}
			`
		},

		// ---------- Locations ---------------------------------------
		{
			id: 'locations',
			icon: '📍',
			title: 'Setting up locations and bins',
			subtitle: 'Adding shelves, drawers, and rooms',
			content: `
				<p><strong>The vocabulary:</strong></p>
				<ul>
					<li><strong>Location</strong> = a building or area, like GAR (Garage) or WHS (Warehouse).</li>
					<li><strong>Bin</strong> = a specific shelf, drawer, or box inside a location. Like A-12 or DRAWER-3.</li>
				</ul>

				<p style="margin-top: 18px;"><strong>Adding a new location:</strong></p>
				${steps([
					`Top bar: <strong>Locations</strong>.`,
					`Click the gold ${btnPrimary('+ Add location')} button in the top right.`,
					`<strong>Code</strong> — 2 to 4 uppercase letters. Like <span style="font-family: monospace;">SHED</span> or <span style="font-family: monospace;">SHOW</span>.`,
					`<strong>Friendly name</strong> — what it actually is. Like "Back Yard Shed" or "Showroom".`,
					`Click ${btnPrimary('Create location')}.`
				])}

				<p style="margin-top: 18px;"><strong>Adding bins inside a location:</strong></p>
				${steps([
					`<strong>Locations</strong> → click the location.`,
					`Two options: <em>Add a single bin</em> (one shelf at a time) or <em>Bulk add a range</em> (like A-1 through A-10 in one click).`,
					`For single: type a code (e.g. <span style="font-family: monospace;">A-12</span>) and an optional friendly name. Click Add.`,
					`For bulk: type a prefix (e.g. <span style="font-family: monospace;">A-</span>), a range (e.g. 1 to 10). It makes A-1, A-2, … A-10 all at once.`
				])}

				<p style="margin-top: 18px;"><strong>Retiring a location or bin:</strong></p>
				<p>When you stop using a spot, you can retire it. It hides from all the dropdowns but
					nothing gets erased — the history of what used to be there stays intact.</p>
				${steps([
					`On the Locations page (or a bin row): click <strong>Retire</strong>.`,
					`Confirm.`,
					`Retired locations show in a "Retired" section at the bottom — you can bring them back with <strong>Unretire</strong> anytime.`
				])}

				${tryItLink('/locations', 'open the Locations page')}
			`
		},

		// ---------- Posting to website ------------------------------
		{
			id: 'post-website',
			icon: '🌐',
			title: 'Putting an item on the website',
			subtitle: 'Pushing a listing to Squarespace',
			content: `
				<p><strong>The scenario:</strong> A guitar is set up and ready. You want it on the
				Southwest Acoustics website so customers can buy it.</p>

				${callout('⚠️', "Nothing pushes to your website automatically. You're always in control — the item won't appear on Squarespace until you click the Push button.", 'warn')}

				${steps([
					`Open the item's detail page.`,
					`On the right sidebar, find the <strong>Listings</strong> panel.`,
					panel(`
						<div>${eyebrow('LISTINGS')}</div>
						<div style="display: flex; align-items: baseline; gap: 8px; margin-top: 6px;">
							<span style="font-size: 13px; font-weight: 500; color: var(--color-ink);">Squarespace</span>
							${pill('Not listed', 'default')}
							<span style="margin-left: auto; font-size: 10px; color: var(--color-ink-3);">Edit →</span>
						</div>
					`),
					`Click on <strong>Squarespace</strong>. The listing editor opens.`,
					`<strong>Listing title</strong> — what shows on the website. Often longer and more keyword-heavy than the internal title.`,
					`<strong>Listing description</strong> — the body text. Either type it yourself in the rich-text editor (with the toolbar for bold, lists, etc.), OR use the AI button (see <a href="#ai-listings">Getting AI to write listings</a>).`,
					`<strong>URL slug</strong> — the bit that goes at the end of the website URL. Leave blank to auto-generate from the title.`,
					`<strong>Listing price</strong> — leave blank to use the item's internal price, or override with a different price for the website.`,
					`<strong>Tags</strong> — comma-separated, optional. Helps with website search.`,
					`<strong>Squarespace storefront</strong> — pick which page of your shop it goes on (e.g. "Leo Jaymz Guitars" or "Parts and Accessories").`,
					`<strong>Visible on Squarespace</strong> — checked means the listing shows on your shop. When the item is on hand &gt; 0 it shows as live and buyable; when on hand = 0 Squarespace shows a "Sold Out" badge automatically (still visible to customers — that's how the collection of "I might get this again" stays on your site). Uncheck to hide the listing entirely.`,
					`Bottom: two save buttons (${btnGhost('Save as draft')} or ${btnGhost('Save as ready')}) just save locally without pushing. The push button is on the right: ${btnPrimary('Push to Squarespace')}.`
				])}

				${callout('💡', `If this is the first time pushing this item, Squarespace creates a new product. If it's already on Squarespace, "Push" updates the existing one — title, description, price, on-hand qty, etc.`)}

				${callout('💡', `To show out-of-stock items as part of a collection (still visible with a Sold Out badge), keep "Visible on Squarespace" checked. Adjusting on hand to 0 in the app and pushing is enough — Squarespace handles the Sold Out display automatically.`)}

				<p style="margin-top: 18px;"><strong>If something already sold on Squarespace and the count is wrong here:</strong></p>
				<p>Go to <a href="/import/squarespace">/import/squarespace</a> and click
				${btnGhost('Sync stock from Squarespace')}. It pulls the current per-variant stock counts
				from Squarespace and updates our DB, writing audit entries for each change. Quick — no
				re-fetching descriptions or photos. Run this whenever the Squarespace storefront sold
				something without going through the app.</p>

				<p style="margin-top: 18px;"><strong>The status pill at the top tells you what state the listing is in:</strong></p>
				<ul style="line-height: 2;">
					<li>${pill('Draft', 'default')} — saved locally, not on Squarespace yet</li>
					<li>${pill('Ready to push', 'warn')} — saved and marked ready, still not on Squarespace</li>
					<li>${pill('Live on Squarespace', 'success')} — pushed and live</li>
					<li>${pill('Paused (hidden)', 'default')} — on Squarespace but hidden from customers</li>
					<li>${pill('Last push errored', 'danger')} — something went wrong on the last push, check the red banner</li>
				</ul>
			`
		},

		// ---------- AI listings -------------------------------------
		{
			id: 'ai-listings',
			icon: '✨',
			title: 'Getting AI to write listings',
			subtitle: 'Title + description with a single button',
			content: `
				<p><strong>The scenario:</strong> You don't want to write a 300-word description
				from scratch. You want a robot to write a first draft, and you'll tweak it.</p>

				${steps([
					`Open the item's listing page (Item detail → Listings → Squarespace).`,
					`Look at the right side of the "Listing description" header. There's a button: ${btnGhost('✨ Suggest with AI')}.`,
					`Click it. A big window opens in the middle of the screen. Right away, the AI starts writing — you'll see a pulsing gold dot while it works.`,
					`In about 5 seconds, it shows you:
						<ul style="margin-top: 6px;">
							<li>A <strong>proposed title</strong> at the top</li>
							<li>A <strong>proposed description</strong>, fully styled with bold and bullets as it'll look on the website</li>
						</ul>`,
					`Read it. If it looks great, click the gold ${btnPrimary('Use these — title + description')} button at the bottom-right. The window closes and both fields are filled in for you.`,
					`If you want changes, type plain English into the box on the right ("Anything you want changed?"). Examples:
						<ul style="margin-top: 6px; font-size: 13px; color: var(--color-ink-2);">
							<li>"Make it shorter"</li>
							<li>"Drop the Free Shipping line"</li>
							<li>"Emphasize the weight — it's 5.4 lb"</li>
							<li>"Use rosewood not maple in the tech specs"</li>
							<li>"More technical, less marketing"</li>
						</ul>`,
					`Click ${btnPrimary('↻ Regenerate with these changes')}. The AI takes your previous draft + your instructions and produces a new version.`,
					`Iterate as many times as you want. When happy, click ${btnPrimary('Use these — title + description')}.`,
					`Back on the listing page, the title and description are populated. Edit anything you want by hand, then Push as usual.`
				])}

				${callout('💡', "The AI knows the style conventions for your different collections. A Leo Jaymz item gets a structured description with Tech Specs bullets. A parts item gets short narrative paragraphs. It looks at the live site to learn the rules.")}

				${callout('⚠️', "The AI sometimes makes up specs that aren't in the item's data. Always read it before pushing. If a spec looks fishy, change it in the textarea ('Use rosewood not maple') and regenerate, or fix it by hand after clicking Use these.", 'warn')}

				<p style="margin-top: 18px;"><strong>If the AI button is greyed out:</strong></p>
				<p>That means the AI key isn't set up. Justin needs to configure it — that's a one-time
					thing on the server side, not something you can fix.</p>
			`
		},

		// ---------- Glossary ----------------------------------------
		{
			id: 'glossary',
			icon: '📖',
			title: 'What does this word mean?',
			subtitle: 'A glossary of the tech vocabulary',
			content: `
				<p>Plain-English explanations of the words that keep showing up.</p>

				${panel(`
					<p style="margin: 0;"><strong>SKU</strong> <span style="color: var(--color-ink-3); font-size: 12px;">(say it: "skew")</span></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">The long code on every item, like <span style="font-family: monospace;">LJ-LEO-MNS-N-26-0001</span>. Each item has its own unique code that never changes. It's what the QR code on the label points to.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Item</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">One thing in the shop. Could be a guitar, a body, a bag of strings, a pickup. Each item has its own page.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Category</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">What kind of thing it is. Like "Leo Jaymz Guitar" or "Strings" or "Pickups". Categories also affect what info shows up on the item form (a pickup needs an "output rating", a guitar doesn't).</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Location</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">A building or area where things live. Right now: GAR (Garage workshop) and WHS (Storage warehouse).</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Bin</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">A specific shelf, drawer, or container inside a location. Like A-12 or DRAWER-3. An item lives in exactly one bin at a time.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Serialized vs Stocked</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">Two ways to track inventory.<br>
						<strong>Serialized</strong> = one row per physical thing. Each guitar gets its own row.<br>
						<strong>Stocked</strong> = one row with a count. "I have 47 of these strings" is one row.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Retire</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">Mark an item as no longer in inventory. Used when a guitar is sold, scrapped, or used in a build. The item doesn't disappear — it just gets hidden from the main list. You can un-retire it later if needed.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Movement / Provenance</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">A history entry. Every receive, sale, transfer, or count adjustment makes a movement. The list of movements for one item is called its provenance — its life story.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Listing</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">A product on a website. The thing customers see and buy on Squarespace. The item in your inventory is the source — the listing is the version that's on the storefront.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Push</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">Send a listing to Squarespace. Creates a new product or updates an existing one. Nothing pushes automatically — you click a button.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>Attribute</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">A specific feature of an item — like "Color: Blue Burl" or "Pickup type: Humbucker". Different categories have different attributes. The form shows the right ones based on the category you pick.</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>UNQ</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">"Unique" / one-of-a-kind. Use this when an attribute can't be picked from a list (like a custom finish that doesn't have a name). A description box appears where you can write what it is in your own words.</p>
				`)}
			`
		},

		// ---------- Troubleshooting ---------------------------------
		{
			id: 'troubleshooting',
			icon: '🤔',
			title: 'When something looks weird',
			subtitle: "What to do when things don't behave",
			content: `
				<p>Common things that confuse people, and how to fix them.</p>

				${panel(`
					<p style="margin: 0;"><strong>"I can't find an item I know is there"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						Try the search bar at the top. If still nothing, click <strong>Items</strong> and
						look at the filter chips below the search box — maybe a filter is set that's hiding
						it. Click the "Clear all" button to remove all filters.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>"The count on an item is wrong"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						See <a href="#fix-count">Fixing a count</a>. Always leave a reason — it makes
						the history readable later.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>"A photo won't load"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						Refresh the page (Ctrl+R or Cmd+R). If still broken, delete the photo and re-upload.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>"I uploaded an iPhone photo and it failed"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						iPhones save photos as HEIC by default, which the web can't read. Either change
						your iPhone setting to "Most Compatible" (Settings → Camera → Formats), or
						convert the file to JPG before uploading.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>"The Push to Squarespace button isn't working"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						Check for a red banner at the top of the listing page — it'll tell you what went
						wrong. Common causes: missing storefront page selection, no description, or the
						Squarespace API key needs renewing. Justin can fix the API key.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>"The AI button is greyed out"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						The ANTHROPIC_API_KEY isn't configured for this environment. Justin needs to
						set it — it's a server-side configuration, not something you can fix from here.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>"I retired the wrong item"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						Open the retired item's page (find it via search). Sidebar shows a "Retired" panel
						with a ${btnGhost('Bring back')} button. Click it.
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>"The label printer is doing weird things"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						Check that <strong>Label size</strong> in the print dialog matches the labels actually
						in the printer. Wrong size = misaligned labels. Also, the print scaling option
						should be set to "100%" or "Actual size" — not "Fit to page".
					</p>
				`)}

				${panel(`
					<p style="margin: 0;"><strong>"The whole page looks broken / froze"</strong></p>
					<p style="margin: 6px 0 0 0; font-size: 13px;">
						Refresh the page (Ctrl+R). Still broken? Close the browser tab and reopen it
						from a bookmark. If still broken, text Justin a screenshot.
					</p>
				`)}

				${callout('💡', "If you're really stuck, text Justin. Tell him which page you're on (look at the URL in the browser bar) and what you tried.")}
			`
		},

		// ---------- Accessibility -----------------------------------
		{
			id: 'accessibility',
			icon: '🔍',
			title: 'Making text bigger',
			subtitle: 'Font size and high contrast',
			content: `
				<p>If the app feels small to read, or you're working in bright daylight, two settings
					help:</p>

				${steps([
					`Top right of the bar: click <strong>Settings</strong>.`,
					`At the top: <strong>Accessibility</strong> section.`,
					`<strong>Font size</strong> — pick Normal (100%), Large (120%), or Extra large (140%). Scales everything in the app.`,
					`<strong>High contrast mode</strong> — turn this on to brighten the text and sharpen the colors. Easier to read in daylight or when there's dust on the screen.`
				])}

				${callout('💡', "These settings save automatically and follow you across devices — so if you turn them on on your phone, they're on at your desktop too.")}

				${tryItLink('/settings', 'open Settings')}
			`
		},

		// ---------- The long code (SKU) -----------------------------
		{
			id: 'sku-meaning',
			icon: '🔤',
			title: 'What the long code on each item means',
			subtitle: 'Decoding an SKU, piece by piece',
			content: `
				<p>You'll see codes like this on every item:</p>
				<div style="text-align: center; margin: 16px 0;">
					<span style="font-family: monospace; font-size: 16px; color: var(--color-gold); background: var(--color-input); padding: 8px 16px; border-radius: 4px; border: 1px solid var(--color-line-dim);">PU-SEY-JBJ-U-26-0017-HUM-NEK-SEY-MED-PAS</span>
				</div>
				<p>That's an SKU. It's the item's permanent ID. It might look scary, but it's actually
					just a recipe — each part says something specific.</p>

				<p style="margin-top: 18px;"><strong>Let's read it left to right:</strong></p>
				<ul style="line-height: 2;">
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">PU</strong> = Pickup (category)</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">SEY</strong> = Seymour Duncan (brand)</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">JBJ</strong> = JB Jr (model)</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">U</strong> = Used (condition)</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">26</strong> = Received in 2026</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">0017</strong> = The 17th pickup received this year</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">HUM</strong> = Humbucker type</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">NEK</strong> = Neck position</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">SEY</strong> = Seymour Duncan brand (attribute slot)</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">MED</strong> = Medium output</li>
					<li><strong style="color: var(--color-gold-bright); font-family: monospace;">PAS</strong> = Passive</li>
				</ul>

				${callout('💡', "You don't have to memorize this. The app shows the friendly version everywhere — 'Used Seymour Duncan JB Jr, Humbucker'. The code is just for the label and for the URL.")}

				<p style="margin-top: 18px;"><strong>Two special codes show up sometimes:</strong></p>
				<ul>
					<li><span style="font-family: monospace; color: var(--color-ink);">XXX</span> = "no value" — the slot doesn't apply to this item</li>
					<li><span style="font-family: monospace; color: var(--color-gold-bright);">UNQ</span> = "one of a kind" — see the description on the item page for what it really is</li>
				</ul>
			`
		},

		// ---------- Squarespace style guide (auto) ------------------
		{
			id: 'squarespace-style',
			icon: '✍️',
			title: 'Website style reference',
			subtitle: "How titles and descriptions should read on the shop",
			content: styleGuideContent
		}
	];

	let activeId = $state<string>(SECTIONS[0].id);
	let activeSection = $derived(SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]);

	// Cross-section anchors — clicking <a href="#cheat-sheet"> inside
	// any section should switch to that section, not scroll within the
	// page. Handle clicks at the article level.
	function handleArticleClick(e: MouseEvent) {
		const target = e.target;
		if (!(target instanceof HTMLAnchorElement)) return;
		const href = target.getAttribute('href');
		if (!href || !href.startsWith('#')) return;
		const id = href.slice(1);
		if (SECTIONS.find((s) => s.id === id)) {
			e.preventDefault();
			activeId = id;
			// Scroll the article content back to the top for the new section.
			const article = e.currentTarget as HTMLElement;
			article.scrollTop = 0;
		}
	}
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Reference</p>
		<h1 class="headline text-3xl">Help</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			How this all works, in plain English. Click a topic on the left.
		</p>
	</header>

	<div class="grid gap-6 lg:grid-cols-[280px_1fr]">
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
		<article
			class="panel space-y-4 px-6 py-5"
			onclick={handleArticleClick}
			role="presentation"
		>
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
