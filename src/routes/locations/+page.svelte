<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let showingAddForm = $state(false);
	let renamingId = $state<number | null>(null);
</script>

<section class="space-y-6">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div class="space-y-1">
			<p class="eyebrow">Where things live</p>
			<h1 class="headline text-3xl">Locations</h1>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				Tap a location to see its bins, add new bins, or rename existing ones.
			</p>
		</div>
		{#if !showingAddForm}
			<button
				type="button"
				class="btn-primary"
				onclick={() => (showingAddForm = true)}
			>
				+ Add location
			</button>
		{/if}
	</header>

	{#if form?.actionError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.actionError}</p>
		</div>
	{/if}

	<!-- ============= Add-location form (inline) ============= -->
	{#if showingAddForm}
		<form
			method="POST"
			action="?/create"
			class="panel space-y-3 px-5 py-4"
		>
			<div class="flex items-baseline justify-between">
				<p class="eyebrow">New location</p>
				<button
					type="button"
					class="text-xs text-[color:var(--color-ink-3)] hover:text-[color:var(--color-ink)]"
					onclick={() => (showingAddForm = false)}
				>
					Cancel
				</button>
			</div>

			<div class="grid gap-3 sm:grid-cols-[140px_1fr]">
				<div class="space-y-1.5">
					<label for="code" class="eyebrow block">Code</label>
					<input
						id="code"
						name="code"
						type="text"
						required
						maxlength="4"
						minlength="2"
						placeholder="GAR"
						value={form?.createValues?.code ?? ''}
						class="field font-mono uppercase"
						style="text-transform: uppercase"
					/>
					{#if form?.createErrors?.code}
						<p class="text-xs text-[color:var(--color-rust-bright)]">{form.createErrors.code}</p>
					{:else}
						<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
							2–4 chars, uppercase, used in label codes
						</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<label for="name" class="eyebrow block">Friendly name</label>
					<input
						id="name"
						name="name"
						type="text"
						required
						placeholder="Garage Workshop"
						value={form?.createValues?.name ?? ''}
						class="field"
					/>
					{#if form?.createErrors?.name}
						<p class="text-xs text-[color:var(--color-rust-bright)]">{form.createErrors.name}</p>
					{/if}
				</div>
			</div>

			<div class="flex gap-2">
				<button type="submit" class="btn-primary">Create location</button>
			</div>
		</form>
	{/if}

	<!-- ============= Active locations ============= -->
	{#if data.locations.length === 0}
		<div class="panel flex flex-col items-center gap-2 px-6 py-12 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">No locations yet.</p>
			<p class="text-sm text-[color:var(--color-ink-3)]">
				Add one above — e.g. <span class="font-mono">GAR</span> for the garage workshop.
			</p>
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each data.locations as loc (loc.id)}
				<div
					class="panel group flex flex-col gap-3 px-5 py-4 transition-colors hover:border-[color:var(--color-gold-dim)]"
				>
					<div class="flex items-baseline justify-between">
						<div class="min-w-0 flex-1">
							<p class="eyebrow">{loc.code}</p>
							{#if renamingId === loc.id}
								<form
									method="POST"
									action="?/rename"
									class="mt-1 flex gap-1.5"
									onsubmit={() => (renamingId = null)}
								>
									<input type="hidden" name="id" value={loc.id} />
									<input
										name="name"
										type="text"
										required
										value={loc.name}
										class="field flex-1 py-1 text-sm"
									/>
									<button type="submit" class="btn-primary px-2 py-1 text-xs">Save</button>
									<button
										type="button"
										class="btn-ghost px-2 py-1 text-xs"
										onclick={(e) => {
											e.preventDefault();
											renamingId = null;
										}}
									>
										✕
									</button>
								</form>
							{:else}
								<a
									href="/locations/{loc.id}"
									class="block min-w-0"
								>
									<h2
										class="headline text-xl transition-colors group-hover:text-[color:var(--color-gold-bright)]"
									>
										{loc.name}
									</h2>
								</a>
							{/if}
						</div>
						<span class="ml-2 font-mono text-xs text-[color:var(--color-ink-3)]">
							{loc.bin_count}
							{loc.bin_count === 1 ? 'bin' : 'bins'}
						</span>
					</div>

					<div class="flex items-center gap-2 border-t border-[color:var(--color-line-dim)] pt-2 text-xs">
						<a
							href="/locations/{loc.id}"
							class="text-[color:var(--color-gold-bright)] hover:underline"
						>
							Manage bins →
						</a>
						{#if renamingId !== loc.id}
							<button
								type="button"
								class="ml-auto text-[color:var(--color-ink-3)] hover:text-[color:var(--color-ink)]"
								onclick={() => (renamingId = loc.id)}
								title="Rename"
							>
								Rename
							</button>
							<form
								method="POST"
								action="?/retire"
								onsubmit={(e) => {
									if (
										!confirm(
											`Retire "${loc.name}"? Its ${loc.bin_count} bin${loc.bin_count === 1 ? '' : 's'} will hide from pickers. You can unretire later.`
										)
									) {
										e.preventDefault();
									}
								}}
							>
								<input type="hidden" name="id" value={loc.id} />
								<button
									type="submit"
									class="text-[color:var(--color-ink-3)] hover:text-[color:var(--color-rust-bright)]"
									title="Retire"
								>
									Retire
								</button>
							</form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- ============= Retired locations ============= -->
	{#if data.retiredLocations.length > 0}
		<section class="space-y-3">
			<div class="flex items-baseline gap-2">
				<p class="eyebrow text-[color:var(--color-rust-bright)]">Retired</p>
				<p class="text-xs italic text-[color:var(--color-ink-4)]">
					Hidden from pickers and search. Unretire to bring back.
				</p>
			</div>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each data.retiredLocations as loc (loc.id)}
					<div
						class="panel flex items-center gap-3 px-4 py-2.5 opacity-70"
					>
						<div class="min-w-0 flex-1">
							<p class="font-mono text-xs text-[color:var(--color-ink-3)]">{loc.code}</p>
							<p class="truncate text-sm text-[color:var(--color-ink-2)]">{loc.name}</p>
						</div>
						<form method="POST" action="?/unretire">
							<input type="hidden" name="id" value={loc.id} />
							<button type="submit" class="btn-ghost px-2 py-1 text-xs">Unretire</button>
						</form>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</section>
