<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface ProbeResult {
		label: string;
		url: string;
		method: string;
		status: number;
		ok: boolean;
		body: string;
		error?: string;
	}

	let busy = $state(false);
	let runAt = $state<string | null>(null);
	let results = $state<ProbeResult[]>([]);
	let errorMsg = $state<string | null>(null);

	let sampleProductId = $state(data.pushedItems[0]?.external_id ?? '');

	async function runProbes() {
		busy = true;
		errorMsg = null;
		results = [];
		try {
			const res = await fetch('/api/debug/squarespace-scope', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sampleProductId: sampleProductId.trim() || undefined
				})
			});
			if (!res.ok) {
				const text = await res.text();
				errorMsg = `${res.status}: ${text.slice(0, 300)}`;
				return;
			}
			const payload = (await res.json()) as {
				probedAt: string;
				results: ProbeResult[];
			};
			runAt = payload.probedAt;
			results = payload.results;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	let successCount = $derived(results.filter((r) => r.ok).length);
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Diagnostic</p>
		<h1 class="headline text-3xl">Squarespace API scope</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Probes the Squarespace API with the current key against likely endpoints. Used to find
			undocumented surfaces like the fulfillment-profile list and any extra fields on the raw
			product GET. Read-only — no writes happen here.
		</p>
	</header>

	{#if !data.hasApiKey}
		<div class="panel px-6 py-4" style="border-color: var(--color-rust)">
			<p class="text-sm text-[color:var(--color-rust-bright)]">
				No SQUARESPACE_API_KEY configured on this environment. Set it via
				<span class="font-mono">wrangler pages secret put</span> and redeploy.
			</p>
		</div>
	{:else}
		<div class="panel space-y-3 px-6 py-4">
			<div class="space-y-1.5">
				<label for="sample_id" class="eyebrow block">
					Sample product ID <span class="lowercase text-[color:var(--color-ink-4)]">(optional)</span>
				</label>
				<input
					id="sample_id"
					type="text"
					bind:value={sampleProductId}
					placeholder="e.g. 6a171dd31a3c8579aa788ffe"
					class="field font-mono"
				/>
				<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
					If supplied, the probe also does a raw GET on this product (both v1 and v2 paths) to
					reveal all undocumented fields. Picks an already-pushed item by default.
				</p>
			</div>

			{#if data.pushedItems.length > 0}
				<div class="space-y-1">
					<p class="eyebrow text-[10px]">Already-pushed items (click to use)</p>
					<div class="flex flex-wrap gap-1.5">
						{#each data.pushedItems.slice(0, 8) as item (item.id)}
							<button
								type="button"
								class="rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] px-2 py-1 font-mono text-[10px] text-[color:var(--color-ink-2)] transition-colors hover:border-[color:var(--color-gold-dim)] hover:bg-[color:var(--color-hover)] hover:text-[color:var(--color-ink)]"
								onclick={() => (sampleProductId = item.external_id)}
								title={item.title}
							>
								{item.sku}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<button
				type="button"
				class="btn-primary px-4 py-2 text-sm"
				onclick={runProbes}
				disabled={busy}
			>
				{busy ? 'Probing…' : 'Run probes'}
			</button>
		</div>

		{#if errorMsg}
			<div class="panel px-4 py-3" style="border-color: var(--color-rust)">
				<p class="text-sm text-[color:var(--color-rust-bright)]">{errorMsg}</p>
			</div>
		{/if}

		{#if results.length > 0}
			<div class="panel px-6 py-4">
				<div class="flex items-baseline justify-between">
					<p class="eyebrow">Results</p>
					<p class="text-[11px] text-[color:var(--color-ink-3)]">
						{successCount} of {results.length} endpoints responded OK · {runAt}
					</p>
				</div>

				<ul class="mt-3 space-y-2">
					{#each results as r (r.url)}
						<li
							class="rounded border px-3 py-2"
							style:border-color={r.ok
								? 'var(--color-moss)'
								: r.status === 404
									? 'var(--color-line-dim)'
									: 'var(--color-rust-dim, var(--color-line-dim))'}
						>
							<div class="flex items-baseline justify-between gap-2">
								<span class="text-sm">
									<span
										class="font-mono text-xs"
										style:color={r.ok
											? 'var(--color-moss-bright)'
											: 'var(--color-ink-3)'}
									>
										{r.method}
										{r.status}
										{#if r.error} · {r.error}{/if}
									</span>
									<span class="ml-2 text-[color:var(--color-ink-2)]">{r.label}</span>
								</span>
							</div>
							<p
								class="mt-1 break-all font-mono text-[10px] text-[color:var(--color-ink-4)]"
							>
								{r.url}
							</p>
							{#if r.body}
								<details class="mt-2 text-[11px]">
									<summary
										class="cursor-pointer text-[color:var(--color-ink-3)] hover:text-[color:var(--color-ink-2)]"
									>
										Response body ({r.body.length} chars)
									</summary>
									<pre
										class="mt-2 max-h-72 overflow-auto rounded bg-[color:var(--color-input)] p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words">{r.body}</pre>
								</details>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}

	<div class="panel px-4 py-3" style="border-color: var(--color-line-dim)">
		<p class="eyebrow">What to look for</p>
		<ul class="mt-2 space-y-1 text-xs text-[color:var(--color-ink-3)]">
			<li>
				<strong class="text-[color:var(--color-ink)]">Fulfillment profile list</strong> — any of
				the <span class="font-mono">/commerce/fulfillment_*</span> or
				<span class="font-mono">/commerce/shipping_*</span> URLs returning 200 with profile data
			</li>
			<li>
				<strong class="text-[color:var(--color-ink)]">Product GET raw fields</strong> — look for
				fields like
				<span class="font-mono">fulfillmentProfileId</span>,
				<span class="font-mono">shippingProfileId</span>,
				<span class="font-mono">categories</span>,
				<span class="font-mono">orderIndex</span>,
				<span class="font-mono">position</span>
			</li>
			<li>
				<strong class="text-[color:var(--color-ink)]">404s are normal</strong> — most candidates
				will miss; we're just hunting for the ones that hit
			</li>
		</ul>
	</div>
</section>
