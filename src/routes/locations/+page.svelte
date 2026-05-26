<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section class="space-y-6">
	<header class="flex items-end justify-between gap-4">
		<div class="space-y-1">
			<p class="eyebrow">Where things live</p>
			<h1 class="headline text-3xl">Locations</h1>
		</div>
		<!-- "+ Add location" lands when we build the multi-location editor -->
	</header>

	<div class="grid gap-3 sm:grid-cols-2">
		{#each data.locations as loc (loc.id)}
			<div class="panel flex flex-col gap-2 px-5 py-4">
				<div class="flex items-baseline justify-between">
					<div>
						<p class="eyebrow">{loc.code}</p>
						<h2 class="headline text-xl">{loc.name}</h2>
					</div>
					<span
						class="font-mono text-xs text-[color:var(--color-ink-3)]"
						title="Bins inside this location"
					>
						{loc.bin_count}
						{loc.bin_count === 1 ? 'bin' : 'bins'}
					</span>
				</div>
				<p class="text-xs italic text-[color:var(--color-ink-4)]">
					Bin editor coming next — for now bins are seeded via the import / migration.
				</p>
			</div>
		{/each}
	</div>
</section>
