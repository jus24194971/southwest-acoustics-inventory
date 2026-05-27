<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import { SQUARESPACE_CATEGORIES } from '$lib/squarespace_categories';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// ----------------------------------------------------------------
	// AI listing modal — generates title + description together, with
	// freeform "make these changes" instructions for iteration.
	// ----------------------------------------------------------------
	let aiModalOpen = $state(false);
	let aiBusy = $state(false);
	let aiError = $state<string | null>(null);
	let aiTitle = $state<string | null>(null);
	let aiDescription = $state<string | null>(null);
	let aiInstructions = $state('');
	let aiUsage = $state<{ input: number; output: number } | null>(null);
	// Total cost over the lifetime of this modal session — handy when
	// iterating to know roughly what each refinement costs.
	let aiTotalIn = $state(0);
	let aiTotalOut = $state(0);

	// Bind to the rich-text editor so we can call setHtml() when Dad
	// accepts an AI suggestion — bypasses round-tripping through the
	// hidden input.
	let editorRef: { setHtml(html: string): void } | undefined = $state();

	async function callSuggest(refining: boolean) {
		aiBusy = true;
		aiError = null;
		try {
			const payload: Record<string, string> = {};
			const instructions = aiInstructions.trim();
			if (instructions) payload.instructions = instructions;
			if (refining && aiTitle) payload.currentTitle = aiTitle;
			if (refining && aiDescription) payload.currentDescriptionHtml = aiDescription;

			const res = await fetch(
				`/api/listings/${data.item.id}/squarespace/suggest-listing`,
				{
					method: 'POST',
					headers: Object.keys(payload).length > 0 ? { 'content-type': 'application/json' } : {},
					body: Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined
				}
			);
			if (!res.ok) {
				const text = await res.text();
				aiError = `${res.status}: ${text.slice(0, 250)}`;
				return;
			}
			const data2 = (await res.json()) as {
				title: string;
				descriptionHtml: string;
				usage: {
					input_tokens: number;
					output_tokens: number;
					cache_creation_input_tokens: number;
					cache_read_input_tokens: number;
				};
			};
			aiTitle = data2.title;
			aiDescription = data2.descriptionHtml;
			const inT = data2.usage.input_tokens + data2.usage.cache_read_input_tokens;
			const outT = data2.usage.output_tokens;
			aiUsage = { input: inT, output: outT };
			aiTotalIn += inT;
			aiTotalOut += outT;
			// Clear instructions box on success so the next refinement
			// starts blank — leaves the user's intent visible in the
			// preview itself rather than in a pre-filled textarea.
			aiInstructions = '';
		} catch (err) {
			aiError = err instanceof Error ? err.message : String(err);
		} finally {
			aiBusy = false;
		}
	}

	function openAiModal() {
		aiModalOpen = true;
		aiBusy = false;
		aiError = null;
		aiTitle = null;
		aiDescription = null;
		aiInstructions = '';
		aiUsage = null;
		aiTotalIn = 0;
		aiTotalOut = 0;
		// Kick off the initial generation immediately on open.
		void callSuggest(false);
	}

	function closeAiModal() {
		aiModalOpen = false;
	}

	function applyAi() {
		if (!aiTitle || !aiDescription) return;
		listingTitle = aiTitle;
		editorRef?.setHtml(aiDescription);
		aiModalOpen = false;
	}

	// Esc-to-close + lock body scroll while the modal is up.
	$effect(() => {
		if (!aiModalOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !aiBusy) closeAiModal();
		};
		document.addEventListener('keydown', onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', onKey);
			document.body.style.overflow = prevOverflow;
		};
	});

	// Parse the JSON tag array back into a comma-separated string for the
	// tag input. Tagging UI is a basic comma-separated field for now —
	// nicer pill UI lands when this earns the screen real estate.
	function tagsFromJson(json: string | null): string {
		if (!json) return '';
		try {
			const arr = JSON.parse(json) as string[];
			return arr.join(', ');
		} catch {
			return '';
		}
	}

	const savedJustNow = $derived(page.url.searchParams.get('saved') === '1');
	const pushedJustNow = $derived(page.url.searchParams.get('pushed') === '1');

	// Initial values for the inputs — start from the listing if there is
	// one, fall back to the item. Captured once on mount via untrack so
	// the user's edits stay put even if data refetches.
	// Fresh listing? = no saved categories yet. We pre-check the
	// suggestions returned by the load() function so the user
	// doesn't have to manually file every new listing into a sub-shop.
	// Once they save (even with all the defaults), the same suggestions
	// get *learned* — future items of the same kind suggest them with
	// higher confidence.
	const isFreshListing = !data.listing?.listing_categories_json;

	const initial = untrack(() => {
		const savedCategories = tagsFromJson(data.listing?.listing_categories_json ?? null)
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		// On a fresh listing, lean on the suggestion engine; otherwise
		// honor whatever the user picked previously.
		const startingCategories = isFreshListing
			? data.autoCheckedSlugs
			: savedCategories;
		// Free shipping: same logic — default from suggestions on fresh
		// listings, respect saved value on existing ones.
		const startingFreeShipping = isFreshListing
			? data.freeShippingSuggestion.suggested
			: data.listing!.listing_free_shipping === 1;
		return {
			title: data.listing?.listing_title ?? data.item.title,
			description: data.listing?.listing_description_html ?? data.item.description_html ?? '',
			urlSlug: data.listing?.listing_url_slug ?? '',
			tags: tagsFromJson(data.listing?.listing_tags_json ?? null),
			price:
				data.listing?.listing_price_cents != null
					? (data.listing.listing_price_cents / 100).toFixed(2)
					: data.item.price_cents != null
						? (data.item.price_cents / 100).toFixed(2)
						: '',
			visible: data.listing ? data.listing.listing_visible === 1 : true,
			storefrontId: data.listing?.storefront_id ?? '',
			categories: startingCategories,
			freeShipping: startingFreeShipping,
			weightOz:
				data.listing?.listing_weight_oz != null ? String(data.listing.listing_weight_oz) : ''
		};
	});

	// Bindable category state — a Set of slugs that's checked in the
	// multi-select. Reactive so the checkbox list reflects the picked
	// state and the form submits a "listing_category" entry per slug.
	let selectedCategories = $state(new Set<string>(initial.categories));
	let freeShipping = $state(initial.freeShipping);

	// Set of slugs the suggestion engine marked as auto-suggested —
	// used to render the ✨ indicator in the UI regardless of whether
	// they're actually checked.
	let suggestedSet = $derived(new Set(data.autoCheckedSlugs));

	function toggleCategory(slug: string) {
		if (selectedCategories.has(slug)) selectedCategories.delete(slug);
		else selectedCategories.add(slug);
		// Trigger reactivity — Svelte 5 doesn't reactively track Set
		// mutations. Reassign a new Set so derived UI updates.
		selectedCategories = new Set(selectedCategories);
	}

	function applyAllSuggestions() {
		for (const slug of data.autoCheckedSlugs) selectedCategories.add(slug);
		selectedCategories = new Set(selectedCategories);
	}

	let visible = $state(initial.visible);
	// Bound to the listing title input so the AI modal can write into
	// it. Initialised once via untrack so subsequent data reloads don't
	// stomp the user's edits.
	let listingTitle = $state(initial.title);

	// ----------------------------------------------------------------
	// Title character counter
	// ----------------------------------------------------------------
	// Squarespace doesn't enforce a strict title length but storefront
	// product cards truncate around 60–80 chars. Counter shows the
	// number and color-codes:
	//   - 0 to TITLE_GOOD_MAX: green (good)
	//   - up to TITLE_WARN_MAX: gold (long but acceptable)
	//   - over TITLE_WARN_MAX: red (likely to truncate)
	const TITLE_GOOD_MAX = 80;
	const TITLE_WARN_MAX = 120;
	let titleLength = $derived(listingTitle.length);
	let titleCounterColor = $derived(
		titleLength <= TITLE_GOOD_MAX
			? 'var(--color-moss-bright)'
			: titleLength <= TITLE_WARN_MAX
				? 'var(--color-gold-bright)'
				: 'var(--color-rust-bright)'
	);

	// ----------------------------------------------------------------
	// Tags state + AI suggester
	// ----------------------------------------------------------------
	// Converted from a one-time `value=initial.tags` to bound state so
	// the AI suggester can append to it programmatically.
	let listingTags = $state(initial.tags);

	let tagAiBusy = $state(false);
	let tagAiError = $state<string | null>(null);
	let tagSuggestions = $state<string[]>([]);

	function currentTagList(): string[] {
		return listingTags
			.split(',')
			.map((t) => t.trim().toLowerCase())
			.filter((t) => t.length > 0);
	}

	// Editor has setHtml() but no getHtml() — grab the rendered HTML
	// from the hidden input the RichTextEditor maintains so AI calls
	// see the current draft, not just the initial server value.
	function getEditorHtml(): string {
		const hidden = document.querySelector<HTMLInputElement>(
			'input[name="listing_description_html"]'
		);
		return hidden?.value ?? initial.description;
	}

	async function suggestTagsFromAi() {
		tagAiBusy = true;
		tagAiError = null;
		tagSuggestions = [];
		try {
			// Send the IN-PROGRESS title + tags + description from the
			// editor so suggestions reflect what Dad is actually drafting,
			// not whatever's stored on the DB.
			const descriptionHtml = getEditorHtml();
			const res = await fetch(`/api/listings/${data.item.id}/squarespace/suggest-tags`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title: listingTitle,
					descriptionHtml,
					existingTags: currentTagList()
				})
			});
			if (!res.ok) {
				const text = await res.text();
				tagAiError = `${res.status}: ${text.slice(0, 200)}`;
				return;
			}
			const payload = (await res.json()) as { tags: string[] };
			tagSuggestions = payload.tags;
		} catch (err) {
			tagAiError = err instanceof Error ? err.message : String(err);
		} finally {
			tagAiBusy = false;
		}
	}

	function addTag(tag: string) {
		const cur = currentTagList();
		if (cur.includes(tag)) return;
		listingTags = cur.length === 0 ? tag : `${listingTags.trim()}${listingTags.trim().endsWith(',') ? '' : ','} ${tag}`;
		// Remove from suggestions pool so the user can see what's left.
		tagSuggestions = tagSuggestions.filter((t) => t !== tag);
	}

	function addAllSuggestedTags() {
		for (const tag of tagSuggestions) addTag(tag);
	}

	const STATUS_PILL: Record<string, string> = {
		draft: 'pill',
		ready: 'pill-warn',
		live: 'pill-success',
		paused: 'pill',
		error: 'pill-danger'
	};
	const STATUS_LABEL: Record<string, string> = {
		draft: 'Draft',
		ready: 'Ready to push',
		live: 'Live on Squarespace',
		paused: 'Paused (hidden)',
		error: 'Last push errored'
	};

	let status = $derived(data.listing?.status ?? 'draft');
</script>

<section class="space-y-6">
	<header class="space-y-2">
		<a
			href="/items/{encodeURIComponent(data.item.sku)}"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← Back to item
		</a>
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<p class="font-mono text-sm text-[color:var(--color-gold)]">{data.item.sku}</p>
			<span class={STATUS_PILL[status] ?? 'pill'}>{STATUS_LABEL[status] ?? status}</span>
		</div>
		<h1 class="headline text-3xl">Squarespace listing</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Listing fields here override the item's internal values when sent to Squarespace. Leave
			a field blank to fall back to the item's value.
		</p>
	</header>

	{#if savedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">Saved locally. No push happened.</p>
		</div>
	{:else if page.url.searchParams.get('unlinked') === '1'}
		<div class="panel px-4 py-3" style="border-color: var(--color-gold-dim)">
			<p class="text-sm text-[color:var(--color-gold-bright)]">
				Unlinked from Squarespace. The product on Squarespace's side wasn't touched — the next
				Push will create a fresh one.
			</p>
		</div>
	{:else if pushedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				{#if page.url.searchParams.get('recreated') === '1'}
					Recreated on Squarespace. The previous product was deleted on Squarespace's side, so
					a fresh one was created with the latest content
					{#if page.url.searchParams.get('photos')}
						and {page.url.searchParams.get('photos')} photo(s) uploaded
					{/if}.
				{:else if page.url.searchParams.get('photo_action') === 'repush'}
					{page.url.searchParams.get('photos') ?? 0} photo(s) uploaded to existing Squarespace listing.
				{:else}
					Pushed to Squarespace successfully.
					{#if page.url.searchParams.get('photos')}
						{page.url.searchParams.get('photos')} photo(s) uploaded.
					{/if}
				{/if}
			</p>
			{#if page.url.searchParams.get('photo_warn')}
				<p class="mt-1 text-xs text-[color:var(--color-gold-bright)]">
					⚠ {page.url.searchParams.get('photo_warn')}. See the "Last sync" notes below for details.
				</p>
			{/if}
			{#if data.listing?.external_id}
				<p class="mt-1 font-mono text-xs text-[color:var(--color-ink-3)]">
					external id: {data.listing.external_id}
				</p>
			{/if}
			<p class="mt-1 text-[11px] italic text-[color:var(--color-ink-3)]">
				Photos take a few seconds to appear — Squarespace processes them asynchronously after
				upload.
			</p>
		</div>
	{/if}

	{#if form?.pushError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.pushError}</p>
		</div>
	{/if}

	{#if data.listing?.last_sync_error && !pushedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">
				Last push error: {data.listing.last_sync_error}
			</p>
		</div>
	{/if}

	<!-- Context card — what we're listing -->
	<div class="panel space-y-2 px-4 py-3">
		<p class="eyebrow">Item being listed</p>
		<p class="text-sm">
			<span class="font-medium text-[color:var(--color-ink)]">{data.item.title}</span>
		</p>
		<p class="text-[11px] text-[color:var(--color-ink-3)]">
			Tracking: <span class="font-mono">{data.item.tracking_mode}</span>
			{#if data.item.tracking_mode === 'stocked'}
				· On hand <span class="font-mono">{data.item.stock_qty}</span> → will push as stock
			{/if}
			· Internal price
			<span class="font-mono">
				{data.item.price_cents != null ? `$${(data.item.price_cents / 100).toFixed(2)}` : '—'}
			</span>
		</p>
	</div>

	<!-- ============= Listing form ============= -->
	<form method="POST" class="panel space-y-5 px-6 py-6">
		<div class="space-y-1.5">
			<div class="flex items-baseline justify-between gap-3">
				<label for="listing_title" class="eyebrow block">Listing title</label>
				<span
					class="font-mono text-[10px]"
					style:color={titleCounterColor}
					title="Storefront cards truncate around 80 chars. Hard breakage around 120."
				>
					{titleLength} chars
					{#if titleLength > TITLE_WARN_MAX}
						· too long
					{:else if titleLength > TITLE_GOOD_MAX}
						· long
					{/if}
				</span>
			</div>
			<input
				id="listing_title"
				name="listing_title"
				type="text"
				bind:value={listingTitle}
				class="field"
				placeholder={data.item.title}
			/>
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Defaults to the item's title. Often longer / more keyword-heavy on Squarespace. Aim for
				under 80 chars so storefront cards don't truncate.
			</p>
		</div>

		<div class="space-y-1.5">
			<div class="flex items-baseline justify-between gap-3">
				<span class="eyebrow">Listing description</span>
				<button
					type="button"
					class="btn-ghost px-2 py-1 text-[11px]"
					onclick={openAiModal}
					disabled={!data.hasAiKey}
					title={data.hasAiKey
						? 'Open the AI listing generator — title + description with refinement'
						: 'ANTHROPIC_API_KEY not configured'}
				>
					✨ Suggest with AI
				</button>
			</div>

			<RichTextEditor
				bind:this={editorRef}
				name="listing_description_html"
				initialHtml={initial.description}
				placeholder="Write a customer-facing description, or hit Suggest with AI to draft one from this item's attributes…"
			/>

			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Customer-facing description. Bold, italic, headings, lists, and links — the toolbar
				covers the basics. The HTML it produces is what gets sent to Squarespace.
			</p>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="listing_url_slug" class="eyebrow block">URL slug</label>
				<input
					id="listing_url_slug"
					name="listing_url_slug"
					type="text"
					value={initial.urlSlug}
					placeholder="auto-derived from title if blank"
					class="field font-mono"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="listing_price" class="eyebrow block">Listing price ($)</label>
				<input
					id="listing_price"
					name="listing_price"
					type="number"
					step="0.01"
					min="0"
					value={initial.price}
					placeholder="inherits item price"
					class="field"
				/>
			</div>
		</div>

		<div class="space-y-1.5">
			<div class="flex items-baseline justify-between gap-3">
				<label for="listing_tags" class="eyebrow block">
					Tags <span class="lowercase text-[color:var(--color-ink-4)]">(comma-separated)</span>
				</label>
				<button
					type="button"
					class="btn-ghost px-2 py-1 text-[11px]"
					onclick={suggestTagsFromAi}
					disabled={tagAiBusy || !data.hasAiKey}
					title={data.hasAiKey
						? 'Read the description and suggest searchable tags'
						: 'ANTHROPIC_API_KEY not configured'}
				>
					{tagAiBusy ? 'Reading…' : '✨ Suggest tags from description'}
				</button>
			</div>
			<input
				id="listing_tags"
				name="listing_tags"
				type="text"
				bind:value={listingTags}
				placeholder="telecaster, custom, hardware"
				class="field"
			/>

			{#if tagAiError}
				<p class="text-xs text-[color:var(--color-rust-bright)]">{tagAiError}</p>
			{/if}

			{#if tagSuggestions.length > 0}
				<div
					class="rounded border border-[color:var(--color-gold-dim)] bg-[color:var(--color-input)] px-3 py-2"
				>
					<div class="flex items-baseline justify-between gap-2">
						<p class="text-[11px] text-[color:var(--color-gold-bright)]">
							✨ Suggested by AI · click to add
						</p>
						<button
							type="button"
							class="text-[10px] text-[color:var(--color-gold-bright)] hover:underline"
							onclick={addAllSuggestedTags}
						>
							Add all
						</button>
					</div>
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each tagSuggestions as tag (tag)}
							<button
								type="button"
								class="rounded-full border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-2.5 py-1 font-mono text-[11px] text-[color:var(--color-ink-2)] transition-colors hover:border-[color:var(--color-gold)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-ink)]"
								onclick={() => addTag(tag)}
								title="Add this tag to the listing"
							>
								+ {tag}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- ============= Storefront categories ============= -->
		<!--
			SS has real Product Categories (separate from Tags). The
			Commerce API's public docs only list `tags`, but the admin
			UI shows Categories as their own field driving sub-shop
			navigation. We send BOTH on push: the category's actual
			display name in payload.categories[] (likely undocumented
			but works in practice), and the URL slug in payload.tags[]
			as a fallback for tag-based storefront filters.

			Suggestions are pre-checked on fresh listings via the
			data.autoCheckedSlugs prop. The ✨ glyph on each checkbox
			label shows which slugs the engine flagged for this item.
		-->
		<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
			<legend class="eyebrow px-2">Squarespace categories</legend>

			{#if data.autoCheckedSlugs.length > 0}
				<div
					class="rounded border border-[color:var(--color-gold-dim)] bg-[color:var(--color-input)] px-3 py-2 text-[11px]"
				>
					<div class="flex items-baseline justify-between gap-2">
						<p class="text-[color:var(--color-gold-bright)]">
							✨ Suggested for this item — {data.autoCheckedSlugs.length}
							sub-shop{data.autoCheckedSlugs.length === 1 ? '' : 's'} based on category{data.suggestions.some(
								(s) => s.reasons.some((r) => r.startsWith('Learned'))
							)
								? ', past picks'
								: ''}{data.suggestions.some((s) =>
								s.reasons.some((r) => r.includes('Title'))
							)
								? ', title'
								: ''}.
						</p>
						<button
							type="button"
							class="text-[color:var(--color-gold-bright)] hover:underline"
							onclick={applyAllSuggestions}
						>
							Apply all
						</button>
					</div>
				</div>
			{/if}

			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Pick every sub-shop this listing should appear on. Push sends the category names to
				Squarespace's <span class="font-mono">categories</span> field (drives the sub-shop
				navigation), plus the slug as a tag fallback. If after pushing the categories don't
				appear in SS admin, the API likely didn't accept the field and Dad will need to
				assign them in SS admin manually — the tag still works for URL filtering.
			</p>

			{#each ['guitars', 'parts', 'special'] as group}
				<div class="space-y-1">
					<p
						class="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-gold-dim)]"
					>
						{group === 'guitars' ? 'Guitars' : group === 'parts' ? 'Parts & accessories' : 'Cross-cutting'}
					</p>
					<div class="grid gap-1.5 sm:grid-cols-2">
						{#each SQUARESPACE_CATEGORIES.filter((c) => c.group === group) as cat (cat.slug)}
							{@const suggestion = data.suggestions.find((s) => s.slug === cat.slug)}
							<label
								class="flex items-start gap-2 text-xs"
								title={suggestion && suggestion.reasons.length > 0
									? 'Suggested because: ' + suggestion.reasons.join('; ')
									: undefined}
							>
								<input
									type="checkbox"
									name="listing_category"
									value={cat.slug}
									checked={selectedCategories.has(cat.slug)}
									onchange={() => toggleCategory(cat.slug)}
									class="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-gold)]"
									style="min-height: auto"
								/>
								<span class="text-[color:var(--color-ink-2)]">
									{cat.label}
									<span class="ml-1 font-mono text-[10px] text-[color:var(--color-ink-4)]"
										>{cat.slug}</span
									>
									{#if suggestedSet.has(cat.slug)}
										<span
											class="ml-1 text-[10px] text-[color:var(--color-gold-bright)]"
											title="Auto-suggested by the engine">✨</span
										>
									{/if}
								</span>
							</label>
						{/each}
					</div>
				</div>
			{/each}
		</fieldset>

		<!-- ============= Shipping ============= -->
		<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
			<legend class="eyebrow px-2">Shipping</legend>

			<label class="flex items-start gap-3">
				<input
					type="checkbox"
					name="listing_free_shipping"
					bind:checked={freeShipping}
					class="mt-0.5 h-4 w-4 accent-[color:var(--color-gold)]"
					style="min-height: auto"
				/>
				<div class="space-y-0.5">
					<span class="text-sm font-medium text-[color:var(--color-ink)]"
						>Free shipping on this listing</span
					>
					<p class="text-[11px] text-[color:var(--color-ink-3)]">
						Appends the <span class="font-mono">free-shipping</span> tag on push. You'll need
						a matching Squarespace shipping rule in your store admin: <em>"Items with
							free-shipping tag → $0"</em>.
					</p>
				</div>
			</label>

			<div class="space-y-1.5">
				<label for="listing_weight_oz" class="eyebrow block">
					Shipping weight (oz) <span class="lowercase">— optional</span>
				</label>
				<input
					id="listing_weight_oz"
					name="listing_weight_oz"
					type="number"
					step="0.1"
					min="0"
					value={initial.weightOz}
					placeholder="e.g. 8 for half a pound"
					class="field"
				/>
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					Pushed as the variant's shipping weight so Squarespace's weight-based shipping
					rules can calculate the right rate. Leave blank if you're using free shipping or
					a flat-rate tag instead.
				</p>
			</div>

			<p class="text-[11px] text-[color:var(--color-ink-4)]">
				For a per-listing flat shipping rate (e.g. <em>"this guitar ships $20"</em>), add a
				tag like <span class="font-mono">ship-20</span> above and configure a matching
				shipping rule in Squarespace admin. The SS Products API doesn't expose a direct
				per-product shipping cost field — tag-driven rules are how it works.
			</p>
		</fieldset>

		<div class="space-y-1.5">
			<label for="storefront_id" class="eyebrow block">Squarespace storefront</label>
			{#if data.storefronts.length > 0}
				<select id="storefront_id" name="storefront_id" class="field">
					<option value="">— pick a store page —</option>
					{#each data.storefronts as sp (sp.id)}
						<option value={sp.id} selected={sp.id === initial.storefrontId}>{sp.title}</option>
					{/each}
				</select>
			{:else}
				<input
					id="storefront_id"
					name="storefront_id"
					type="text"
					value={initial.storefrontId}
					placeholder="storePageId (couldn't fetch list)"
					class="field font-mono"
				/>
				{#if data.storefrontsError}
					<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
						{data.storefrontsError}
					</p>
				{/if}
			{/if}
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Which storefront page this product belongs to. Required for new listings; updates re-use
				whatever Squarespace already has.
			</p>
		</div>

		<label class="flex items-start gap-3">
			<input
				type="checkbox"
				name="listing_visible"
				bind:checked={visible}
				class="mt-0.5 h-4 w-4 accent-[color:var(--color-gold)]"
				style="min-height: auto"
			/>
			<div class="space-y-0.5">
				<span class="text-sm font-medium text-[color:var(--color-ink)]">Visible on Squarespace</span>
				<p class="text-[11px] text-[color:var(--color-ink-3)]">
					Controls whether the listing shows on the shop at all.
					<strong class="text-[color:var(--color-ink-2)]">When checked and on hand &gt; 0</strong>:
					customers see it as live and buyable.
					<strong class="text-[color:var(--color-ink-2)]">When checked and on hand = 0</strong>:
					Squarespace shows a "Sold Out" badge — keeps the listing in your collection so customers
					see what you've had / could get again. Uncheck to hide it entirely.
				</p>
				{#if data.item.stock_qty === 0}
					<p class="text-[11px] text-[color:var(--color-gold-bright)]">
						This item is out of stock ({data.item.tracking_mode}). It will push to Squarespace
						as qty=0 — visible as Sold Out if the checkbox above is on.
					</p>
				{/if}
			</div>
		</label>

		<div class="flex flex-wrap gap-2 border-t border-[color:var(--color-line-dim)] pt-5">
			<button type="submit" formaction="?/save" name="target_status" value="draft" class="btn-ghost">
				Save as draft
			</button>
			<button type="submit" formaction="?/save" name="target_status" value="ready" class="btn-ghost">
				Save as ready
			</button>
			<button type="submit" formaction="?/push" class="btn-primary ml-auto" disabled={!data.hasApiKey}>
				{data.listing?.external_id ? 'Push update to Squarespace' : 'Push to Squarespace'}
			</button>
		</div>

		{#if !data.hasApiKey}
			<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
				Push disabled: SQUARESPACE_API_KEY isn't configured for this environment.
			</p>
		{/if}
	</form>

	<!-- ============= Re-push photos (existing listings only) ============= -->
	<!--
		Standalone form so it doesn't submit the main listing form's
		fields — re-push only needs the route + the SKU. Appears only
		when the listing has an external_id (already on Squarespace);
		new listings handle photos through the main Push button.
	-->
	{#if data.listing?.external_id}
		<form
			method="POST"
			action="?/repushPhotos"
			class="panel space-y-3 px-6 py-4"
			onsubmit={(e) => {
				if (
					!confirm(
						'Upload all current photos to the existing Squarespace product. ' +
							'If photos are already there, Squarespace will add these as DUPLICATES — you ' +
							'would need to clean them up in your Squarespace admin. Continue?'
					)
				) {
					e.preventDefault();
				}
			}}
		>
			<div class="flex items-baseline justify-between gap-3">
				<div>
					<p class="eyebrow">Re-push photos</p>
					<p class="mt-1 text-[11px] italic text-[color:var(--color-ink-3)]">
						Fixes listings that landed without photos. Uploads every current inventory photo
						to the existing Squarespace product. <strong class="not-italic text-[color:var(--color-gold-bright)]"
							>Watch for duplicates</strong
						> — Squarespace doesn't deduplicate, so this is best used when SS shows zero photos.
					</p>
				</div>
				<button type="submit" class="btn-ghost px-4 py-2 text-sm" disabled={!data.hasApiKey}>
					↻ Re-push photos
				</button>
			</div>
		</form>

		<!-- Unlink panel — for when SS-side product is gone or Dad wants to relink. -->
		<form
			method="POST"
			action="?/unlinkFromSquarespace"
			class="panel space-y-3 px-6 py-4"
			style="border-color: var(--color-rust-dim, var(--color-line-dim))"
			onsubmit={(e) => {
				if (
					!confirm(
						'Forget the Squarespace product link for this listing. The product on ' +
							"Squarespace's side is NOT touched — if it still exists you'd have a " +
							'duplicate after the next Push. Use this when SS shows no product (deleted), ' +
							'or when you want to point at a different product. Continue?'
					)
				) {
					e.preventDefault();
				}
			}}
		>
			<div class="flex items-baseline justify-between gap-3">
				<div>
					<p class="eyebrow" style="color: var(--color-rust-bright)">Unlink from Squarespace</p>
					<p class="mt-1 text-[11px] italic text-[color:var(--color-ink-3)]">
						Clears the local link to the Squarespace product (external id
						<span class="font-mono">{data.listing.external_id}</span>) without touching the
						SS side. Next Push will create a fresh product. Use after deleting the product on
						Squarespace, or to relink. <strong class="not-italic">Push usually auto-handles
							this</strong> if SS returns a 404/405 on update — this is the manual lever.
					</p>
				</div>
				<button
					type="submit"
					class="btn-ghost px-4 py-2 text-sm"
					style="color: var(--color-rust-bright)"
				>
					Unlink
				</button>
			</div>
		</form>
	{/if}

	<!-- ============= AI listing generator modal ============= -->
	{#if aiModalOpen}
		<!-- Backdrop: dim everything, click-outside closes when idle. -->
		<div
			class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="ai-modal-title"
			onclick={(e) => {
				if (e.target === e.currentTarget && !aiBusy) closeAiModal();
			}}
			onkeydown={() => {
				/* handled by document-level listener in $effect */
			}}
			tabindex="-1"
		>
			<!-- Panel -->
			<div
				class="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[color:var(--color-line-bright)] bg-[color:var(--color-panel)] shadow-2xl"
			>
				<!-- Header -->
				<header
					class="flex items-baseline justify-between gap-3 border-b border-[color:var(--color-line-dim)] bg-gradient-to-b from-[color:var(--color-panel-2)] to-[color:var(--color-panel)] px-5 py-3"
				>
					<div>
						<p class="eyebrow text-[color:var(--color-gold-bright)]">✨ AI listing generator</p>
						<h2 id="ai-modal-title" class="headline text-lg">{data.item.title}</h2>
					</div>
					<button
						type="button"
						class="text-2xl leading-none text-[color:var(--color-ink-3)] transition-colors hover:text-[color:var(--color-ink)]"
						onclick={closeAiModal}
						disabled={aiBusy}
						aria-label="Close"
					>
						×
					</button>
				</header>

				<!-- Body: preview (left) + controls (right) -->
				<div class="grid flex-1 overflow-hidden lg:grid-cols-[3fr_2fr]">
					<!-- Preview -->
					<div class="flex flex-col gap-4 overflow-y-auto border-b border-[color:var(--color-line-dim)] px-5 py-4 lg:border-b-0 lg:border-r">
						{#if aiBusy && !aiTitle}
							<div class="flex flex-1 items-center justify-center text-sm italic text-[color:var(--color-ink-3)]">
								<span class="inline-flex items-center gap-2">
									<span
										class="inline-block h-3 w-3 animate-pulse rounded-full bg-[color:var(--color-gold)]"
									></span>
									Drafting…
								</span>
							</div>
						{:else if aiError && !aiTitle}
							<div
								class="rounded border border-[color:var(--color-rust)] bg-[color:var(--color-input)] px-3 py-2 text-xs text-[color:var(--color-rust-bright)]"
							>
								{aiError}
							</div>
						{:else if aiTitle && aiDescription}
							<div class="space-y-2">
								<p class="eyebrow">Proposed title</p>
								<p
									class="rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] px-3 py-2 text-sm font-medium text-[color:var(--color-ink)]"
								>
									{aiTitle}
								</p>
							</div>
							<div class="flex flex-1 flex-col space-y-2 overflow-hidden">
								<p class="eyebrow">Proposed description (rendered)</p>
								<div
									class="description-body flex-1 overflow-y-auto rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-shell)] p-4 text-sm"
								>
									{@html aiDescription}
								</div>
							</div>
							<details class="text-[11px] text-[color:var(--color-ink-3)]">
								<summary class="cursor-pointer hover:text-[color:var(--color-ink-2)]">
									View raw HTML
								</summary>
								<pre class="mt-2 max-h-40 overflow-auto rounded bg-[color:var(--color-input)] p-2 font-mono text-[10px] leading-relaxed text-[color:var(--color-ink-3)] whitespace-pre-wrap break-words">{aiDescription}</pre>
							</details>
						{/if}
					</div>

					<!-- Controls -->
					<div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
						<div class="space-y-2">
							<label for="ai_instructions" class="eyebrow block">
								Anything you want changed?
							</label>
							<textarea
								id="ai_instructions"
								bind:value={aiInstructions}
								rows="6"
								placeholder={aiTitle
									? `e.g. "Shorter title, emphasize the weight"\n"Drop the Free Shipping line"\n"Make the description more technical"\n"Use ROSEWOOD not maple in the specs"`
									: `Optional. Leave blank for an initial draft, or steer the first take — e.g. "Be brief, mention free shipping".`}
								class="field text-sm"
								disabled={aiBusy}
							></textarea>
							<p class="text-[11px] italic text-[color:var(--color-ink-4)]">
								Plain English. Mentions things to keep, change, add, or drop.
							</p>
						</div>

						{#if aiTitle && aiError}
							<div
								class="rounded border border-[color:var(--color-rust)] bg-[color:var(--color-input)] px-3 py-2 text-xs text-[color:var(--color-rust-bright)]"
							>
								{aiError}
							</div>
						{/if}

						<div class="space-y-2">
							{#if aiTitle}
								<button
									type="button"
									class="btn-primary w-full px-3 py-2 text-sm"
									onclick={() => callSuggest(true)}
									disabled={aiBusy}
								>
									{aiBusy ? 'Drafting…' : '↻ Regenerate with these changes'}
								</button>
								<button
									type="button"
									class="btn-ghost w-full px-3 py-2 text-xs"
									onclick={() => callSuggest(false)}
									disabled={aiBusy}
									title="Start over from scratch instead of refining"
								>
									Start fresh draft
								</button>
							{:else}
								<button
									type="button"
									class="btn-primary w-full px-3 py-2 text-sm"
									onclick={() => callSuggest(false)}
									disabled={aiBusy}
								>
									{aiBusy ? 'Drafting…' : 'Generate'}
								</button>
							{/if}
						</div>

						<!-- Token usage footer (cumulative for this modal session). -->
						{#if aiUsage}
							<div
								class="mt-auto border-t border-[color:var(--color-line-dim)] pt-3 text-[10px] text-[color:var(--color-ink-4)]"
							>
								<p class="font-mono">
									last call: {aiUsage.input} in / {aiUsage.output} out
								</p>
								{#if aiTotalIn !== aiUsage.input || aiTotalOut !== aiUsage.output}
									<p class="font-mono">
										session: {aiTotalIn} in / {aiTotalOut} out
									</p>
								{/if}
								<p class="italic">Claude Haiku 4.5 · ~$1/M in, ~$5/M out</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Footer: Apply / Cancel -->
				<footer
					class="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line-dim)] bg-gradient-to-b from-[color:var(--color-panel)] to-[color:var(--color-panel-2)] px-5 py-3"
				>
					<button
						type="button"
						class="btn-ghost px-4 py-2 text-sm"
						onclick={closeAiModal}
						disabled={aiBusy}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn-primary ml-auto px-4 py-2 text-sm"
						onclick={applyAi}
						disabled={aiBusy || !aiTitle || !aiDescription}
					>
						Use these — title + description
					</button>
				</footer>
			</div>
		</div>
	{/if}

	<!-- ============= Sync state details ============= -->
	{#if data.listing}
		<div class="panel space-y-2 px-4 py-3">
			<p class="eyebrow">Squarespace state</p>
			<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Status</dt>
					<dd class="font-mono">{data.listing.status}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">External ID</dt>
					<dd class="font-mono truncate">{data.listing.external_id ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Last synced</dt>
					<dd class="font-mono">{data.listing.last_synced_at ?? '—'}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt class="text-[color:var(--color-ink-3)]">Last sync status</dt>
					<dd class="font-mono">{data.listing.last_sync_status ?? '—'}</dd>
				</div>
			</dl>
		</div>
	{/if}
</section>
