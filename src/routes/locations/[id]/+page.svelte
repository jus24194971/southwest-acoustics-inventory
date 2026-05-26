<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// In-place editing state. One bin can be in edit mode at a time;
	// the bulk add panel is collapsible because most additions are one
	// at a time. Add-single is always visible because it's the most
	// common action.
	let editingBinId = $state<number | null>(null);
	let showBulkAdd = $state(false);
</script>

<section class="space-y-6">
	<header class="space-y-2">
		<a
			href="/locations"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← All locations
		</a>
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<p class="font-mono text-sm text-[color:var(--color-gold)]">{data.location.code}</p>
		</div>
		<h1 class="headline text-3xl">{data.location.name}</h1>
		{#if data.location.address}
			<p class="text-sm text-[color:var(--color-ink-3)]">{data.location.address}</p>
		{/if}
		<p class="text-xs text-[color:var(--color-ink-4)]">
			{data.bins.length} bin{data.bins.length === 1 ? '' : 's'} ·
			{data.bins.reduce((n, b) => n + b.item_count, 0)} items on hand
		</p>
	</header>

	{#if form?.actionError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.actionError}</p>
		</div>
	{/if}

	<!-- ============= Add bin ============= -->
	<div class="panel space-y-4 px-6 py-5">
		<div class="flex items-center justify-between">
			<p class="eyebrow">Add a bin</p>
			<button
				type="button"
				class="btn-ghost px-3 py-1.5 text-xs"
				onclick={() => (showBulkAdd = !showBulkAdd)}
			>
				{showBulkAdd ? 'Single bin' : 'Bulk add (A-1 through A-10)'}
			</button>
		</div>

		{#if showBulkAdd}
			<form method="POST" action="?/addBulk" class="space-y-3">
				<div class="grid gap-3 sm:grid-cols-4">
					<div class="space-y-1.5">
						<label for="prefix" class="eyebrow block">Prefix</label>
						<input
							id="prefix"
							name="prefix"
							type="text"
							required
							placeholder="A-"
							class="field font-mono uppercase"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="start" class="eyebrow block">Start</label>
						<input id="start" name="start" type="number" required value="1" min="0" class="field" />
					</div>
					<div class="space-y-1.5">
						<label for="end" class="eyebrow block">End</label>
						<input id="end" name="end" type="number" required value="10" min="0" class="field" />
					</div>
					<div class="space-y-1.5">
						<label for="pad" class="eyebrow block">Pad to (digits)</label>
						<input id="pad" name="pad" type="number" value="0" min="0" max="6" class="field" />
					</div>
				</div>
				<p class="text-xs italic text-[color:var(--color-ink-3)]">
					Creates <span class="font-mono text-[color:var(--color-ink-2)]">{`<prefix><n>`}</span>
					for every n in the range. Existing codes are skipped, so you can re-run safely. Cap of 200
					per call.
				</p>
				{#if form?.bulkError}
					<p class="text-xs text-[color:var(--color-rust-bright)]">{form.bulkError}</p>
				{/if}
				<button type="submit" class="btn-primary">Create bins</button>
			</form>
		{:else}
			<form method="POST" action="?/addBin" class="space-y-3">
				<div class="grid gap-3 sm:grid-cols-[150px_1fr_2fr_auto]">
					<div class="space-y-1.5">
						<label for="code" class="eyebrow block">Code</label>
						<input
							id="code"
							name="code"
							type="text"
							required
							placeholder="A-12"
							class="field font-mono uppercase"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="name" class="eyebrow block">
							Name <span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(opt)</span>
						</label>
						<input id="name" name="name" type="text" placeholder="Top shelf, drawer 3…" class="field" />
					</div>
					<div class="space-y-1.5">
						<label for="notes" class="eyebrow block">
							Notes
							<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(opt)</span>
						</label>
						<input id="notes" name="notes" type="text" placeholder="" class="field" />
					</div>
					<div class="flex items-end">
						<button type="submit" class="btn-primary w-full">Add</button>
					</div>
				</div>
				{#if form?.addError}
					<p class="text-xs text-[color:var(--color-rust-bright)]">{form.addError}</p>
				{/if}
			</form>
		{/if}
	</div>

	<!-- ============= Bins list ============= -->
	{#if data.bins.length === 0}
		<div class="panel px-6 py-12 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">No bins yet.</p>
			<p class="mt-2 text-sm text-[color:var(--color-ink-3)]">
				Add a bin above — bins are how items get a physical home in this location.
			</p>
		</div>
	{:else}
		<div class="panel overflow-hidden">
			<table class="w-full text-sm">
				<thead
					class="border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)]"
				>
					<tr class="text-left">
						<th class="eyebrow px-3 py-2.5">Code</th>
						<th class="eyebrow px-3 py-2.5">Name</th>
						<th class="eyebrow px-3 py-2.5">Notes</th>
						<th class="eyebrow px-3 py-2.5 text-right">Items</th>
						<th class="eyebrow px-3 py-2.5 text-right">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[color:var(--color-line-dim)]">
					{#each data.bins as bin (bin.id)}
						{#if editingBinId === bin.id}
							<tr class="bg-[color:var(--color-hover)]">
								<td colspan="5" class="px-3 py-3">
									<form method="POST" action="?/editBin" class="grid gap-2 sm:grid-cols-[140px_1fr_2fr_auto_auto]">
										<input type="hidden" name="bin_id" value={bin.id} />
										<input
											name="code"
											type="text"
											required
											value={bin.code}
											class="field font-mono uppercase"
										/>
										<input name="name" type="text" value={bin.name ?? ''} class="field" />
										<input name="notes" type="text" value={bin.notes ?? ''} class="field" />
										<button type="submit" class="btn-primary px-3 py-1.5 text-xs">Save</button>
										<button
											type="button"
											class="btn-ghost px-3 py-1.5 text-xs"
											onclick={() => (editingBinId = null)}
										>
											Cancel
										</button>
									</form>
								</td>
							</tr>
						{:else}
							<tr class="transition-colors hover:bg-[color:var(--color-hover)]">
								<td class="px-3 py-2.5 font-mono text-sm text-[color:var(--color-gold)]">
									{bin.code}
								</td>
								<td class="px-3 py-2.5 text-[color:var(--color-ink-2)]">
									{bin.name ?? ''}
								</td>
								<td class="px-3 py-2.5 text-xs italic text-[color:var(--color-ink-3)]">
									{bin.notes ?? ''}
								</td>
								<td class="px-3 py-2.5 text-right font-mono text-[color:var(--color-ink)]">
									{bin.item_count}
								</td>
								<td class="px-3 py-2.5 text-right">
									<div class="inline-flex gap-1">
										<button
											type="button"
											class="btn-ghost px-2 py-1 text-[11px]"
											onclick={() => (editingBinId = bin.id)}
										>
											Edit
										</button>
										<form method="POST" action="?/retireBin" class="inline">
											<input type="hidden" name="bin_id" value={bin.id} />
											<button
												type="submit"
												class="btn-ghost px-2 py-1 text-[11px] text-[color:var(--color-rust-bright)]"
												title="Retire (soft-delete) this bin"
											>
												Retire
											</button>
										</form>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
