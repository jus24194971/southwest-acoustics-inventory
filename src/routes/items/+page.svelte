<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatPrice(cents: number | null): string {
		if (cents == null) return '—';
		return `$${(cents / 100).toFixed(2)}`;
	}
</script>

<section class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold tracking-tight">Items</h1>
		<a
			href="/items/new"
			class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
		>
			+ Add item
		</a>
	</div>

	{#if data.items.length === 0}
		<div class="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
			<p>No items yet.</p>
			<p class="mt-1 text-sm">Add your first one to get started.</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
					<tr>
						<th class="px-3 py-2">SKU</th>
						<th class="px-3 py-2">Title</th>
						<th class="px-3 py-2">Where</th>
						<th class="px-3 py-2 text-right">Price</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.items as item (item.id)}
						<tr class={item.retired_at ? 'text-slate-400' : ''}>
							<td class="px-3 py-2 font-mono text-xs">{item.sku}</td>
							<td class="px-3 py-2">
								<div class="font-medium">{item.title}</div>
								<div class="text-xs text-slate-500">
									{item.category_name}{item.brand_name ? ` · ${item.brand_name}` : ''}
								</div>
							</td>
							<td class="px-3 py-2 text-xs text-slate-600">
								{#if item.location_code && item.bin_code}
									{item.location_code} / {item.bin_code}
								{:else}
									<span class="italic text-slate-400">unassigned</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-right">{formatPrice(item.price_cents)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
