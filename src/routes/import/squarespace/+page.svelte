<script lang="ts">
	import type { PageData } from './$types';
	import type {
		BackfillResult,
		BatchResult,
		ImportError,
		StockSyncResult
	} from '$lib/server/squarespace_import';

	let { data }: { data: PageData } = $props();

	// Local state for the polling loops. Each batch / backfill response
	// is appended to `log` so the user sees progress accumulate.
	type LogEntry =
		| { kind: 'batch'; result: BatchResult }
		| { kind: 'backfill'; result: BackfillResult }
		| { kind: 'error'; message: string }
		| { kind: 'done'; total: number; mode: 'import' | 'backfill' };

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
					log = [
						...log,
						{ kind: 'done', total: batch.totalImportedSoFar, mode: 'import' }
					];
					break;
				}
			}
		} catch (err) {
			log = [...log, { kind: 'error', message: err instanceof Error ? err.message : String(err) }];
		} finally {
			running = false;
		}
	}

	// Dedicated stock-only sync — one fast call, no looping. Uses the
	// thin Inventory API rather than re-walking the full Products feed.
	let syncingStock = $state(false);
	let stockSyncResult = $state<StockSyncResult | null>(null);
	let stockSyncError = $state<string | null>(null);

	async function syncStock() {
		syncingStock = true;
		stockSyncResult = null;
		stockSyncError = null;
		try {
			const res = await fetch('/api/import/squarespace/sync-stock', { method: 'POST' });
			if (!res.ok) {
				const text = await res.text();
				stockSyncError = `Server returned ${res.status}: ${text.slice(0, 300)}`;
				return;
			}
			stockSyncResult = (await res.json()) as StockSyncResult;
		} catch (err) {
			stockSyncError = err instanceof Error ? err.message : String(err);
		} finally {
			syncingStock = false;
		}
	}

	async function startBackfill() {
		running = true;
		log = [];
		aggregate = { created: 0, updated: 0, photos: 0, errors: [] };

		try {
			while (true) {
				const res = await fetch('/api/import/squarespace/backfill', { method: 'POST' });
				if (!res.ok) {
					const text = await res.text();
					log = [
						...log,
						{ kind: 'error', message: `Server returned ${res.status}: ${text.slice(0, 200)}` }
					];
					break;
				}

				const payload = (await res.json()) as { ok: boolean; result: BackfillResult };
				const r = payload.result;

				log = [...log, { kind: 'backfill', result: r }];
				aggregate.photos += r.photosAdded;
				aggregate.errors = [...aggregate.errors, ...r.errors];

				if (!r.hasMore) {
					log = [
						...log,
						{ kind: 'done', total: aggregate.photos, mode: 'backfill' }
					];
					break;
				}
			}
		} catch (err) {
			log = [
				...log,
				{ kind: 'error', message: err instanceof Error ? err.message : String(err) }
			];
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

		<!-- ============= Import + backfill controls ============= -->
		<div class="panel px-6 py-5">
			<div class="flex flex-wrap items-center gap-3">
				<button class="btn-primary" onclick={startImport} disabled={running}>
					{#if running}
						Working…
					{:else if (data.alreadyImportedCount ?? 0) > 0}
						Continue / refresh import
					{:else}
						Start import
					{/if}
				</button>
				{#if (data.alreadyImportedCount ?? 0) > 0}
					<button class="btn-ghost" onclick={startBackfill} disabled={running}>
						Backfill missing photos
					</button>
					<button
						class="btn-ghost"
						onclick={syncStock}
						disabled={running || syncingStock}
						title="Pull current stock counts from Squarespace into our DB"
					>
						{syncingStock ? 'Syncing stock…' : 'Sync stock from Squarespace'}
					</button>
				{/if}
				{#if running}
					<span class="eyebrow text-[color:var(--color-gold-bright)]"
						>in progress · do not close tab</span
					>
				{/if}
			</div>

			<p class="mt-3 text-xs italic text-[color:var(--color-ink-3)]">
				<strong class="not-italic text-[color:var(--color-ink-2)]">Import</strong> creates new
				items + refreshes metadata.
				<strong class="not-italic text-[color:var(--color-ink-2)]">Backfill</strong>
				re-scans the catalog for items that have fewer photos than Squarespace has and fetches the
				missing ones.
				<strong class="not-italic text-[color:var(--color-ink-2)]">Sync stock</strong>
				is the fastest path: pulls only the current per-variant counts from the Inventory API and
				updates our <span class="font-mono">stock_qty</span> + writes an audit movement for each
				change. Anything marked sold out on Squarespace gets reflected as qty=0 here.
			</p>

			<!-- Stock sync results panel — separate from the import log so a
				 quick sync doesn't get buried in batch noise. -->
			{#if stockSyncError}
				<div
					class="mt-4 rounded border border-[color:var(--color-rust)] bg-[color:var(--color-input)] px-4 py-3"
				>
					<p class="eyebrow text-[color:var(--color-rust-bright)]">Stock sync error</p>
					<p class="mt-1 text-xs">{stockSyncError}</p>
				</div>
			{:else if stockSyncResult}
				<div
					class="mt-4 rounded border border-[color:var(--color-moss)] bg-[color:var(--color-input)] px-4 py-3"
				>
					<p class="eyebrow text-[color:var(--color-moss-bright)]">Stock sync complete</p>
					<div
						class="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 md:grid-cols-5"
					>
						<div>
							<span class="eyebrow text-[10px]">Updated</span>
							<p class="font-mono text-xl text-[color:var(--color-gold-bright)]">
								{stockSyncResult.itemsUpdated}
							</p>
						</div>
						<div>
							<span class="eyebrow text-[10px]">No change</span>
							<p class="font-mono text-xl text-[color:var(--color-ink-2)]">
								{stockSyncResult.noChange}
							</p>
						</div>
						<div>
							<span class="eyebrow text-[10px]">Scanned</span>
							<p class="font-mono text-xl text-[color:var(--color-ink-2)]">
								{stockSyncResult.entriesScanned}
							</p>
						</div>
						<div>
							<span class="eyebrow text-[10px]">Unknown variants</span>
							<p class="font-mono text-xl text-[color:var(--color-ink-3)]"
								title="Variants in SS that aren't imported yet — run Import to fetch them.">
								{stockSyncResult.unknownVariants}
							</p>
						</div>
						<div>
							<span class="eyebrow text-[10px]">Skipped (unlimited)</span>
							<p class="font-mono text-xl text-[color:var(--color-ink-3)]"
								title="SS variants marked as unlimited stock — we ignore these.">
								{stockSyncResult.skippedUnlimited}
							</p>
						</div>
					</div>
					{#if stockSyncResult.errors.length > 0}
						<p class="mt-3 text-xs text-[color:var(--color-rust-bright)]">
							{stockSyncResult.errors.length} error{stockSyncResult.errors.length === 1 ? '' : 's'} — see below
						</p>
						<ul class="mt-1 space-y-1 text-xs">
							{#each stockSyncResult.errors as e (e.context)}
								<li>
									<span class="font-mono text-[color:var(--color-ink-3)]">{e.context}</span>
									— {e.error}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}

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
							{:else if entry.kind === 'backfill'}
								<div class="text-[color:var(--color-ink-2)]">
									backfill · scanned
									<span class="text-[color:var(--color-ink)]">{entry.result.itemsScanned}</span>
									· photos
									<span class="text-[color:var(--color-moss-bright)]"
										>+{entry.result.photosAdded}</span
									>
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
									{#if entry.mode === 'import'}
										✓ done · {entry.total} items now tracked from Squarespace
									{:else}
										✓ backfill done · {entry.total} photo{entry.total === 1 ? '' : 's'} recovered
									{/if}
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
