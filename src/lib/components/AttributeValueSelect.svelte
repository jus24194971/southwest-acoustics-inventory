<script lang="ts">
	import { untrack } from 'svelte';

	/**
	 * Dropdown for picking a 3-char attribute value, with two affordances
	 * beyond a regular <select>:
	 *
	 *  1. Each option renders as "Label (CODE)" so Dad sees plain English
	 *     and the SKU character together.
	 *  2. "+ Add new value…" at the bottom switches the cell into an
	 *     inline mini-form that POSTs to /api/attribute-values, then
	 *     selects the new value on success.
	 *  3. Selecting the special "UNQ" code surfaces a description
	 *     textarea (caller decides how to render that — we just emit
	 *     `value` and let the parent watch it).
	 *
	 * The component is dumb about which context it's serving — pass
	 * `contextKey` (e.g. 'color', 'pickup_type') along with the initial
	 * list of values. When the user adds a new value, the local list
	 * grows; the canonical source (the DB) is updated server-side.
	 */
	export interface AttributeValue {
		id: number;
		code: string;
		label: string;
	}

	let {
		contextKey,
		name,
		value = $bindable(''),
		initialValues = [],
		placeholder = '— pick a value —'
	}: {
		contextKey: string | null;
		name: string;
		value?: string;
		initialValues?: AttributeValue[];
		placeholder?: string;
	} = $props();

	const ADD_NEW = '__add_new__';

	// Capture initialValues once on mount. The parent (the form page)
	// can change props when navigating, in which case the component
	// remounts and re-initialises — exactly what we want.
	let values = $state<AttributeValue[]>(untrack(() => [...initialValues]));
	let mode = $state<'select' | 'adding'>('select');
	let newCode = $state('');
	let newLabel = $state('');
	let addError = $state<string | null>(null);
	let saving = $state(false);

	function onSelectChange(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		if (v === ADD_NEW) {
			mode = 'adding';
			// Don't change value yet — only commit on successful add.
			addError = null;
			newCode = '';
			newLabel = '';
		} else {
			value = v;
		}
	}

	async function submitNew() {
		if (!contextKey) {
			addError = 'No context to add to.';
			return;
		}
		const codeNorm = newCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
		const labelNorm = newLabel.trim();
		if (!codeNorm || codeNorm.length > 3) {
			addError = 'Code must be 1-3 letters/numbers.';
			return;
		}
		if (!labelNorm) {
			addError = 'Label required.';
			return;
		}
		saving = true;
		addError = null;
		try {
			const res = await fetch('/api/attribute-values', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					context_key: contextKey,
					code: codeNorm,
					label: labelNorm
				})
			});
			if (!res.ok) {
				const text = await res.text();
				addError = text || `HTTP ${res.status}`;
				return;
			}
			const json = (await res.json()) as { value: AttributeValue };
			// Insert sorted by label so the new value lands near its peers.
			values = [...values, json.value].sort((a, b) =>
				a.label.localeCompare(b.label)
			);
			value = json.value.code;
			mode = 'select';
			newCode = '';
			newLabel = '';
		} catch (err) {
			addError = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	function cancelAdd() {
		mode = 'select';
		newCode = '';
		newLabel = '';
		addError = null;
	}
</script>

{#if mode === 'adding'}
	<div
		class="space-y-2 rounded border border-[color:var(--color-gold-dim)] bg-[color:var(--color-hover)] p-3"
	>
		<p class="eyebrow">+ Add new value</p>
		<div class="grid grid-cols-[90px_1fr] gap-2">
			<input
				type="text"
				maxlength="3"
				bind:value={newCode}
				placeholder="BLK"
				class="field font-mono uppercase"
			/>
			<input
				type="text"
				bind:value={newLabel}
				placeholder="Display name (e.g. Black)"
				class="field"
			/>
		</div>
		<p class="text-[11px] italic text-[color:var(--color-ink-3)]">
			3-char code goes in the SKU. Display name is what shows everywhere else.
		</p>
		{#if addError}
			<p class="text-xs text-[color:var(--color-rust-bright)]">{addError}</p>
		{/if}
		<div class="flex gap-2">
			<button
				type="button"
				onclick={submitNew}
				disabled={saving}
				class="btn-primary px-3 py-1.5 text-xs"
			>
				{saving ? 'Adding…' : 'Add'}
			</button>
			<button type="button" onclick={cancelAdd} class="btn-ghost px-3 py-1.5 text-xs">
				Cancel
			</button>
		</div>
		<!-- Hidden field so the surrounding form still sees a value while
		     the inline editor is open. Submitted value is whatever was
		     previously selected (often empty). -->
		<input type="hidden" {name} {value} />
	</div>
{:else}
	<select {name} bind:value onchange={onSelectChange} class="field">
		<option value="">{placeholder}</option>
		{#each values as v (v.id)}
			<option value={v.code}>{v.label} ({v.code})</option>
		{/each}
		{#if contextKey}
			<option value={ADD_NEW} style="color: var(--color-gold-bright)">
				+ Add new value…
			</option>
		{/if}
	</select>
{/if}
