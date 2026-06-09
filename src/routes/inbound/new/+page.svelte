<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import InfoTip from '$lib/components/InfoTip.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Editable line shape (unitCost in DOLLARS for the input; converted
	// to cents on submit).
	type Line = {
		description: string;
		quantity: number;
		unitCost: string;
		supplierSku: string;
	};

	let intakeMode = $state<'screenshot' | 'paste'>('screenshot');
	let pasteText = $state('');
	let fileInput: HTMLInputElement | undefined = $state();
	let parsing = $state(false);
	let parseError = $state<string | null>(null);
	let parsedNote = $state<string | null>(null);

	// Order header
	let supplier = $state('');
	let orderRef = $state('');
	let status = $state('ordered');
	let eta = $state('');
	let tracking = $state('');
	let notes = $state('');

	let lines = $state<Line[]>([]);

	function addLine() {
		lines = [...lines, { description: '', quantity: 1, unitCost: '', supplierSku: '' }];
	}
	function removeLine(i: number) {
		lines = lines.filter((_, idx) => idx !== i);
	}

	function readFileAsBase64(file: File): Promise<{ data: string; mediaType: string }> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				// strip the "data:image/png;base64," prefix
				const comma = result.indexOf(',');
				resolve({ data: result.slice(comma + 1), mediaType: file.type || 'image/png' });
			};
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	async function parseWithAI() {
		parsing = true;
		parseError = null;
		parsedNote = null;
		try {
			let payload: Record<string, unknown>;
			if (intakeMode === 'screenshot') {
				const file = fileInput?.files?.[0];
				if (!file) {
					parseError = 'Pick a screenshot of the order first.';
					return;
				}
				const { data: b64, mediaType } = await readFileAsBase64(file);
				payload = { imageBase64: b64, imageMediaType: mediaType };
			} else {
				if (!pasteText.trim()) {
					parseError = 'Paste the order text first.';
					return;
				}
				payload = { text: pasteText.trim() };
			}

			const res = await fetch('/api/inbound/parse', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const t = await res.text();
				parseError = `${res.status}: ${t.slice(0, 250)}`;
				return;
			}
			const out = (await res.json()) as {
				supplier: string | null;
				orderRef: string | null;
				lines: {
					description: string;
					quantity: number;
					unitCostCents: number | null;
					supplierSku: string | null;
				}[];
			};
			if (out.supplier && !supplier) supplier = out.supplier;
			if (out.orderRef && !orderRef) orderRef = out.orderRef;
			const parsedLines: Line[] = out.lines.map((l) => ({
				description: l.description,
				quantity: l.quantity,
				unitCost: l.unitCostCents != null ? (l.unitCostCents / 100).toFixed(2) : '',
				supplierSku: l.supplierSku ?? ''
			}));
			// Append parsed lines to any existing (don't wipe manual edits).
			lines = [...lines, ...parsedLines];
			parsedNote =
				parsedLines.length > 0
					? `Pulled ${parsedLines.length} line${parsedLines.length === 1 ? '' : 's'} — review and edit below.`
					: 'No line items found. Add them manually below.';
		} catch (err) {
			parseError = err instanceof Error ? err.message : String(err);
		} finally {
			parsing = false;
		}
	}

	// Serialize lines (cents) into the hidden field on submit.
	let linesJson = $derived(
		JSON.stringify(
			lines
				.filter((l) => l.description.trim())
				.map((l) => ({
					description: l.description.trim(),
					quantity: Number(l.quantity) > 0 ? Math.round(Number(l.quantity)) : 1,
					unitCostCents: l.unitCost.trim() ? Math.round(parseFloat(l.unitCost) * 100) : null,
					supplierSku: l.supplierSku.trim() || null
				}))
		)
	);

	let lineTotalCents = $derived(
		lines.reduce((sum, l) => {
			const c = l.unitCost.trim() ? Math.round(parseFloat(l.unitCost) * 100) : 0;
			const q = Number(l.quantity) > 0 ? Number(l.quantity) : 0;
			return sum + (Number.isFinite(c) ? c * q : 0);
		}, 0)
	);
</script>

<section class="space-y-5">
	<header class="space-y-2">
		<a
			href="/inbound"
			class="eyebrow inline-flex items-center gap-1 text-[color:var(--color-ink-3)] hover:text-[color:var(--color-gold-bright)]"
		>
			← Inbound orders
		</a>
		<h1 class="headline text-3xl">New inbound order</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Upload a screenshot of the Alibaba order (or paste the text) and let AI pull the line
			items, then review and save.
		</p>
	</header>

	{#if form?.createError}
		<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">{form.createError}</p>
		</div>
	{/if}

	<!-- ============ Intake ============ -->
	<div class="panel space-y-3 px-6 py-5">
		<div class="flex items-baseline justify-between gap-3">
			<p class="eyebrow inline-flex items-center gap-0.5">
				Import the order
				<InfoTip title="AI order import">
					<p>
						Screenshot the Alibaba order and upload it — Claude reads the products,
						quantities and prices. Or paste the order/email text. You can also skip this
						and add lines by hand.
					</p>
				</InfoTip>
			</p>
			<div class="flex gap-1 text-xs">
				<button
					type="button"
					class="rounded-full border px-3 py-1 transition-colors {intakeMode === 'screenshot'
						? 'border-[color:var(--color-gold)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
						: 'border-[color:var(--color-line)] text-[color:var(--color-ink-3)] hover:bg-[color:var(--color-hover)]'}"
					onclick={() => (intakeMode = 'screenshot')}
				>
					Screenshot
				</button>
				<button
					type="button"
					class="rounded-full border px-3 py-1 transition-colors {intakeMode === 'paste'
						? 'border-[color:var(--color-gold)] bg-[color:var(--color-selected)] text-[color:var(--color-ink)]'
						: 'border-[color:var(--color-line)] text-[color:var(--color-ink-3)] hover:bg-[color:var(--color-hover)]'}"
					onclick={() => (intakeMode = 'paste')}
				>
					Paste text
				</button>
			</div>
		</div>

		{#if !data.hasAiKey}
			<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
				ANTHROPIC_API_KEY isn't configured — AI import is disabled. You can still add lines
				manually below.
			</p>
		{/if}

		{#if intakeMode === 'screenshot'}
			<input
				bind:this={fileInput}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				class="field text-sm"
			/>
		{:else}
			<textarea
				bind:value={pasteText}
				rows="6"
				placeholder="Paste the Alibaba order page or confirmation email text here…"
				class="field text-sm"
			></textarea>
		{/if}

		<div class="flex items-center gap-3">
			<button
				type="button"
				class="btn-primary px-4 py-2 text-sm"
				onclick={parseWithAI}
				disabled={parsing || !data.hasAiKey}
			>
				{parsing ? 'Reading…' : '✨ Parse with AI'}
			</button>
			{#if parsedNote}
				<span class="text-[11px] text-[color:var(--color-moss-bright)]">{parsedNote}</span>
			{/if}
		</div>
		{#if parseError}
			<p class="text-xs text-[color:var(--color-rust-bright)]">{parseError}</p>
		{/if}
	</div>

	<!-- ============ Order form ============ -->
	<form method="POST" action="?/create" class="panel space-y-5 px-6 py-5">
		<input type="hidden" name="lines_json" value={linesJson} />

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<label for="supplier" class="eyebrow block">Supplier</label>
				<input id="supplier" name="supplier" bind:value={supplier} placeholder="Seller / Alibaba store" class="field" />
			</div>
			<div class="space-y-1.5">
				<label for="supplier_order_ref" class="eyebrow block">Order number</label>
				<input id="supplier_order_ref" name="supplier_order_ref" bind:value={orderRef} placeholder="Alibaba order #" class="field font-mono" />
			</div>
			<div class="space-y-1.5">
				<label for="status" class="eyebrow block">Status</label>
				<select id="status" name="status" bind:value={status} class="field">
					<option value="ordered">Ordered</option>
					<option value="in_transit">In transit</option>
					<option value="received">Received</option>
				</select>
			</div>
			<div class="space-y-1.5">
				<label for="eta" class="eyebrow block">ETA <span class="lowercase">(optional)</span></label>
				<input id="eta" name="eta" bind:value={eta} placeholder="e.g. mid-July, 2 wks" class="field" />
			</div>
			<div class="space-y-1.5 sm:col-span-2">
				<label for="tracking" class="eyebrow block">Tracking <span class="lowercase">(optional)</span></label>
				<input id="tracking" name="tracking" bind:value={tracking} placeholder="Carrier + tracking #" class="field font-mono" />
			</div>
			<div class="space-y-1.5 sm:col-span-2">
				<label for="notes" class="eyebrow block">Notes <span class="lowercase">(optional)</span></label>
				<input id="notes" name="notes" bind:value={notes} class="field" />
			</div>
		</div>

		<!-- Lines -->
		<div class="space-y-2">
			<div class="flex items-baseline justify-between">
				<p class="eyebrow">Line items</p>
				<button type="button" class="btn-ghost px-3 py-1 text-xs" onclick={addLine}>+ Add line</button>
			</div>

			{#if lines.length === 0}
				<p class="rounded border border-dashed border-[color:var(--color-line-dim)] px-4 py-6 text-center text-sm text-[color:var(--color-ink-4)]">
					No lines yet — parse a screenshot/text above, or add lines manually.
				</p>
			{:else}
				<div class="space-y-2">
					{#each lines as line, i (i)}
						<div class="grid items-end gap-2 rounded border border-[color:var(--color-line-dim)] p-2 sm:grid-cols-[1fr_4rem_6rem_8rem_auto]">
							<div class="space-y-1">
								<span class="eyebrow block text-[10px]">Description</span>
								<input bind:value={line.description} placeholder="Product name" class="field py-1 text-sm" />
							</div>
							<div class="space-y-1">
								<span class="eyebrow block text-[10px]">Qty</span>
								<input type="number" min="1" bind:value={line.quantity} class="field py-1 text-sm" />
							</div>
							<div class="space-y-1">
								<span class="eyebrow block text-[10px]">Unit $</span>
								<input type="number" step="0.01" min="0" bind:value={line.unitCost} placeholder="—" class="field py-1 text-sm" />
							</div>
							<div class="space-y-1">
								<span class="eyebrow block text-[10px]">Supplier SKU</span>
								<input bind:value={line.supplierSku} placeholder="—" class="field py-1 text-sm font-mono" />
							</div>
							<button
								type="button"
								class="btn-ghost px-2 py-1 text-xs"
								style="color: var(--color-rust-bright)"
								onclick={() => removeLine(i)}
								title="Remove line"
							>
								✕
							</button>
						</div>
					{/each}
				</div>
				{#if lineTotalCents > 0}
					<p class="text-right text-[11px] text-[color:var(--color-ink-3)]">
						Estimated order total: <span class="font-mono text-[color:var(--color-gold-bright)]">${(lineTotalCents / 100).toFixed(2)}</span>
					</p>
				{/if}
			{/if}
		</div>

		<div class="flex gap-2 border-t border-[color:var(--color-line-dim)] pt-4">
			<a href="/inbound" class="btn-ghost px-4 py-2 text-sm">Cancel</a>
			<button type="submit" class="btn-primary ml-auto px-4 py-2 text-sm" disabled={lines.filter((l) => l.description.trim()).length === 0}>
				Save inbound order
			</button>
		</div>
	</form>
</section>
