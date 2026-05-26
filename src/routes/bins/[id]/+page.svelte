<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const CONDITION_LABEL: Record<string, string> = {
		N: 'New',
		U: 'Used',
		R: 'Refurbished',
		B: 'For parts'
	};
	const CONDITION_PILL: Record<string, string> = {
		N: 'pill-success',
		U: 'pill',
		R: 'pill-warn',
		B: 'pill-danger'
	};

	function printLabel() {
		window.open(`/api/labels/bin/${data.bin.id}`, '_blank');
	}
</script>

<section class="space-y-6">
	<header class="space-y-2">
		<a
			href={data.meta.parent_bin_id
				? `/bins/${data.meta.parent_bin_id}`
				: `/locations/${data.meta.location_id}`}
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← {data.meta.parent_bin_id ? 'Parent bin' : data.meta.loc_name}
		</a>

		<p class="font-mono text-xs text-[color:var(--color-ink-3)]">{data.bin.path}</p>
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
			<p class="font-mono text-2xl text-[color:var(--color-gold)]">{data.bin.code}</p>
			{#if data.bin.name}
				<h1 class="headline text-2xl">{data.bin.name}</h1>
			{/if}
		</div>
		{#if data.bin.notes}
			<p class="text-sm italic text-[color:var(--color-ink-3)]">{data.bin.notes}</p>
		{/if}

		<div class="flex items-center gap-2 pt-2">
			<button type="button" class="btn-ghost px-3 py-1.5 text-xs" onclick={printLabel}>
				Print bin label
			</button>
		</div>
	</header>

	<!-- ============= Nested bins ============= -->
	{#if data.children.length > 0}
		<section class="space-y-2">
			<p class="eyebrow">Contains {data.children.length} bin{data.children.length === 1 ? '' : 's'}</p>
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.children as child (child.id)}
					<a
						href="/bins/{child.id}"
						class="panel flex items-baseline gap-3 px-3 py-2 transition-colors hover:border-[color:var(--color-gold-dim)]"
					>
						<span class="font-mono text-sm text-[color:var(--color-gold)]">{child.code}</span>
						<span class="text-sm text-[color:var(--color-ink-2)]">{child.name ?? ''}</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- ============= Items in this bin ============= -->
	<section class="space-y-2">
		<p class="eyebrow">
			{data.items.length} item{data.items.length === 1 ? '' : 's'} on hand
		</p>
		{#if data.items.length === 0}
			<div class="panel px-6 py-12 text-center">
				<p class="text-sm italic text-[color:var(--color-ink-3)]">
					Nothing currently stored here.
				</p>
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
							<th class="eyebrow px-3 py-2.5 text-right">Qty</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[color:var(--color-line-dim)]">
						{#each data.items as item (item.id)}
							<tr class="transition-colors hover:bg-[color:var(--color-hover)]">
								<td class="px-3 py-2.5">
									<a
										href="/items/{encodeURIComponent(item.sku)}"
										class="font-mono text-xs text-[color:var(--color-gold)] hover:text-[color:var(--color-gold-bright)]"
									>
										{item.sku}
									</a>
								</td>
								<td class="px-3 py-2.5">
									<div class="text-[color:var(--color-ink)]">{item.title}</div>
									<div class="text-xs text-[color:var(--color-ink-3)]">
										{item.cat_code} · {item.cat_name}
									</div>
								</td>
								<td class="px-3 py-2.5">
									<span class={CONDITION_PILL[item.condition] ?? 'pill'}>
										{CONDITION_LABEL[item.condition] ?? item.condition}
									</span>
								</td>
								<td class="px-3 py-2.5 text-right font-mono text-[color:var(--color-ink)]">
									{item.tracking_mode === 'stocked' ? item.stock_qty : 1}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</section>
