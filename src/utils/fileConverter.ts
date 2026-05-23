/**
 * Module: fileConverter.ts
 * File conversion utility module
 *
 * Description:
 * - Provides document format detection and conversion
 * - Supports converting Markdown, HTML, TXT to Markdown
 * - Handles UTF-8 BOM markers
 *
 * Exported functions:
 * - convertToMarkdown: Auto-detect and convert document format to Markdown
 * - removeBom: Remove UTF-8 BOM marker
 * - hasBom: Check if file has BOM
 */

import * as fs from 'fs';

/**
 * convertToMarkdown: Auto-detect and convert document format to Markdown
 *
 * Description:
 * - Auto-detects format by file extension or content
 * - Supports: Markdown, HTML, TXT
 * - Auto-removes UTF-8 BOM marker
 *
 * @param filePath - File path
 * @param content - File content (optional, if provided used directly without reading file)
 * @returns Converted Markdown content
 *
 * Supported formats:
 * - .md, .markdown -> return as-is
 * - .html, .htm -> convert to Markdown
 * - .txt, .text -> return as-is
 * - Other formats -> attempt HTML detection
 */
export function convertToMarkdown(filePath: string, content?: string): string {
	// If content not provided, read from file
	let fileContent = content;
	if (fileContent === undefined) {
		if (!fs.existsSync(filePath)) {
			throw new Error(`File not found: ${filePath}`);
		}
		fileContent = fs.readFileSync(filePath, 'utf-8');
	}

	// Remove UTF-8 BOM marker (\uFEFF or 0xFEFF)
	if (fileContent.charCodeAt(0) === 0xfeff) {
		fileContent = fileContent.slice(1);
	}

	// Trim leading/trailing whitespace
	const trimmed = fileContent.trim();

	// Get file extension (lowercase)
	const ext = filePath.split('.').pop()?.toLowerCase() || '';

	// Convert based on extension
	switch (ext) {
		case 'md':
		case 'markdown':
			// Markdown files returned as-is
			return trimmed;

		case 'html':
		case 'htm':
			// HTML files converted to Markdown
			return htmlToMarkdown(trimmed);

		case 'txt':
		case 'text':
			// Plain text files kept as-is
			return trimmed;

		default:
			// Unknown format, attempt HTML detection
			if (
				trimmed.startsWith('<!DOCTYPE') ||
				trimmed.startsWith('<html') ||
				trimmed.startsWith('<div')
			) {
				return htmlToMarkdown(trimmed);
			}
			// Otherwise treat as plain text
			return trimmed;
	}
}

/**
 * htmlToMarkdown: Simple HTML to Markdown converter
 *
 * Description:
 * - Converts common HTML tags to Markdown syntax
 * - Supports h1-h6, p, br, strong, b, em, i, del, s, code, pre, a, img, ul, ol, li, blockquote, hr, table, etc.
 *
 * @param html - HTML content
 * @returns Converted Markdown
 *
 * Conversion rules:
 * - h1-h6 -> # to ###### headings
 * - strong/b -> **bold**
 * - em/i -> *italic*
 * - del/s -> ~~strikethrough~~
 * - code -> `inline code`
 * - pre/code -> ```code block```
 * - a -> [text](link)
 * - img -> ![alt](image url)
 * - ul/ol -> - / 1. lists
 * - blockquote -> > quote
 * - hr -> ---
 * - table -> Markdown table
 */
function htmlToMarkdown(html: string): string {
	let markdown = html;

	// Remove doctype and html/body tags
	markdown = markdown.replace(/<!DOCTYPE[^>]*>/gi, '');
	markdown = markdown.replace(/<html[^>]*>/gi, '');
	markdown = markdown.replace(/<\/html>/gi, '');
	markdown = markdown.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
	markdown = markdown.replace(/<body[^>]*>/gi, '');
	markdown = markdown.replace(/<\/body>/gi, '');

	// Heading conversion
	markdown = markdown.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
	markdown = markdown.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
	markdown = markdown.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
	markdown = markdown.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
	markdown = markdown.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
	markdown = markdown.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');

	// Paragraph conversion (p tag)
	markdown = markdown.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

	// Line break conversion
	markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

	// Bold conversion
	markdown = markdown.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
	markdown = markdown.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');

	// Italic conversion
	markdown = markdown.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
	markdown = markdown.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

	// Strikethrough conversion
	markdown = markdown.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~');
	markdown = markdown.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~');

	// Inline code conversion
	markdown = markdown.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

	// Code block conversion
	markdown = markdown.replace(
		/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
		'```\n$1\n```\n\n'
	);

	// Link conversion
	markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

	// Image conversion
	markdown = markdown.replace(
		/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi,
		'![$2]($1)'
	);
	markdown = markdown.replace(
		/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*\/?>/gi,
		'![$1]($2)'
	);
	markdown = markdown.replace(/<img[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![]($1)');

	// Unordered list conversion
	markdown = markdown.replace(
		/<ul[^>]*>([\s\S]*?)<\/ul>/gi,
		(_match: string, listContent: string): string => {
			return listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n') + '\n';
		}
	);

	// Ordered list conversion
	markdown = markdown.replace(
		/<ol[^>]*>([\s\S]*?)<\/ol>/gi,
		(_match: string, listContent: string): string => {
			let index = 1;
			return (
				listContent.replace(
					/<li[^>]*>([\s\S]*?)<\/li>/gi,
					(): string => `${index++}. $1\n`
				) + '\n'
			);
		}
	);

	// Blockquote conversion
	markdown = markdown.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n\n');

	// Horizontal rule conversion
	markdown = markdown.replace(/<hr\s*\/?>/gi, '\n---\n\n');

	// Table conversion (basic support)
	markdown = markdown.replace(
		/<table[^>]*>([\s\S]*?)<\/table>/gi,
		(_match: string, tableContent: string): string => {
			let result = '';
			// Table header
			const headerMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
			if (headerMatch) {
				const headers = headerMatch[1].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
				result += '| ' + headers.map((h: string) => stripTags(h)).join(' | ') + ' |\n';
				result += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
			}
			// Table body
			const bodyMatch = tableContent.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i) || [
				0,
				tableContent
			];
			const rows = bodyMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
			for (const row of rows) {
				const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
				result += '| ' + cells.map((c: string) => stripTags(c)).join(' | ') + ' |\n';
			}
			return result + '\n';
		}
	);

	// Remove remaining HTML tags
	markdown = markdown.replace(/<[^>]+>/g, '');

	// Decode HTML entities
	markdown = decodeHtmlEntities(markdown);

	// Clean up excess blank lines
	markdown = markdown.replace(/\n{3,}/g, '\n\n');

	return markdown.trim();
}

/**
 * stripTags: Strip HTML tags from content
 *
 * @param html - String containing HTML tags
 * @returns Plain text with tags removed
 */
function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * decodeHtmlEntities: Decode HTML entities
 *
 * Description:
 * - Convert HTML entities to corresponding characters
 * - Supports named entities and numeric entities (decimal/hex)
 *
 * @param text - Text containing HTML entities
 * @returns Decoded text
 *
 * Supported entities:
 * - &nbsp; -> space
 * - &amp; -> &
 * - &lt; -> <
 * - &gt; -> >
 * - &quot; -> "
 * - &#39; -> '
 * - &mdash; -> \u2014 (em dash)
 * - &ndash; -> \u2013 (en dash)
 * - &hellip; -> \u2026 (ellipsis)
 * - &#digits; -> decimal character
 * - &#xHEX; -> hex character
 */
function decodeHtmlEntities(text: string): string {
	// Common HTML entity mapping
	const entities: Record<string, string> = {
		'&nbsp;': ' ',
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&#39;': "'",
		'&apos;': "'",
		'&mdash;': '\u2014',
		'&ndash;': '\u2013',
		'&hellip;': '\u2026',
		'&copy;': '\u00A9',
		'&reg;': '\u00AE',
		'&trade;': '\u2122',
		'&lsquo;': '\u2018',
		'&rsquo;': '\u2019',
		'&ldquo;': '\u201C',
		'&rdquo;': '\u201D'
	};

	let result = text;

	// Replace named entities
	for (const [entity, char] of Object.entries(entities)) {
		result = result.replace(new RegExp(entity, 'gi'), char);
	}

	// Handle numeric HTML entities (decimal)
	result = result.replace(/&#(\d+);/g, (_: string, code: string): string => {
		return String.fromCharCode(parseInt(code, 10));
	});

	// Handle numeric HTML entities (hex)
	result = result.replace(/&#x([0-9a-f]+);/gi, (_: string, code: string): string => {
		return String.fromCharCode(parseInt(code, 16));
	});

	return result;
}

/**
 * Remove UTF-8 BOM marker
 */
export function removeBom(content: string): string {
	if (content.charCodeAt(0) === 0xfeff) {
		return content.slice(1);
	}
	return content;
}

/**
 * Check if file has BOM
 */
export function hasBom(content: string): boolean {
	return content.charCodeAt(0) === 0xfeff;
}
