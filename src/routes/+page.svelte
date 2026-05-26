<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Shop floor at a glance</h1>
		<p class="mt-1 text-sm text-slate-600">
			One row per part, one source of truth. Squarespace mirrors what's here.
		</p>
	</div>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<a
			href="/items"
			class="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400"
		>
			<div class="text-3xl font-semibold">{data.stats.itemsOnHand}</div>
			<div class="mt-1 text-xs text-slate-500">items on hand</div>
		</a>
		<a
			href="/locations"
			class="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400"
		>
			<div class="text-3xl font-semibold">{data.stats.locations}</div>
			<div class="mt-1 text-xs text-slate-500">locations</div>
		</a>
		<div class="rounded-lg border border-slate-200 bg-white p-4">
			<div class="text-3xl font-semibold">{data.stats.categories}</div>
			<div class="mt-1 text-xs text-slate-500">categories</div>
		</div>
		<div class="rounded-lg border border-slate-200 bg-white p-4">
			<div class="text-3xl font-semibold">{data.stats.movements}</div>
			<div class="mt-1 text-xs text-slate-500">total movements</div>
		</div>
	</div>

	<div class="flex flex-wrap gap-2">
		<a
			href="/items/new"
			class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
		>
			+ Add item
		</a>
		<a
			href="/items"
			class="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100"
		>
			Browse all items
		</a>
	</div>
</section>
