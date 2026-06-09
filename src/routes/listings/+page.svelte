<script lang="ts">
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function fmtPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}

	function listedInfo(ts: string | null): { label: string; days: number | null; tooltip: string } {
		if (!ts) return { label: '—', days: null, tooltip: '' };
		const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return { label: ts, days: null, tooltip: ts };
		const days = Math.floor((Date.now() - d.getTime()) / 86400000);
		const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
		const tooltip = d.toLocaleString(undefined, {
			year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
		});
		return { label, days, tooltip };
	}

	const PLATFORMS = [
		{ key: 'squarespace', label: 'Squarespace' },
		{ key: 'reverb', label: 'Reverb' },
		{ key: 'ebay', label: 'eBay' }
	] as const;

	const STATUS_DOT: Record<string, string> = {
		live: 'bg-[color:var(--color-moss-bright)]',
		ready: 'bg-[color:var(--color-gold-bright)]',
		paused: 'bg-[color:var(--color-ink-4)]',
		error: 'bg-[color:var(--color-rust-bright)]',
		draft: 'bg-[color:var(--color-ink-4)]'
	};

	const pushedId = $derived(parseInt(page.url.searchParams.get('pushed') ?? '', 10));
	const savedId = $derived(parseInt(page.url.searchParams.get('saved') ?? '', 10));
	const syncedPlatform = $derived(page.url.searchParams.get('synced'));
	const syncRecorded = $derived(page.url.searchParams.get('recorded'));
	const syncSkipped = $derived(page.url.searchParams.get('skipped'));
	const syncUnmatched = $derived(page.url.searchParams.get('unmatched'));

	function withParam(key: string, value: string | null): string {
		const next = new URLSearchParams(page.url.searchParams);
		if (value == null || value === '') next.delete(key);
		else next.set(key, value);
		next.delete('pushed');
		next.delete('saved');
		const qs = next.toString();
		return qs ? `/listings?${qs}` : '/listings';
	}

	function sortHref(key: string): string {
		const next = new URLSearchParams(page.url.searchParams);
		if (data.sort.key === key) {
			next.set('dir', data.sort.dir === 'asc' ? 'desc' : 'asc');
		} else {
			next.delete('dir');
		}
		next.set('sort', key);
		next.delete('pushed');
		next.delete('saved');
		const qs = next.toString();
		return qs ? `/listings?${qs}` : '/listings';
	}

	// Sort presets shown as chips. `dir` is the explicit direction this
	// chip applies (so "Stalest" = listed asc, "Recent" = listed desc).
	const SORT_PRESETS = [
		{ key: 'listed', dir: 'desc', label: 'Recently listed' },
		{ key: 'listed', dir: 'asc', label: 'Stalest first' },
		{ key: 'base', dir: 'desc', label: 'Base price' },
		{ key: 'sold', dir: 'asc', label: 'Sold first' },
		{ key: 'item', dir: 'asc', label: 'Item A–Z' }
	] as const;
	function presetHref(key: string, dir: string): string {
		const next = new URLSearchParams(page.url.searchParams);
		next.set('sort', key);
		next.set('dir', dir);
		next.delete('pushed');
		next.delete('saved');
		return `/listings?${next.toString()}`;
	}
	function presetActive(key: string, dir: string): boolean {
		return data.sort.key === key && data.sort.dir === dir;
	}

	const PLATFORM_FILTERS = ['', 'squarespace', 'reverb', 'ebay'];
	const PLATFORM_FILTER_LABEL: Record<string, string> = {
		'': 'All',
		squarespace: 'Squarespace',
		reverb: 'Reverb',
		ebay: 'eBay'
	};
</script>

<!--
	Platform price cell — rendered once per platform per item. `p` is the
	listing for that platform (or undefined if the item isn't listed there).
	A single "Update" button saves the new price AND pushes it live.
-->
{#snippet platformCell(p: PageData['items'][number]['platforms'][string] | undefined, sku: string, platformKey: string)}
	{#if p}
		{@const li = listedInfo(p.listed_at)}
		{@const stale = p.status === 'live' && li.days != null && li.days >= 30}
		{@const rowErr = form?.priceError && form?.listingId === p.listing_id}
		<div class="space-y-1">
			<form method="POST" action="?/updatePrice" class="space-y-1">
				<input type="hidden" name="listing_id" value={p.listing_id} />
				<div class="flex items-center gap-1">
					<span class="text-[color:var(--color-ink-4)]">$</span>
					<input
						name="price"
						type="number"
						step="0.01"
						min="0"
						value={p.listing_price_cents != null ? (p.listing_price_cents / 100).toFixed(2) : ''}
						class="field min-w-0 flex-1 py-1 text-sm"
						style="min-height: 30px"
						aria-label="{platformKey} price for {sku}"
					/>
				</div>
				<button
					type="submit"
					class="btn-primary w-full px-2 py-1 text-[10px]"
					title="Save and push this price live to the platform"
					disabled={!p.external_id}
				>
					Update price
				</button>
			</form>
			<div class="flex items-center gap-1.5 text-[10px] text-[color:var(--color-ink-4)] whitespace-nowrap">
				<span class="inline-block h-1.5 w-1.5 rounded-full {STATUS_DOT[p.status] ?? 'bg-[color:var(--color-ink-4)]'}" title={p.status}></span>
				{#if li.days != null}
					<!-- Listed date + age. The date is the stable "date listed";
						 the (Nd) is its age, red once stale. -->
					<span title={li.tooltip}>
						{li.label}
						<span class="font-mono" class:text-[color:var(--color-rust-bright)]={stale}>
							({li.days}d{stale ? ' · stale' : ''})
						</span>
					</span>
				{:else}
					<span class="italic">not yet listed</span>
				{/if}
				{#if p.external_url}
					<a href={p.external_url} target="_blank" rel="noopener" class="hover:text-[color:var(--color-gold-bright)] hover:underline">↗</a>
				{/if}
			</div>
			{#if rowErr}
				<p class="text-[10px] text-[color:var(--color-rust-bright)]">{form?.priceError}</p>
			{:else if !p.external_id}
				<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
					<a href="/items/{encodeURIComponent(sku)}/listings/{platformKey}" class="underline hover:text-[color:var(--color-gold-bright)]">publish</a>
				</p>
			{/if}
		</div>
	{:else}
		<!-- "List" is a distinct affordance from "Update price": a dashed
			 outline reads as "create something new here", vs the solid
			 gold Update which acts on an existing listing. Same palette,
			 different shape — on-theme but clearly differentiated. -->
		<a
			href="/items/{encodeURIComponent(sku)}/listings/{platformKey}"
			class="inline-flex items-center gap-1 rounded border border-dashed border-[color:var(--color-line-bright)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--color-ink-3)] transition-colors hover:border-[color:var(--color-gold)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-gold-bright)]"
			title="Not listed on {platformKey} — open the editor to create it"
		>
			<span class="text-sm leading-none">+</span> List
		</a>
	{/if}
{/snippet}

<section class="space-y-5">
	<header class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
		<p class="eyebrow">Across all marketplaces</p>
		<h1 class="headline text-3xl inline-flex items-baseline gap-2">
			Listings
			<InfoTip title="The single pane of glass">
				<p>
					One row per item, with its Squarespace / Reverb / eBay prices side by side.
					Prices differ per platform (each grosses up for that platform's fees), so you
					can compare and re-price any of them on the fly — clicking <strong>Update</strong>
					saves the price and pushes it live to that platform.
				</p>
				<p>
					Watch the per-platform <strong>days counter</strong>: live, in stock, 30+ days
					(red "stale") = a candidate to re-price. <strong>Sold</strong> counts units
					that moved (from the movement ledger) against current on-hand.
				</p>
			</InfoTip>
		</h1>
		</div>

		<!-- Sales sync. Each pulls that platform's orders → writes 'sale'
			 movements → on-hand + sold counts update. eBay lands once its
			 sell.fulfillment scope is re-authorized. -->
		<div class="flex flex-col gap-2">
			<form method="POST" action="?/syncSquarespaceSales">
				<button
					type="submit"
					class="btn-ghost w-full px-4 py-2 text-sm whitespace-nowrap"
					title="Pull recent Squarespace orders and update on-hand + sold counts"
				>
					↻ Sync sales from Squarespace
				</button>
			</form>
			<form method="POST" action="?/syncReverbSales">
				<button
					type="submit"
					class="btn-ghost w-full px-4 py-2 text-sm whitespace-nowrap"
					title="Pull recent Reverb orders and update on-hand + sold counts"
				>
					↻ Sync sales from Reverb
				</button>
			</form>
			<form method="POST" action="?/syncEbaySales">
				<button
					type="submit"
					class="btn-ghost w-full px-4 py-2 text-sm whitespace-nowrap"
					title="Pull recent eBay orders and update on-hand + sold counts (needs eBay re-authorized for order access)"
				>
					↻ Sync sales from eBay
				</button>
			</form>
			<a
				href="/listings/cleanup"
				class="btn-ghost w-full px-4 py-2 text-center text-sm whitespace-nowrap"
				title="Find and remove duplicate Squarespace listings left by earlier crashed pushes"
			>
				🧹 Clean up duplicate listings
			</a>
		</div>
	</header>

	<!-- Summary tiles -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="panel px-4 py-3">
			<p class="eyebrow">Live listings</p>
			<p class="mt-1 font-mono text-2xl text-[color:var(--color-ink)]">{data.summary.live}</p>
		</div>
		<div class="panel px-4 py-3">
			<p class="eyebrow">Listed value</p>
			<p class="mt-1 font-mono text-2xl text-[color:var(--color-gold-bright)]">{fmtPrice(data.summary.totalListedValueCents)}</p>
		</div>
		<div class="panel px-4 py-3">
			<p class="eyebrow">Sold / out</p>
			<p class="mt-1 font-mono text-2xl text-[color:var(--color-moss-bright)]">{data.summary.sold}</p>
		</div>
		<div class="panel px-4 py-3" title="Live, in stock, listed 30+ days ago, never sold">
			<p class="eyebrow">Stale (30d+)</p>
			<p class="mt-1 font-mono text-2xl" class:text-[color:var(--color-rust-bright)]={data.summary.stale > 0} class:text-[color:var(--color-ink-3)]={data.summary.stale === 0}>{data.summary.stale}</p>
		</div>
	</div>

	<!-- Controls: platform filter + sort presets -->
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
		<div class="flex items-center gap-2">
			<span class="eyebrow">Platform</span>
			{#each PLATFORM_FILTERS as p (p)}
				{@const active = data.filters.platform === p}
				<a
					href={withParam('platform', p)}
					class="rounded-full border px-3 py-1 transition-colors {active
						? 'border-[color:var(--color-gold)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
						: 'border-[color:var(--color-line)] text-[color:var(--color-ink-3)] hover:bg-[color:var(--color-hover)]'}"
				>
					{PLATFORM_FILTER_LABEL[p]}
				</a>
			{/each}
		</div>
		<div class="flex items-center gap-2">
			<span class="eyebrow">Sort</span>
			{#each SORT_PRESETS as s (s.label)}
				{@const active = presetActive(s.key, s.dir)}
				<a
					href={presetHref(s.key, s.dir)}
					class="rounded-full border px-3 py-1 transition-colors {active
						? 'border-[color:var(--color-gold)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
						: 'border-[color:var(--color-line)] text-[color:var(--color-ink-3)] hover:bg-[color:var(--color-hover)]'}"
				>
					{s.label}
				</a>
			{/each}
		</div>
	</div>

	<!-- Banners -->
	{#if pushedId}
		<div class="panel px-4 py-2" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">✓ Price updated and pushed live to the platform.</p>
		</div>
	{:else if savedId}
		<div class="panel px-4 py-2" style="border-color: var(--color-gold-dim)">
			<p class="text-sm text-[color:var(--color-gold-bright)]">
				Price saved, but this listing isn't published yet — use the platform editor's Publish first.
			</p>
		</div>
	{/if}
	{#if form?.priceError}
		<div class="panel px-4 py-2" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.priceError}</p>
		</div>
	{/if}
	{#if form?.syncError}
		<div class="panel px-4 py-2" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">Sync failed: {form.syncError}</p>
		</div>
	{/if}
	{#if syncedPlatform === 'squarespace' || syncedPlatform === 'reverb' || syncedPlatform === 'ebay'}
		{@const platformName =
			syncedPlatform === 'reverb' ? 'Reverb' : syncedPlatform === 'ebay' ? 'eBay' : 'Squarespace'}
		<div class="panel px-4 py-2" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				✓ Synced {platformName} sales —
				{syncRecorded} new sale{syncRecorded === '1' ? '' : 's'} recorded
				{#if Number(syncSkipped) > 0}· {syncSkipped} already counted{/if}
				{#if Number(syncUnmatched) > 0}
					<span class="text-[color:var(--color-gold-bright)]">· {syncUnmatched} order(s) didn't match an item</span>
				{/if}.
			</p>
		</div>
	{/if}

	{#if data.items.length === 0}
		<div class="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">No listings yet.</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				Push an item to Squarespace, Reverb, or eBay and it'll show up here.
			</p>
		</div>
	{:else}
		<div class="panel overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]">
					<tr class="text-left">
						<th class="eyebrow w-12 px-2 py-2.5"></th>
						<th class="eyebrow px-3 py-2.5">
							<a href={sortHref('item')} class="hover:text-[color:var(--color-gold-bright)]">Item{data.sort.key === 'item' ? (data.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</a>
						</th>
						<th class="eyebrow px-3 py-2.5 text-right">Base</th>
						{#each PLATFORMS as pf (pf.key)}
							<th class="eyebrow px-3 py-2.5" style="min-width: 11rem">{pf.label}</th>
						{/each}
						<th class="eyebrow px-3 py-2.5">Sold / On hand</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.items as it (it.item_id)}
						<tr class="align-top transition-colors hover:bg-[color:var(--color-hover)]">
							<td class="px-2 py-2">
								{#if it.thumb_r2_key}
									<img src="/api/photos/{it.thumb_r2_key}" alt="" class="h-11 w-11 rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] object-cover" loading="lazy" />
								{:else}
									<div class="flex h-11 w-11 items-center justify-center rounded border border-dashed border-[color:var(--color-line-dim)] text-[9px] italic text-[color:var(--color-ink-4)]">—</div>
								{/if}
							</td>
							<td class="px-3 py-2" style="max-width: 15rem">
								<a
									href="/items/{encodeURIComponent(it.sku)}"
									class="block text-xs font-medium leading-tight text-[color:var(--color-ink)] hover:text-[color:var(--color-gold-bright)]"
								>
									{it.item_title}
								</a>
								<div class="mt-0.5 font-mono text-[10px] text-[color:var(--color-gold)]">{it.sku}</div>
							</td>
							<td class="px-3 py-2 text-right font-mono text-xs text-[color:var(--color-ink-3)]">{fmtPrice(it.base_price_cents)}</td>
							{#each PLATFORMS as pf (pf.key)}
								<td class="px-3 py-2" style="min-width: 11rem">{@render platformCell(it.platforms[pf.key], it.sku, pf.key)}</td>
							{/each}
							<td class="px-3 py-2 whitespace-nowrap">
								<!-- Sold count (cumulative, from the movement ledger) vs
									 current on-hand. e.g. "1 sold / 11 on hand". -->
								<div class="font-mono text-[11px]">
									{#if it.sold_qty > 0}
										<span class="text-[color:var(--color-moss-bright)]">{it.sold_qty} sold</span>
										<span class="text-[color:var(--color-ink-4)]"> / </span>
									{/if}
									<span
										class={it.stock_qty === 0
											? 'text-[color:var(--color-gold-bright)]'
											: 'text-[color:var(--color-ink-2)]'}
									>
										{it.stock_qty} on hand
									</span>
								</div>
								{#if it.stock_qty === 0}
									<span class="pill pill-success mt-1 text-[9px]">Out of stock</span>
								{/if}
								{#if it.last_sold_at}
									{@const s = listedInfo(it.last_sold_at)}
									<div class="mt-0.5 text-[9px] text-[color:var(--color-ink-4)]" title={s.tooltip}>
										last sold {s.label}
									</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p class="text-[11px] italic text-[color:var(--color-ink-4)]">
			{data.summary.items} item{data.summary.items === 1 ? '' : 's'} listed. Each platform's price is
			independent — type a new price and click <strong class="not-italic">Update</strong> to push it
			live there. <strong class="not-italic">+ list</strong> opens the editor to add a platform.
			Title / description / photo changes live in each platform's editor.
		</p>
	{/if}
</section>
