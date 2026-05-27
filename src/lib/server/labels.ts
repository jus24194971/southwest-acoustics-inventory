/**
 * Label PDF rendering for the DYMO LabelWriter.
 *
 * Two label kinds share the same renderer — they both fit the
 * 19×64mm landscape layout, just with different content:
 *
 *   Item label:
 *     ┌─────────┬──────────────────────────────┐
 *     │         │  Southwest Acoustics         │
 *     │  [QR]   │  CAT-BRAND-MODEL-COND-YY-SEQ │
 *     │         │  A1-A2-A3-A4-A5              │
 *     │         │  Item title (truncated)      │
 *     └─────────┴──────────────────────────────┘
 *
 *   Bin label:
 *     ┌─────────┬──────────────────────────────┐
 *     │         │  Southwest Acoustics         │
 *     │  [QR]   │  GAR / Main Cabinet / D1     │
 *     │         │  A-12                        │
 *     │         │  Friendly name (truncated)   │
 *     └─────────┴──────────────────────────────┘
 *
 * Both encode a URL in the QR — scanning takes the phone straight
 * to /items/<sku> or /bins/<id>.
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import qrcode from 'qrcode-generator';

/** 1mm in PDF points. PDF's native unit is the typographic point
 *  (1/72 inch); 1 inch = 25.4mm, so 1mm ≈ 2.8346 pt. */
const MM = 2.8346456693;

export interface LabelTemplate {
	/** Long edge of the label, in millimetres. */
	widthMm: number;
	/** Short edge of the label, in millimetres. */
	heightMm: number;
	/** Display name surfaced in the print UI. */
	label: string;
}

export const LABEL_TEMPLATES: Record<string, LabelTemplate> = {
	LW_DURABLE_19x64: {
		widthMm: 64,
		heightMm: 19,
		label: 'DYMO LW Durable 19×64mm (NA 1933085)'
	},
	DYMO_30334: {
		widthMm: 57.15,
		heightMm: 31.75,
		label: 'DYMO 30334 Multi-Purpose (2.25" × 1.25")'
	},
	DYMO_30330: {
		widthMm: 50.8,
		heightMm: 19,
		label: 'DYMO 30330 File Folder (3/4" × 2")'
	},
	DYMO_30252: {
		widthMm: 88.9,
		heightMm: 28.6,
		label: 'DYMO 30252 Address (1.125" × 3.5")'
	},
	DYMO_30320: {
		widthMm: 88.9,
		heightMm: 25.4,
		label: 'DYMO 30320 Address (1" × 3.5")'
	},
	PRIMERA_LX610_2x3: {
		widthMm: 76.2,
		heightMm: 50.8,
		label: 'Primera LX-610 Color 2″ × 3″'
	}
};

export type LabelTemplateCode = keyof typeof LABEL_TEMPLATES;
export const DEFAULT_TEMPLATE: LabelTemplateCode = 'LW_DURABLE_19x64';

export interface ItemLabel {
	kind: 'item';
	sku: string;
	title: string;
	url: string; // what the QR encodes
	/** Optional description text — rendered only by the large-format
	 *  renderer (Primera LX-610 etc.). DYMO labels ignore this. May
	 *  contain HTML; the renderer strips tags. */
	description?: string | null;
}

export interface BinLabel {
	kind: 'bin';
	code: string;
	name: string | null;
	path: string;
	url: string;
}

export type Label = ItemLabel | BinLabel;

export interface BuildPdfOptions {
	template?: LabelTemplateCode;
	/** Repeat each label this many times. Useful for stocked items
	 *  where Dad might want N identical labels (one per object) or
	 *  for bins where multiple identical labels are needed. */
	copiesPerLabel?: number;
}

/**
 * Build a multi-page PDF where each page is one label.
 *
 * The returned Uint8Array can be streamed back as a Response with
 * content-type: application/pdf — most browsers open it inline in
 * the PDF viewer where the user hits Print and picks the DYMO.
 */
export async function buildLabelsPdf(
	labels: Label[],
	options: BuildPdfOptions = {}
): Promise<Uint8Array> {
	const templateCode = options.template ?? DEFAULT_TEMPLATE;
	const template = LABEL_TEMPLATES[templateCode];
	const copies = Math.max(1, options.copiesPerLabel ?? 1);

	const widthPt = template.widthMm * MM;
	const heightPt = template.heightMm * MM;

	const doc = await PDFDocument.create();
	doc.setTitle('Southwest Acoustics labels');
	doc.setProducer('SW Acoustics Inventory');

	const monoFont = await doc.embedFont(StandardFonts.Courier);
	const monoBold = await doc.embedFont(StandardFonts.CourierBold);
	const sansFont = await doc.embedFont(StandardFonts.Helvetica);
	const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
	const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
	// TimesBoldItalic stands in for Cambria-BoldItalic (which lives on
	// Windows but isn't a PDF standard font). Used only for the "SA"
	// monogram drawn in the corner of every label.
	const timesItalicBold = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);

	const fonts: LabelFonts = {
		monoFont,
		monoBold,
		sansFont,
		sansBold,
		italic,
		timesItalicBold
	};

	for (const label of labels) {
		for (let copy = 0; copy < copies; copy++) {
			const page = doc.addPage([widthPt, heightPt]);
			await renderLabel(doc, page, label, template, fonts);
		}
	}

	return await doc.save();
}

interface LabelFonts {
	monoFont: PDFFont;
	monoBold: PDFFont;
	sansFont: PDFFont;
	sansBold: PDFFont;
	italic: PDFFont;
	timesItalicBold: PDFFont; // for the "SA" monogram
}

// --- Brand palette for the SA monogram --------------------------------
// Matches the SW Listing Studio icon generator (scripts/generate_icon.py):
//   bg    = #1B1813 (--bg-shell)
//   panel = #26211A (--bg-panel)
//   gold  = #D6B074 (--gold-bright)
//   gold-dim = #7A6238 (--gold-dim)
const SA_BG = rgb(0.106, 0.094, 0.075);
const SA_BG_PANEL = rgb(0.149, 0.129, 0.102);
const SA_GOLD = rgb(0.839, 0.690, 0.455);
const SA_GOLD_DIM = rgb(0.478, 0.384, 0.220);

/**
 * Draw the SA monogram (italic gold "SA" on dark-brown square) at the
 * given position and size. Mirrors the listing-studio icon generator:
 * at ≥12pt the icon gets a subtle inset panel + gold-dim ring; below
 * that it's a plain dark square (rings turn to noise on tiny labels).
 *
 * `size` is in PDF points (pt). Use `mm * MM` to convert.
 */
function drawSaIcon(
	page: PDFPage,
	x: number,
	y: number,
	size: number,
	fonts: LabelFonts
): void {
	page.drawRectangle({
		x,
		y,
		width: size,
		height: size,
		color: SA_BG
	});

	// Inset panel + ring only at sizes where 1-2pt detail reads cleanly.
	const SHOW_RING_MIN_PT = 18;
	if (size >= SHOW_RING_MIN_PT) {
		const inset = Math.max(0.6, size / 32);
		const ringWidth = Math.max(0.3, size / 96);
		page.drawRectangle({
			x: x + inset,
			y: y + inset,
			width: size - 2 * inset,
			height: size - 2 * inset,
			color: SA_BG_PANEL,
			borderColor: SA_GOLD_DIM,
			borderWidth: ringWidth
		});
	}

	// "SA" letters — italic at the larger sizes (matches the Cambria
	// Italic look in the Python generator), upright bold when the
	// label is tiny so the diagonal A stays defined.
	const useItalic = size >= 22;
	const font = useItalic ? fonts.timesItalicBold : fonts.sansBold;
	// Sized to take ~58% of the icon when italic, ~70% when upright —
	// italics carry more visual weight and need a bit more breathing room.
	const fontSizePt = useItalic ? size * 0.58 : size * 0.7;
	const text = 'SA';
	const textWidth = font.widthOfTextAtSize(text, fontSizePt);
	// Optical centering: cap-height ≈ 0.7 of font size; baseline lands
	// roughly cap-height below the visual top.
	const textX = x + (size - textWidth) / 2;
	const textY = y + (size - fontSizePt * 0.7) / 2;
	page.drawText(text, {
		x: textX,
		y: textY,
		size: fontSizePt,
		font,
		color: SA_GOLD
	});
}

/**
 * Unified label renderer — works for every label template, scaling QR
 * size, SA monogram size, content area, and font sizes off the label
 * dimensions. Drives both individual reprint and the bulk receive PDF
 * since they share buildLabelsPdf.
 *
 * Layout (landscape, any size):
 *
 *   ┌────────────────────────────────────────┐
 *   │                                  ┌──┐  │  SA icon, top-right
 *   │  ┌──────┐  CAT-BRAND-MODEL-COND  │SA│  │
 *   │  │      │  A1-A2-A3-A4-A5         └──┘  │
 *   │  │ QR   │  Item title                  │
 *   │  │      │  Description (when room)…    │
 *   │  └──────┘                                │
 *   └────────────────────────────────────────┘
 *
 * Decisions made dynamically per template:
 *   - QR size: fills the short edge minus padding, capped at 36mm
 *   - SA icon size: proportional to label height (~40%, capped at 16mm)
 *   - SKU font size: largest that fits one line; falls back to 5pt
 *   - Description: rendered only if vertical room remains after title
 *
 * For bin labels the content column becomes "BIG CODE / path / name"
 * instead of SKU + title + description.
 */
async function renderLabel(
	doc: PDFDocument,
	page: PDFPage,
	label: Label,
	template: LabelTemplate,
	fonts: LabelFonts
): Promise<void> {
	const widthMm = template.widthMm;
	const heightMm = template.heightMm;
	const widthPt = widthMm * MM;
	const heightPt = heightMm * MM;

	const ink = rgb(0.05, 0.05, 0.05);
	const inkSoft = rgb(0.25, 0.25, 0.25);

	// Compact labels get tighter margins so we can scrape every mm; the
	// LX-610 has room to breathe so its margins are larger.
	const small = heightMm < 30;
	const padMm = small ? 1.2 : 2.5; // top, right, bottom
	// Left padding is intentionally tight — every mm here is an mm the
	// content column doesn't get. 0.5mm sits right at the printer's
	// safe bleed line (Primera safe area is ~0.5mm, DYMO 0.5–1mm) so
	// we still print cleanly to the edge.
	const padLeftMm = 0.5;
	const gapMm = small ? 1.5 : 3;

	// ---- QR: bottom-left, scaled to the short edge --------------------
	const qrSizeMm = Math.min(heightMm - 2 * padMm, 36);
	const qrSizePt = qrSizeMm * MM;
	const qrX = padLeftMm * MM;
	const qrY = padMm * MM;
	const qrPng = await renderQrPng(label.url);
	const qrImage = await doc.embedPng(qrPng);
	page.drawImage(qrImage, {
		x: qrX,
		y: qrY,
		width: qrSizePt,
		height: qrSizePt
	});

	// ---- SA monogram: top-right ---------------------------------------
	// Square icon, sized as a fraction of label height capped at 16mm
	// (any bigger and it dominates the LX-610 layout). Floor at 4mm so
	// even on a 19mm DYMO the icon is recognizable rather than invisible.
	const iconSizeMm = Math.max(4, Math.min(heightMm * 0.42, 16));
	const iconX = (widthMm - padMm - iconSizeMm) * MM;
	const iconY = (heightMm - padMm - iconSizeMm) * MM;
	drawSaIcon(page, iconX, iconY, iconSizeMm * MM, fonts);

	// ---- Content column: right of QR, below SA icon -------------------
	const contentX = qrX + qrSizePt + gapMm * MM;
	const contentRight = (widthMm - padMm) * MM;
	const contentWidthPt = contentRight - contentX;
	// Top edge sits ~1mm below the icon so content doesn't graze it.
	const contentTopMm = heightMm - padMm - iconSizeMm - 1;

	// Helpers ------------------------------------------------------------
	const fitOneLineSize = (
		text: string,
		font: PDFFont,
		candidates: number[]
	): number => {
		for (const s of candidates) {
			if (font.widthOfTextAtSize(text, s) <= contentWidthPt) return s;
		}
		return candidates[candidates.length - 1];
	};

	const fitChars = (text: string, font: PDFFont, sizePt: number): string => {
		const w = font.widthOfTextAtSize(text, sizePt);
		if (w <= contentWidthPt) return text;
		let lo = 0;
		let hi = text.length;
		while (lo < hi) {
			const mid = (lo + hi + 1) >>> 1;
			if (font.widthOfTextAtSize(text.slice(0, mid) + '…', sizePt) <= contentWidthPt) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return text.slice(0, lo) + '…';
	};

	// Item label ---------------------------------------------------------
	// Visual hierarchy: title (plain text) is the heading at the top in
	// big bold sans; the SKU rides the bottom in a smaller mono for
	// quick reference. Description, when there's vertical room
	// (LX-610-class labels), sits in between.
	if (label.kind === 'item') {
		const baseSku = label.sku.slice(0, 20);
		const attrSku = label.sku.length > 21 ? label.sku.slice(21) : '';

		// Title is the heavyweight now — bumped from 6.5pt/9pt to
		// 8.5pt/12pt so the human-readable name reads first at arm's
		// length. SKU stays auto-fit but with a smaller candidate range.
		const titleSize = small ? 8.5 : 12;
		const skuCandidates = small ? [6, 5.5, 5] : [8, 7, 6.5];
		const attrCandidates = small ? [5, 4.5] : [7, 6.5, 6];

		const skuSize = fitOneLineSize(baseSku, fonts.monoBold, skuCandidates);
		const attrSize = attrSku ? fitOneLineSize(attrSku, fonts.monoBold, attrCandidates) : 0;
		const descSize = 7;

		const titleGap = small ? 1.5 : 2;
		const skuGap = small ? 1.2 : 2;
		const descLineHeight = descSize + 1.5;

		// Pre-compute the bottom band height so the description knows
		// where to stop. SKU base line sits at padMm from bottom; attrs
		// line above it.
		const skuBlockHeightMm =
			(skuSize + (attrSku ? skuGap + attrSize : 0)) / MM;
		const skuBottomMm = padMm;
		const skuTopMm = skuBottomMm + skuBlockHeightMm + 0.5;

		// --- Title from the top ---
		let cursorY = (contentTopMm - titleSize / MM - 0.2) * MM;
		const maxTitleLines = small ? 2 : 3;
		const titleLines = wrapLines(
			label.title,
			fonts.sansBold,
			titleSize,
			contentWidthPt,
			maxTitleLines
		);
		for (const ln of titleLines) {
			if (cursorY < skuTopMm * MM + 2) break; // ran into SKU band
			page.drawText(ln, {
				x: contentX,
				y: cursorY,
				size: titleSize,
				font: fonts.sansBold,
				color: ink
			});
			cursorY -= titleSize + titleGap;
		}

		// --- Description in the gap (large labels only) ---
		if (!small && label.description) {
			cursorY -= 1;
			const plain = stripHtml(label.description);
			if (plain) {
				const remainingPt = cursorY - skuTopMm * MM;
				const maxLines = Math.max(0, Math.floor(remainingPt / descLineHeight));
				if (maxLines > 0) {
					const descLines = wrapLines(plain, fonts.sansFont, descSize, contentWidthPt, maxLines);
					for (const ln of descLines) {
						page.drawText(ln, {
							x: contentX,
							y: cursorY,
							size: descSize,
							font: fonts.sansFont,
							color: inkSoft
						});
						cursorY -= descLineHeight;
					}
				}
			}
		}

		// --- SKU anchored at the bottom (smaller, mono, soft ink) ---
		// Base SKU above attrs so a top-down read still parses
		// "category-brand-model …" first. Anchored to padMm-from-bottom
		// rather than chasing a cursor so the layout is stable even
		// when title or description didn't fill their max lines.
		const skuBaseY = skuBottomMm * MM + (attrSku ? attrSize + skuGap : 0);
		page.drawText(baseSku, {
			x: contentX,
			y: skuBaseY,
			size: skuSize,
			font: fonts.monoBold,
			color: inkSoft
		});
		if (attrSku) {
			page.drawText(attrSku, {
				x: contentX,
				y: skuBottomMm * MM,
				size: attrSize,
				font: fonts.monoBold,
				color: inkSoft
			});
		}
	} else {
		// Bin label ------------------------------------------------------
		// Bin code is the headline, path beneath, friendly name last.
		// Auto-sizes the bin code so it fills the available width.
		const codeCandidates = small ? [14, 12, 11, 10, 9] : [22, 20, 18, 16, 14];
		const codeSize = fitOneLineSize(label.code, fonts.sansBold, codeCandidates);
		const pathSize = small ? 6 : 9;
		const nameSize = small ? 6 : 9;

		let cursorY = (contentTopMm - codeSize / MM - 0.5) * MM;

		page.drawText(label.code, {
			x: contentX,
			y: cursorY,
			size: codeSize,
			font: fonts.sansBold,
			color: ink
		});
		cursorY -= codeSize + (small ? 1.5 : 3);

		const pathFitted = fitChars(label.path, fonts.monoBold, pathSize);
		if (cursorY > qrY + 1 * MM) {
			page.drawText(pathFitted, {
				x: contentX,
				y: cursorY,
				size: pathSize,
				font: fonts.monoBold,
				color: inkSoft
			});
			cursorY -= pathSize + 2;
		}

		if (label.name && cursorY > qrY + 1 * MM) {
			const nameLines = wrapLines(
				label.name,
				fonts.italic,
				nameSize,
				contentWidthPt,
				small ? 1 : 2
			);
			for (const ln of nameLines) {
				if (cursorY < qrY + 1 * MM) break;
				page.drawText(ln, {
					x: contentX,
					y: cursorY,
					size: nameSize,
					font: fonts.italic,
					color: inkSoft
				});
				cursorY -= nameSize + 1.5;
			}
		}
	}

	// Touch the page-dimension locals so TS doesn't complain when the
	// renderer body happens not to reference them directly.
	void widthPt;
	void heightPt;
}

/**
 * Strip HTML and collapse whitespace. The item description column
 * may contain HTML (from Squarespace import or the rich-text editor)
 * — we render plain text on labels.
 */
function stripHtml(html: string): string {
	return html
		.replace(/<\s*br\s*\/?\s*>/gi, '\n')
		.replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Word-wrap a string into lines that each fit `maxWidthPt` at the
 * given font/size. Hard breaks (`\n`) in the source are preserved.
 * Overlong words get char-broken so we don't return a line wider
 * than the bounds.
 */
function wrapLines(
	text: string,
	font: PDFFont,
	sizePt: number,
	maxWidthPt: number,
	maxLines: number
): string[] {
	const out: string[] = [];
	const paragraphs = text.split(/\n/);
	for (const para of paragraphs) {
		if (out.length >= maxLines) break;
		const words = para.split(/\s+/).filter(Boolean);
		let line = '';
		for (const word of words) {
			const candidate = line ? line + ' ' + word : word;
			if (font.widthOfTextAtSize(candidate, sizePt) <= maxWidthPt) {
				line = candidate;
			} else {
				if (line) out.push(line);
				if (out.length >= maxLines) break;
				// Word itself overflows — char-break it.
				if (font.widthOfTextAtSize(word, sizePt) > maxWidthPt) {
					let chunk = '';
					for (const ch of word) {
						if (font.widthOfTextAtSize(chunk + ch, sizePt) <= maxWidthPt) {
							chunk += ch;
						} else {
							out.push(chunk);
							if (out.length >= maxLines) break;
							chunk = ch;
						}
					}
					line = chunk;
				} else {
					line = word;
				}
			}
		}
		if (line && out.length < maxLines) out.push(line);
	}

	// If we ran out of room, ellipsize the last line.
	if (out.length === maxLines) {
		const remainder = text
			.split(/\n/)
			.join(' ')
			.split(/\s+/)
			.filter(Boolean);
		const renderedWordCount = out.join(' ').split(/\s+/).filter(Boolean).length;
		if (renderedWordCount < remainder.length) {
			let last = out[maxLines - 1];
			while (
				last.length > 1 &&
				font.widthOfTextAtSize(last + '…', sizePt) > maxWidthPt
			) {
				last = last.slice(0, -1);
			}
			out[maxLines - 1] = last + '…';
		}
	}
	return out;
}


/**
 * Generate a QR code as a PNG byte array, suitable for embedding
 * into pdf-lib. Uses `qrcode-generator` (pure JS, Workers-safe) for
 * the QR matrix, then draws it to a bitmap manually since the
 * Workers runtime has no canvas.
 */
async function renderQrPng(data: string): Promise<Uint8Array> {
	// `qrcode-generator` picks the lowest QR version that fits.
	// Error correction L (~7% recoverable) is fine for small print
	// labels — the QR is being scanned within inches of a phone.
	const qr = qrcode(0, 'L');
	qr.addData(data);
	qr.make();

	const moduleCount = qr.getModuleCount();
	// Each module is 1px in our final image, then we let the PDF
	// scale it. At 3px per module, a typical 33×33 module QR becomes
	// 99px square — plenty of resolution at print scale.
	const SCALE = 4;
	const size = moduleCount * SCALE;

	// Build a 1-bit-per-pixel bitmap then encode as a minimal PNG.
	// Avoids pulling in a canvas dep.
	const pixels = new Uint8Array(size * size); // 0 = white, 1 = black
	for (let r = 0; r < moduleCount; r++) {
		for (let c = 0; c < moduleCount; c++) {
			if (qr.isDark(r, c)) {
				for (let dy = 0; dy < SCALE; dy++) {
					for (let dx = 0; dx < SCALE; dx++) {
						pixels[(r * SCALE + dy) * size + (c * SCALE + dx)] = 1;
					}
				}
			}
		}
	}

	return encodePngGrayscale1Bit(pixels, size, size);
}

/**
 * Minimal hand-rolled PNG encoder for a 1-bit grayscale bitmap.
 *
 * pdf-lib accepts PNG byte buffers via embedPng. We could pull in
 * `pngjs` but it's a relatively heavy dep that uses Node streams.
 * 1-bit grayscale PNG is small enough to encode by hand here, and
 * keeps the Workers bundle tight.
 *
 * PNG spec reference: https://www.w3.org/TR/2003/REC-PNG-20031110/
 */
function encodePngGrayscale1Bit(
	pixels: Uint8Array,
	width: number,
	height: number
): Uint8Array {
	// Build the IDAT pixel data: each row prefixed with a filter byte
	// (0 = no filter), followed by 8-bit grayscale values (0x00 black,
	// 0xff white). Going 8-bit per pixel keeps the encoder simple at
	// the cost of slightly bigger files — acceptable for label QRs.
	const rawSize = (width + 1) * height;
	const raw = new Uint8Array(rawSize);
	let p = 0;
	for (let y = 0; y < height; y++) {
		raw[p++] = 0; // filter: None
		for (let x = 0; x < width; x++) {
			raw[p++] = pixels[y * width + x] ? 0x00 : 0xff;
		}
	}

	// Wrap raw in zlib (deflate, with adler32 checksum). PNG IDAT
	// requires deflated bytes — but we can use the "stored" / no-
	// compression block format which is valid deflate and is far
	// simpler to write by hand.
	const compressed = zlibStored(raw);

	// PNG file = signature + chunks.
	const signature = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
	]);

	// IHDR: width, height, bit_depth=8, color_type=0 (grayscale),
	// compression=0, filter=0, interlace=0
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 0; // color type = grayscale
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	const ihdrChunk = pngChunk('IHDR', ihdr);
	const idatChunk = pngChunk('IDAT', compressed);
	const iendChunk = pngChunk('IEND', new Uint8Array(0));

	return concatBytes([signature, ihdrChunk, idatChunk, iendChunk]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const lengthBytes = new Uint8Array(4);
	new DataView(lengthBytes.buffer).setUint32(0, data.length);

	const typeBytes = new TextEncoder().encode(type);

	const crcInput = concatBytes([typeBytes, data]);
	const crc = crc32(crcInput);
	const crcBytes = new Uint8Array(4);
	new DataView(crcBytes.buffer).setUint32(0, crc);

	return concatBytes([lengthBytes, typeBytes, data, crcBytes]);
}

function zlibStored(data: Uint8Array): Uint8Array {
	// zlib header: 0x78 0x01 = no compression, lowest level.
	const header = new Uint8Array([0x78, 0x01]);

	const MAX_BLOCK = 65535;
	const blocks: Uint8Array[] = [];
	for (let i = 0; i < data.length; i += MAX_BLOCK) {
		const isLast = i + MAX_BLOCK >= data.length;
		const blockLen = Math.min(MAX_BLOCK, data.length - i);
		const header5 = new Uint8Array(5);
		header5[0] = isLast ? 0x01 : 0x00; // BFINAL + BTYPE=00 stored
		new DataView(header5.buffer).setUint16(1, blockLen, true); // LEN little-endian
		new DataView(header5.buffer).setUint16(3, ~blockLen & 0xffff, true); // NLEN
		blocks.push(header5);
		blocks.push(data.slice(i, i + blockLen));
	}

	const adler = adler32(data);
	const adlerBytes = new Uint8Array(4);
	new DataView(adlerBytes.buffer).setUint32(0, adler);

	return concatBytes([header, ...blocks, adlerBytes]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

// ----- CRC-32 (PNG uses the standard CRC-32 polynomial 0xEDB88320) -----
let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
	if (!crcTable) {
		const t = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) {
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			}
			t[n] = c;
		}
		crcTable = t;
	}
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
	let a = 1;
	let b = 0;
	const MOD = 65521;
	for (let i = 0; i < data.length; i++) {
		a = (a + data[i]) % MOD;
		b = (b + a) % MOD;
	}
	return ((b << 16) | a) >>> 0;
}
