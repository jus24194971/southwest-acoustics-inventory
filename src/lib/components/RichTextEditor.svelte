<script lang="ts">
	/**
	 * TipTap-based WYSIWYG editor. Outputs HTML that pastes cleanly into
	 * Squarespace's editor or our description rendering pipeline. Dad
	 * types like he's in any word processor; the form receives the
	 * HTML via a hidden input named by `name`.
	 *
	 * Why not a textarea: raw HTML editing is painful for non-developers.
	 * Why not a heavyweight editor: TipTap's starter kit + link is ~80KB
	 * compressed and gives Bold / Italic / Lists / Headings / Links —
	 * which is what Squarespace product descriptions actually need.
	 *
	 * The editor is only created in the browser (TipTap uses DOM APIs);
	 * we guard with `browser` so SSR doesn't crash.
	 */
	import { onMount, onDestroy, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Link from '@tiptap/extension-link';

	let {
		name,
		initialHtml = '',
		placeholder = 'Write a description…',
		minHeightRem = 14
	}: {
		name: string;
		initialHtml?: string;
		placeholder?: string;
		minHeightRem?: number;
	} = $props();

	let editorEl: HTMLDivElement | undefined = $state();
	let editor: Editor | null = null;
	let currentHtml = $state<string>(untrack(() => initialHtml));

	// Track toolbar button active state reactively.
	let toolbarTick = $state(0);
	const bump = () => (toolbarTick = toolbarTick + 1);

	onMount(() => {
		if (!browser || !editorEl) return;
		editor = new Editor({
			element: editorEl,
			extensions: [
				StarterKit.configure({
					heading: { levels: [2, 3] }
				}),
				Link.configure({
					openOnClick: false,
					HTMLAttributes: { rel: 'noopener', target: '_blank' }
				})
			],
			content: untrack(() => initialHtml),
			onUpdate: ({ editor }) => {
				currentHtml = editor.getHTML();
			},
			onSelectionUpdate: bump,
			onTransaction: bump,
			editorProps: {
				attributes: {
					class: 'tt-content'
				}
			}
		});
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});

	/** Replace the editor's contents from outside (e.g. AI suggestion).
	 *  Exported via $bindable for parents that need it. */
	export function setHtml(html: string) {
		currentHtml = html;
		editor?.commands.setContent(html, { emitUpdate: true });
	}

	function isActive(name: string, attrs?: Record<string, unknown>): boolean {
		// referencing toolbarTick subscribes the button to editor changes
		void toolbarTick;
		return editor?.isActive(name, attrs) ?? false;
	}

	function toggleBold() {
		editor?.chain().focus().toggleBold().run();
	}
	function toggleItalic() {
		editor?.chain().focus().toggleItalic().run();
	}
	function toggleH2() {
		editor?.chain().focus().toggleHeading({ level: 2 }).run();
	}
	function toggleH3() {
		editor?.chain().focus().toggleHeading({ level: 3 }).run();
	}
	function toggleBulletList() {
		editor?.chain().focus().toggleBulletList().run();
	}
	function toggleOrderedList() {
		editor?.chain().focus().toggleOrderedList().run();
	}
	function toggleBlockquote() {
		editor?.chain().focus().toggleBlockquote().run();
	}
	function setLink() {
		const existing = (editor?.getAttributes('link')?.href as string | undefined) ?? '';
		const url = prompt('Link URL (leave empty to remove):', existing);
		if (url === null) return;
		if (url === '') {
			editor?.chain().focus().extendMarkRange('link').unsetLink().run();
		} else {
			editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
		}
	}
	function clearFormatting() {
		editor?.chain().focus().clearNodes().unsetAllMarks().run();
	}
</script>

<div class="rich-editor rounded border border-[color:var(--color-line)] bg-[color:var(--color-input)]">
	<!-- Toolbar -->
	<div
		class="flex flex-wrap items-center gap-1 border-b border-[color:var(--color-line-dim)] bg-[color:var(--color-panel-2)] px-2 py-1.5"
	>
		<button
			type="button"
			onclick={toggleBold}
			class="tt-btn"
			class:tt-active={isActive('bold')}
			title="Bold (Ctrl+B)"
		>
			<span class="font-bold">B</span>
		</button>
		<button
			type="button"
			onclick={toggleItalic}
			class="tt-btn"
			class:tt-active={isActive('italic')}
			title="Italic (Ctrl+I)"
		>
			<span class="italic">I</span>
		</button>
		<span class="tt-sep"></span>
		<button
			type="button"
			onclick={toggleH2}
			class="tt-btn"
			class:tt-active={isActive('heading', { level: 2 })}
			title="Heading"
		>
			H2
		</button>
		<button
			type="button"
			onclick={toggleH3}
			class="tt-btn"
			class:tt-active={isActive('heading', { level: 3 })}
			title="Subheading"
		>
			H3
		</button>
		<span class="tt-sep"></span>
		<button
			type="button"
			onclick={toggleBulletList}
			class="tt-btn"
			class:tt-active={isActive('bulletList')}
			title="Bullet list"
		>
			• list
		</button>
		<button
			type="button"
			onclick={toggleOrderedList}
			class="tt-btn"
			class:tt-active={isActive('orderedList')}
			title="Numbered list"
		>
			1. list
		</button>
		<span class="tt-sep"></span>
		<button
			type="button"
			onclick={toggleBlockquote}
			class="tt-btn"
			class:tt-active={isActive('blockquote')}
			title="Blockquote"
		>
			❝
		</button>
		<button type="button" onclick={setLink} class="tt-btn" class:tt-active={isActive('link')} title="Link">
			🔗
		</button>
		<span class="tt-sep"></span>
		<button type="button" onclick={clearFormatting} class="tt-btn" title="Clear formatting">
			✕ fmt
		</button>
	</div>

	<!-- Content area -->
	<div
		bind:this={editorEl}
		class="tt-host px-3 py-3 text-sm"
		style="min-height: {minHeightRem}rem"
		data-placeholder={placeholder}
	></div>

	<!-- Hidden input carries the HTML to the surrounding form -->
	<input type="hidden" {name} value={currentHtml} />
</div>

<style>
	.tt-btn {
		min-width: 28px;
		min-height: 28px;
		padding: 4px 8px;
		font-family: var(--font-sans);
		font-size: 12px;
		color: var(--color-ink-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 3px;
		cursor: pointer;
		transition: all 0.12s ease;
	}
	.tt-btn:hover {
		background: var(--color-hover);
		color: var(--color-ink);
		border-color: var(--color-line);
	}
	.tt-active {
		background: var(--color-selected);
		color: var(--color-ink);
		border-color: var(--color-gold-dim);
	}
	.tt-sep {
		width: 1px;
		height: 18px;
		margin: 0 4px;
		background: var(--color-line-dim);
	}

	/* TipTap content area */
	.tt-host :global(.tt-content) {
		outline: none;
		color: var(--color-ink);
		min-height: inherit;
	}
	.tt-host :global(.tt-content p) {
		margin: 0.5rem 0;
	}
	.tt-host :global(.tt-content p:first-child) {
		margin-top: 0;
	}
	.tt-host :global(.tt-content p:last-child) {
		margin-bottom: 0;
	}
	.tt-host :global(.tt-content h2) {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 1.15rem;
		font-style: italic;
		margin: 0.75rem 0 0.25rem;
		color: var(--color-ink);
	}
	.tt-host :global(.tt-content h3) {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 1rem;
		font-style: italic;
		margin: 0.5rem 0 0.25rem;
		color: var(--color-ink-2);
	}
	.tt-host :global(.tt-content ul) {
		list-style: disc;
		margin: 0.5rem 0;
		padding-left: 1.25rem;
	}
	.tt-host :global(.tt-content ol) {
		list-style: decimal;
		margin: 0.5rem 0;
		padding-left: 1.25rem;
	}
	.tt-host :global(.tt-content li) {
		margin: 0.125rem 0;
	}
	.tt-host :global(.tt-content blockquote) {
		border-left: 3px solid var(--color-gold-dim);
		padding-left: 0.75rem;
		margin: 0.5rem 0;
		color: var(--color-ink-2);
		font-style: italic;
	}
	.tt-host :global(.tt-content a) {
		color: var(--color-gold-bright);
		text-decoration: underline;
	}
	.tt-host :global(.tt-content strong) {
		color: var(--color-ink);
		font-weight: 600;
	}
	.tt-host :global(.tt-content em) {
		font-style: italic;
	}
	/* Empty-state placeholder via :empty pseudo on the content wrapper.
	   TipTap renders an empty <p><br></p> for blank state; target it. */
	.tt-host :global(.tt-content p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		float: left;
		color: var(--color-ink-4);
		pointer-events: none;
		height: 0;
		font-style: italic;
	}
</style>
