<script lang="ts">
	import type { PageData } from './$types';
	import type { BatchResult, ImportError } from '$lib/server/squarespace_import';

	let { data }: { data: PageData } = $props();

	// Local state for the polling loop. Each batch returned by the
	// /api/import/squarespace/batch endpoint is appended to `log` so the
	// user sees progress accumulate. Aggregate totals roll up across
	// batches for the headline counters.
	type LogEntry =
		| { kind: 'batch'; result: BatchResult }
		| { kind: 'error'; message: string }
		| { kind: 'done'; total: number };

	let running = $state(false);
	let log = $state<LogEntry[]>([]);
	let aggregate = $state({
		created: 0,
		updated: 0,
		photos: 0,
		errors: [] as ImportError[]
	});

	async function startImport() {
		running = true;
		log = [];
		aggregate = { created: 0, updated: 0, photos: 0, errors: [] };

		try {
			while (true) {
				const res = await fetch('/api/import/squarespace/batch', { method: 'POST' });

				if (!res.ok) {
					const text = await res.text();
					log = [
						...log,
						{ kind: 'error', message: `Server returned ${res.status}: ${text.slice(0, 200)}` }
					];
					break;
				}

				const payload = (await res.json()) as { ok: boolean; batch: BatchResult };
				const batch = payload.batch;

				log = [...log, { kind: 'batch', result: batch }];
				aggregate.created += batch.itemsCreated;
				aggregate.updated += batch.itemsUpdated;
				aggregate.photos += batch.photosUploaded;
				aggregate.errors = [...aggregate.errors, ...batch.errors];

				if (!batch.hasMore) {
					log = [...log, { kind: 'done', total: batch.totalImportedSoFar }];
					break;
				}
			}
		} catch (err) {
			log = [...log, { kind: 'error', message: err instanceof Error ? err.message : String(err) }];
		} finally {
			running = false;
		}
	}
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Bootstrap</p>
		<h1 class="headline text-3xl">Squarespace product import</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Pulls Dad's existing Squarespace catalog into inventory as the seed dataset. Idempotent —
			re-running updates titles, descriptions, and prices but never duplicates.
		</p>
	</header>

	{#if data.status === 'no_key'}
		<div class="panel px-6 py-5" style="border-color: var(--color-rust)">
			<p class="headline text-xl text-[color:var(--color-rust-bright)]">No API key configured.</p>
			<p class="mt-2 text-sm text-[color:var(--color-ink-2)]">{data.message}</p>
		</div>
	{:else if data.status === 'api_error'}
		<div class="panel px-6 py-5" style="border-color: var(--color-rust)">
			<p class="headline text-xl text-[color:var(--color-rust-bright)]">
				Squarespace rejected the request.
			</p>
			<p class="mt-2 text-sm">
				HTTP <span class="font-mono">{data.httpStatus}</span>
				— {data.message}
			</p>
			{#if data.httpStatus === 401 || data.httpStatus === 403}
				<p class="mt-3 text-xs italic text-[color:var(--color-ink-3)]">
					Likely cause: API key missing the <span class="font-mono">Products</span> scope, or
					pointed at the wrong site. Regenerate in Squarespace → Settings → Developer Tools → API
					Keys with all read scopes.
				</p>
			{/if}
			{#if data.body}
				<pre
					class="mt-4 overflow-x-auto rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] p-3 text-xs">{data.body}</pre>
			{/if}
		</div>
	{:else if data.status === 'network_error'}
		<div class="panel px-6 py-5" style="border-color: var(--color-rust)">
			<p class="headline text-xl text-[color:var(--color-rust-bright)]">
				Couldn't reach Squarespace.
			</p>
			<p class="mt-2 text-sm text-[color:var(--color-ink-2)]">{data.message}</p>
		</div>
	{:else if data.status === 'ok'}
		<!-- ============= Connection summary ============= -->
		<div class="panel px-6 py-5" style="border-color: var(--color-moss)">
			<p class="headline text-xl text-[color:var(--color-moss-bright)]">Connected.</p>
			<div class="mt-3 grid grid-cols-4 gap-4 text-sm">
				<div>
					<span class="eyebrow">Products page 1</span>
					<p class="headline mt-1 text-2xl">{data.sampleCount}</p>
				</div>
				<div>
					<span class="eyebrow">Images page 1</span>
					<p class="headline mt-1 text-2xl">{data.totalImageCount}</p>
				</div>
				<div>
					<span class="eyebrow">Variants page 1</span>
					<p class="headline mt-1 text-2xl">{data.totalVariantCount}</p>
				</div>
				<div>
					<span class="eyebrow">Already imported</span>
					<p class="headline mt-1 text-2xl text-[color:var(--color-gold-bright)]">
						{data.alreadyImportedCount}
					</p>
				</div>
			</div>
			<p class="mt-3 text-xs italic text-[color:var(--color-ink-3)]">
				Has additional pages: <span class="font-mono">{data.hasNextPage ? 'yes' : 'no'}</span>
			</p>
		</div>

		<!-- ============= Import controls + log ============= -->
		<div class="panel px-6 py-5">
			<div class="flex items-center gap-3">
				<button class="btn-primary" onclick={startImport} disabled={running}>
					{#if running}
						Importing…
					{:else if (data.alreadyImportedCount ?? 0) > 0}
						Continue / refresh import
					{:else}
						Start import
					{/if}
				</button>
				{#if running}
					<span class="eyebrow text-[color:var(--color-gold-bright)]"
						>in progress · do not close tab</span
					>
				{/if}
			</div>

			<p class="mt-3 text-xs italic text-[color:var(--color-ink-3)]">
				Processes ~10 variants per server call and continues automatically until done. Each call
				downloads photos to R2 — that's the slow part.
			</p>

			{#if log.length > 0 || aggregate.created > 0 || aggregate.updated > 0}
				<div class="mt-5 space-y-3">
					<!-- Aggregate counters -->
					<div class="grid grid-cols-3 gap-4 text-sm">
						<div>
							<span class="eyebrow">Created</span>
							<p class="headline mt-1 text-2xl text-[color:var(--color-moss-bright)]">
								{aggregate.created}
							</p>
						</div>
						<div>
							<span class="eyebrow">Updated</span>
							<p class="headline mt-1 text-2xl text-[color:var(--color-gold-bright)]">
								{aggregate.updated}
							</p>
						</div>
						<div>
							<span class="eyebrow">Photos uploaded</span>
							<p class="headline mt-1 text-2xl">{aggregate.photos}</p>
						</div>
					</div>

					<!-- Scrolling log -->
					<div
						class="max-h-72 overflow-y-auto rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)] p-3 font-mono text-xs"
					>
						{#each log as entry, i (i)}
							{#if entry.kind === 'batch'}
								<div class="text-[color:var(--color-ink-2)]">
									batch · created
									<span class="text-[color:var(--color-moss-bright)]"
										>{entry.result.itemsCreated}</span
									>
									· updated
									<span class="text-[color:var(--color-gold-bright)]"
										>{entry.result.itemsUpdated}</span
									>
									· photos
									<span class="text-[color:var(--color-ink)]">{entry.result.photosUploaded}</span>
									{#if entry.result.errors.length > 0}
										·
										<span class="text-[color:var(--color-rust-bright)]"
											>{entry.result.errors.length} err</span
										>
									{/if}
								</div>
							{:else if entry.kind === 'error'}
								<div class="text-[color:var(--color-rust-bright)]">! {entry.message}</div>
							{:else if entry.kind === 'done'}
								<div class="mt-2 text-[color:var(--color-moss-bright)]">
									✓ done · {entry.total} items now tracked from Squarespace
								</div>
							{/if}
						{/each}
					</div>

					{#if aggregate.errors.length > 0}
						<details class="text-xs">
							<summary
								class="cursor-pointer text-[color:var(--color-rust-bright)] hover:text-[color:var(--color-rust)]"
							>
								{aggregate.errors.length} error{aggregate.errors.length === 1 ? '' : 's'} (click
								to expand)
							</summary>
							<ul class="mt-2 space-y-1 pl-4">
								{#each aggregate.errors as e (e.context)}
									<li class="text-[color:var(--color-ink-3)]">
										<span class="font-mono text-[color:var(--color-ink-4)]">{e.context}</span>
										— {e.error}
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				</div>
			{/if}
		</div>

		<!-- ============= Sample products ============= -->
		<div class="space-y-1">
			<p class="eyebrow">First 5 products as Squarespace sees them</p>
		</div>

		<div class="space-y-3">
			{#each data.sample ?? [] as p (p.id)}
				<div class="panel grid grid-cols-[120px_1fr] gap-4 p-4">
					<div
						class="aspect-square overflow-hidden rounded border border-[color:var(--color-line-dim)] bg-[color:var(--color-input)]"
					>
						{#if p.firstImageUrl}
							<img src={p.firstImageUrl} alt={p.name} class="h-full w-full object-cover" />
						{:else}
							<div
								class="flex h-full w-full items-center justify-center text-xs italic text-[color:var(--color-ink-4)]"
							>
								no image
							</div>
						{/if}
					</div>

					<div class="space-y-2">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-mono text-[11px] text-[color:var(--color-gold-dim)]">{p.id}</p>
								<h3 class="headline text-lg leading-tight">{p.name}</h3>
							</div>
							{#if !p.isVisible}
								<span class="pill pill-warn flex-shrink-0">Hidden</span>
							{/if}
						</div>

						{#if p.descriptionPreview}
							<p class="text-xs text-[color:var(--color-ink-2)]">
								{p.descriptionPreview}{p.descriptionLength > 180 ? '…' : ''}
							</p>
						{/if}

						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
							<span>
								<span class="eyebrow">Variants:</span>
								<span class="ml-1 font-mono text-[color:var(--color-ink)]">{p.variantCount}</span>
							</span>
							<span>
								<span class="eyebrow">Images:</span>
								<span class="ml-1 font-mono text-[color:var(--color-ink)]">{p.imageCount}</span>
							</span>
							{#if p.firstVariantSku}
								<span>
									<span class="eyebrow">First SKU:</span>
									<span class="ml-1 font-mono text-[color:var(--color-gold)]"
										>{p.firstVariantSku}</span
									>
								</span>
							{/if}
							<span>
								<span class="eyebrow">Price:</span>
								<span class="ml-1 font-mono text-[color:var(--color-ink)]"
									>{p.firstVariantPrice}</span
								>
							</span>
						</div>

						{#if p.tags.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each p.tags as t (t)}
									<span class="pill text-[10px]">{t}</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>
