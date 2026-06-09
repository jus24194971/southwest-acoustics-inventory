<script lang="ts">
	import type { PageData } from './$types';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data }: { data: PageData } = $props();

	const CONDITION_LABEL: Record<string, string> = {
		N: 'New',
		U: 'Used',
		R: 'Refurb',
		B: 'For parts'
	};

	function formatPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}
</script>

<section class="space-y-5">
	<header class="space-y-2">
		<a
			href="/items/{encodeURIComponent(data.keeper.sku)}"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← Back to item
		</a>
		<h1 class="headline text-3xl inline-flex items-baseline gap-2">
			Find duplicates
			<InfoTip>
				<p>
					Looking for items that might be the same as <strong>{data.keeper.sku}</strong>.
					Matches require the same category, then ranks by brand+model overlap and
					title token overlap.
				</p>
				<p>
					Picking one routes you to a side-by-side preview before the merge actually
					happens. Nothing changes until you confirm there.
				</p>
			</InfoTip>
		</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Keeper: <span class="font-mono text-[color:var(--color-gold)]"
				>{data.keeper.sku}</span
			>
			· <span class="text-[color:var(--color-ink)]">{data.keeper.title}</span>
		</p>
		{#if data.titleTokens.length > 0}
			<p class="text-[11px] italic text-[color:var(--color-ink-4)]">
				Title tokens used for matching:
				{#each data.titleTokens as t, i (t)}
					<code class="font-mono">{t}</code>{i < data.titleTokens.length - 1 ? ', ' : ''}
				{/each}
			</p>
		{/if}
	</header>

	{#if data.candidates.length === 0}
		<div class="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">
				No likely duplicates found.
			</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				Nothing else in this category shares a brand/model or title tokens. If the
				duplicate has a wildly different title, edit it to match and try again.
			</p>
		</div>
	{:else}
		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead
					class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]"
				>
					<tr class="text-left">
						<th class="eyebrow w-12 px-2 py-2.5"></th>
						<th class="eyebrow px-3 py-2.5">SKU</th>
						<th class="eyebrow px-3 py-2.5">Title</th>
						<th class="eyebrow px-3 py-2.5">Condition</th>
						<th class="eyebrow px-3 py-2.5 text-right">Qty</th>
						<th class="eyebrow px-3 py-2.5 text-right">Price</th>
						<th class="eyebrow px-3 py-2.5 text-right">Photos · Listings</th>
						<th class="eyebrow px-3 py-2.5">Why?</th>
						<th class="eyebrow w-24 px-3 py-2.5"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.candidates as c (c.id)}
						<tr
							class:opacity-60={c.retired_at != null}
							class="transition-colors hover:bg-[color:var(--color-hover)]"
						>
							<td class="px-2 py-1.5">
								{#if c.thumb_r2_key}
									<img
										src="/api/photos/{c.thumb_r2_key}"
										alt=""
										class="h-10 w-10 rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] object-cover"
										loading="lazy"
									/>
								{:else}
									<div
										class="flex h-10 w-10 items-center justify-center rounded border border-dashed border-[color:var(--color-line-dim)] text-[9px] italic text-[color:var(--color-ink-4)]"
									>
										—
									</div>
								{/if}
							</td>
							<td class="px-3 py-2.5">
								<a
									href="/items/{encodeURIComponent(c.sku)}"
									class="font-mono text-xs text-[color:var(--color-gold)] hover:text-[color:var(--color-gold-bright)]"
								>
									{c.sku}
								</a>
								{#if c.retired_at}
									<div>
										<span class="pill pill-danger text-[9px]">Retired</span>
									</div>
								{/if}
							</td>
							<td class="px-3 py-2.5 text-[color:var(--color-ink)]">{c.title}</td>
							<td class="px-3 py-2.5">
								<span class="pill text-[10px]">
									{CONDITION_LABEL[c.condition] ?? c.condition}
								</span>
							</td>
							<td class="px-3 py-2.5 text-right font-mono text-xs">{c.stock_qty}</td>
							<td class="px-3 py-2.5 text-right font-mono text-xs">{formatPrice(c.price_cents)}</td>
							<td class="px-3 py-2.5 text-right font-mono text-[11px] text-[color:var(--color-ink-3)]">
								{c.photo_count} · {c.listing_count}
							</td>
							<td class="px-3 py-2.5">
								<span
									class="text-[10px] italic"
									class:text-[color:var(--color-gold-bright)]={c.match_reason === 'Brand + model'}
								>
									{c.match_reason}
								</span>
							</td>
							<td class="px-3 py-2.5 text-right">
								<a
									href="/items/{encodeURIComponent(data.keeper.sku)}/merge/{encodeURIComponent(c.sku)}"
									class="btn-primary inline-block px-3 py-1 text-[11px]"
								>
									Preview →
								</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="panel px-4 py-3 text-[11px] text-[color:var(--color-ink-3)]">
			<p>
				<strong class="text-[color:var(--color-ink)]">Merge direction:</strong> the item
				you came from (<span class="font-mono">{data.keeper.sku}</span>) is the
				<strong>keeper</strong>. The duplicate gets absorbed into it: photos move over,
				movement history re-points, marketplace listings transfer (when the keeper
				doesn't already have one for that platform), and stock quantities sum. The
				duplicate is soft-deleted with a reference to the keeper so old URLs still
				resolve.
			</p>
		</div>
	{/if}
</section>
