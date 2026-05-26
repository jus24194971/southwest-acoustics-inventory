<script lang="ts">
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const savedJustNow = $derived(page.url.searchParams.get('saved') === '1');

	const STATE_PILL: Record<string, string> = {
		ok: 'pill-success',
		missing: 'pill-warn',
		error: 'pill-danger'
	};
	const STATE_LABEL: Record<string, string> = {
		ok: 'Connected',
		missing: 'Not configured',
		error: 'Error'
	};
</script>

<section class="space-y-6">
	<header class="space-y-1">
		<p class="eyebrow">Configuration</p>
		<h1 class="headline text-3xl">Settings</h1>
		<p class="text-sm text-[color:var(--color-ink-3)]">
			Accessibility, sync state, and connections to outside services.
		</p>
	</header>

	{#if savedJustNow}
		<div class="panel px-4 py-3" style="border-color: var(--color-moss)">
			<p class="text-sm text-[color:var(--color-moss-bright)]">Settings saved.</p>
		</div>
	{/if}

	<!-- ============= Accessibility ============= -->
	<form method="POST" action="?/updatePreferences" class="panel space-y-5 px-6 py-5">
		<div>
			<p class="eyebrow">Accessibility</p>
			<p class="mt-1 text-xs text-[color:var(--color-ink-3)]">
				Applies immediately on save. Settings sync across whichever device you're signed into.
			</p>
		</div>

		<div class="space-y-1.5">
			<label for="font_scale" class="eyebrow block">Font size</label>
			<select id="font_scale" name="font_scale" class="field max-w-xs">
				<option value="normal" selected={data.preferences.font_scale === 'normal'}>
					Normal (100%)
				</option>
				<option value="large" selected={data.preferences.font_scale === 'large'}>
					Large (120%)
				</option>
				<option value="xlarge" selected={data.preferences.font_scale === 'xlarge'}>
					Extra large (140%)
				</option>
			</select>
			<p class="text-[11px] text-[color:var(--color-ink-3)]">
				Scales everything proportionally — easier on the eyes when Dad is reading off the shop
				floor.
			</p>
		</div>

		<label class="flex items-center gap-3">
			<input
				type="checkbox"
				name="high_contrast"
				checked={data.preferences.high_contrast}
				class="h-4 w-4 accent-[color:var(--color-gold)]"
				style="min-height: auto"
			/>
			<div>
				<span class="text-sm font-medium text-[color:var(--color-ink)]">High contrast mode</span>
				<p class="text-[11px] text-[color:var(--color-ink-3)]">
					Brighter text + sharper colour separation. Useful in bright daylight or against dusty
					backgrounds.
				</p>
			</div>
		</label>

		{#if form?.prefError}
			<p class="text-xs text-[color:var(--color-rust-bright)]">{form.prefError}</p>
		{/if}

		<div class="border-t border-[color:var(--color-line-dim)] pt-4">
			<button type="submit" class="btn-primary">Save settings</button>
		</div>
	</form>

	<!-- ============= Connections ============= -->
	<div class="panel space-y-3 px-6 py-5">
		<div>
			<p class="eyebrow">Connections</p>
			<p class="mt-1 text-xs text-[color:var(--color-ink-3)]">
				Status of the outside services this app talks to. To add or rotate credentials, use
				<span class="font-mono text-[color:var(--color-ink-2)]">wrangler pages secret put</span>
				from the project folder — never paste keys into the UI.
			</p>
		</div>

		<ul class="space-y-2">
			{#each data.connections as conn (conn.name)}
				<li class="flex flex-wrap items-baseline gap-3 border-t border-[color:var(--color-line-dim)] pt-2 first:border-t-0 first:pt-0">
					<span class={STATE_PILL[conn.state] ?? 'pill'}>
						{STATE_LABEL[conn.state] ?? conn.state}
					</span>
					<span class="font-medium text-[color:var(--color-ink)]">{conn.name}</span>
					<span class="flex-1 text-xs text-[color:var(--color-ink-3)]">{conn.detail}</span>
				</li>
			{/each}
		</ul>
	</div>

	<!-- ============= About ============= -->
	<div class="panel px-6 py-5">
		<p class="eyebrow mb-2">About</p>
		<dl class="space-y-1 text-sm">
			<div class="flex justify-between">
				<dt class="text-[color:var(--color-ink-3)]">Version</dt>
				<dd class="font-mono">v0.0.1</dd>
			</div>
			<div class="flex justify-between">
				<dt class="text-[color:var(--color-ink-3)]">Source</dt>
				<dd>
					<a
						href="https://github.com/jus24194971/southwest-acoustics-inventory"
						target="_blank"
						rel="noopener"
						class="text-[color:var(--color-gold-bright)] hover:underline"
					>
						github.com/jus24194971/southwest-acoustics-inventory
					</a>
				</dd>
			</div>
			<div class="flex justify-between">
				<dt class="text-[color:var(--color-ink-3)]">Sister app</dt>
				<dd class="text-[color:var(--color-ink-2)]">
					Listing Studio (Reverb / eBay / Etsy posting)
				</dd>
			</div>
		</dl>
	</div>
</section>
