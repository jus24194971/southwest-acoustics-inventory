<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section class="space-y-8">
	<header class="space-y-2">
		<p class="eyebrow">Shop floor at a glance</p>
		<h1 class="headline text-3xl">The current state of the bench.</h1>
		<p class="max-w-xl text-sm text-[color:var(--color-ink-3)]">
			One row per part. One source of truth. Squarespace mirrors what lives here — never the
			other way around.
		</p>
	</header>

	<!-- Stat tiles. Each links to its detail view where applicable. -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<a
			href="/items"
			class="panel group flex flex-col gap-1 px-4 py-4 transition-colors hover:border-[color:var(--color-gold-dim)]"
		>
			<span class="eyebrow">Items on hand</span>
			<span
				class="headline text-3xl text-[color:var(--color-ink)] transition-colors group-hover:text-[color:var(--color-gold-bright)]"
			>
				{data.stats.itemsOnHand}
			</span>
		</a>
		<a
			href="/locations"
			class="panel group flex flex-col gap-1 px-4 py-4 transition-colors hover:border-[color:var(--color-gold-dim)]"
		>
			<span class="eyebrow">Locations</span>
			<span
				class="headline text-3xl text-[color:var(--color-ink)] transition-colors group-hover:text-[color:var(--color-gold-bright)]"
			>
				{data.stats.locations}
			</span>
		</a>
		<a
			href="/categories"
			class="panel group flex flex-col gap-1 px-4 py-4 transition-colors hover:border-[color:var(--color-gold-dim)]"
		>
			<span class="eyebrow">Categories</span>
			<span
				class="headline text-3xl text-[color:var(--color-ink)] transition-colors group-hover:text-[color:var(--color-gold-bright)]"
			>
				{data.stats.categories}
			</span>
		</a>
		<a
			href="/movements"
			class="panel group flex flex-col gap-1 px-4 py-4 transition-colors hover:border-[color:var(--color-gold-dim)]"
		>
			<span class="eyebrow">Movements</span>
			<span
				class="headline text-3xl text-[color:var(--color-ink)] transition-colors group-hover:text-[color:var(--color-gold-bright)]"
			>
				{data.stats.movements}
			</span>
		</a>
	</div>

	<!-- Primary action area. -->
	<div class="flex flex-wrap items-center gap-3">
		<a href="/items/new" class="btn-primary">+ Add item</a>
		<a href="/items" class="btn-ghost">Browse all items</a>
	</div>
</section>
