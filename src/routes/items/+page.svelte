<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}

	// Map our 4 condition codes to a display + pill class. Used wherever
	// items are listed — kept here for now; lift to a shared helper if it
	// shows up in a third place.
	const CONDITION_LABEL: Record<string, string> = {
		N: 'New',
		U: 'Used',
		R: 'Refurb',
		B: 'For parts'
	};
	const CONDITION_PILL: Record<string, string> = {
		N: 'pill-success',
		U: 'pill',
		R: 'pill-warn',
		B: 'pill-danger'
	};
</script>

<section class="space-y-6">
	<header class="flex items-end justify-between gap-4">
		<div class="space-y-1">
			<p class="eyebrow">Inventory</p>
			<h1 class="headline text-3xl">Items</h1>
		</div>
		<a href="/items/new" class="btn-primary">+ Add item</a>
	</header>

	{#if data.items.length === 0}
		<div class="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">Nothing on the bench yet.</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				Add your first item to get a SKU printed and a row in the ledger.
			</p>
			<a href="/items/new" class="btn-primary mt-2">+ Add the first one</a>
		</div>
	{:else}
		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead
					class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]"
				>
					<tr class="text-left">
						<th class="eyebrow px-3 py-2.5">SKU</th>
						<th class="eyebrow px-3 py-2.5">Title</th>
						<th class="eyebrow px-3 py-2.5">Condition</th>
						<th class="eyebrow px-3 py-2.5">Where</th>
						<th class="eyebrow px-3 py-2.5 text-right">Price</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.items as item (item.id)}
						<tr
							class="transition-colors hover:bg-[color:var(--color-hover)] {item.retired_at
								? 'text-[color:var(--color-ink-4)]'
								: ''}"
						>
							<td class="px-3 py-2.5 font-mono text-xs text-[color:var(--color-gold)]">
								{item.sku}
							</td>
							<td class="px-3 py-2.5">
								<div class="font-medium text-[color:var(--color-ink)]">{item.title}</div>
								<div class="text-xs text-[color:var(--color-ink-3)]">
									{item.category_name}{item.brand_name ? ` · ${item.brand_name}` : ''}
								</div>
							</td>
							<td class="px-3 py-2.5">
								<span class={CONDITION_PILL[item.condition] ?? 'pill'}>
									{CONDITION_LABEL[item.condition] ?? item.condition}
								</span>
							</td>
							<td class="px-3 py-2.5 text-xs text-[color:var(--color-ink-2)]">
								{#if item.location_code && item.bin_code}
									<span class="font-mono">{item.location_code}</span>
									<span class="text-[color:var(--color-ink-4)]">/</span>
									<span class="font-mono">{item.bin_code}</span>
								{:else}
									<span class="italic text-[color:var(--color-ink-4)]">unassigned</span>
								{/if}
							</td>
							<td class="px-3 py-2.5 text-right font-mono text-[color:var(--color-ink)]">
								{formatPrice(item.price_cents)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
