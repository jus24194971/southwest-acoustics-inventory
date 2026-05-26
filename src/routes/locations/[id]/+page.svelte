<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import type { BinTreeRow } from './+page.server';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local UI state for inline editors + the bin tree view.
	let editingBinId = $state<number | null>(null);
	let showSingleAdd = $state(false);
	let showBulkAdd = $state(false);
	let addParentId = $state<number | null>(null);

	// Track which nodes are collapsed (set of bin IDs). Default = all
	// expanded so Dad sees the full tree on first load; he can collapse
	// deep cabinets as he wants. This is purely client-side; not
	// persisted between visits — easy to add later if needed.
	let collapsedIds = $state<Set<number>>(new Set());

	// Pre-compute which bins have at least one child, since we render
	// a chevron only on those. Cheaper than checking on every render.
	let hasChildren = $derived.by(() => {
		const set = new Set<number>();
		for (const b of data.bins) {
			if (b.parent_bin_id != null) set.add(b.parent_bin_id);
		}
		return set;
	});

	// Filter the bins list to hide descendants of collapsed parents.
	// Walk the depth-first ordered list; when a collapsed bin is hit,
	// skip every following row that's deeper than it until we get back
	// to its depth.
	let visibleBins = $derived.by(() => {
		const out: BinTreeRow[] = [];
		let collapseDepth: number | null = null;
		for (const b of data.bins) {
			if (collapseDepth != null && b.depth > collapseDepth) continue;
			collapseDepth = null;
			out.push(b);
			if (collapsedIds.has(b.id)) collapseDepth = b.depth;
		}
		return out;
	});

	function toggleCollapse(id: number) {
		const next = new Set(collapsedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		collapsedIds = next;
	}

	function openAddChild(parentBinId: number) {
		addParentId = parentBinId;
		showSingleAdd = true;
		showBulkAdd = false;
		// Scroll to the form so the parent context is visually obvious.
		setTimeout(() => document.getElementById('bin-add-form')?.scrollIntoView({ behavior: 'smooth' }), 50);
	}

	function openAddRoot() {
		addParentId = null;
		showSingleAdd = !showSingleAdd;
		if (showSingleAdd) showBulkAdd = false;
	}

	function parentLabel(id: number | null): string {
		if (id == null) return '(root of location)';
		const b = data.bins.find((x) => x.id === id);
		return b ? b.path : '(unknown parent)';
	}
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

	<!-- ============= Add toolbar ============= -->
	<div class="flex flex-wrap items-center gap-3">
		<button type="button" class="btn-primary" onclick={openAddRoot}>
			{showSingleAdd && addParentId == null ? '✕ Close' : '+ Add bin'}
		</button>
		<button
			type="button"
			class="btn-ghost"
			onclick={() => {
				showBulkAdd = !showBulkAdd;
				if (showBulkAdd) showSingleAdd = false;
			}}
		>
			{showBulkAdd ? '✕ Close bulk add' : 'Bulk add (A-1 through A-10)'}
		</button>
		<p class="text-xs italic text-[color:var(--color-ink-3)]">
			Bins nest — add a parent first (like "Main Parts Cabinet"), then add children under it.
		</p>
	</div>

	<!-- ============= Single-add form ============= -->
	{#if showSingleAdd}
		<form
			id="bin-add-form"
			method="POST"
			action="?/addBin"
			class="panel space-y-3 px-6 py-5"
		>
			{#if addParentId != null}
				<input type="hidden" name="parent_bin_id" value={addParentId} />
				<p class="text-xs text-[color:var(--color-ink-3)]">
					Adding under:
					<span class="font-mono text-[color:var(--color-gold)]"
						>{parentLabel(addParentId)}</span
					>
					<button
						type="button"
						class="ml-2 underline hover:text-[color:var(--color-gold-bright)]"
						onclick={() => (addParentId = null)}>change</button
					>
				</p>
			{:else}
				<div class="space-y-1.5">
					<label for="parent_bin_id_single" class="eyebrow block">Parent (optional)</label>
					<select id="parent_bin_id_single" name="parent_bin_id" class="field">
						<option value="">(root — top-level bin in this location)</option>
						{#each data.bins as b (b.id)}
							<option value={b.id}>{b.path}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="grid gap-3 sm:grid-cols-[150px_1fr_2fr_auto]">
				<div class="space-y-1.5">
					<label for="code" class="eyebrow block">Code</label>
					<input
						id="code"
						name="code"
						type="text"
						required
						placeholder="A-12 or DRAWER-1"
						class="field font-mono uppercase"
					/>
				</div>
				<div class="space-y-1.5">
					<label for="name" class="eyebrow block">
						Name <span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(opt)</span>
					</label>
					<input id="name" name="name" type="text" placeholder="Main parts cabinet…" class="field" />
				</div>
				<div class="space-y-1.5">
					<label for="notes" class="eyebrow block">
						Notes
						<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(opt)</span>
					</label>
					<input id="notes" name="notes" type="text" class="field" />
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

	<!-- ============= Bulk-add form ============= -->
	{#if showBulkAdd}
		<form method="POST" action="?/addBulk" class="panel space-y-3 px-6 py-5">
			<div class="space-y-1.5">
				<label for="parent_bin_id_bulk" class="eyebrow block">Parent (optional)</label>
				<select id="parent_bin_id_bulk" name="parent_bin_id" class="field">
					<option value="">(root — top-level bins in this location)</option>
					{#each data.bins as b (b.id)}
						<option value={b.id}>{b.path}</option>
					{/each}
				</select>
				<p class="text-[11px] text-[color:var(--color-ink-3)]">
					Pick a parent if you want the new bins to nest inside an existing one.
				</p>
			</div>
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
	{/if}

	<!-- ============= Bin tree ============= -->
	{#if data.bins.length === 0}
		<div class="panel px-6 py-12 text-center">
			<p class="headline text-xl text-[color:var(--color-ink-2)]">No bins yet.</p>
			<p class="mt-2 text-sm text-[color:var(--color-ink-3)]">
				Add a top-level bin like "Main Parts Cabinet" — then you can nest drawers and bins inside it.
			</p>
		</div>
	{:else}
		<div class="panel overflow-hidden">
			<ul class="divide-y divide-[color:var(--color-line-dim)]">
				{#each visibleBins as bin (bin.id)}
					{@const indent = bin.depth * 24}
					{@const isExpandable = hasChildren.has(bin.id)}
					{@const isCollapsed = collapsedIds.has(bin.id)}
					{#if editingBinId === bin.id}
						<li class="bg-[color:var(--color-hover)] px-3 py-3">
							<form method="POST" action="?/editBin" class="space-y-2">
								<input type="hidden" name="bin_id" value={bin.id} />
								<div class="grid gap-2 sm:grid-cols-[140px_1fr_2fr_auto_auto]">
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
								</div>
							</form>
						</li>
					{:else}
						<li
							class="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[color:var(--color-hover)]"
							style="padding-left: {indent + 12}px"
						>
							<!-- Chevron (only on rows with children) -->
							{#if isExpandable}
								<button
									type="button"
									onclick={() => toggleCollapse(bin.id)}
									class="flex h-5 w-5 flex-shrink-0 items-center justify-center text-xs text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
									title={isCollapsed ? 'Expand' : 'Collapse'}
								>
									{isCollapsed ? '▶' : '▼'}
								</button>
							{:else}
								<span class="h-5 w-5 flex-shrink-0 text-center text-[10px] text-[color:var(--color-ink-4)]">·</span>
							{/if}

							<!-- Code (mono, gold) -->
							<span class="font-mono text-sm text-[color:var(--color-gold)]">{bin.code}</span>

							<!-- Friendly name -->
							{#if bin.name}
								<span class="text-sm text-[color:var(--color-ink)]">{bin.name}</span>
							{/if}

							<!-- Notes -->
							{#if bin.notes}
								<span class="text-xs italic text-[color:var(--color-ink-3)]">{bin.notes}</span>
							{/if}

							<!-- Spacer + item count + actions -->
							<span class="ml-auto flex flex-shrink-0 items-center gap-1.5">
								{#if bin.item_count > 0}
									<span class="font-mono text-xs text-[color:var(--color-ink-3)]">
										{bin.item_count}
										{bin.item_count === 1 ? 'item' : 'items'}
									</span>
								{/if}
								<a
									href="/api/labels/bin/{bin.id}"
									target="_blank"
									class="btn-ghost px-2 py-1 text-[11px]"
									title="Print a label for this bin"
								>
									Print
								</a>
								<button
									type="button"
									class="btn-ghost px-2 py-1 text-[11px]"
									onclick={() => openAddChild(bin.id)}
								>
									+ Child
								</button>
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
							</span>
						</li>
					{/if}
				{/each}
			</ul>
		</div>
	{/if}
</section>
