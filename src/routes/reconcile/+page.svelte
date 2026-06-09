<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let scraping = $state(false);

	function fmtPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}

	const PLATFORM_LABEL: Record<string, string> = {
		squarespace: 'Squarespace',
		reverb: 'Reverb',
		ebay: 'eBay'
	};
	const PLATFORM_PILL: Record<string, string> = {
		squarespace: 'pill',
		reverb: 'pill-warn',
		ebay: 'pill-success'
	};

	// Group listings by platform for the raw view.
	let byPlatform = $derived.by(() => {
		const m = new Map<string, typeof data.listings>();
		for (const l of data.listings) {
			const arr = m.get(l.platform);
			if (arr) arr.push(l);
			else m.set(l.platform, [l]);
		}
		return [...m.entries()];
	});

	let linkedCount = $derived(data.listings.filter((l) => l.existing_item_id != null).length);
	let matching = $state(false);
	// Which listing's "detach" reason form is open (by listing id).
	let detachingId = $state<number | null>(null);

	// Grouped view (after AI matching): one card per match group, with the
	// already-linked ("skipped") groups separated out.
	let groups = $derived.by(() => {
		const m = new Map<
			number,
			{
				id: number;
				title: string;
				decision: string | null;
				validated: boolean;
				listings: typeof data.listings;
			}
		>();
		for (const l of data.listings) {
			if (l.group_id == null) continue;
			const g = m.get(l.group_id);
			if (g) g.listings.push(l);
			else
				m.set(l.group_id, {
					id: l.group_id,
					title: l.group_title ?? l.title,
					decision: l.group_decision,
					validated: l.group_validated != null,
					listings: [l]
				});
		}
		const all = [...m.values()];
		return {
			toReview: all.filter((g) => g.decision !== 'skipped'),
			linked: all.filter((g) => g.decision === 'skipped')
		};
	});

	let validatedCount = $derived(groups.toReview.filter((g) => g.validated).length);
</script>

<section class="space-y-6">
	<header class="space-y-2">
		<p class="eyebrow">Go-live onboarding</p>
		<h1 class="headline text-3xl leading-tight">Reconcile listings</h1>
		<p class="max-w-2xl text-sm text-[color:var(--color-ink-2)]">
			Pulls everything Dad currently has listed on Squarespace, Reverb, and eBay into one place.
			Next we'll match the same product across platforms and walk through them one at a time —
			keeping, correcting, combining, or removing each — to build unified inventory items.
		</p>
	</header>

	<!-- eBay seller — needed for the Browse listing scrape. We can't read
		 the username from the API reliably, so Dad pastes his store link
		 (or username) once. -->
	<div class="panel space-y-2 px-4 py-3">
		<p class="eyebrow">eBay store link or seller username</p>
		<form method="POST" action="?/setEbayUsername" class="flex flex-wrap gap-2">
			<input
				name="ebay_seller"
				value={data.ebay.seller}
				placeholder="https://www.ebay.com/str/yourstore  ·  or  ·  your_ebay_username"
				class="field min-w-0 flex-1 py-1.5 text-sm"
			/>
			<button type="submit" class="btn-ghost px-3 py-1.5 text-sm whitespace-nowrap">Save</button>
		</form>
		<p class="text-[11px] text-[color:var(--color-ink-3)]">
			Paste Dad's eBay store link — e.g. <span class="font-mono">ebay.com/str/southwest-acoustics</span>
			or his profile <span class="font-mono">ebay.com/usr/username</span>. We use it to find his eBay
			listings.
			{#if !data.ebay.connected}
				<span class="text-[color:var(--color-gold-bright)]">
					eBay also needs to be connected in Settings for the scrape.
				</span>
			{/if}
		</p>
	</div>

	{#if !data.run}
		<div class="panel space-y-3 px-5 py-5">
			<p class="text-sm text-[color:var(--color-ink-2)]">
				Start by scraping all three platforms. This reads your live listings only — it doesn't
				change anything on any store.
			</p>
			<ul class="ml-4 list-disc space-y-1 text-[13px] text-[color:var(--color-ink-3)]">
				<li><strong>Squarespace</strong> &amp; <strong>Reverb</strong> — full catalog with stock.</li>
				<li>
					<strong>eBay</strong> — live listings via search (no quantity; you'll set it during
					review). Needs eBay connected in Settings.
				</li>
			</ul>
			<form method="POST" action="?/scrape" onsubmit={() => (scraping = true)}>
				<button type="submit" class="btn-primary px-4 py-2 text-sm" disabled={scraping}>
					{scraping ? 'Scraping… (this can take 10–20s)' : 'Scrape all my listings'}
				</button>
			</form>
		</div>
	{:else}
		<!-- Per-platform summary -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
			{#each ['squarespace', 'reverb', 'ebay'] as p (p)}
				{@const count =
					p === 'squarespace'
						? data.run.ss_count
						: p === 'reverb'
							? data.run.reverb_count
							: data.run.ebay_count}
				{@const err =
					p === 'squarespace'
						? data.run.ss_error
						: p === 'reverb'
							? data.run.reverb_error
							: data.run.ebay_error}
				<div class="panel px-4 py-3" style={err ? 'border-color: var(--color-gold-dim)' : ''}>
					<p class="eyebrow">{PLATFORM_LABEL[p]}</p>
					<p class="font-mono text-2xl text-[color:var(--color-ink)]">{count}</p>
					{#if err}
						<p class="mt-1 text-[11px] text-[color:var(--color-gold-bright)]">⚠ {err}</p>
					{:else}
						<p class="mt-1 text-[11px] text-[color:var(--color-ink-3)]">listings pulled</p>
					{/if}
				</div>
			{/each}
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<p class="text-sm text-[color:var(--color-ink-2)]">
				{data.listings.length} total · <span class="text-[color:var(--color-moss-bright)]"
					>{linkedCount} already linked</span
				> to existing items.
			</p>
			<a
				href="/reconcile/wizard"
				class="btn-primary ml-auto px-4 py-1.5 text-sm whitespace-nowrap"
				title="Walk through every inventory item one at a time"
			>
				▶ Review wizard
			</a>
			<form method="POST" action="?/scrape" onsubmit={() => (scraping = true)}>
				<button type="submit" class="btn-ghost px-3 py-1.5 text-xs" disabled={scraping}>
					{scraping ? 'Re-scraping…' : '↻ Re-scrape'}
				</button>
			</form>
			<form
				method="POST"
				action="?/reset"
				onsubmit={(e) => {
					if (!confirm('Clear the scrape and start over? (Your real inventory items are unaffected.)'))
						e.preventDefault();
				}}
			>
				<button type="submit" class="btn-ghost px-3 py-1.5 text-xs">Reset</button>
			</form>
		</div>

		<!-- Match controls -->
		<div class="panel flex flex-wrap items-center gap-3 px-4 py-3" style="border-color: var(--color-gold-dim)">
			<div class="min-w-0 flex-1">
				<p class="text-[13px] text-[color:var(--color-ink-2)]">
					{#if data.matched}
						<strong class="text-[color:var(--color-moss-bright)]">{validatedCount}</strong>/{groups
							.toReview.length} groups validated · {groups.linked.length} already linked. Check each
						grouping, <strong>detach</strong> anything mis-matched (with a note so it learns), and
						hit <strong>Validate match</strong>. The decision wizard comes next.
					{:else}
						<strong class="text-[color:var(--color-gold-bright)]">Next:</strong> let AI group the
						same product across platforms into one item each. Confirm the scrape below first,
						especially eBay.
					{/if}
				</p>
			</div>
			<form method="POST" action="?/match" onsubmit={() => (matching = true)}>
				<button type="submit" class="btn-primary px-4 py-2 text-sm whitespace-nowrap" disabled={matching}>
					{matching ? 'Matching…' : data.matched ? '↻ Re-match with AI' : '✨ Match with AI'}
				</button>
			</form>
		</div>

		{#if data.matched}
			<!-- Grouped view: one card per matched product. Validate or
				 detach mis-matches before the decision wizard. -->
			{#each groups.toReview as g (g.id)}
				<div
					class="panel space-y-2 px-4 py-3"
					style={g.validated ? 'border-color: var(--color-moss-bright)' : ''}
				>
					<div class="flex items-start justify-between gap-3">
						<p class="text-sm font-medium text-[color:var(--color-ink)]">{g.title}</p>
						<form method="POST" action="?/validateGroup">
							<input type="hidden" name="group_id" value={g.id} />
							<input type="hidden" name="on" value={g.validated ? '0' : '1'} />
							<button
								type="submit"
								class={g.validated
									? 'pill pill-success text-[10px] hover:opacity-80'
									: 'btn-ghost px-2.5 py-1 text-[11px] whitespace-nowrap'}
								title={g.validated
									? 'Validated — click to undo'
									: 'Confirm this grouping is correct'}
							>
								{g.validated ? '✓ Validated' : 'Validate match'}
							</button>
						</form>
					</div>
					<div class="space-y-1">
						{#each g.listings as l (l.id)}
							<div class="flex items-center gap-3">
								{#if l.image_url}
									<img
										src={l.image_url}
										alt=""
										class="h-9 w-9 flex-shrink-0 rounded object-cover"
										loading="lazy"
									/>
								{:else}
									<div class="h-9 w-9 flex-shrink-0 rounded bg-[color:var(--color-input)]"></div>
								{/if}
								<span class="{PLATFORM_PILL[l.platform]} text-[10px]">{PLATFORM_LABEL[l.platform]}</span>
								<div class="min-w-0 flex-1">
									<p class="truncate text-[13px] text-[color:var(--color-ink-2)]">{l.title}</p>
									<p class="text-[11px] text-[color:var(--color-ink-3)]">
										{fmtPrice(l.price_cents)}{#if l.qty != null}· qty {l.qty}{/if}
									</p>
								</div>
								{#if l.url}
									<a
										href={l.url}
										target="_blank"
										rel="noopener"
										class="text-[11px] text-[color:var(--color-gold-bright)] hover:underline">↗</a
									>
								{/if}
								{#if g.listings.length > 1}
									<button
										type="button"
										class="text-[11px] text-[color:var(--color-rust-bright)] hover:underline"
										title="This one doesn't belong in this group"
										onclick={() => (detachingId = detachingId === l.id ? null : l.id)}
									>
										detach
									</button>
								{/if}
							</div>
							{#if detachingId === l.id}
								<form
									method="POST"
									action="?/detachListing"
									class="ml-12 flex flex-wrap items-center gap-2 pb-1"
								>
									<input type="hidden" name="listing_id" value={l.id} />
									<input
										name="reason"
										placeholder="What's wrong? (e.g. that's a Strat, not a Tele)"
										class="field min-w-0 flex-1 py-1 text-xs"
									/>
									<button type="submit" class="btn-ghost px-2.5 py-1 text-[11px] whitespace-nowrap">
										Detach + save note
									</button>
									<button
										type="button"
										class="text-[11px] text-[color:var(--color-ink-3)] hover:underline"
										onclick={() => (detachingId = null)}
									>
										cancel
									</button>
								</form>
							{/if}
						{/each}
					</div>
				</div>
			{/each}

			{#if groups.linked.length > 0}
				<details class="panel px-4 py-3">
					<summary class="cursor-pointer text-sm text-[color:var(--color-ink-2)]">
						{groups.linked.length} group(s) already linked to existing items
					</summary>
					<div class="mt-2 space-y-1">
						{#each groups.linked as g (g.id)}
							<p class="text-[12px] text-[color:var(--color-ink-3)]">
								{g.title} · {g.listings.map((l) => PLATFORM_LABEL[l.platform]).join(', ')}
							</p>
						{/each}
					</div>
				</details>
			{/if}
		{:else}
			<!-- Raw scraped listings, grouped by platform (pre-match). -->
			{#each byPlatform as [platform, listings] (platform)}
				<div class="space-y-2">
					<h2 class="flex items-center gap-2 text-lg text-[color:var(--color-ink)]">
						<span class={PLATFORM_PILL[platform]}>{PLATFORM_LABEL[platform]}</span>
						<span class="text-sm text-[color:var(--color-ink-3)]">{listings.length}</span>
					</h2>
					<div class="overflow-hidden rounded border border-[color:var(--color-line-dim)]">
						{#each listings as l (l.id)}
							<div
								class="flex items-center gap-3 border-b border-[color:var(--color-line-dim)] px-3 py-2 last:border-b-0"
							>
								{#if l.image_url}
									<img
										src={l.image_url}
										alt=""
										class="h-10 w-10 flex-shrink-0 rounded object-cover"
										loading="lazy"
									/>
								{:else}
									<div class="h-10 w-10 flex-shrink-0 rounded bg-[color:var(--color-input)]"></div>
								{/if}
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm text-[color:var(--color-ink)]">{l.title}</p>
									<p class="text-[11px] text-[color:var(--color-ink-3)]">
										{fmtPrice(l.price_cents)}
										{#if l.qty != null}· qty {l.qty}{/if}
										{#if l.sku}· <span class="font-mono">{l.sku}</span>{/if}
									</p>
								</div>
								{#if l.existing_item_id}
									<span
										class="pill pill-success text-[10px]"
										title="Already linked to {l.existing_item_sku}"
									>
										linked
									</span>
								{/if}
								{#if l.url}
									<a
										href={l.url}
										target="_blank"
										rel="noopener"
										class="text-[11px] text-[color:var(--color-gold-bright)] hover:underline"
									>
										↗
									</a>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	{/if}
</section>
