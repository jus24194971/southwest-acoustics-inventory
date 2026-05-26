<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import QrScanner from 'qr-scanner';

	type Mode = 'lookup' | 'out' | 'in' | 'build';

	interface ScanItem {
		id: number;
		sku: string;
		title: string;
		tracking_mode: 'serialized' | 'stocked';
		stock_qty: number;
		retired_at: string | null;
		cat_code: string;
		cat_name: string;
		bin_code: string | null;
		loc_code: string | null;
	}

	interface LogEntry {
		at: Date;
		sku: string;
		mode: Mode;
		ok: boolean;
		message: string;
		item?: ScanItem;
	}

	// State -------------------------------------------------------------
	let mode = $state<Mode>('lookup');
	let qty = $state(1);
	let note = $state('');

	let cameraActive = $state(false);
	let cameraError = $state<string | null>(null);
	let videoEl: HTMLVideoElement | undefined = $state();
	let scanner: QrScanner | null = null;

	let manualSku = $state('');
	let manualInputEl: HTMLInputElement | undefined = $state();

	let log = $state<LogEntry[]>([]);
	let lastScannedSku = $state<string | null>(null);
	let lastScannedAt = 0;
	let busy = $state(false);

	// Modes config ------------------------------------------------------
	const MODES: Record<Mode, { label: string; sub: string; pill: string }> = {
		lookup: {
			label: 'Lookup',
			sub: 'Just see what this is',
			pill: 'pill'
		},
		out: {
			label: 'Scan out',
			sub: 'Sale / pull from inventory',
			pill: 'pill-warn'
		},
		in: {
			label: 'Scan in',
			sub: 'Restock — increment stocked qty',
			pill: 'pill-success'
		},
		build: {
			label: 'Build',
			sub: 'Consume for a build / refurb',
			pill: 'pill-warn'
		}
	};

	// Parse a scanned payload into a SKU. The QR encodes a full URL
	// like https://…/items/<sku> but USB scanners typically emit the
	// raw SKU + Enter — we accept both.
	function extractSku(raw: string): string | null {
		const trimmed = raw.trim();
		if (!trimmed) return null;
		const urlMatch = trimmed.match(/\/items\/([^/?#]+)/i);
		if (urlMatch) return decodeURIComponent(urlMatch[1]).toUpperCase();
		// Bin scans land elsewhere, but for cleanliness recognise them
		// too — and treat them as "not an item SKU."
		if (/\/bins\//.test(trimmed)) return null;
		// Raw SKU-ish string
		if (/^[A-Z0-9-]{6,60}$/i.test(trimmed)) return trimmed.toUpperCase();
		return null;
	}

	async function handleRawScan(raw: string) {
		const sku = extractSku(raw);
		if (!sku) {
			pushLog({
				at: new Date(),
				sku: raw.slice(0, 32),
				mode,
				ok: false,
				message: "Didn't recognise the code as an item SKU"
			});
			return;
		}

		// Debounce identical-SKU scans within 1.5s (camera will fire
		// repeatedly while the QR is in view).
		const now = Date.now();
		if (sku === lastScannedSku && now - lastScannedAt < 1500) return;
		lastScannedSku = sku;
		lastScannedAt = now;

		await processScan(sku);
	}

	async function processScan(sku: string) {
		if (busy) return;
		busy = true;
		try {
			const res = await fetch('/api/scan', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sku, mode, qty, note: note || undefined })
			});

			if (!res.ok) {
				const text = await res.text();
				pushLog({
					at: new Date(),
					sku,
					mode,
					ok: false,
					message: text.slice(0, 200)
				});
				return;
			}

			const data = (await res.json()) as {
				ok: boolean;
				item: ScanItem;
				message: string;
			};
			pushLog({
				at: new Date(),
				sku,
				mode,
				ok: true,
				message: data.message,
				item: data.item
			});
		} catch (err) {
			pushLog({
				at: new Date(),
				sku,
				mode,
				ok: false,
				message: err instanceof Error ? err.message : String(err)
			});
		} finally {
			busy = false;
		}
	}

	function pushLog(entry: LogEntry) {
		log = [entry, ...log].slice(0, 50);
	}

	async function startCamera() {
		if (!browser || !videoEl) return;
		cameraError = null;
		try {
			const hasCam = await QrScanner.hasCamera();
			if (!hasCam) {
				cameraError = 'No camera detected.';
				return;
			}
			scanner = new QrScanner(
				videoEl,
				(result) => handleRawScan(result.data),
				{
					highlightScanRegion: true,
					highlightCodeOutline: true,
					preferredCamera: 'environment'
				}
			);
			await scanner.start();
			cameraActive = true;
		} catch (err) {
			cameraError = err instanceof Error ? err.message : String(err);
		}
	}

	async function stopCamera() {
		if (!scanner) return;
		scanner.stop();
		scanner.destroy();
		scanner = null;
		cameraActive = false;
	}

	async function toggleCamera() {
		if (cameraActive) await stopCamera();
		else await startCamera();
	}

	function onManualSubmit(e: Event) {
		e.preventDefault();
		if (!manualSku.trim()) return;
		const value = manualSku;
		manualSku = '';
		handleRawScan(value);
		// USB scanners send Enter and then the input clears — we focus
		// for the next read.
		manualInputEl?.focus();
	}

	onMount(() => {
		if (browser) manualInputEl?.focus();
	});
	onDestroy(() => {
		void stopCamera();
	});

	function formatTime(d: Date): string {
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Picking & movement</p>
		<h1 class="headline text-3xl">Scan</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Camera for the phone, USB scanner for the bench. Pick a mode first — every scan after that
			runs the same action.
		</p>
	</header>

	<!-- ============= Mode picker ============= -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each Object.entries(MODES) as [m, meta] (m)}
			{@const active = mode === m}
			<button
				type="button"
				onclick={() => (mode = m as Mode)}
				class="panel flex flex-col gap-0.5 px-3 py-3 text-left transition-colors {active
					? 'border-[color:var(--color-gold)] bg-[color:var(--color-selected)]'
					: 'hover:border-[color:var(--color-gold-dim)]'}"
			>
				<span class="text-sm font-semibold text-[color:var(--color-ink)]">{meta.label}</span>
				<span class="text-[11px] text-[color:var(--color-ink-3)]">{meta.sub}</span>
			</button>
		{/each}
	</div>

	{#if mode === 'out' || mode === 'in' || mode === 'build'}
		<div class="panel grid gap-3 px-4 py-3 sm:grid-cols-[120px_1fr]">
			<div class="space-y-1">
				<label for="qty" class="eyebrow block">Qty per scan</label>
				<input
					id="qty"
					type="number"
					min="1"
					max="999"
					bind:value={qty}
					class="field font-mono"
				/>
			</div>
			<div class="space-y-1">
				<label for="note" class="eyebrow block">
					Note
					<span class="lowercase tracking-normal text-[color:var(--color-ink-4)]">
						(optional, applied to every scan)
					</span>
				</label>
				<input
					id="note"
					type="text"
					bind:value={note}
					placeholder={mode === 'build'
						? 'e.g. SA Telecaster build #003'
						: mode === 'out'
							? 'e.g. NAMM booth sale'
							: 'Optional note'}
					class="field"
				/>
			</div>
		</div>
	{/if}

	<!-- ============= Camera + manual input ============= -->
	<div class="grid gap-4 lg:grid-cols-2">
		<div class="panel space-y-3 px-4 py-4">
			<div class="flex items-center justify-between">
				<p class="eyebrow">Camera</p>
				<button type="button" class="btn-ghost px-3 py-1.5 text-xs" onclick={toggleCamera}>
					{cameraActive ? 'Stop camera' : 'Start camera'}
				</button>
			</div>
			<div
				class="relative aspect-square overflow-hidden rounded border border-[color:var(--color-line-dim)] bg-black"
			>
				<video bind:this={videoEl} class="h-full w-full object-cover" muted playsinline></video>
				{#if !cameraActive}
					<div
						class="absolute inset-0 flex items-center justify-center text-center text-xs italic text-[color:var(--color-ink-3)]"
					>
						Camera off · click Start to enable
					</div>
				{/if}
			</div>
			{#if cameraError}
				<p class="text-xs text-[color:var(--color-rust-bright)]">
					{cameraError}
				</p>
			{/if}
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				Phones work best. Hold the label ~6 inches from the lens; the white outline confirms a
				lock.
			</p>
		</div>

		<div class="panel space-y-3 px-4 py-4">
			<p class="eyebrow">Or paste / scan with a USB reader</p>
			<form onsubmit={onManualSubmit} class="space-y-2">
				<input
					bind:this={manualInputEl}
					bind:value={manualSku}
					type="text"
					autocomplete="off"
					autocapitalize="characters"
					placeholder="Paste SKU or URL, or hit Enter from a USB scanner…"
					class="field font-mono uppercase"
				/>
				<button type="submit" class="btn-primary w-full" disabled={busy}>
					{busy ? 'Working…' : `Apply: ${MODES[mode].label}`}
				</button>
			</form>
			<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
				USB scanners typically emit the SKU then press Enter — focus stays on this field so
				rapid scans work without touching the mouse.
			</p>
		</div>
	</div>

	<!-- ============= Scan log ============= -->
	<section class="space-y-2">
		<div class="flex items-baseline justify-between">
			<p class="eyebrow">Recent scans</p>
			{#if log.length > 0}
				<button
					type="button"
					class="btn-ghost px-2 py-1 text-[11px]"
					onclick={() => (log = [])}
				>
					Clear
				</button>
			{/if}
		</div>

		{#if log.length === 0}
			<div class="panel px-6 py-12 text-center">
				<p class="text-sm italic text-[color:var(--color-ink-3)]">
					Scan a code and the result appears here. Latest at top.
				</p>
			</div>
		{:else}
			<div class="panel overflow-hidden">
				<ul class="divide-y divide-[color:var(--color-line-dim)]">
					{#each log as entry, i (i)}
						<li
							class="flex items-baseline gap-3 px-3 py-2"
							class:bg-rust={!entry.ok}
							style={!entry.ok ? 'background: rgba(162,66,40,0.08)' : ''}
						>
							<span
								class="font-mono text-[10px] text-[color:var(--color-ink-4)]"
								title={entry.at.toISOString()}
							>
								{formatTime(entry.at)}
							</span>

							<span class={MODES[entry.mode].pill}>
								{MODES[entry.mode].label}
							</span>

							<div class="min-w-0 flex-1">
								{#if entry.item}
									<a
										href="/items/{encodeURIComponent(entry.sku)}"
										class="font-mono text-xs text-[color:var(--color-gold)] hover:text-[color:var(--color-gold-bright)]"
									>
										{entry.sku}
									</a>
									<span class="ml-2 text-xs text-[color:var(--color-ink-2)]">
										{entry.item.title}
									</span>
									{#if entry.item.tracking_mode === 'stocked'}
										<span class="ml-2 font-mono text-[10px] text-[color:var(--color-ink-3)]">
											qty {entry.item.stock_qty}
										</span>
									{/if}
								{:else}
									<span class="font-mono text-xs text-[color:var(--color-ink-3)]">
										{entry.sku}
									</span>
								{/if}
							</div>

							<span
								class="flex-shrink-0 text-xs {entry.ok
									? 'text-[color:var(--color-moss-bright)]'
									: 'text-[color:var(--color-rust-bright)]'}"
							>
								{entry.message}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>
</section>
