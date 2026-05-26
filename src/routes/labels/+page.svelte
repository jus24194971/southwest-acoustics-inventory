<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import AttributeValueSelect from '$lib/components/AttributeValueSelect.svelte';

	let { data }: { data: PageData } = $props();

	const currentYear = new Date().getFullYear();

	// Form state — most of this mirrors /items/new since the receive
	// flow is the create flow plus a quantity + a "print N labels per
	// item" knob.
	let selectedCategoryId = $state<number | null>(null);
	let attrValues = $state<string[]>(['', '', '', '', '']);
	let trackingMode = $state<'serialized' | 'stocked'>('stocked');
	let quantity = $state(1);
	let labelsPerItem = $state(1);
	let templateCode = $state(
		untrack(
			() => data.templates.find((t) => t.is_default)?.code ?? data.templates[0]?.code ?? ''
		)
	);

	// Submission UX state.
	let submitting = $state(false);
	let lastResult = $state<{ skus: string[]; pdfUrl: string } | null>(null);
	let submitError = $state<string | null>(null);

	let activeCategory = $derived(
		data.categories.find((c) => c.id === selectedCategoryId) ?? null
	);

	let attrSlots = $derived(
		[1, 2, 3, 4, 5].map((n) => {
			const cat = activeCategory;
			const label = cat ? (cat[`attr_${n}_label` as keyof typeof cat] as string | null) : null;
			const contextKey = cat
				? (cat[`attr_${n}_context_key` as keyof typeof cat] as string | null)
				: null;
			const values = contextKey
				? data.attrValues
						.filter((v) => v.context_key === contextKey)
						.map((v) => ({ id: v.id, code: v.code, label: v.label }))
				: [];
			return { n, label, contextKey, values };
		})
	);

	function isUnq(value: string): boolean {
		return value.trim().toUpperCase() === 'UNQ';
	}

	// Total labels that will print = (items created) × (copies per).
	let totalLabels = $derived(
		trackingMode === 'serialized' ? quantity * labelsPerItem : labelsPerItem
	);

	let activeTemplate = $derived(
		data.templates.find((t) => t.code === templateCode) ?? data.templates[0]
	);

	async function onSubmit(e: Event) {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);

		submitting = true;
		submitError = null;

		try {
			const res = await fetch('/api/labels/receive', {
				method: 'POST',
				body: fd
			});

			if (!res.ok) {
				const text = await res.text();
				submitError = `Server returned ${res.status}: ${text.slice(0, 250)}`;
				return;
			}

			const skusHeader = res.headers.get('x-skus-created') ?? '';
			const skus = skusHeader ? skusHeader.split(',') : [];

			const blob = await res.blob();
			const pdfUrl = URL.createObjectURL(blob);
			lastResult = { skus, pdfUrl };

			// Open the PDF in a new tab where Dad hits Cmd/Ctrl+P with
			// the DYMO selected. New tab keeps the form page intact so
			// he can adjust quantity and re-print.
			window.open(pdfUrl, '_blank');

			// Clear quantity so accidental double-submit doesn't double up.
			quantity = 1;
		} catch (err) {
			submitError = err instanceof Error ? err.message : String(err);
		} finally {
			submitting = false;
		}
	}
</script>

<section class="mx-auto max-w-3xl space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Receive & print</p>
		<h1 class="headline text-3xl">Receive stock + print labels</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Describe what's coming in, pick where it goes, set how many. We create the inventory row(s)
			and hand you a PDF ready to print on the DYMO.
		</p>
	</header>

	{#if lastResult}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">
				Created {lastResult.skus.length} item{lastResult.skus.length === 1 ? '' : 's'}. PDF
				opened in a new tab — if it didn't,
				<a href={lastResult.pdfUrl} target="_blank" class="underline">click here</a>.
			</p>
			{#if lastResult.skus.length <= 6}
				<ul class="mt-2 space-y-1 text-xs">
					{#each lastResult.skus as sku (sku)}
						<li>
							<a
								href="/items/{encodeURIComponent(sku)}"
								class="font-mono text-[color:var(--color-gold)] hover:text-[color:var(--color-gold-bright)]"
							>
								{sku}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if submitError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{submitError}</p>
		</div>
	{/if}

	<form onsubmit={onSubmit} class="panel space-y-5 px-6 py-6">
		<!-- ============= What ============= -->
		<div class="space-y-1.5">
			<label for="title" class="eyebrow block">Title</label>
			<input
				id="title"
				name="title"
				type="text"
				required
				placeholder="e.g. Black Telecaster control knob"
				class="field"
			/>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="category_id" class="eyebrow block">Category</label>
				<select
					id="category_id"
					name="category_id"
					required
					bind:value={selectedCategoryId}
					class="field"
				>
					<option value={null}>— pick one —</option>
					{#each data.categories as cat (cat.id)}
						<option value={cat.id}>{cat.code} · {cat.name}</option>
					{/each}
				</select>
			</div>

			<div class="space-y-1.5">
				<label for="condition" class="eyebrow block">Condition</label>
				<select id="condition" name="condition" required class="field">
					<option value="">— pick one —</option>
					<option value="N">New</option>
					<option value="U">Used</option>
					<option value="R">Refurbished</option>
					<option value="B">Broken / for parts</option>
				</select>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<label for="brand_id" class="eyebrow block">
					Brand
					<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(optional)</span>
				</label>
				{#if data.brands.length > 0}
					<select id="brand_id" name="brand_id" class="field">
						<option value="">— none —</option>
						{#each data.brands as brand (brand.id)}
							<option value={brand.id}>{brand.code} · {brand.name}</option>
						{/each}
					</select>
				{:else}
					<input
						id="brand_code"
						name="brand_code"
						type="text"
						maxlength="3"
						placeholder="FEN"
						class="field font-mono uppercase"
					/>
				{/if}
			</div>

			<div class="space-y-1.5">
				<label for="model" class="eyebrow block">Model</label>
				<input
					id="model"
					name="model"
					type="text"
					required
					placeholder="STR"
					class="field font-mono uppercase"
				/>
			</div>
		</div>

		<!-- ============= Attributes ============= -->
		{#if attrSlots.some((s) => s.label != null)}
			<fieldset class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
				<legend class="eyebrow px-2">Attributes</legend>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each attrSlots as slot, i (slot.n)}
						{#if slot.label}
							<div class="space-y-1.5">
								<label for="attr_{slot.n}" class="eyebrow block">{slot.label}</label>
								<AttributeValueSelect
									contextKey={slot.contextKey}
									name="attr_{slot.n}"
									bind:value={attrValues[i]}
									initialValues={slot.values}
									placeholder="— no value —"
								/>
								{#if isUnq(attrValues[i])}
									<textarea
										name="attr_{slot.n}_unique_desc"
										rows="2"
										placeholder="Describe this one-of-a-kind {slot.label.toLowerCase()}…"
										class="field text-sm"
									></textarea>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</fieldset>
		{/if}

		<!-- ============= Tracking + Quantity ============= -->
		<fieldset class="grid gap-3 rounded border border-[color:var(--color-line-dim)] p-4 sm:grid-cols-3">
			<legend class="eyebrow px-2">Quantity & tracking</legend>

			<div class="space-y-1.5">
				<label for="tracking_mode" class="eyebrow block">Mode</label>
				<select
					id="tracking_mode"
					name="tracking_mode"
					bind:value={trackingMode}
					class="field"
				>
					<option value="stocked">Stocked (count)</option>
					<option value="serialized">Serialized (each unique)</option>
				</select>
			</div>

			<div class="space-y-1.5">
				<label for="quantity" class="eyebrow block">
					{trackingMode === 'serialized' ? '# of items received' : 'On-hand quantity'}
				</label>
				<input
					id="quantity"
					name="quantity"
					type="number"
					min="1"
					max="200"
					required
					bind:value={quantity}
					class="field"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="labels_per_item" class="eyebrow block">
					{trackingMode === 'serialized' ? 'Labels per item' : 'Total labels'}
				</label>
				<input
					id="labels_per_item"
					name="labels_per_item"
					type="number"
					min="1"
					max="50"
					required
					bind:value={labelsPerItem}
					class="field"
				/>
			</div>
		</fieldset>

		<p class="text-xs italic text-[color:var(--color-ink-3)]">
			{#if trackingMode === 'serialized'}
				Will create <strong class="not-italic text-[color:var(--color-ink-2)]">{quantity}</strong>
				inventory item{quantity === 1 ? '' : 's'} (each with its own unique SKU) and print
				<strong class="not-italic text-[color:var(--color-ink-2)]">{totalLabels}</strong> label{totalLabels === 1
					? ''
					: 's'}.
			{:else}
				Will create <strong class="not-italic text-[color:var(--color-ink-2)]">1</strong> stocked
				inventory item with on-hand
				<strong class="not-italic text-[color:var(--color-ink-2)]">{quantity}</strong> and print
				<strong class="not-italic text-[color:var(--color-ink-2)]">{labelsPerItem}</strong>
				identical label{labelsPerItem === 1 ? '' : 's'}.
			{/if}
		</p>

		<!-- ============= Location ============= -->
		<div class="space-y-1.5">
			<label for="bin_id" class="eyebrow block">Where does it go?</label>
			<select id="bin_id" name="bin_id" class="field">
				<option value="">— unassigned —</option>
				{#each data.bins as bin (bin.id)}
					<option value={bin.id}>{bin.path}</option>
				{/each}
			</select>
		</div>

		<!-- ============= Money + Year ============= -->
		<div class="grid grid-cols-3 gap-4">
			<div class="space-y-1.5">
				<label for="year_received" class="eyebrow block">Year</label>
				<input
					id="year_received"
					name="year_received"
					type="number"
					min="2000"
					max="2100"
					value={currentYear}
					class="field"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="cost" class="eyebrow block">Cost ($)</label>
				<input id="cost" name="cost" type="number" step="0.01" min="0" placeholder="0.00" class="field" />
			</div>
			<div class="space-y-1.5">
				<label for="price" class="eyebrow block">Price ($)</label>
				<input id="price" name="price" type="number" step="0.01" min="0" placeholder="0.00" class="field" />
			</div>
		</div>

		<div class="space-y-1.5">
			<label for="description" class="eyebrow block">
				Description
				<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">(optional)</span>
			</label>
			<textarea id="description" name="description" rows="2" class="field"></textarea>
		</div>

		<!-- ============= Label template ============= -->
		<div class="space-y-1.5">
			<label for="template" class="eyebrow block">Label size</label>
			<select id="template" name="template" bind:value={templateCode} class="field">
				{#each data.templates as t (t.code)}
					<option value={t.code}>{t.display_name}</option>
				{/each}
			</select>
			{#if activeTemplate}
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					{activeTemplate.width_mm}mm × {activeTemplate.height_mm}mm — make sure your DYMO has
					this label loaded.
				</p>
			{/if}
		</div>

		<div class="flex gap-2 border-t border-[color:var(--color-line-dim)] pt-5">
			<button type="submit" class="btn-primary" disabled={submitting}>
				{submitting ? 'Creating…' : `Create + print ${totalLabels} label${totalLabels === 1 ? '' : 's'}`}
			</button>
			<a href="/items" class="btn-ghost">Cancel</a>
		</div>
	</form>
</section>
