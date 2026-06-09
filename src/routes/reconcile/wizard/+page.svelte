<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';

	let { data }: { data: PageData } = $props();

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

	let haveQty = $state(1);

	let done = $derived(data.progress.groupsDone + data.progress.itemsDone);
	let total = $derived(data.progress.groupsTotal + data.progress.itemsTotal);
	let pct = $derived(total > 0 ? Math.round((done / total) * 100) : 0);
	let outOfStock = $derived(data.item != null && data.item.stock_qty === 0);

	// Suggested price for the group = highest platform price.
	let groupPrice = $derived(
		data.groupListings.reduce<number | null>(
			(m, l) => (l.price_cents != null && (m == null || l.price_cents > m) ? l.price_cents : m),
			null
		)
	);

	// Post-action banner — set by ?/keepSellable's redirect. The wizard has
	// already advanced to the next unit, so this shows as a transient note
	// confirming what just happened to the item Dad marked sellable.
	const published = $derived(page.url.searchParams.get('published'));
	const pubStatus = $derived(page.url.searchParams.get('pub'));
	const pubMsg = $derived(page.url.searchParams.get('pubmsg'));
	const seoNudge = $derived(page.url.searchParams.get('seo') === '1');
	const photosPulled = $derived(page.url.searchParams.get('photos'));
</script>

<section class="mx-auto max-w-2xl space-y-5">
	<header class="space-y-2">
		<p class="text-xs text-[color:var(--color-ink-3)]">
			<a href="/reconcile" class="hover:underline">Reconcile</a> · Review wizard
		</p>
		<h1 class="headline text-2xl leading-tight">
			{#if data.mode === 'group'}
				Onboard new products
			{:else}
				Review your inventory
			{/if}
		</h1>
		<div class="space-y-1">
			<div class="flex justify-between text-[11px] text-[color:var(--color-ink-3)]">
				<span>
					{data.progress.groupsDone}/{data.progress.groupsTotal} new · {data.progress.itemsDone}/{data
						.progress.itemsTotal} existing
				</span>
				<span>{pct}%</span>
			</div>
			<div class="h-1.5 w-full overflow-hidden rounded bg-[color:var(--color-input)]">
				<div
					class="h-full bg-[color:var(--color-moss-bright)] transition-all"
					style="width: {pct}%"
				></div>
			</div>
		</div>
	</header>

	{#if published}
		{#if pubStatus === 'ok'}
			<div class="panel px-4 py-3" style="border-color: var(--color-moss-bright)">
				<p class="text-sm text-[color:var(--color-moss-bright)]">
					✓ <span class="font-mono text-[12px]">{published}</span> is now sellable and live on Squarespace.{#if photosPulled && Number(photosPulled) > 0}
						<span class="text-[color:var(--color-ink-2)]"> Pulled {photosPulled} photo(s) into the item.</span>{/if}
				</p>
				{#if seoNudge}
					<p class="mt-1 text-[11px] text-[color:var(--color-ink-3)]">
						Optional: set its SEO title/description + shipping in
						<a href="https://account.squarespace.com" target="_blank" rel="noopener" class="text-[color:var(--color-gold-bright)] hover:underline">Squarespace admin</a>
						— the app can’t write those. (Most of these you’re retiring, so you can usually skip it.)
					</p>
				{/if}
			</div>
		{:else if pubStatus === 'nolisting'}
			<div class="panel px-4 py-3" style="border-color: var(--color-gold-dim)">
				<p class="text-sm text-[color:var(--color-gold-bright)]">
					Marked <span class="font-mono text-[12px]">{published}</span> sellable — but it isn’t on
					Squarespace yet. Open it and push from its listing editor to go live.
				</p>
			</div>
		{:else if pubStatus === 'err'}
			<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
				<p class="text-sm text-[color:var(--color-rust-bright)]">
					Marked <span class="font-mono text-[12px]">{published}</span> sellable, but the Squarespace
					push failed: {pubMsg ?? 'unknown error'}. You can re-push from the item’s editor.
				</p>
			</div>
		{/if}
	{/if}

	{#if data.mode === 'group' && data.group}
		{@const group = data.group}
		<!-- A matched group from the scrape → create a unified item. -->
		<div class="panel space-y-4 px-5 py-5">
			<div>
				<p class="eyebrow">New product · {data.groupListings.length} listing(s)</p>
				<p class="text-lg leading-snug text-[color:var(--color-ink)]">{group.title}</p>
			</div>

			<div class="space-y-1.5">
				{#each data.groupListings as l (l.id)}
					<div class="flex items-center gap-3">
						{#if l.image_url}
							<img src={l.image_url} alt="" class="h-10 w-10 flex-shrink-0 rounded object-cover" loading="lazy" />
						{:else}
							<div class="h-10 w-10 flex-shrink-0 rounded bg-[color:var(--color-input)]"></div>
						{/if}
						<span class="{PLATFORM_PILL[l.platform]} text-[10px]">{PLATFORM_LABEL[l.platform]}</span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-[13px] text-[color:var(--color-ink-2)]">{l.title}</p>
							<p class="text-[11px] text-[color:var(--color-ink-3)]">
								{fmtPrice(l.price_cents)}{#if l.qty != null}· qty {l.qty}{/if}
							</p>
						</div>
						{#if l.url}
							<a href={l.url} target="_blank" rel="noopener" class="text-[11px] text-[color:var(--color-gold-bright)] hover:underline">↗</a>
						{/if}
					</div>
				{/each}
			</div>

			<p class="text-[12px] text-[color:var(--color-ink-3)]">
				“Have it” pre-fills a new item from these listings (category, brand, model, color/style — AI
				best-guesses, you confirm) and links every listing back to it.
			</p>

			<div class="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line-dim)] pt-3">
				<form method="POST" action="?/haveIt" class="flex items-center gap-2">
					<input type="hidden" name="group_id" value={group.id} />
					<label class="text-[11px] text-[color:var(--color-ink-3)]">
						qty
						<input
							name="qty"
							type="number"
							min="0"
							bind:value={haveQty}
							class="field ml-1 w-16 py-1 text-sm"
						/>
					</label>
					<button type="submit" class="btn-primary px-4 py-2 text-sm">✓ Have it — create item</button>
				</form>
				<form method="POST" action="?/future">
					<input type="hidden" name="group_id" value={group.id} />
					<button type="submit" class="btn-ghost px-3 py-2 text-sm" title="Create the item at 0 on hand">
						Future (0 qty)
					</button>
				</form>
				<form
					method="POST"
					action="?/groupGone"
					class="ml-auto"
					onsubmit={(e) => {
						if (!confirm('Mark this product as no longer carried? Its listings are queued for removal — you’ll confirm + delete them in the dead-listings step.'))
							e.preventDefault();
					}}
				>
					<input type="hidden" name="group_id" value={group.id} />
					<button
						type="submit"
						class="rounded border border-[color:var(--color-rust)] px-3 py-2 text-sm text-[color:var(--color-rust-bright)] hover:bg-[color:var(--color-input)]"
					>
						No longer have
					</button>
				</form>
			</div>
		</div>
	{:else if data.mode === 'item' && data.item}
		{@const item = data.item}
		<div
			class="panel space-y-4 px-5 py-5"
			style={outOfStock ? 'border-color: var(--color-gold-dim)' : ''}
		>
			<div class="flex gap-4">
				{#if item.photo_key}
					<img src="/api/photos/{item.photo_key}" alt="" class="h-24 w-24 flex-shrink-0 rounded object-cover" />
				{:else}
					<div class="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded bg-[color:var(--color-input)] text-[10px] text-[color:var(--color-ink-4)]">
						no photo
					</div>
				{/if}
				<div class="min-w-0 flex-1">
					<p class="text-lg leading-snug text-[color:var(--color-ink)]">{item.title}</p>
					<p class="mt-0.5 font-mono text-[11px] text-[color:var(--color-ink-3)]">{item.sku}</p>
					<div class="mt-1.5 flex flex-wrap items-center gap-2">
						<span class="pill text-[10px]">{item.cat_code} · {item.cat_name}</span>
						{#if outOfStock}
							<span class="pill pill-warn text-[10px]">Out of stock</span>
						{:else}
							<span class="pill pill-success text-[10px]">{item.stock_qty} on hand</span>
						{/if}
						<span class="text-[11px] text-[color:var(--color-ink-3)]">{fmtPrice(item.price_cents)}</span>
					</div>
				</div>
				<a href="/items/{encodeURIComponent(item.sku)}" target="_blank" class="btn-ghost px-2.5 py-1 text-[11px] whitespace-nowrap">Open ↗</a>
			</div>

			{#if data.listings.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each data.listings as l (l.platform)}
						<span class="inline-flex items-center gap-1 rounded border border-[color:var(--color-line-dim)] px-2 py-1 text-[11px]">
							{PLATFORM_LABEL[l.platform] ?? l.platform}
							{#if l.external_id}
								<span class="text-[color:var(--color-moss-bright)]">· {l.status}</span>
								{#if l.external_url}
									<a href={l.external_url} target="_blank" rel="noopener" class="text-[color:var(--color-gold-bright)]">↗</a>
								{/if}
							{:else}
								<span class="text-[color:var(--color-ink-4)]">· not listed</span>
							{/if}
						</span>
					{/each}
				</div>
			{:else}
				<p class="text-[11px] text-[color:var(--color-ink-4)]">Not listed on any marketplace.</p>
			{/if}

			{#if outOfStock}
				<p class="text-[12px] text-[color:var(--color-gold-bright)]">
					Out of stock. Keep it (stays a “Sold Out” listing, ready to restock) or retire it if it's
					not coming back.
				</p>
			{/if}

			<div class="flex flex-wrap gap-2 border-t border-[color:var(--color-line-dim)] pt-3">
				<form method="POST" action="?/keepSellable">
					<input type="hidden" name="item_id" value={item.id} />
					<button
						type="submit"
						class="btn-primary px-4 py-2 text-sm"
						title="Mark it sellable, push it live on Squarespace, and keep it auto-synced from now on"
					>
						✓ Keep &amp; sell on Squarespace
					</button>
				</form>
				<form method="POST" action="?/keep">
					<input type="hidden" name="item_id" value={item.id} />
					<button
						type="submit"
						class="btn-ghost px-3 py-2 text-sm"
						title="Keep carrying it, but don't list or sync it to Squarespace"
					>
						Keep — don’t sell online
					</button>
				</form>
				<form
					method="POST"
					action="?/retire"
					onsubmit={(e) => {
						if (!confirm('Retire this item? Its listings are queued for removal (you’ll confirm + delete those in the dead-listings step); a full copy is kept — un-retire to restore.'))
							e.preventDefault();
					}}
				>
					<input type="hidden" name="item_id" value={item.id} />
					<button type="submit" class="rounded border border-[color:var(--color-rust)] px-4 py-2 text-sm text-[color:var(--color-rust-bright)] hover:bg-[color:var(--color-input)]">
						Never carry again — retire + save copy
					</button>
				</form>
				<form method="POST" action="?/skip" class="ml-auto">
					<input type="hidden" name="item_id" value={item.id} />
					<button type="submit" class="btn-ghost px-3 py-2 text-sm">Skip for now</button>
				</form>
			</div>
		</div>
	{:else}
		<!-- Done -->
		<div class="panel space-y-3 px-6 py-8 text-center">
			<p class="text-2xl">✓</p>
			<p class="text-lg text-[color:var(--color-ink)]">All caught up!</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				Every new product group has been onboarded and every existing item reviewed.
			</p>
			<p class="text-sm text-[color:var(--color-gold-bright)]">
				Anything marked “no longer have” is queued on the dead-listings page — go through it with Dad
				to actually remove those from Squarespace, Reverb &amp; eBay.
			</p>
			<div class="flex flex-wrap justify-center gap-2 pt-2">
				<a href="/reconcile/dead" class="btn-primary px-4 py-2 text-sm">Review &amp; remove dead listings</a>
				<a href="/reconcile" class="btn-ghost px-4 py-2 text-sm">Back to Reconcile</a>
				<a href="/items" class="btn-ghost px-4 py-2 text-sm">Go to Items</a>
			</div>
		</div>
	{/if}

	<!-- eBay manual-delete summary: anything marked "no longer have" that
		 lives on eBay can't be ended via API. -->
	{#if data.ebayToDelete.length > 0}
		<details class="panel px-4 py-3" open={data.mode === 'done'}>
			<summary class="cursor-pointer text-sm text-[color:var(--color-gold-bright)]">
				🗑 {data.ebayToDelete.length} eBay listing(s) to end manually
			</summary>
			<p class="mt-1 text-[11px] text-[color:var(--color-ink-3)]">
				eBay's API can't end these classic listings — open each and end it in eBay.
			</p>
			<ul class="mt-2 space-y-1">
				{#each data.ebayToDelete as l (l.url)}
					<li class="flex items-center gap-2 text-[12px]">
						{#if l.url}
							<a href={l.url} target="_blank" rel="noopener" class="text-[color:var(--color-gold-bright)] hover:underline">↗</a>
						{/if}
						<span class="truncate text-[color:var(--color-ink-2)]">{l.title}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>
