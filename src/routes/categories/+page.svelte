<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Taxonomy</p>
		<h1 class="headline text-3xl">Categories</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			The two-letter code prefixes each SKU. Categories marked for sync also push to Squarespace.
		</p>
	</header>

	<div class="panel overflow-hidden">
		<table class="w-full text-sm">
			<thead class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]">
				<tr class="text-left">
					<th class="eyebrow px-3 py-2.5">Code</th>
					<th class="eyebrow px-3 py-2.5">Name</th>
					<th class="eyebrow px-3 py-2.5">Squarespace</th>
					<th class="eyebrow px-3 py-2.5 text-right">On hand</th>
					<th class="eyebrow px-3 py-2.5 text-right">All time</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-[color:var(--color-line-dim)]">
				{#each data.categories as cat (cat.id)}
					<tr
						class="cursor-pointer transition-colors hover:bg-[color:var(--color-hover)]"
						onclick={() =>
							(window.location.href = `/items?category=${encodeURIComponent(cat.code)}`)}
						title="View items in {cat.name}"
					>
						<td class="px-3 py-2.5">
							<a
								href="/items?category={encodeURIComponent(cat.code)}"
								class="font-mono text-sm text-[color:var(--color-gold)] hover:text-[color:var(--color-gold-bright)]"
								onclick={(e) => e.stopPropagation()}
							>
								{cat.code}
							</a>
						</td>
						<td class="px-3 py-2.5">
							<div class="font-medium text-[color:var(--color-ink)]">{cat.name}</div>
							{#if cat.description}
								<div class="text-xs text-[color:var(--color-ink-3)]">{cat.description}</div>
							{/if}
						</td>
						<td class="px-3 py-2.5">
							{#if cat.syncs_to_squarespace}
								<span class="pill pill-success">Sync</span>
							{:else}
								<span class="pill">Internal</span>
							{/if}
						</td>
						<td class="px-3 py-2.5 text-right font-mono text-[color:var(--color-ink)]">
							{cat.on_hand_count}
						</td>
						<td
							class="px-3 py-2.5 text-right font-mono text-xs text-[color:var(--color-ink-3)]"
						>
							{cat.item_count}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<p class="text-xs italic text-[color:var(--color-ink-4)]">
		Editor for adding new categories lands once we've imported Squarespace and know which taxonomy
		gaps actually exist.
	</p>
</section>
