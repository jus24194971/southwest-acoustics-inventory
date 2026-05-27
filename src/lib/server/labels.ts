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
	/** Brand logo PNG bytes. Only used by large-format templates
	 *  (Primera LX-610). Callers fetch /southwest_logo.png via
	 *  event.fetch and pass the bytes through. Optional — the
	 *  renderer falls back to a text wordmark if absent. */
	logoPng?: Uint8Array;
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
	const italicBold = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

	// Embed the brand logo once if provided — the same image gets
	// drawn on every page of a multi-label run, so do the embed cost
	// upfront and reuse the handle.
	let logoImage = null;
	if (options.logoPng && options.logoPng.length > 0) {
		try {
			logoImage = await doc.embedPng(options.logoPng);
		} catch {
			// Bad bytes — fall back to the text wordmark.
			logoImage = null;
		}
	}

	// Large-format templates get a richer renderer. Threshold of 40mm
	// is well above any DYMO size but well below the 51mm LX-610 short
	// edge — if we ever add a mid-size template we'll revisit.
	const isLargeFormat = template.heightMm >= 40;

	for (const label of labels) {
		for (let copy = 0; copy < copies; copy++) {
			const page = doc.addPage([widthPt, heightPt]);
			if (isLargeFormat) {
				await renderLargeFormatLabel(doc, page, label, template, {
					monoFont,
					monoBold,
					sansFont,
					sansBold,
					italic,
					italicBold,
					logoImage
				});
			} else {
				await renderLabel(doc, page, label, template, {
					monoFont,
					monoBold,
					sansFont,
					sansBold,
					italic
				});
			}
		}
	}

	return await doc.save();
}

interface Fonts {
	monoFont: PDFFont;
	monoBold: PDFFont;
	sansFont: PDFFont;
	sansBold: PDFFont;
	italic: PDFFont;
}

async function renderLabel(
	doc: PDFDocument,
	page: PDFPage,
	label: Label,
	template: LabelTemplate,
	fonts: Fonts
): Promise<void> {
	const heightPt = template.heightMm * MM;
	const widthPt = template.widthMm * MM;

	// ---------- QR block ------------------------------------------------
	// Square, anchored top-left with a 1mm margin. Size = (label
	// height - 2mm margin), so it fills the short edge.
	const qrSizeMm = template.heightMm - 2;
	const qrSizePt = qrSizeMm * MM;
	const qrX = 1 * MM;
	// PDF coords have origin at bottom-left, Y axis up. Bottom edge
	// of the QR at 1mm.
	const qrY = 1 * MM;

	const qrPng = await renderQrPng(label.url);
	const qrImage = await doc.embedPng(qrPng);
	page.drawImage(qrImage, {
		x: qrX,
		y: qrY,
		width: qrSizePt,
		height: qrSizePt
	});

	// ---------- Text block ---------------------------------------------
	// Right of the QR, with a 2mm gap.
	const textX = qrX + qrSizePt + 2 * MM;
	const textWidthMm = template.widthMm - (qrSizeMm + 4); // 1mm L + 2mm gap + 1mm R
	const textWidthPt = textWidthMm * MM;

	// Approximate "how many chars fit at this point size" using each
	// font's average advance width — used to truncate titles cleanly.
	const fitChars = (text: string, font: PDFFont, sizePt: number): string => {
		const w = font.widthOfTextAtSize(text, sizePt);
		if (w <= textWidthPt) return text;
		// Binary-trim until it fits, append ellipsis.
		let lo = 0;
		let hi = text.length;
		while (lo < hi) {
			const mid = (lo + hi + 1) >>> 1;
			if (font.widthOfTextAtSize(text.slice(0, mid) + '…', sizePt) <= textWidthPt) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return text.slice(0, lo) + '…';
	};

	// Layout was tuned for a 19mm-tall label; everything (font sizes,
	// vertical spacing) scales linearly with `scale` so a taller label
	// fills its full height instead of crowding into the top corner.
	// At scale=1 the layout matches the original 19×64mm look.
	const scale = template.heightMm / 19;

	// Y baselines from the top, in mm-from-bottom. The spacing
	// constants (3.5, 7.8, 12.0, 16.4 mm) are the original layout for
	// 19mm — they get multiplied by `scale` so a 25mm or 32mm label
	// uses proportionally bigger gaps.
	const yBrand = (template.heightMm - 3.5 * scale) * MM;
	const yPrimary = (template.heightMm - 7.8 * scale) * MM;
	const ySecondary = (template.heightMm - 12.0 * scale) * MM;
	const yTertiary = (template.heightMm - 16.4 * scale) * MM;

	// Font sizes scale the same way. Cap the upper bound on title /
	// brand so they don't fight the SKU for visual weight on the
	// biggest labels.
	const fsBrand = 5 * scale;
	const fsSku = 7 * scale;
	const fsTitle = Math.min(6 * scale, 9);
	const fsBinCode = 11 * scale;
	const fsBinPath = 6 * scale;

	// Brand strip — italic Fraunces-feel using Helvetica oblique
	// since we don't have a custom font embedded yet.
	page.drawText('Southwest Acoustics', {
		x: textX,
		y: yBrand,
		size: fsBrand,
		font: fonts.italic,
		color: rgb(0.45, 0.36, 0.18) // gold-dim
	});

	if (label.kind === 'item') {
		// Item label — split the 40-char SKU into base + attrs. Both lines
		// in Courier Bold so the SKU prints heavy and stays legible at
		// 7pt on glossy thermal stock.
		const baseSku = label.sku.slice(0, 20); // CAT-BRAND-MODEL-COND-YY-SEQ
		const attrSku = label.sku.length > 21 ? label.sku.slice(21) : ''; // A1-...-A5

		page.drawText(baseSku, {
			x: textX,
			y: yPrimary,
			size: fsSku,
			font: fonts.monoBold,
			color: rgb(0, 0, 0)
		});

		if (attrSku) {
			page.drawText(attrSku, {
				x: textX,
				y: ySecondary,
				size: fsSku,
				font: fonts.monoBold,
				color: rgb(0, 0, 0)
			});
		}

		const titleFitted = fitChars(label.title, fonts.sansFont, fsTitle);
		page.drawText(titleFitted, {
			x: textX,
			y: yTertiary,
			size: fsTitle,
			font: fonts.sansFont,
			color: rgb(0.15, 0.15, 0.15)
		});
	} else {
		// Bin label — path on the secondary line so Dad can read the
		// hierarchy at a glance; bin CODE big on the primary; name
		// last.
		const pathFitted = fitChars(label.path, fonts.monoBold, fsBinPath);

		page.drawText(label.code, {
			x: textX,
			y: yPrimary,
			size: fsBinCode,
			font: fonts.sansBold,
			color: rgb(0, 0, 0)
		});

		page.drawText(pathFitted, {
			x: textX,
			y: ySecondary,
			size: fsBinPath,
			font: fonts.monoBold,
			color: rgb(0.2, 0.2, 0.2)
		});

		if (label.name) {
			const nameFitted = fitChars(label.name, fonts.italic, fsTitle);
			page.drawText(nameFitted, {
				x: textX,
				y: yTertiary,
				size: fsTitle,
				font: fonts.italic,
				color: rgb(0.2, 0.2, 0.2)
			});
		}
	}
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

interface LargeFormatFonts extends Fonts {
	italicBold: PDFFont;
	logoImage: Awaited<ReturnType<PDFDocument['embedPng']>> | null;
}

/**
 * Large-format label renderer — designed around the Primera LX-610's
 * 2" × 3" color cut. Layout uses the brand logo as the only header
 * (no wordmark text — the logo image itself carries the brand mark).
 *
 * Layout (76mm × 51mm, landscape):
 *
 *   ┌────────────────────────────────────────────┐
 *   │                                  [ LOGO ]  │  top-right corner
 *   │  ┌──────────┐  CAT-BRAND-MODEL-COND-YY-NN  │
 *   │  │          │  A1-A2-A3-A4-A5               │
 *   │  │   QR     │  Item Title (bold)            │
 *   │  │          │  Description text wraps       │
 *   │  │          │  across multiple lines…       │
 *   │  └──────────┘                                │
 *   └────────────────────────────────────────────┘
 *
 * For bin labels the right column shifts to bin code (big) + path +
 * friendly name, mirroring the small-format bin layout.
 *
 * SKU sizing is dynamic — we try the largest font in {9, 8, 7} pt
 * that fits the content width, and only wrap to a second line if
 * even 7pt overflows. Same logic for the attribute line.
 */
async function renderLargeFormatLabel(
	doc: PDFDocument,
	page: PDFPage,
	label: Label,
	template: LabelTemplate,
	fonts: LargeFormatFonts
): Promise<void> {
	const widthMm = template.widthMm;
	const heightMm = template.heightMm;
	const widthPt = widthMm * MM;
	const heightPt = heightMm * MM;

	const ink = rgb(0.05, 0.05, 0.05);
	const inkSoft = rgb(0.25, 0.25, 0.25);

	const padMm = 2.5;

	// ---- Logo: top-right corner, no wordmark --------------------------
	// Aspect-preserved, capped at 24mm wide × 11mm tall so it stays a
	// brand accent rather than dominating the label. Stored bounds so
	// content layout below knows to start under it.
	let logoBottomMm = heightMm - padMm; // if no logo, "below logo" is the top edge
	if (fonts.logoImage) {
		const img = fonts.logoImage;
		const aspect = img.width / img.height;
		const MAX_LOGO_WMM = 24;
		const MAX_LOGO_HMM = 11;
		let logoWmm = MAX_LOGO_WMM;
		let logoHmm = logoWmm / aspect;
		if (logoHmm > MAX_LOGO_HMM) {
			logoHmm = MAX_LOGO_HMM;
			logoWmm = logoHmm * aspect;
		}
		const logoX = (widthMm - padMm - logoWmm) * MM;
		const logoY = (heightMm - padMm - logoHmm) * MM;
		page.drawImage(img, {
			x: logoX,
			y: logoY,
			width: logoWmm * MM,
			height: logoHmm * MM
		});
		logoBottomMm = heightMm - padMm - logoHmm;
	}

	// ---- QR: left side, anchored bottom-left ---------------------------
	// Big — the QR is the primary scan target. Caps at 36mm so it fits
	// the label height with margin to spare even on a portrait crop.
	const qrSizeMm = Math.min(heightMm - 2 * padMm, 36);
	const qrSizePt = qrSizeMm * MM;
	const qrX = padMm * MM;
	const qrY = padMm * MM;

	const qrPng = await renderQrPng(label.url);
	const qrImage = await doc.embedPng(qrPng);
	page.drawImage(qrImage, {
		x: qrX,
		y: qrY,
		width: qrSizePt,
		height: qrSizePt
	});

	// ---- Content column: right of QR, below logo -----------------------
	// Top edge sits ~1.5mm under the logo so content doesn't graze it.
	// If no logo was supplied we slide it back to padMm for parity with
	// the original layout.
	const contentX = qrX + qrSizePt + 3 * MM;
	const contentRight = (widthMm - padMm) * MM;
	const contentWidthPt = contentRight - contentX;
	const contentTopMm = fonts.logoImage ? logoBottomMm - 1.5 : heightMm - padMm;

	// Truncate-to-fit helper for single-line strings.
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

	// Pick the largest size from `candidates` that fits one line of
	// `text` in `font` within `widthPt`. Falls back to the smallest.
	const fitOneLineSize = (
		text: string,
		font: PDFFont,
		candidates: number[],
		widthPt: number
	): number => {
		for (const s of candidates) {
			if (font.widthOfTextAtSize(text, s) <= widthPt) return s;
		}
		return candidates[candidates.length - 1];
	};

	if (label.kind === 'item') {
		// SKU split: base (CAT-BRAND-MODEL-COND-YY-SEQ, 20 chars) on
		// line 1, attrs (A1-A2-A3-A4-A5) on line 2. The right-side
		// logo squeezes content width to ~33mm, so we auto-size the
		// SKU to the largest size that still fits one line.
		const baseSku = label.sku.slice(0, 20);
		const attrSku = label.sku.length > 21 ? label.sku.slice(21) : '';

		const skuSize = fitOneLineSize(baseSku, fonts.monoBold, [10, 9, 8, 7], contentWidthPt);
		const attrSize = attrSku
			? fitOneLineSize(attrSku, fonts.monoBold, [9, 8, 7], contentWidthPt)
			: 0;
		const TITLE_SIZE = 9;
		const DESC_SIZE = 7;

		// Start 1mm below the content top so the SKU isn't kissing the
		// logo's bottom edge.
		let cursorY = (contentTopMm - skuSize / MM - 0.5) * MM;

		page.drawText(baseSku, {
			x: contentX,
			y: cursorY,
			size: skuSize,
			font: fonts.monoBold,
			color: ink
		});
		cursorY -= skuSize + 3;

		if (attrSku) {
			page.drawText(attrSku, {
				x: contentX,
				y: cursorY,
				size: attrSize,
				font: fonts.monoBold,
				color: inkSoft
			});
			cursorY -= attrSize + 4;
		}

		// Title — bold sans, possibly wrapping onto two lines if it's
		// long. Cap at 2 lines so the description still has room.
		const titleLines = wrapLines(label.title, fonts.sansBold, TITLE_SIZE, contentWidthPt, 2);
		for (const ln of titleLines) {
			page.drawText(ln, {
				x: contentX,
				y: cursorY,
				size: TITLE_SIZE,
				font: fonts.sansBold,
				color: ink
			});
			cursorY -= TITLE_SIZE + 2;
		}

		// Description — wrap into the remaining vertical space. The QR
		// bottom is at padMm; we stop drawing above that.
		if (label.description) {
			cursorY -= 2;
			const plain = stripHtml(label.description);
			if (plain) {
				const lineHeight = DESC_SIZE + 1.5;
				const remainingPt = cursorY - padMm * MM;
				const maxLines = Math.max(1, Math.floor(remainingPt / lineHeight));
				const descLines = wrapLines(plain, fonts.sansFont, DESC_SIZE, contentWidthPt, maxLines);
				for (const ln of descLines) {
					page.drawText(ln, {
						x: contentX,
						y: cursorY,
						size: DESC_SIZE,
						font: fonts.sansFont,
						color: inkSoft
					});
					cursorY -= lineHeight;
				}
			}
		}
	} else {
		// Bin label — same content shape as the DYMO bin layout but
		// scaled up. Bin code is the headline, path/name beneath.
		let cursorY = (contentTopMm - 7) * MM;
		const CODE_SIZE = 20;
		const PATH_SIZE = 9;
		const NAME_SIZE = 9;

		page.drawText(label.code, {
			x: contentX,
			y: cursorY,
			size: CODE_SIZE,
			font: fonts.sansBold,
			color: ink
		});
		cursorY -= CODE_SIZE + 2;

		const pathFitted = fitChars(label.path, fonts.monoBold, PATH_SIZE);
		page.drawText(pathFitted, {
			x: contentX,
			y: cursorY,
			size: PATH_SIZE,
			font: fonts.monoBold,
			color: inkSoft
		});
		cursorY -= PATH_SIZE + 3;

		if (label.name) {
			const nameLines = wrapLines(label.name, fonts.italic, NAME_SIZE, contentWidthPt, 2);
			for (const ln of nameLines) {
				page.drawText(ln, {
					x: contentX,
					y: cursorY,
					size: NAME_SIZE,
					font: fonts.italic,
					color: inkSoft
				});
				cursorY -= NAME_SIZE + 2;
			}
		}
	}

	// Pull in the unused-var refs so TS/build doesn't warn about
	// widthPt/heightPt when the layout above happens not to read them
	// (defensive — keeps the renderer easy to extend later).
	void widthPt;
	void heightPt;
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
