<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Where things live</p>
		<h1 class="headline text-3xl">Locations</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Tap a location to see its bins, add new bins, or rename existing ones.
		</p>
	</header>

	<div class="grid gap-3 sm:grid-cols-2">
		{#each data.locations as loc (loc.id)}
			<a
				href="/locations/{loc.id}"
				class="panel group flex flex-col gap-2 px-5 py-4 transition-colors hover:border-[color:var(--color-gold-dim)]"
			>
				<div class="flex items-baseline justify-between">
					<div>
						<p class="eyebrow">{loc.code}</p>
						<h2
							class="headline text-xl transition-colors group-hover:text-[color:var(--color-gold-bright)]"
						>
							{loc.name}
						</h2>
					</div>
					<span class="font-mono text-xs text-[color:var(--color-ink-3)]">
						{loc.bin_count}
						{loc.bin_count === 1 ? 'bin' : 'bins'}
					</span>
				</div>
				<p class="text-xs text-[color:var(--color-ink-4)]">Manage bins →</p>
			</a>
		{/each}
	</div>
</section>
