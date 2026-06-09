<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';

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
	// Wizard context + photo-upload flashes (the reconcile "list it on SS" flow
	// routes sellable-but-unlisted items here to add photos + push).
	const fromReconcile = $derived(page.url.searchParams.get('from') === 'reconcile');
	const photosAdded = $derived(page.url.searchParams.get('photos_added'));
	const photoWarnFlash = $derived(page.url.searchParams.get('photo_warn'));

	// Initial values for the inputs — start from the listing if there is
	// one, fall back to the item. Captured once on mount via untrack so
	// the user's edits stay put even if data refetches.
	//
	// Storefront defaults to the only available option when there's
	// exactly one (Dad's site has just "shop"). This skips the
	// "—pick a store page—" placeholder so Push works without any
	// extra clicks on a fresh listing.
	const initial = untrack(() => {
		const onlyStorefrontId =
			data.storefronts.length === 1 ? data.storefronts[0].id : '';
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
			storefrontId: data.listing?.storefront_id ?? onlyStorefrontId
		};
	});

	let visible = $state(initial.visible);
	// Bound to the listing title input so the AI modal can write into
	// it. Initialised once via untrack so subsequent data reloads don't
	// stomp the user's edits.
	let listingTitle = $state(initial.title);

	// ----------------------------------------------------------------
	// SEO TITLE + META DESCRIPTION (Squarespace `seoOptions` field)
	// ----------------------------------------------------------------
	// Both bound so the AI suggester can populate them, and so the
	// per-input character counters track length in real time.
	//
	// Limits explained:
	//   - SS admin hard caps: 100 char title, 400 char description.
	//   - Google SERP truncation: ~60 char title, ~160 char description.
	// We color-code GREEN at the Google target, GOLD between target and
	// SS cap (still publishable, just may truncate on Google), and RED
	// over the SS cap (the server will hard-truncate at push time).
	let seoTitle = $state(data.listing?.listing_seo_title ?? '');
	let seoDescription = $state(data.listing?.listing_seo_description ?? '');

	const SEO_TITLE_GOOGLE_TARGET = 60;
	const SEO_TITLE_HARD_CAP = 100;
	const SEO_DESC_GOOGLE_TARGET = 160;
	const SEO_DESC_HARD_CAP = 400;

	let seoTitleLength = $derived(seoTitle.length);
	let seoTitleCounterColor = $derived(
		seoTitleLength === 0
			? 'var(--color-ink-4)'
			: seoTitleLength <= SEO_TITLE_GOOGLE_TARGET
				? 'var(--color-moss-bright)'
				: seoTitleLength <= SEO_TITLE_HARD_CAP
					? 'var(--color-gold-bright)'
					: 'var(--color-rust-bright)'
	);
	let seoDescLength = $derived(seoDescription.length);
	let seoDescCounterColor = $derived(
		seoDescLength === 0
			? 'var(--color-ink-4)'
			: seoDescLength <= SEO_DESC_GOOGLE_TARGET
				? 'var(--color-moss-bright)'
				: seoDescLength <= SEO_DESC_HARD_CAP
					? 'var(--color-gold-bright)'
					: 'var(--color-rust-bright)'
	);

	// AI SEO suggester state — mirrors the tag suggester pattern.
	// Inline (no modal): the SEO outputs are short enough that we just
	// drop them into the inputs directly, the way the tag pills do.
	let seoAiBusy = $state(false);
	let seoAiError = $state<string | null>(null);
	// Optional steering text for refinement runs.
	let seoAiInstructions = $state('');
	// Track whether we've ever populated SEO (initial run vs refinement).
	let seoEverGenerated = $derived(seoTitle.length > 0 || seoDescription.length > 0);

	async function suggestSeoFromAi() {
		seoAiBusy = true;
		seoAiError = null;
		try {
			const descriptionHtml = getEditorHtml();
			const payload: Record<string, string> = {
				title: listingTitle,
				descriptionHtml
			};
			const instructions = seoAiInstructions.trim();
			// Refinement when we have existing SEO + instructions.
			if (instructions && seoEverGenerated) {
				payload.instructions = instructions;
				if (seoTitle) payload.existingSeoTitle = seoTitle;
				if (seoDescription) payload.existingSeoDescription = seoDescription;
			} else if (instructions) {
				// First run, but user wants to steer it.
				payload.instructions = instructions;
			}

			const res = await fetch(`/api/listings/${data.item.id}/squarespace/suggest-seo`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const text = await res.text();
				seoAiError = `${res.status}: ${text.slice(0, 200)}`;
				return;
			}
			const out = (await res.json()) as {
				seoTitle: string;
				seoDescription: string;
			};
			seoTitle = out.seoTitle;
			seoDescription = out.seoDescription;
			// Clear instructions on success so the next refinement is blank.
			seoAiInstructions = '';
		} catch (err) {
			seoAiError = err instanceof Error ? err.message : String(err);
		} finally {
			seoAiBusy = false;
		}
	}

	// One-shot "Copied" feedback on the reminder-banner copy buttons.
	// Keyed by field name so two adjacent buttons can show their flash
	// independently. Resets after 1.5s.
	let copiedFlash = $state<string | null>(null);
	async function copyText(value: string, key: string) {
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			copiedFlash = key;
			setTimeout(() => {
				if (copiedFlash === key) copiedFlash = null;
			}, 1500);
		} catch (err) {
			console.error('clipboard write failed', err);
		}
	}

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

	// ----------------------------------------------------------------
	// Client-side photo upload to Squarespace.
	// ----------------------------------------------------------------
	// We do NOT transcode images in the Worker anymore (Photon WASM blew
	// the per-request CPU/memory limit on multi-photo pushes). Instead,
	// after a create/recreate redirect carries `?needs_photos=N`, the
	// browser fetches each photo, downscales + re-encodes it to JPEG on a
	// canvas (no CPU cap here), and POSTs them ONE AT A TIME to a thin
	// relay endpoint. This keeps every request tiny on the server.
	let photoBusy = $state(false);
	let photoDone = $state(0);
	let photoTotal = $state(0);
	let photoErrors = $state<string[]>([]);
	let photoFinished = $state(false);

	const MAX_DIM = 2048; // cap long edge — plenty for SS, keeps uploads small

	async function transcodeToJpeg(r2Key: string): Promise<Blob> {
		const res = await fetch(`/api/photos/${r2Key}`);
		if (!res.ok) throw new Error(`fetch photo ${res.status}`);
		const srcBlob = await res.blob();
		const bitmap = await createImageBitmap(srcBlob);
		let w = bitmap.width;
		let h = bitmap.height;
		const scale = Math.min(1, MAX_DIM / Math.max(w, h));
		w = Math.round(w * scale);
		h = Math.round(h * scale);
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('no canvas context');
		ctx.drawImage(bitmap, 0, 0, w, h);
		bitmap.close?.();
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))),
				'image/jpeg',
				0.85
			)
		);
	}

	async function uploadPhotosToSs() {
		if (photoBusy || data.photos.length === 0) return;
		photoBusy = true;
		photoFinished = false;
		photoErrors = [];
		photoDone = 0;
		photoTotal = data.photos.length;
		for (let i = 0; i < data.photos.length; i++) {
			const p = data.photos[i];
			try {
				const jpeg = await transcodeToJpeg(p.r2_key);
				const fd = new FormData();
				fd.append('file', jpeg, `photo-${i + 1}.jpg`);
				const up = await fetch(
					`/api/listings/${data.item.id}/squarespace/upload-photo`,
					{ method: 'POST', body: fd }
				);
				const r = (await up.json()) as { ok: boolean; error?: string };
				if (!r.ok) photoErrors.push(`Photo ${i + 1}: ${r.error ?? 'failed'}`);
			} catch (err) {
				photoErrors.push(`Photo ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
			}
			photoDone = i + 1;
		}
		photoBusy = false;
		photoFinished = true;
	}

	// Auto-start the upload when a push/recreate/repush redirect lands on
	// `?needs_photos=N`. We watch the URL (reactive) rather than using
	// onMount because `use:enhance` resolves the redirect with a
	// client-side navigation that reuses this component instance — onMount
	// wouldn't re-fire. `lastPhotoHref` is a plain (non-reactive) guard so
	// each distinct redirect URL kicks the upload exactly once.
	let lastPhotoHref = '';
	$effect(() => {
		const href = page.url.href; // reactive dependency — re-runs on navigation
		const needs = parseInt(page.url.searchParams.get('needs_photos') ?? '', 10);
		if (Number.isInteger(needs) && needs > 0 && href !== lastPhotoHref && data.photos.length > 0) {
			lastPhotoHref = href;
			void uploadPhotosToSs();
		}
	});
</script>

<section class="space-y-6">
	<header class="space-y-2">
		{#if fromReconcile}
			<a
				href="/reconcile/wizard"
				class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-gold-bright)] hover:underline"
			>
				← Back to the review wizard
			</a>
		{:else}
			<a
				href="/items/{encodeURIComponent(data.item.sku)}"
				class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
			>
				← Back to item
			</a>
		{/if}
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

	{#if fromReconcile}
		<div class="panel px-4 py-3" style="border-color: var(--color-gold-dim)">
			<p class="text-sm text-[color:var(--color-gold-bright)]">
				This item isn't on Squarespace yet. Add photos, set the title + description (the ✨ AI
				button writes both), pick a storefront, then <strong>Push</strong> to list it — then use
				“← Back to the review wizard” up top to keep going.
			</p>
		</div>
	{/if}

	{#if page.url.searchParams.get('linked')}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				✓ Linked to the Squarespace listing{#if page.url.searchParams.get('photos')} · pulled {page.url.searchParams.get('photos')} photo(s){/if}.
			</p>
		</div>
	{/if}

	<!-- Link an EXISTING Squarespace listing the auto-match missed (divergent
	     title/slug/SKU). Paste its URL → found by slug and linked; no new
	     product is created. Shown only when not already linked. -->
	{#if !data.listing?.external_id}
		<div class="panel space-y-2 px-5 py-4" style="border-color: var(--color-gold-dim)">
			<p class="text-sm text-[color:var(--color-ink)]">Already listed on Squarespace?</p>
			<p class="text-[12px] text-[color:var(--color-ink-3)]">
				If this item already has a Squarespace page the app didn’t auto-match, paste its URL to link
				them — no new listing is created, and its photos come along.
			</p>
			<form method="POST" action="?/linkExisting" class="flex flex-wrap items-center gap-2">
				<input
					type="text"
					name="ss_url"
					placeholder="https://…/shop/p/your-listing-slug"
					class="field min-w-0 flex-1 py-1.5 text-sm"
				/>
				<button type="submit" class="btn-primary px-4 py-2 text-sm whitespace-nowrap">Link it</button>
			</form>
			{#if form?.linkError}
				<p class="text-[12px] text-[color:var(--color-rust-bright)]">{form.linkError}</p>
			{/if}
		</div>
	{/if}

	<!-- Photos — add them to the item right here so this page is a one-stop
	     "list it on Squarespace" surface. Reorder/remove still live on the
	     item page (linked). Uploads go through the shared item-photo helper. -->
	<div class="panel space-y-3 px-5 py-4">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="eyebrow">
				Photos{#if data.photos.length}<span class="text-[color:var(--color-ink-3)]"> · {data.photos.length} on file</span>{/if}
			</p>
			<a
				href="/items/{encodeURIComponent(data.item.sku)}"
				class="text-[11px] text-[color:var(--color-gold-bright)] hover:underline"
			>
				Reorder / remove on item page ↗
			</a>
		</div>

		{#if data.photos.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each data.photos as p (p.id)}
					<img
						src="/api/photos/{p.r2_key}"
						alt=""
						class="h-16 w-16 rounded object-cover ring-1 ring-[color:var(--color-line-dim)]"
						loading="lazy"
					/>
				{/each}
			</div>
		{:else}
			<p class="text-[12px] text-[color:var(--color-gold-bright)]">
				No photos yet — add some so they publish with the listing.
			</p>
		{/if}

		<form
			method="POST"
			action="?/uploadPhotos"
			enctype="multipart/form-data"
			class="flex flex-wrap items-center gap-2"
		>
			<input type="hidden" name="from" value={fromReconcile ? 'reconcile' : ''} />
			<input
				type="file"
				name="photos"
				accept="image/jpeg,image/png,image/webp,image/gif"
				multiple
				required
				class="text-[12px] text-[color:var(--color-ink-2)] file:mr-2 file:rounded file:border-0 file:bg-[color:var(--color-input)] file:px-3 file:py-1.5 file:text-[color:var(--color-ink)]"
			/>
			<button type="submit" class="btn-ghost px-3 py-1.5 text-sm whitespace-nowrap">
				Upload photos
			</button>
		</form>

		{#if photosAdded}
			<p class="text-[12px] text-[color:var(--color-moss-bright)]">Added {photosAdded} photo(s).</p>
		{/if}
		{#if photoWarnFlash}
			<p class="text-[12px] text-[color:var(--color-gold-bright)]">{photoWarnFlash}</p>
		{/if}
		{#if form?.photoError}
			<p class="text-[12px] text-[color:var(--color-rust-bright)]">{form.photoError}</p>
		{/if}
	</div>

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
	{:else if page.url.searchParams.get('pulled') === '1'}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				Pulled latest from Squarespace. Title, description, price, and URL refreshed.
			</p>
			{#if page.url.searchParams.get('stock_to')}
				<p class="mt-1 text-xs text-[color:var(--color-gold-bright)]">
					Stock changed: {page.url.searchParams.get('stock_from')} →
					{page.url.searchParams.get('stock_to')} (movement recorded)
				</p>
			{/if}
		</div>
	{:else if pushedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				{#if page.url.searchParams.get('recreated') === '1'}
					Recreated on Squarespace. The previous product was deleted on Squarespace's side, so a
					fresh one was created with the latest content.
				{:else if page.url.searchParams.get('adopted') === '1'}
					Found your existing Squarespace listing (matched by SKU) and updated it in place — no
					duplicate created. The link is now saved, so future pushes update it directly.
				{:else if page.url.searchParams.get('photo_action') === 'repush'}
					Re-pushing photos to the existing Squarespace listing.
				{:else}
					Pushed to Squarespace successfully.
				{/if}
			</p>

			<!-- Live photo-upload progress. Photos are transcoded to JPEG
				 in the browser (canvas, no CPU limit) and POSTed one at a
				 time to the relay endpoint, so the Worker never runs image
				 processing. This is the fix for the "Worker exceeded
				 resource limits" error on multi-photo pushes. -->
			{#if photoTotal > 0 || photoBusy}
				<div class="mt-2">
					{#if photoBusy}
						<p class="text-xs text-[color:var(--color-ink-2)]">
							Uploading photos… {photoDone}/{photoTotal}
						</p>
						<div
							class="mt-1 h-1.5 w-full overflow-hidden rounded bg-[color:var(--color-input)]"
						>
							<div
								class="h-full bg-[color:var(--color-moss-bright)] transition-all"
								style="width: {photoTotal ? Math.round((photoDone / photoTotal) * 100) : 0}%"
							></div>
						</div>
					{:else if photoFinished}
						<p class="text-xs text-[color:var(--color-moss-bright)]">
							{photoDone - photoErrors.length} of {photoTotal} photo(s) uploaded. Photos take a
							few seconds to appear — Squarespace processes them after upload.
						</p>
					{/if}

					{#if photoErrors.length > 0}
						<details class="mt-2 text-[11px] text-[color:var(--color-gold-bright)]">
							<summary class="cursor-pointer">⚠ {photoErrors.length} photo(s) failed</summary>
							<ul class="mt-1 space-y-0.5 text-[color:var(--color-ink-3)]">
								{#each photoErrors as e}
									<li class="font-mono text-[10px] break-words">{e}</li>
								{/each}
							</ul>
							<button
								type="button"
								class="mt-2 rounded border border-[color:var(--color-gold-dim)] px-2 py-1 text-[11px] text-[color:var(--color-gold-bright)] hover:bg-[color:var(--color-input)] disabled:opacity-50"
								onclick={() => uploadPhotosToSs()}
								disabled={photoBusy}
							>
								Retry photo upload
							</button>
						</details>
					{/if}
				</div>
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

			<!-- Manual-step reminder. Squarespace's public Commerce API
				 doesn't expose category or fulfillment-profile assignment
				 (we probed the surface in /settings/squarespace-scope and
				 only the documented fields come back). So Dad still has
				 to do these two things in SS admin per product. We
				 surface the deep-links here so the click cost is minimal.

				 Skipped on the photo-only repush since the product
				 already existed and these would already be set. -->
			{#if page.url.searchParams.get('photo_action') !== 'repush' && data.listing?.external_id}
				<div
					class="mt-3 rounded border border-[color:var(--color-gold-dim)] bg-[color:var(--color-input)] px-3 py-2"
				>
					<p class="text-[11px] font-semibold text-[color:var(--color-gold-bright)]">
						⚠ Don't forget — set in Squarespace admin:
					</p>
					<ul class="mt-1.5 space-y-1 text-[11px] text-[color:var(--color-ink-2)]">
						<li>
							<strong class="text-[color:var(--color-ink)]">Categories</strong> — which
							sub-shop pages this product appears on (Leo Jaymz Guitars, Special Value
							Guitars, etc.)
						</li>
						<li>
							<strong class="text-[color:var(--color-ink)]">Fulfillment Profile</strong> —
							which shipping option set (Flat Rate Electric Guitar, Free Shipping, etc.)
						</li>
						{#if data.listing.listing_seo_title || data.listing.listing_seo_description}
							<li>
								<strong class="text-[color:var(--color-ink)]">SEO Title + Description</strong>
								— paste from below into the product's SEO panel
							</li>
						{/if}
					</ul>

					{#if data.listing.listing_seo_title || data.listing.listing_seo_description}
						<!-- SEO copy-paste block.
							 The SS Products API rejects writes to both candidate field
							 names (seoData and seoOptions return HTTP 400 "unknown or
							 readonly fields"), so Dad still has to paste these into
							 the admin manually. Per-field copy buttons drop the
							 friction to one click + Cmd-V. -->
						<div
							class="mt-2 space-y-1.5 rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-shell)] p-2"
						>
							<p class="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-gold-dim)]">
								SEO — copy each, paste into admin
							</p>
							{#if data.listing.listing_seo_title}
								<div class="flex items-start gap-2">
									<div class="flex-1 min-w-0">
										<p class="text-[10px] text-[color:var(--color-ink-4)]">SEO TITLE</p>
										<p
											class="truncate font-mono text-[11px] text-[color:var(--color-ink-2)]"
											title={data.listing.listing_seo_title}
										>
											{data.listing.listing_seo_title}
										</p>
									</div>
									<button
										type="button"
										class="shrink-0 rounded border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-2 py-1 font-mono text-[10px] text-[color:var(--color-gold-bright)] transition-colors hover:bg-[color:var(--color-hover)]"
										onclick={() =>
											copyText(data.listing!.listing_seo_title ?? '', 'seo_title')}
										style="min-height: auto"
									>
										{copiedFlash === 'seo_title' ? '✓ Copied' : 'Copy'}
									</button>
								</div>
							{/if}
							{#if data.listing.listing_seo_description}
								<div class="flex items-start gap-2">
									<div class="flex-1 min-w-0">
										<p class="text-[10px] text-[color:var(--color-ink-4)]">SEO DESCRIPTION</p>
										<p
											class="text-[11px] text-[color:var(--color-ink-2)] line-clamp-2"
											title={data.listing.listing_seo_description}
										>
											{data.listing.listing_seo_description}
										</p>
									</div>
									<button
										type="button"
										class="shrink-0 rounded border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-2 py-1 font-mono text-[10px] text-[color:var(--color-gold-bright)] transition-colors hover:bg-[color:var(--color-hover)]"
										onclick={() =>
											copyText(
												data.listing!.listing_seo_description ?? '',
												'seo_desc'
											)}
										style="min-height: auto"
									>
										{copiedFlash === 'seo_desc' ? '✓ Copied' : 'Copy'}
									</button>
								</div>
							{/if}
						</div>
					{/if}

					<p class="mt-2 text-[11px]">
						<a
							href="https://www.southwestacousticproducts.com/config/commerce/inventory/{data.listing.external_id}"
							target="_blank"
							rel="noopener"
							class="text-[color:var(--color-gold-bright)] underline"
						>
							Open this product in Squarespace admin ↗
						</a>
					</p>
					<p class="mt-1 text-[10px] italic text-[color:var(--color-ink-4)]">
						These fields aren't exposed by the SS public API — only the admin UI can
						set them. Once set on the SS side, they survive future re-pushes from here
						(and a Pull will mirror them back to this page).
					</p>
				</div>
			{/if}
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

		<!--
			Categories + Shipping fieldsets removed. Both used to live
			here. Categories went away because the SS Products API
			rejects the field on writes — the in-app checkboxes had no
			effect on the actual push. Dad still assigns categories in
			SS admin (the post-push reminder banner points him at the
			right deep-link). Shipping went away because Dad isn't
			using the tag-driven shipping workflow — he'll set the
			fulfillment profile in SS admin instead.

			DB columns `listing_categories_json`, `listing_free_shipping`,
			and `listing_weight_oz` are left in the schema as dead
			columns — cheap to keep, and if the SS API ever opens these
			up we won't need a migration to restore the feature.
		-->

		<!-- ============= SEO ============= -->
		<!--
			SEO TITLE + META DESCRIPTION map to Squarespace's `seoOptions`
			(returned as `null` when unset, in which case SS auto-derives
			both fields from the product name + description). We send
			whatever Dad sets here on push; leaving both blank keeps SS's
			auto-derivation.

			Caps are dual-tier:
			  - Squarespace admin: 100 char title, 400 char description.
			  - Google SERP truncation: ~60 char title, ~160 char description.
			Counters turn green at Google's target, gold between target and
			SS cap (still publishes, just may truncate on Google), red over
			the SS cap (server hard-truncates at push). The AI suggester
			aims at the Google targets to maximize SERP completeness.
		-->
		<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
			<legend class="eyebrow px-2">SEO (Google search appearance)</legend>

			<div
				class="rounded border border-[color:var(--color-gold-dim)] bg-[color:var(--color-input)] px-3 py-2 text-[11px] text-[color:var(--color-gold-bright)]"
			>
				⚠ Copy-paste workflow. Squarespace's Products API doesn't let us write SEO fields
				directly (both <code>seoData</code> and <code>seoOptions</code> are rejected — same
				admin-only restriction as Categories). Draft the SEO here with AI and the post-push
				reminder banner will give you one-click copy buttons to paste into the SS admin's
				SEO panel.
			</div>

			<div class="flex flex-wrap items-baseline justify-between gap-3">
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					Leaving both blank lets Squarespace auto-derive them from the title + description
					above. Fill in to override what shows in Google search results.
				</p>
				<button
					type="button"
					class="btn-ghost px-2 py-1 text-[11px]"
					onclick={suggestSeoFromAi}
					disabled={seoAiBusy || !data.hasAiKey}
					title={data.hasAiKey
						? 'Generate SEO title + meta description based on the title and description above'
						: 'ANTHROPIC_API_KEY not configured'}
				>
					{seoAiBusy ? 'Drafting…' : seoEverGenerated ? '✨ Regenerate SEO' : '✨ Suggest SEO from listing'}
				</button>
			</div>

			{#if seoAiError}
				<p class="text-xs text-[color:var(--color-rust-bright)]">{seoAiError}</p>
			{/if}

			<div class="space-y-1.5">
				<div class="flex items-baseline justify-between gap-3">
					<label for="listing_seo_title" class="eyebrow block">SEO title</label>
					<span
						class="font-mono text-[10px]"
						style:color={seoTitleCounterColor}
						title="Google SERP target: 60 chars. Squarespace hard cap: 100 chars."
					>
						{seoTitleLength} / {SEO_TITLE_HARD_CAP}
						{#if seoTitleLength > SEO_TITLE_HARD_CAP}
							· too long — will truncate
						{:else if seoTitleLength > SEO_TITLE_GOOGLE_TARGET}
							· may truncate on Google
						{/if}
					</span>
				</div>
				<input
					id="listing_seo_title"
					name="listing_seo_title"
					type="text"
					bind:value={seoTitle}
					maxlength={SEO_TITLE_HARD_CAP}
					placeholder="e.g. Ivy IJZ-300 Semi-Hollow Jazz Guitar in Sunburst"
					class="field"
				/>
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					Best under 60 chars so Google's search result doesn't truncate it. Lead with brand
					+ model + product type.
				</p>
			</div>

			<div class="space-y-1.5">
				<div class="flex items-baseline justify-between gap-3">
					<label for="listing_seo_description" class="eyebrow block">SEO description</label>
					<span
						class="font-mono text-[10px]"
						style:color={seoDescCounterColor}
						title="Google SERP target: 160 chars. Squarespace hard cap: 400 chars."
					>
						{seoDescLength} / {SEO_DESC_HARD_CAP}
						{#if seoDescLength > SEO_DESC_HARD_CAP}
							· too long — will truncate
						{:else if seoDescLength > SEO_DESC_GOOGLE_TARGET}
							· may truncate on Google
						{/if}
					</span>
				</div>
				<textarea
					id="listing_seo_description"
					name="listing_seo_description"
					bind:value={seoDescription}
					rows="3"
					maxlength={SEO_DESC_HARD_CAP}
					placeholder="One or two sentences describing what the product is and one selling point. Aim under 160 chars."
					class="field text-sm"
				></textarea>
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					This is the snippet that shows under the title in Google's search results. Best
					under 160 chars. Don't repeat the SEO title word-for-word.
				</p>
			</div>

			{#if data.hasAiKey}
				<div class="space-y-1.5 rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] p-3">
					<label
						for="seo_ai_instructions"
						class="eyebrow block text-[10px] text-[color:var(--color-gold-dim)]"
					>
						Steer the AI {seoEverGenerated ? '(refinement)' : '(optional)'}
					</label>
					<input
						id="seo_ai_instructions"
						type="text"
						bind:value={seoAiInstructions}
						placeholder={seoEverGenerated
							? 'e.g. "Mention free shipping in the description", "Shorter title"'
							: 'Optional steering — e.g. "Lead with the color"'}
						class="field text-sm"
						disabled={seoAiBusy}
					/>
					<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
						Type here, then click ✨ {seoEverGenerated ? 'Regenerate' : 'Suggest'} above.
					</p>
				</div>
			{/if}
		</fieldset>

		<div class="space-y-1.5">
			<label for="storefront_id" class="eyebrow block">Squarespace storefront</label>
			{#if data.storefronts.length === 1}
				<!--
					Only one store page exists (Dad's site has just "Shop"),
					so render it as a locked display and submit it via a
					hidden input — no picker noise. The select branch
					below still handles the multi-storefront case for
					future-proofing if Dad ever spins up a second store.
				-->
				<input type="hidden" name="storefront_id" value={data.storefronts[0].id} />
				<div
					class="field flex items-center justify-between"
					style="cursor: default; opacity: 0.85"
				>
					<span class="text-[color:var(--color-ink-2)]">{data.storefronts[0].title}</span>
					<span class="font-mono text-[10px] text-[color:var(--color-ink-4)]"
						>auto-selected (only one)</span
					>
				</div>
			{:else if data.storefronts.length > 1}
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
	<!-- Pull from Squarespace — manual sync-back for one listing.
	     Use case: Dad edited the SS product on their side (price,
	     description, stock) and wants our local copy to catch up. -->
	{#if data.listing?.external_id}
		<form
			method="POST"
			action="?/pullFromSquarespace"
			class="panel space-y-3 px-6 py-4"
			onsubmit={(e) => {
				if (
					!confirm(
						"Pull the latest from Squarespace? This overwrites the local title, " +
							"description, and price with whatever's on Squarespace right now. " +
							"Stock differences write a movement. Continue?"
					)
				) {
					e.preventDefault();
				}
			}}
		>
			<div class="flex items-baseline justify-between gap-3">
				<div>
					<p class="eyebrow">Pull from Squarespace</p>
					<p class="mt-1 text-[11px] italic text-[color:var(--color-ink-3)]">
						Refresh the local copy with whatever's on Squarespace right now. Use this after
						editing the product in Squarespace admin so the next push from us doesn't undo
						those edits. Stock deltas write a movement to the provenance ledger.
					</p>
				</div>
				<button
					type="submit"
					class="btn-ghost px-4 py-2 text-sm"
					disabled={!data.hasApiKey}
				>
					↻ Pull from Squarespace
				</button>
			</div>
		</form>
	{/if}

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
