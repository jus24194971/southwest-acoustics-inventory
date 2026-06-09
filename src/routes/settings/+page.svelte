<script lang="ts">
	import { page } from '$app/state';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	import InfoTip from '$lib/components/InfoTip.svelte';

	const savedJustNow = $derived(page.url.searchParams.get('saved') === '1');
	const ebayFlag = $derived(page.url.searchParams.get('ebay'));
	const ebayReason = $derived(page.url.searchParams.get('reason'));

	// One-shot "Copied" feedback on the notification copy buttons.
	let copiedFlash = $state<string | null>(null);
	async function copyText(value: string, key: string) {
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			copiedFlash = key;
			setTimeout(() => {
				if (copiedFlash === key) copiedFlash = null;
			}, 1500);
		} catch (err) {
			console.error('clipboard write failed', err);
		}
	}

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

	<!-- ============= eBay ============= -->
	<div class="panel space-y-4 px-6 py-5">
		<div class="flex items-baseline justify-between gap-3">
			<div>
				<p class="eyebrow inline-flex items-center gap-0.5">
					eBay
					<InfoTip title="How eBay connection works">
						<p>
							eBay needs two credentials: an <strong>app token</strong> (from your App
							ID + Cert ID, already set as secrets) for reading categories and item
							specifics, and a <strong>user token</strong> you authorize by clicking
							Connect — that's what actually lists items.
						</p>
						<p>
							The user token is stored in the database (not a secret file), because
							it's minted at the moment you click Connect.
						</p>
					</InfoTip>
				</p>
				<p class="mt-1 text-xs text-[color:var(--color-ink-3)]">
					Connect your eBay seller account to cross-list inventory.
				</p>
			</div>
		</div>

		<!-- eBay status banners -->
		{#if ebayFlag === 'connected'}
			<div class="rounded border border-[color:var(--color-moss)] bg-[color:var(--color-input)] px-3 py-2">
				<p class="text-sm text-[color:var(--color-moss-bright)]">
					✓ eBay account connected. You can now push listings.
				</p>
			</div>
		{:else if ebayFlag === 'disconnected'}
			<div class="rounded border border-[color:var(--color-gold-dim)] bg-[color:var(--color-input)] px-3 py-2">
				<p class="text-sm text-[color:var(--color-gold-bright)]">
					eBay account disconnected. Your listings on eBay are untouched — this just
					cleared the saved token here.
				</p>
			</div>
		{:else if ebayFlag === 'location_created'}
			<div class="rounded border border-[color:var(--color-moss)] bg-[color:var(--color-input)] px-3 py-2">
				<p class="text-sm text-[color:var(--color-moss-bright)]">
					✓ eBay inventory location created. Offers can now reference it.
				</p>
			</div>
		{:else if ebayFlag === 'declined'}
			<div class="rounded border border-[color:var(--color-rust)] bg-[color:var(--color-input)] px-3 py-2">
				<p class="text-sm text-[color:var(--color-rust-bright)]">
					eBay authorization was declined. Click Connect to try again.
				</p>
			</div>
		{:else if ebayFlag === 'error'}
			<div class="rounded border border-[color:var(--color-rust)] bg-[color:var(--color-input)] px-3 py-2">
				<p class="text-sm text-[color:var(--color-rust-bright)]">
					eBay connection error{ebayReason ? `: ${ebayReason}` : ''}.
				</p>
			</div>
		{/if}

		{#if form?.ebayError}
			<div class="rounded border border-[color:var(--color-rust)] bg-[color:var(--color-input)] px-3 py-2">
				<p class="text-sm text-[color:var(--color-rust-bright)]">{form.ebayError}</p>
			</div>
		{/if}

		<!-- Status rows -->
		<ul class="space-y-2 text-sm">
			<li class="flex flex-wrap items-baseline gap-3">
				<span class={data.ebay.appConfigured && data.ebay.appTokenOk ? 'pill-success' : data.ebay.appConfigured ? 'pill-danger' : 'pill-warn'}>
					{data.ebay.appConfigured ? (data.ebay.appTokenOk ? 'Working' : 'Error') : 'Not set'}
				</span>
				<span class="font-medium text-[color:var(--color-ink)]">App token (categories + specifics)</span>
				<span class="flex-1 text-xs text-[color:var(--color-ink-3)]">
					{#if !data.ebay.appConfigured}
						Set <span class="font-mono">EBAY_CLIENT_ID</span> + <span class="font-mono">EBAY_CLIENT_SECRET</span> as Pages secrets.
					{:else if data.ebay.appTokenOk}
						App ID + Cert ID accepted by eBay.
					{:else}
						Credentials set but eBay rejected them{data.ebay.error ? ` — ${data.ebay.error}` : ''}.
					{/if}
				</span>
			</li>

			<li class="flex flex-wrap items-baseline gap-3 border-t border-[color:var(--color-line-dim)] pt-2">
				<span class={data.ebay.userConnected ? 'pill-success' : 'pill-warn'}>
					{data.ebay.userConnected ? 'Connected' : 'Not connected'}
				</span>
				<span class="font-medium text-[color:var(--color-ink)]">Seller account (listing)</span>
				<span class="flex-1 text-xs text-[color:var(--color-ink-3)]">
					{#if data.ebay.userConnected}
						Connected{data.ebay.accountLabel ? ` as ${data.ebay.accountLabel}` : ''}.
						{#if data.ebay.refreshExpiresAt}
							Re-auth before {new Date(data.ebay.refreshExpiresAt).toLocaleDateString()}.
						{/if}
					{:else}
						Click Connect to authorize listing on your behalf.
					{/if}
				</span>
			</li>

			<li class="flex flex-wrap items-baseline gap-3 border-t border-[color:var(--color-line-dim)] pt-2">
				<span class={data.ebay.locationKey ? 'pill-success' : 'pill-warn'}>
					{data.ebay.locationKey ? 'Set' : 'Not set'}
				</span>
				<span class="font-medium text-[color:var(--color-ink)]">Inventory location</span>
				<span class="flex-1 text-xs text-[color:var(--color-ink-3)]">
					{#if data.ebay.locationKey}
						<span class="font-mono">{data.ebay.locationKey}</span> — every offer references this.
					{:else}
						Required before publishing. Create one below once connected.
					{/if}
				</span>
			</li>
		</ul>

		<!-- Connect / Disconnect -->
		<div class="flex flex-wrap gap-2 border-t border-[color:var(--color-line-dim)] pt-4">
			{#if !data.ebay.appConfigured}
				<p class="text-[11px] italic text-[color:var(--color-ink-4)]">
					Set the App ID + Cert ID secrets first, then redeploy — Connect activates after that.
				</p>
			{:else if !data.ebay.ruNameConfigured}
				<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
					<span class="font-mono">EBAY_RU_NAME</span> isn't set — Connect needs the RuName to build the consent URL.
				</p>
			{:else if !data.ebay.userConnected}
				<!-- Plain link: /api/ebay/oauth/start 302-redirects to eBay's consent screen. -->
				<a href="/api/ebay/oauth/start" class="btn-primary px-4 py-2 text-sm">
					Connect eBay account
				</a>
			{:else}
				<form method="POST" action="?/disconnectEbay">
					<button
						type="submit"
						class="btn-ghost px-4 py-2 text-sm"
						style="color: var(--color-rust-bright)"
					>
						Disconnect eBay
					</button>
				</form>
				<a href="/api/ebay/oauth/start" class="btn-ghost px-4 py-2 text-sm">
					Re-authorize
				</a>
			{/if}
		</div>

		<!-- Create location (only meaningful once connected) -->
		{#if data.ebay.userConnected}
			<form
				method="POST"
				action="?/createEbayLocation"
				class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4"
			>
				<p class="eyebrow inline-flex items-center gap-0.5">
					{data.ebay.locationKey ? 'Update' : 'Create'} inventory location
					<InfoTip title="Inventory location">
						<p>
							eBay requires every listing to ship from a registered location.
							This isn't shown publicly — it's used for shipping calculation and
							handling time. Minimum is country + postal code.
						</p>
					</InfoTip>
				</p>
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="space-y-1">
						<label for="location_name" class="eyebrow block text-[10px]">Location name</label>
						<input id="location_name" name="location_name" type="text" value="Southwest Acoustics" class="field py-1 text-sm" />
					</div>
					<div class="space-y-1">
						<label for="address_line1" class="eyebrow block text-[10px]">Address (optional)</label>
						<input id="address_line1" name="address_line1" type="text" placeholder="Street address" class="field py-1 text-sm" />
					</div>
					<div class="space-y-1">
						<label for="city" class="eyebrow block text-[10px]">City (optional)</label>
						<input id="city" name="city" type="text" class="field py-1 text-sm" />
					</div>
					<div class="space-y-1">
						<label for="state" class="eyebrow block text-[10px]">State (optional)</label>
						<input id="state" name="state" type="text" placeholder="e.g. TX" class="field py-1 text-sm" />
					</div>
					<div class="space-y-1">
						<label for="postal_code" class="eyebrow block text-[10px]">Postal code *</label>
						<input id="postal_code" name="postal_code" type="text" required class="field py-1 text-sm" />
					</div>
					<div class="space-y-1">
						<label for="country" class="eyebrow block text-[10px]">Country</label>
						<input id="country" name="country" type="text" value="US" maxlength="2" class="field py-1 text-sm font-mono uppercase" />
					</div>
				</div>
				<button type="submit" class="btn-ghost px-4 py-2 text-sm">
					{data.ebay.locationKey ? 'Update location' : 'Create location'}
				</button>
			</form>
		{/if}

		<!-- Marketplace deletion notification setup -->
		{#if data.ebay.appConfigured}
			<div class="space-y-3 rounded border border-[color:var(--color-line-dim)] p-4">
				<p class="eyebrow inline-flex items-center gap-0.5">
					Account-deletion notification
					<InfoTip title="Why eBay needs this">
						<p>
							eBay requires every production app to acknowledge "marketplace account
							deletion" notifications, or it can throttle your keyset. Register the
							endpoint + token below in the eBay dev portal under
							<strong>Alerts &amp; Notifications → Marketplace account deletion</strong>.
						</p>
						<p>
							⚠ The endpoint is hit by eBay's servers, not a browser, so it must be
							<strong>exempt from Cloudflare Access</strong>. Add a Bypass policy for
							path <code>/api/ebay/notifications</code> in Zero Trust → Access →
							Applications, or eBay's test will hit the Access login page.
						</p>
					</InfoTip>
				</p>

				<!-- Endpoint URL row -->
				<div class="flex items-start gap-2">
					<div class="min-w-0 flex-1">
						<p class="text-[10px] text-[color:var(--color-ink-4)]">Notification endpoint</p>
						<p class="truncate font-mono text-[11px] text-[color:var(--color-ink-2)]" title={data.ebayNotify.endpoint}>
							{data.ebayNotify.endpoint}
						</p>
					</div>
					<button
						type="button"
						class="shrink-0 rounded border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-2 py-1 font-mono text-[10px] text-[color:var(--color-gold-bright)] transition-colors hover:bg-[color:var(--color-hover)]"
						style="min-height: auto"
						onclick={() => copyText(data.ebayNotify.endpoint, 'endpoint')}
					>
						{copiedFlash === 'endpoint' ? '✓ Copied' : 'Copy'}
					</button>
				</div>

				<!-- Verification token row -->
				<div class="flex items-start gap-2">
					<div class="min-w-0 flex-1">
						<p class="text-[10px] text-[color:var(--color-ink-4)]">Verification token</p>
						{#if data.ebayNotify.verificationToken}
							<p class="truncate font-mono text-[11px] text-[color:var(--color-ink-2)]" title={data.ebayNotify.verificationToken}>
								{data.ebayNotify.verificationToken}
							</p>
						{:else}
							<p class="text-[11px] italic text-[color:var(--color-rust-bright)]">
								EBAY_VERIFICATION_TOKEN not set as a Pages secret.
							</p>
						{/if}
					</div>
					{#if data.ebayNotify.verificationToken}
						<button
							type="button"
							class="shrink-0 rounded border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-2 py-1 font-mono text-[10px] text-[color:var(--color-gold-bright)] transition-colors hover:bg-[color:var(--color-hover)]"
							style="min-height: auto"
							onclick={() => copyText(data.ebayNotify.verificationToken ?? '', 'token')}
						>
							{copiedFlash === 'token' ? '✓ Copied' : 'Copy'}
						</button>
					{/if}
				</div>

				<p class="text-[10px] italic text-[color:var(--color-ink-4)]">
					Paste both into eBay's dev portal, then add the Cloudflare Access bypass for
					<code>/api/ebay/notifications</code> (see the ⓘ above) before clicking "Send test
					notification".
				</p>
			</div>
		{/if}
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
