/**
 * Module: docsUtil.ts
 * Document utility functions module
 *
 * Description:
 * - Provides core implementation for document creation
 * - Supports creating documents from Markdown
 * - Provides helper functions for Yjs block operations
 * - Supports exporting documents to Markdown
 *
 * Main exported functions:
 * - createDocFromMarkdownCore: Create document from Markdown (core function)
 * - collectDocForMarkdown: Collect document info for Markdown export
 *
 * Exported helper functions:
 * - findBlockIdByFlavour: Find block ID by flavour
 * - findBlockById: Find block by ID
 * - childIdsFrom: Get child element ID array
 * - getStringArray: Get string array
 * - asText: Convert text content to string
 */

import * as Y from 'yjs';
import { createWorkspaceSocket, joinWorkspace, fetchYDoc, updateYDoc } from './wsClient.js';
import { parseMarkdownToOperations } from '../markdown/parse.js';
import type { MarkdownOperation, TextDelta } from '../markdown/types.js';
import { TAG_COLORS } from '../core/constants.js';
import { generateId } from './misc.js';
import { getWorkspaceTagOptions, WorkspaceTagOption } from '../core/tags.js';
import { getWorkspaceId } from './config.js';

export const APPEND_BLOCK_CANONICAL_TYPE_VALUES = [
	'paragraph',
	'heading',
	'quote',
	'list',
	'code',
	'divider',
	'callout',
	'latex',
	'table',
	'bookmark',
	'image',
	'attachment',
	'embed_youtube',
	'embed_github',
	'embed_figma',
	'embed_loom',
	'embed_html',
	'embed_linked_doc',
	'embed_synced_doc',
	'embed_iframe',
	'database',
	'data_view',
	'surface_ref',
	'frame',
	'edgeless_text',
	'note'
] as const;
export type AppendBlockCanonicalType = (typeof APPEND_BLOCK_CANONICAL_TYPE_VALUES)[number];

export const APPEND_BLOCK_LEGACY_ALIAS_MAP = {
	heading1: 'heading',
	heading2: 'heading',
	heading3: 'heading',
	bulleted_list: 'list',
	numbered_list: 'list',
	todo: 'list'
} as const;
export type AppendBlockLegacyType = keyof typeof APPEND_BLOCK_LEGACY_ALIAS_MAP;

export const APPEND_BLOCK_LIST_STYLE_VALUES = ['bulleted', 'numbered', 'todo'] as const;
export type AppendBlockListStyle = (typeof APPEND_BLOCK_LIST_STYLE_VALUES)[number];

export type AppendBlockBookmarkStyle = (typeof APPEND_BLOCK_BOOKMARK_STYLE_VALUES)[number];

export const APPEND_BLOCK_DATA_VIEW_MODE_VALUES = ['table', 'kanban'] as const;
export type AppendBlockDataViewMode = (typeof APPEND_BLOCK_DATA_VIEW_MODE_VALUES)[number];

export const APPEND_BLOCK_BOOKMARK_STYLE_VALUES = [
	'vertical',
	'horizontal',
	'list',
	'cube',
	'citation'
] as const;
/**
 * Get block version number
 */
function blockVersion(flavour: string): number {
	switch (flavour) {
		case 'affine:page':
			return 2;
		case 'affine:surface':
			return 5;
		default:
			return 1;
	}
}

export type AppendPlacement = {
	parentId?: string;
	afterBlockId?: string;
	beforeBlockId?: string;
	index?: number;
};

export type AppendBlockInput = {
	workspaceId?: string;
	docId: string;
	type: string;
	text?: string;
	deltas?: TextDelta[];
	url?: string;
	pageId?: string;
	iframeUrl?: string;
	html?: string;
	design?: string;
	reference?: string;
	refFlavour?: string;
	width?: number;
	height?: number;
	background?: string;
	sourceId?: string;
	name?: string;
	mimeType?: string;
	size?: number;
	embed?: boolean;
	rows?: number;
	columns?: number;
	latex?: string;
	checked?: boolean;
	language?: string;
	caption?: string;
	level?: number;
	style?: AppendBlockListStyle;
	bookmarkStyle?: AppendBlockBookmarkStyle;
	viewMode?: AppendBlockDataViewMode;
	strict?: boolean;
	placement?: AppendPlacement;
	tableData?: string[][];
	tableCellDeltas?: TextDelta[][][];
};

export type NormalizedAppendBlockInput = {
	workspaceId?: string;
	docId: string;
	type: AppendBlockCanonicalType;
	strict: boolean;
	placement?: AppendPlacement;
	text: string;
	url: string;
	pageId: string;
	iframeUrl: string;
	html: string;
	design: string;
	reference: string;
	refFlavour: string;
	width: number;
	height: number;
	background: string;
	sourceId: string;
	name: string;
	mimeType: string;
	size: number;
	embed: boolean;
	rows: number;
	columns: number;
	latex: string;
	headingLevel: 1 | 2 | 3 | 4 | 5 | 6;
	listStyle: AppendBlockListStyle;
	bookmarkStyle: AppendBlockBookmarkStyle;
	dataViewMode: AppendBlockDataViewMode;
	checked: boolean;
	language: string;
	caption?: string;
	legacyType?: AppendBlockLegacyType;
	tableData?: string[][];
	deltas?: TextDelta[];
	tableCellDeltas?: TextDelta[][][];
};

export type CreateDocInput = {
	workspaceId?: string;
	title?: string;
	content?: string;
};

export type CreateDocResult = {
	workspaceId: string;
	docId: string;
	title: string;
};

/**
 * Set block system fields
 */
export function setSysFields(block: Y.Map<any>, blockId: string, flavour: string): void {
	block.set('sys:id', blockId);
	block.set('sys:flavour', flavour);
	block.set('sys:version', blockVersion(flavour));
}

/**
 * Create Y.Text
 */
export function makeText(content: string | TextDelta[]): Y.Text {
	const yText = new Y.Text();
	if (typeof content === 'string') {
		if (content.length > 0) {
			yText.insert(0, content);
		}
		return yText;
	}
	let offset = 0;
	for (const delta of content) {
		if (!delta.insert) {
			continue;
		}
		yText.insert(offset, delta.insert, delta.attributes ? { ...delta.attributes } : {});
		offset += delta.insert.length;
	}
	return yText;
}

/**
 * Ensure note block exists
 */
export function ensureNoteBlock(blocks: Y.Map<any>): string {
	const existingNoteId = findBlockIdByFlavour(blocks, 'affine:note');
	if (existingNoteId) {
		return existingNoteId;
	}

	const pageId = findBlockIdByFlavour(blocks, 'affine:page');
	if (!pageId) {
		throw new Error('Document has no page block; unable to insert content.');
	}

	const noteId = generateId(12, 'note');
	const note = new Y.Map<any>();
	setSysFields(note, noteId, 'affine:note');
	note.set('sys:parent', null);
	note.set('sys:children', new Y.Array<string>());
	note.set('prop:xywh', '[0,0,800,95]');
	note.set('prop:index', 'a0');
	note.set('prop:hidden', false);
	note.set('prop:displayMode', 'both');
	const background = new Y.Map<any>();
	background.set('light', '#ffffff');
	background.set('dark', '#252525');
	note.set('prop:background', background);
	blocks.set(noteId, note);

	const page = blocks.get(pageId) as Y.Map<any>;
	let pageChildren = page.get('sys:children') as Y.Array<string> | undefined;
	if (!(pageChildren instanceof Y.Array)) {
		pageChildren = new Y.Array<string>();
		page.set('sys:children', pageChildren);
	}
	pageChildren.push([noteId]);
	return noteId;
}

// /**
//  * Ensure surface block exists
//  */
// function ensureSurfaceBlock(blocks: Y.Map<any>): string {
// 	const existingSurfaceId = findBlockIdByFlavour(blocks, 'affine:surface');
// 	if (existingSurfaceId) {
// 		return existingSurfaceId;
// 	}

// 	const pageId = findBlockIdByFlavour(blocks, 'affine:page');
// 	if (!pageId) {
// 		throw new Error('Document has no page block; unable to create/find surface.');
// 	}

// 	const surfaceId = generateId(12, 'surface');
// 	const surface = new Y.Map<any>();
// 	setSysFields(surface, surfaceId, 'affine:surface');
// 	surface.set('sys:parent', null);
// 	surface.set('sys:children', new Y.Array<string>());
// 	const elements = new Y.Map<any>();
// 	elements.set('type', '$blocksuite:internal:native$');
// 	elements.set('value', new Y.Map<any>());
// 	surface.set('prop:elements', elements);
// 	blocks.set(surfaceId, surface);

// 	const page = blocks.get(pageId) as Y.Map<any>;
// 	let pageChildren = page.get('sys:children') as Y.Array<string> | undefined;
// 	if (!(pageChildren instanceof Y.Array)) {
// 		pageChildren = new Y.Array<string>();
// 		page.set('sys:children', pageChildren);
// 	}
// 	pageChildren.push([surfaceId]);
// 	return surfaceId;
// }

/**
 * Collect descendant block IDs
 */
function collectDescendantBlockIds(blocks: Y.Map<any>, startIds: string[]): string[] {
	const result: string[] = [];
	const visited = new Set<string>();
	const stack = [...startIds];
	while (stack.length > 0) {
		const current = stack.pop() as string;
		if (visited.has(current)) continue;
		visited.add(current);
		result.push(current);
		const block = findBlockById(blocks, current);
		if (!block) continue;
		const children = childIdsFrom(block.get('sys:children'));
		for (const childId of children) stack.push(childId);
	}
	return result;
}

/**
 * Merge warning arrays (deduplicated)
 */
function mergeWarnings(...sources: string[][]): string[] {
	const deduped = new Set<string>();
	for (const source of sources) {
		for (const warning of source) {
			deduped.add(warning);
		}
	}
	return [...deduped];
}

export function createDatabaseViewColumn(
	columnId: string,
	width: number = 200,
	hide: boolean = false
): Y.Map<any> {
	const column = new Y.Map<any>();
	column.set('id', columnId);
	column.set('width', width);
	column.set('hide', hide);
	return column;
}

export function createDatabaseColumnDefinition(input: {
	id: string;
	name: string;
	type: string;
	width?: number;
	options?: string[];
}): Y.Map<any> {
	const column = new Y.Map<any>();
	column.set('id', input.id);
	column.set('name', input.name);
	column.set('type', input.type);
	column.set('width', input.width ?? 200);

	if ((input.type === 'select' || input.type === 'multi-select') && input.options?.length) {
		const data = new Y.Map<any>();
		const options = new Y.Array<any>();
		input.options.forEach((value, index) => {
			const option = new Y.Map<any>();
			option.set('id', generateId());
			option.set('value', value);
			option.set('color', TAG_COLORS[index % TAG_COLORS.length]);
			options.push([option]);
		});
		data.set('options', options);
		column.set('data', data);
	}

	return column;
}
export function createPresetBackedDataViewBlock(
	blockId: string,
	titleText: string,
	viewMode: AppendBlockDataViewMode,
	blockType: string
): { blockId: string; block: Y.Map<any>; flavour: string; blockType: string } {
	const block = new Y.Map<any>();
	setSysFields(block, blockId, 'affine:database');
	block.set('sys:parent', null);
	block.set('sys:children', new Y.Array<string>());
	block.set('prop:title', makeText(titleText));
	block.set('prop:cells', new Y.Map<any>());
	block.set('prop:comments', undefined);

	const titleColumnId = generateId();
	const columns = new Y.Array<any>();
	columns.push([
		createDatabaseColumnDefinition({
			id: titleColumnId,
			name: 'Title',
			type: 'title',
			width: 320
		})
	]);

	const viewColumns = new Y.Array<any>();
	viewColumns.push([createDatabaseViewColumn(titleColumnId, 320, false)]);
	const header = {
		titleColumn: titleColumnId,
		iconColumn: 'type'
	};

	let groupBy: Record<string, string> | null = null;
	let groupProperties: unknown[] | null = null;

	if (viewMode === 'kanban') {
		const statusColumnId = generateId();
		columns.push([
			createDatabaseColumnDefinition({
				id: statusColumnId,
				name: 'Status',
				type: 'select',
				options: ['Todo', 'In Progress', 'Done']
			})
		]);
		viewColumns.push([createDatabaseViewColumn(statusColumnId, 200, false)]);
		groupBy = {
			columnId: statusColumnId,
			name: 'select',
			type: 'groupBy'
		};
		groupProperties = [];
	}

	const view = new Y.Map<any>();
	view.set('id', generateId());
	view.set('name', viewMode === 'kanban' ? 'Kanban View' : 'Table View');
	view.set('mode', viewMode);
	view.set('columns', viewColumns);
	view.set('filter', { type: 'group', op: 'and', conditions: [] });
	if (groupBy) {
		view.set('groupBy', groupBy);
	} else {
		view.set('groupBy', null);
	}
	if (groupProperties) {
		view.set('groupProperties', groupProperties);
	}
	view.set('sort', null);
	view.set('header', header);

	const views = new Y.Array<any>();
	views.push([view]);

	block.set('prop:columns', columns);
	block.set('prop:views', views);

	return {
		blockId,
		block,
		flavour: 'affine:database',
		blockType
	};
}

/**
 * Create block
 */

export function createBlock(normalized: NormalizedAppendBlockInput): {
	blockId: string;
	block: Y.Map<any>;
	flavour: string;
	blockType?: string;
	extraBlocks?: Array<{ blockId: string; block: Y.Map<any> }>;
} {
	const blockId = generateId();
	const block = new Y.Map<any>();
	const content = normalized.text;

	switch (normalized.type) {
		case 'paragraph':
		case 'heading':
		case 'quote': {
			setSysFields(block, blockId, 'affine:paragraph');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			const blockType =
				normalized.type === 'heading'
					? (`h${normalized.headingLevel}` as const)
					: normalized.type === 'quote'
						? 'quote'
						: 'text';
			block.set('prop:type', blockType);
			block.set('prop:text', makeText(content));
			return { blockId, block, flavour: 'affine:paragraph', blockType };
		}
		case 'list': {
			setSysFields(block, blockId, 'affine:list');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:type', normalized.listStyle);
			block.set('prop:checked', normalized.listStyle === 'todo' ? normalized.checked : false);
			block.set('prop:text', makeText(normalized.deltas ?? content));
			return {
				blockId,
				block,
				flavour: 'affine:list',
				blockType: normalized.listStyle
			};
		}
		case 'code': {
			setSysFields(block, blockId, 'affine:code');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:language', normalized.language);
			if (normalized.caption) {
				block.set('prop:caption', normalized.caption);
			}
			block.set('prop:text', makeText(content));
			return { blockId, block, flavour: 'affine:code' };
		}
		case 'divider': {
			setSysFields(block, blockId, 'affine:divider');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			return { blockId, block, flavour: 'affine:divider' };
		}
		case 'callout': {
			setSysFields(block, blockId, 'affine:callout');
			block.set('sys:parent', null);
			const calloutChildren = new Y.Array<string>();
			const textBlockId = generateId();
			const textBlock = new Y.Map<any>();
			setSysFields(textBlock, textBlockId, 'affine:paragraph');
			textBlock.set('sys:parent', null);
			textBlock.set('sys:children', new Y.Array<string>());
			textBlock.set('prop:type', 'text');
			textBlock.set('prop:text', makeText(content));
			calloutChildren.push([textBlockId]);
			block.set('sys:children', calloutChildren);
			block.set('prop:icon', { type: 'emoji', unicode: '💡' });
			block.set('prop:backgroundColorName', 'grey');
			return {
				blockId,
				block,
				flavour: 'affine:callout',
				extraBlocks: [{ blockId: textBlockId, block: textBlock }]
			};
		}
		case 'latex': {
			setSysFields(block, blockId, 'affine:latex');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:xywh', '[0,0,16,16]');
			block.set('prop:index', 'a0');
			block.set('prop:lockedBySelf', false);
			block.set('prop:scale', 1);
			block.set('prop:rotate', 0);
			block.set('prop:latex', normalized.latex);
			return { blockId, block, flavour: 'affine:latex' };
		}
		case 'table': {
			setSysFields(block, blockId, 'affine:table');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());

			const rowIds: string[] = [];
			const columnIds: string[] = [];
			const tableData = normalized.tableData ?? [];

			for (let i = 0; i < normalized.rows; i++) {
				const rowId = generateId();
				block.set(`prop:rows.${rowId}.rowId`, rowId);
				block.set(`prop:rows.${rowId}.order`, `r${String(i).padStart(4, '0')}`);
				rowIds.push(rowId);
			}
			for (let i = 0; i < normalized.columns; i++) {
				const columnId = generateId();
				block.set(`prop:columns.${columnId}.columnId`, columnId);
				block.set(`prop:columns.${columnId}.order`, `c${String(i).padStart(4, '0')}`);
				columnIds.push(columnId);
			}
			for (let rowIndex = 0; rowIndex < rowIds.length; rowIndex += 1) {
				const rowId = rowIds[rowIndex];
				const isHeader = rowIndex === 0;
				for (let columnIndex = 0; columnIndex < columnIds.length; columnIndex += 1) {
					const columnId = columnIds[columnIndex];
					const cellText = tableData[rowIndex]?.[columnIndex] ?? '';
					const cellDeltas = normalized.tableCellDeltas?.[rowIndex]?.[columnIndex] ?? [];
					const cellYText = new Y.Text();
					if (cellDeltas.length > 0) {
						let offset = 0;
						for (const delta of cellDeltas) {
							if (!delta.insert) {
								continue;
							}
							const attrs = isHeader
								? { ...(delta.attributes ?? {}), bold: true }
								: delta.attributes
									? { ...delta.attributes }
									: {};
							cellYText.insert(offset, delta.insert, attrs);
							offset += delta.insert.length;
						}
					} else if (isHeader && cellText) {
						cellYText.insert(0, cellText, { bold: true });
					} else {
						cellYText.insert(0, cellText);
					}
					block.set(`prop:cells.${rowId}:${columnId}.text`, cellYText);
				}
			}

			block.set('prop:comments', undefined);
			block.set('prop:textAlign', undefined);
			return { blockId, block, flavour: 'affine:table' };
		}
		case 'bookmark': {
			setSysFields(block, blockId, 'affine:bookmark');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:style', normalized.bookmarkStyle);
			block.set('prop:url', normalized.url);
			block.set('prop:caption', normalized.caption ?? null);
			block.set('prop:description', null);
			block.set('prop:icon', null);
			block.set('prop:image', null);
			block.set('prop:title', null);
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:index', 'a0');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:footnoteIdentifier', null);
			return { blockId, block, flavour: 'affine:bookmark' };
		}
		case 'image': {
			setSysFields(block, blockId, 'affine:image');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:caption', normalized.caption ?? '');
			block.set('prop:sourceId', normalized.sourceId);
			block.set('prop:width', 0);
			block.set('prop:height', 0);
			block.set('prop:size', normalized.size || -1);
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:index', 'a0');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			return { blockId, block, flavour: 'affine:image' };
		}
		case 'attachment': {
			setSysFields(block, blockId, 'affine:attachment');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:name', normalized.name);
			block.set('prop:size', normalized.size);
			block.set('prop:type', normalized.mimeType);
			block.set('prop:sourceId', normalized.sourceId);
			block.set('prop:caption', normalized.caption ?? undefined);
			block.set('prop:embed', normalized.embed);
			block.set('prop:style', 'horizontalThin');
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:footnoteIdentifier', null);
			return { blockId, block, flavour: 'affine:attachment' };
		}
		case 'embed_youtube': {
			setSysFields(block, blockId, 'affine:embed-youtube');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:style', 'video');
			block.set('prop:url', normalized.url);
			block.set('prop:caption', normalized.caption ?? null);
			block.set('prop:image', null);
			block.set('prop:title', null);
			block.set('prop:description', null);
			block.set('prop:creator', null);
			block.set('prop:creatorUrl', null);
			block.set('prop:creatorImage', null);
			block.set('prop:videoId', null);
			return { blockId, block, flavour: 'affine:embed-youtube' };
		}
		case 'embed_github': {
			setSysFields(block, blockId, 'affine:embed-github');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:style', 'horizontal');
			block.set('prop:owner', '');
			block.set('prop:repo', '');
			block.set('prop:githubType', 'issue');
			block.set('prop:githubId', '');
			block.set('prop:url', normalized.url);
			block.set('prop:caption', normalized.caption ?? null);
			block.set('prop:image', null);
			block.set('prop:status', null);
			block.set('prop:statusReason', null);
			block.set('prop:title', null);
			block.set('prop:description', null);
			block.set('prop:createdAt', null);
			block.set('prop:assignees', null);
			return { blockId, block, flavour: 'affine:embed-github' };
		}
		case 'embed_figma': {
			setSysFields(block, blockId, 'affine:embed-figma');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:style', 'figma');
			block.set('prop:url', normalized.url);
			block.set('prop:caption', normalized.caption ?? null);
			block.set('prop:title', null);
			block.set('prop:description', null);
			return { blockId, block, flavour: 'affine:embed-figma' };
		}
		case 'embed_loom': {
			setSysFields(block, blockId, 'affine:embed-loom');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:style', 'video');
			block.set('prop:url', normalized.url);
			block.set('prop:caption', normalized.caption ?? null);
			block.set('prop:image', null);
			block.set('prop:title', null);
			block.set('prop:description', null);
			block.set('prop:videoId', null);
			return { blockId, block, flavour: 'affine:embed-loom' };
		}
		case 'embed_html': {
			setSysFields(block, blockId, 'affine:embed-html');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:style', 'html');
			block.set('prop:caption', normalized.caption ?? null);
			block.set('prop:html', normalized.html || undefined);
			block.set('prop:design', normalized.design || undefined);
			return { blockId, block, flavour: 'affine:embed-html' };
		}
		case 'embed_linked_doc': {
			setSysFields(block, blockId, 'affine:embed-linked-doc');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:style', 'horizontal');
			block.set('prop:caption', normalized.caption ?? null);
			block.set('prop:pageId', normalized.pageId);
			block.set('prop:title', undefined);
			block.set('prop:description', undefined);
			block.set('prop:footnoteIdentifier', null);
			return { blockId, block, flavour: 'affine:embed-linked-doc' };
		}
		case 'embed_synced_doc': {
			setSysFields(block, blockId, 'affine:embed-synced-doc');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,800,100]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:rotate', 0);
			block.set('prop:style', 'syncedDoc');
			block.set('prop:caption', normalized.caption ?? undefined);
			block.set('prop:pageId', normalized.pageId);
			block.set('prop:scale', undefined);
			block.set('prop:preFoldHeight', undefined);
			block.set('prop:title', undefined);
			block.set('prop:description', undefined);
			return { blockId, block, flavour: 'affine:embed-synced-doc' };
		}
		case 'embed_iframe': {
			setSysFields(block, blockId, 'affine:embed-iframe');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:index', 'a0');
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:lockedBySelf', false);
			block.set('prop:scale', 1);
			block.set('prop:url', normalized.url);
			block.set('prop:iframeUrl', normalized.iframeUrl || normalized.url);
			block.set('prop:width', undefined);
			block.set('prop:height', undefined);
			block.set('prop:caption', normalized.caption ?? null);
			block.set('prop:title', null);
			block.set('prop:description', null);
			return { blockId, block, flavour: 'affine:embed-iframe' };
		}
		case 'database': {
			if (normalized.dataViewMode === 'kanban') {
				return createPresetBackedDataViewBlock(
					blockId,
					normalized.text,
					'kanban',
					'database_kanban'
				);
			}
			setSysFields(block, blockId, 'affine:database');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			const defaultView = new Y.Map<any>();
			defaultView.set('id', generateId());
			defaultView.set('name', 'Table View');
			defaultView.set('mode', 'table');
			defaultView.set('columns', new Y.Array<any>());
			defaultView.set('filter', { type: 'group', op: 'and', conditions: [] });
			defaultView.set('groupBy', null);
			defaultView.set('sort', null);
			defaultView.set('header', { titleColumn: null, iconColumn: null });
			const views = new Y.Array<any>();
			views.push([defaultView]);
			block.set('prop:views', views);
			block.set('prop:title', makeText(content));
			block.set('prop:cells', new Y.Map<any>());
			block.set('prop:columns', new Y.Array<any>());
			block.set('prop:comments', undefined);
			return { blockId, block, flavour: 'affine:database' };
		}
		case 'data_view': {
			return createPresetBackedDataViewBlock(
				blockId,
				normalized.text,
				normalized.dataViewMode,
				`data_view_${normalized.dataViewMode}`
			);
		}
		case 'surface_ref': {
			setSysFields(block, blockId, 'affine:surface-ref');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:reference', normalized.reference);
			block.set('prop:caption', normalized.caption ?? '');
			block.set('prop:refFlavour', normalized.refFlavour);
			block.set('prop:comments', undefined);
			return { blockId, block, flavour: 'affine:surface-ref' };
		}
		case 'frame': {
			setSysFields(block, blockId, 'affine:frame');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:title', makeText(content || 'Frame'));
			block.set('prop:background', normalized.background);
			block.set('prop:xywh', `[0,0,${normalized.width},${normalized.height}]`);
			block.set('prop:index', 'a0');
			block.set('prop:childElementIds', new Y.Map<any>());
			block.set('prop:presentationIndex', 'a0');
			block.set('prop:lockedBySelf', false);
			return { blockId, block, flavour: 'affine:frame' };
		}
		case 'edgeless_text': {
			setSysFields(block, blockId, 'affine:edgeless-text');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:xywh', `[0,0,${normalized.width},${normalized.height}]`);
			block.set('prop:index', 'a0');
			block.set('prop:lockedBySelf', false);
			block.set('prop:scale', 1);
			block.set('prop:rotate', 0);
			block.set('prop:hasMaxWidth', false);
			block.set('prop:comments', undefined);
			block.set('prop:color', 'black');
			block.set('prop:fontFamily', 'Inter');
			block.set('prop:fontStyle', 'normal');
			block.set('prop:fontWeight', 'regular');
			block.set('prop:textAlign', 'left');
			return { blockId, block, flavour: 'affine:edgeless-text' };
		}
		case 'note': {
			setSysFields(block, blockId, 'affine:note');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:xywh', `[0,0,${normalized.width},${normalized.height}]`);
			block.set('prop:background', normalized.background);
			block.set('prop:index', 'a0');
			block.set('prop:lockedBySelf', false);
			block.set('prop:hidden', false);
			block.set('prop:displayMode', 'both');
			const edgeless = new Y.Map<any>();
			const style = new Y.Map<any>();
			style.set('borderRadius', 8);
			style.set('borderSize', 1);
			style.set('borderStyle', 'solid');
			style.set('shadowType', 'none');
			edgeless.set('style', style);
			block.set('prop:edgeless', edgeless);
			block.set('prop:comments', undefined);
			return { blockId, block, flavour: 'affine:note' };
		}
	}
}

/**
 * Apply Markdown operations to document
 */
async function applyMarkdownOperationsInternal(parsed: {
	workspaceId: string;
	docId: string;
	operations: MarkdownOperation[];
	strict?: boolean;
	placement?: AppendPlacement;
	replaceExisting?: boolean;
}): Promise<{ appendedCount: number; skippedCount: number; blockIds: string[] }> {
	const strict = parsed.strict !== false;
	const replaceExisting = parsed.replaceExisting !== false;

	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, parsed.workspaceId);
		const { doc, exists, prevSV } = await fetchYDoc(socket, parsed.workspaceId, parsed.docId);
		if (!exists) throw new Error(`Document ${parsed.docId} not found.`);

		const blocks = doc.getMap('blocks') as Y.Map<any>;

		let anchorPlacement: AppendPlacement | undefined = parsed.placement;
		let lastInsertedBlockId: string | undefined;
		let replaceParentId: string | undefined;
		let skippedCount = 0;
		const blockIds: string[] = [];
		if (replaceExisting) {
			replaceParentId = ensureNoteBlock(blocks);
			const noteBlock = findBlockById(blocks, replaceParentId);
			if (!noteBlock) throw new Error('Unable to resolve note block.');
			const noteChildren = ensureChildrenArray(noteBlock);
			const descendantBlockIds = collectDescendantBlockIds(
				blocks,
				childIdsFrom(noteChildren)
			);
			for (const descendantId of descendantBlockIds) blocks.delete(descendantId);
			if (noteChildren.length > 0) noteChildren.delete(0, noteChildren.length);
		}
		for (const operation of parsed.operations) {
			const placement = lastInsertedBlockId
				? { afterBlockId: lastInsertedBlockId }
				: replaceParentId
					? { parentId: replaceParentId }
					: anchorPlacement;
			const appendInput = markdownOperationToAppendInput(
				operation,
				parsed.docId,
				parsed.workspaceId,
				strict,
				placement
			);
			try {
				const normalized = normalizeAppendBlockInput(appendInput);
				const context = resolveInsertContext(blocks, normalized);
				const { blockId, block, extraBlocks } = createBlock(normalized);
				blocks.set(blockId, block);
				if (Array.isArray(extraBlocks))
					for (const extra of extraBlocks) blocks.set(extra.blockId, extra.block);
				if (context.insertIndex >= context.children.length)
					context.children.push([blockId]);
				else context.children.insert(context.insertIndex, [blockId]);
				blockIds.push(blockId);
				lastInsertedBlockId = blockId;
				if (!replaceParentId) anchorPlacement = { afterBlockId: blockId };
			} catch {
				skippedCount += 1;
			}
		}
		await updateYDoc(socket, parsed.workspaceId, parsed.docId, doc, prevSV);
		return { appendedCount: blockIds.length, skippedCount, blockIds };
	} finally {
	}
}

export function normalizeBlockTypeInput(typeInput: string): {
	type: AppendBlockCanonicalType;
	legacyType?: AppendBlockLegacyType;
	headingLevelFromAlias?: 1 | 2 | 3;
	listStyleFromAlias?: AppendBlockListStyle;
} {
	const key = typeInput.trim().toLowerCase();
	if ((APPEND_BLOCK_CANONICAL_TYPE_VALUES as readonly string[]).includes(key)) {
		return { type: key as AppendBlockCanonicalType };
	}

	if (Object.prototype.hasOwnProperty.call(APPEND_BLOCK_LEGACY_ALIAS_MAP, key)) {
		const legacyType = key as AppendBlockLegacyType;
		const type = APPEND_BLOCK_LEGACY_ALIAS_MAP[legacyType];
		const listStyleFromAlias =
			legacyType === 'bulleted_list'
				? 'bulleted'
				: legacyType === 'numbered_list'
					? 'numbered'
					: legacyType === 'todo'
						? 'todo'
						: undefined;
		const headingLevelFromAlias =
			legacyType === 'heading1'
				? 1
				: legacyType === 'heading2'
					? 2
					: legacyType === 'heading3'
						? 3
						: undefined;
		return { type, legacyType, headingLevelFromAlias, listStyleFromAlias };
	}

	const supported = [
		...APPEND_BLOCK_CANONICAL_TYPE_VALUES,
		...Object.keys(APPEND_BLOCK_LEGACY_ALIAS_MAP)
	].join(', ');
	throw new Error(`Unsupported append_block type '${typeInput}'. Supported types: ${supported}`);
}

export function normalizePlacement(
	placement: AppendPlacement | undefined
): AppendPlacement | undefined {
	if (!placement) return undefined;

	const normalized: AppendPlacement = {};
	if (placement.parentId?.trim()) normalized.parentId = placement.parentId.trim();
	if (placement.afterBlockId?.trim()) normalized.afterBlockId = placement.afterBlockId.trim();
	if (placement.beforeBlockId?.trim()) normalized.beforeBlockId = placement.beforeBlockId.trim();
	if (placement.index !== undefined) normalized.index = placement.index;

	const hasAfter = Boolean(normalized.afterBlockId);
	const hasBefore = Boolean(normalized.beforeBlockId);
	if (hasAfter && hasBefore) {
		throw new Error(
			'placement.afterBlockId and placement.beforeBlockId are mutually exclusive.'
		);
	}
	if (normalized.index !== undefined) {
		if (!Number.isInteger(normalized.index) || normalized.index < 0) {
			throw new Error('placement.index must be an integer greater than or equal to 0.');
		}
		if (hasAfter || hasBefore) {
			throw new Error(
				'placement.index cannot be used with placement.afterBlockId/beforeBlockId.'
			);
		}
	}

	if (
		!normalized.parentId &&
		!normalized.afterBlockId &&
		!normalized.beforeBlockId &&
		normalized.index === undefined
	) {
		return undefined;
	}
	return normalized;
}

export function normalizeAppendBlockInput(parsed: AppendBlockInput): NormalizedAppendBlockInput {
	const strict = parsed.strict !== false;
	const typeInfo = normalizeBlockTypeInput(parsed.type);
	const headingLevelCandidate = parsed.level ?? typeInfo.headingLevelFromAlias ?? 1;
	const headingLevelNumber = Number(headingLevelCandidate);
	const headingLevel = Math.max(1, Math.min(6, headingLevelNumber)) as 1 | 2 | 3 | 4 | 5 | 6;
	const listStyle = typeInfo.listStyleFromAlias ?? parsed.style ?? 'bulleted';
	const bookmarkStyle = parsed.bookmarkStyle ?? 'horizontal';
	const dataViewMode = parsed.viewMode ?? (typeInfo.type === 'data_view' ? 'kanban' : 'table');
	const language = (parsed.language ?? 'txt').trim().toLowerCase() || 'txt';
	const placement = normalizePlacement(parsed.placement);
	const url = (parsed.url ?? '').trim();
	const pageId = (parsed.pageId ?? '').trim();
	const iframeUrl = (parsed.iframeUrl ?? '').trim();
	const html = parsed.html ?? '';
	const design = parsed.design ?? '';
	const reference = (parsed.reference ?? '').trim();
	const refFlavour = (parsed.refFlavour ?? '').trim();
	const width = Number.isFinite(parsed.width)
		? Math.max(1, Math.floor(parsed.width as number))
		: 100;
	const height = Number.isFinite(parsed.height)
		? Math.max(1, Math.floor(parsed.height as number))
		: 100;
	const background = (parsed.background ?? 'transparent').trim() || 'transparent';
	const sourceId = (parsed.sourceId ?? '').trim();
	const name = (parsed.name ?? 'attachment').trim() || 'attachment';
	const mimeType =
		(parsed.mimeType ?? 'application/octet-stream').trim() || 'application/octet-stream';
	const size = Number.isFinite(parsed.size) ? Math.max(0, Math.floor(parsed.size as number)) : 0;
	const rows = Number.isInteger(parsed.rows) ? (parsed.rows as number) : 3;
	const columns = Number.isInteger(parsed.columns) ? (parsed.columns as number) : 3;
	const latex = (parsed.latex ?? '').trim();
	const tableData = Array.isArray(parsed.tableData) ? parsed.tableData : undefined;
	const tableCellDeltas = Array.isArray(parsed.tableCellDeltas)
		? parsed.tableCellDeltas
		: undefined;

	const normalized: NormalizedAppendBlockInput = {
		workspaceId: parsed.workspaceId,
		docId: parsed.docId,
		type: typeInfo.type,
		strict,
		placement,
		text: parsed.text ?? '',
		url,
		pageId,
		iframeUrl,
		html,
		design,
		reference,
		refFlavour,
		width,
		height,
		background,
		sourceId,
		name,
		mimeType,
		size,
		embed: Boolean(parsed.embed),
		rows,
		columns,
		latex,
		headingLevel,
		listStyle,
		bookmarkStyle,
		dataViewMode,
		checked: Boolean(parsed.checked),
		language,
		caption: parsed.caption,
		legacyType: typeInfo.legacyType,
		tableData,
		deltas: parsed.deltas,
		tableCellDeltas
	};

	validateNormalizedAppendBlockInput(normalized, parsed);
	return normalized;
}

export function findParentIdByChild(blocks: Y.Map<any>, childId: string): string | null {
	for (const [id, value] of blocks) {
		if (!(value instanceof Y.Map)) {
			continue;
		}
		const childIds = childIdsFrom(value.get('sys:children'));
		if (childIds.includes(childId)) {
			return String(id);
		}
	}
	return null;
}

export function resolveBlockParentId(blocks: Y.Map<any>, blockId: string): string | null {
	const block = findBlockById(blocks, blockId);
	if (!block) {
		return null;
	}
	const rawParentId = block.get('sys:parent');
	if (typeof rawParentId === 'string' && rawParentId.trim().length > 0) {
		return rawParentId;
	}
	return findParentIdByChild(blocks, blockId);
}

export function ensureSurfaceBlock(blocks: Y.Map<any>): string {
	const existingSurfaceId = findBlockIdByFlavour(blocks, 'affine:surface');
	if (existingSurfaceId) {
		return existingSurfaceId;
	}

	const pageId = findBlockIdByFlavour(blocks, 'affine:page');
	if (!pageId) {
		throw new Error('Document has no page block; unable to create/find surface.');
	}

	const surfaceId = generateId();
	const surface = new Y.Map<any>();
	setSysFields(surface, surfaceId, 'affine:surface');
	surface.set('sys:parent', null);
	surface.set('sys:children', new Y.Array<string>());
	const elements = new Y.Map<any>();
	elements.set('type', '$blocksuite:internal:native$');
	elements.set('value', new Y.Map<any>());
	surface.set('prop:elements', elements);
	blocks.set(surfaceId, surface);

	const page = blocks.get(pageId) as Y.Map<any>;
	let pageChildren = page.get('sys:children') as Y.Array<string> | undefined;
	if (!(pageChildren instanceof Y.Array)) {
		pageChildren = new Y.Array<string>();
		page.set('sys:children', pageChildren);
	}
	pageChildren.push([surfaceId]);
	return surfaceId;
}

export function indexOfChild(children: Y.Array<any>, blockId: string): number {
	let index = -1;
	children.forEach((entry: unknown, i: number) => {
		if (index >= 0) return;
		if (typeof entry === 'string') {
			if (entry === blockId) index = i;
			return;
		}
		if (Array.isArray(entry)) {
			for (const child of entry) {
				if (child === blockId) {
					index = i;
					return;
				}
			}
		}
	});
	return index;
}

export function resolveInsertContext(
	blocks: Y.Map<any>,
	normalized: NormalizedAppendBlockInput
): {
	parentId: string;
	parentBlock: Y.Map<any>;
	children: Y.Array<any>;
	insertIndex: number;
} {
	const placement = normalized.placement;
	let parentId: string | undefined;
	let referenceBlockId: string | undefined;
	let mode: 'append' | 'index' | 'after' | 'before' = 'append';

	if (placement?.afterBlockId) {
		mode = 'after';
		referenceBlockId = placement.afterBlockId;
		const referenceBlock = findBlockById(blocks, referenceBlockId);
		if (!referenceBlock)
			throw new Error(`placement.afterBlockId '${referenceBlockId}' was not found.`);
		const refParentId = resolveBlockParentId(blocks, referenceBlockId);
		if (!refParentId) {
			throw new Error(`Block '${referenceBlockId}' has no parent.`);
		}
		parentId = refParentId;
	} else if (placement?.beforeBlockId) {
		mode = 'before';
		referenceBlockId = placement.beforeBlockId;
		const referenceBlock = findBlockById(blocks, referenceBlockId);
		if (!referenceBlock)
			throw new Error(`placement.beforeBlockId '${referenceBlockId}' was not found.`);
		const refParentId = resolveBlockParentId(blocks, referenceBlockId);
		if (!refParentId) {
			throw new Error(`Block '${referenceBlockId}' has no parent.`);
		}
		parentId = refParentId;
	} else if (placement?.parentId) {
		mode = placement.index !== undefined ? 'index' : 'append';
		parentId = placement.parentId;
	}

	if (!parentId) {
		if (normalized.type === 'frame' || normalized.type === 'edgeless_text') {
			parentId = ensureSurfaceBlock(blocks);
		} else if (normalized.type === 'note') {
			parentId = findBlockIdByFlavour(blocks, 'affine:page') || undefined;
			if (!parentId) {
				throw new Error('Document has no page block; unable to insert note.');
			}
		} else {
			parentId = ensureNoteBlock(blocks);
		}
	}
	const parentBlock = findBlockById(blocks, parentId);
	if (!parentBlock) {
		throw new Error(`Target parent block '${parentId}' was not found.`);
	}
	const parentFlavour = parentBlock.get('sys:flavour');
	if (normalized.strict) {
		if (parentFlavour === 'affine:page' && normalized.type !== 'note') {
			throw new Error(`Cannot append '${normalized.type}' directly under 'affine:page'.`);
		}
		if (
			parentFlavour === 'affine:surface' &&
			normalized.type !== 'frame' &&
			normalized.type !== 'edgeless_text'
		) {
			throw new Error(`Cannot append '${normalized.type}' directly under 'affine:surface'.`);
		}
		if (normalized.type === 'note' && parentFlavour !== 'affine:page') {
			throw new Error('note blocks must be appended under affine:page.');
		}
		if (
			(normalized.type === 'frame' || normalized.type === 'edgeless_text') &&
			parentFlavour !== 'affine:surface'
		) {
			throw new Error(`${normalized.type} blocks must be appended under affine:surface.`);
		}
	}

	const children = ensureChildrenArray(parentBlock);
	let insertIndex = children.length;
	if (mode === 'after' || mode === 'before') {
		const idx = indexOfChild(children, referenceBlockId as string);
		if (idx < 0) {
			throw new Error(
				`Reference block '${referenceBlockId}' is not a child of parent '${parentId}'.`
			);
		}
		insertIndex = mode === 'after' ? idx + 1 : idx;
	} else if (mode === 'index') {
		const requestedIndex = placement?.index ?? children.length;
		if (requestedIndex > children.length && normalized.strict) {
			throw new Error(
				`placement.index ${requestedIndex} is out of range (max ${children.length}).`
			);
		}
		insertIndex = Math.min(requestedIndex, children.length);
	}

	return { parentId, parentBlock, children, insertIndex };
}

export function markdownOperationToAppendInput(
	operation: MarkdownOperation,
	docId: string,
	workspaceId?: string,
	strict: boolean = true,
	placement?: AppendPlacement
): AppendBlockInput {
	switch (operation.type) {
		case 'heading':
			return {
				workspaceId,
				docId,
				type: 'heading',
				text: operation.text,
				level: operation.level,
				strict,
				placement
			};
		case 'paragraph':
			return {
				workspaceId,
				docId,
				type: 'paragraph',
				text: operation.text,
				strict,
				placement
			};
		case 'quote':
			return {
				workspaceId,
				docId,
				type: 'quote',
				text: operation.text,
				strict,
				placement
			};
		case 'callout':
			return {
				workspaceId,
				docId,
				type: 'callout',
				text: operation.text,
				strict,
				placement
			};
		case 'list':
			return {
				workspaceId,
				docId,
				type: 'list',
				text: operation.text,
				style: operation.style,
				checked: operation.checked,
				deltas: operation.deltas,
				strict,
				placement
			};
		case 'code':
			return {
				workspaceId,
				docId,
				type: 'code',
				text: operation.text,
				language: operation.language,
				strict,
				placement
			};
		case 'divider':
			return { workspaceId, docId, type: 'divider', strict, placement };
		case 'table':
			return {
				workspaceId,
				docId,
				type: 'table',
				rows: operation.rows,
				columns: operation.columns,
				tableData: operation.tableData,
				tableCellDeltas: operation.tableCellDeltas,
				strict,
				placement
			};
		case 'bookmark':
			return {
				workspaceId,
				docId,
				type: 'bookmark',
				url: operation.url,
				caption: operation.caption,
				strict,
				placement
			};
		default: {
			const exhaustiveCheck: never = operation;
			throw new Error(
				`Unsupported markdown operation type: ${(exhaustiveCheck as any).type}`
			);
		}
	}
}

export function validateNormalizedAppendBlockInput(
	normalized: NormalizedAppendBlockInput,
	raw: AppendBlockInput
): void {
	if (normalized.type === 'heading') {
		if (
			!Number.isInteger(normalized.headingLevel) ||
			normalized.headingLevel < 1 ||
			normalized.headingLevel > 6
		) {
			throw new Error('Heading level must be an integer from 1 to 6.');
		}
	} else if (raw.level !== undefined && normalized.strict) {
		throw new Error("The 'level' field can only be used with type='heading'.");
	}

	if (normalized.type === 'list') {
		if (!(APPEND_BLOCK_LIST_STYLE_VALUES as readonly string[]).includes(normalized.listStyle)) {
			throw new Error(`Invalid list style '${normalized.listStyle}'.`);
		}
		if (normalized.listStyle !== 'todo' && raw.checked !== undefined && normalized.strict) {
			throw new Error("The 'checked' field can only be used when list style is 'todo'.");
		}
	} else {
		if (raw.style !== undefined && normalized.strict) {
			throw new Error("The 'style' field can only be used with type='list'.");
		}
		if (raw.checked !== undefined && normalized.strict) {
			throw new Error(
				"The 'checked' field can only be used with type='list' (style='todo')."
			);
		}
	}

	if (normalized.type !== 'code') {
		if (raw.language !== undefined && normalized.strict) {
			throw new Error("The 'language' field can only be used with type='code'.");
		}
		const allowsCaption =
			normalized.type === 'bookmark' ||
			normalized.type === 'image' ||
			normalized.type === 'attachment' ||
			normalized.type === 'surface_ref' ||
			normalized.type.startsWith('embed_');
		if (raw.caption !== undefined && !allowsCaption && normalized.strict) {
			throw new Error("The 'caption' field is not valid for this block type.");
		}
	} else if (normalized.language.length > 64) {
		throw new Error('Code language is too long (max 64 chars).');
	}

	if (normalized.type === 'divider' && raw.text && raw.text.length > 0 && normalized.strict) {
		throw new Error('Divider blocks do not accept text.');
	}

	const requiresUrl = [
		'bookmark',
		'embed_youtube',
		'embed_github',
		'embed_figma',
		'embed_loom',
		'embed_iframe'
	] as const;
	const urlAllowedTypes = [...requiresUrl] as readonly string[];
	if (urlAllowedTypes.includes(normalized.type)) {
		if (!normalized.url) {
			throw new Error(`${normalized.type} blocks require a non-empty url.`);
		}
		try {
			new URL(normalized.url);
		} catch {
			throw new Error(`Invalid url for ${normalized.type} block: '${normalized.url}'.`);
		}
	}

	if (normalized.type === 'bookmark') {
		if (
			!(APPEND_BLOCK_BOOKMARK_STYLE_VALUES as readonly string[]).includes(
				normalized.bookmarkStyle
			)
		) {
			throw new Error(`Invalid bookmark style '${normalized.bookmarkStyle}'.`);
		}
	} else {
		if (raw.bookmarkStyle !== undefined && normalized.strict) {
			throw new Error("The 'bookmarkStyle' field can only be used with type='bookmark'.");
		}
		if (
			raw.url !== undefined &&
			!urlAllowedTypes.includes(normalized.type) &&
			normalized.strict
		) {
			throw new Error("The 'url' field is not valid for this block type.");
		}
	}

	if (normalized.type === 'image' || normalized.type === 'attachment') {
		if (!normalized.sourceId) {
			throw new Error(`${normalized.type} blocks require sourceId (use upload_blob first).`);
		}
		if (normalized.type === 'attachment' && (!normalized.name || !normalized.mimeType)) {
			throw new Error('attachment blocks require valid name and mimeType.');
		}
	} else if (raw.sourceId !== undefined && normalized.strict) {
		throw new Error(
			"The 'sourceId' field can only be used with type='image' or type='attachment'."
		);
	} else if (
		(raw.name !== undefined ||
			raw.mimeType !== undefined ||
			raw.embed !== undefined ||
			raw.size !== undefined) &&
		normalized.strict
	) {
		throw new Error(
			"The 'name'/'mimeType'/'embed'/'size' fields are only valid for image/attachment blocks."
		);
	}

	if (normalized.type === 'latex') {
		if (!normalized.latex && normalized.strict) {
			throw new Error("latex blocks require a non-empty 'latex' value in strict mode.");
		}
	} else if (raw.latex !== undefined && normalized.strict) {
		throw new Error("The 'latex' field can only be used with type='latex'.");
	}

	if (normalized.type === 'embed_linked_doc' || normalized.type === 'embed_synced_doc') {
		if (!normalized.pageId) {
			throw new Error(`${normalized.type} blocks require pageId.`);
		}
	} else if (raw.pageId !== undefined && normalized.strict) {
		throw new Error("The 'pageId' field can only be used with linked/synced doc embed types.");
	}

	if (normalized.type === 'embed_html') {
		if (!normalized.html && !normalized.design && normalized.strict) {
			throw new Error('embed_html blocks require html or design.');
		}
	} else if ((raw.html !== undefined || raw.design !== undefined) && normalized.strict) {
		throw new Error("The 'html'/'design' fields can only be used with type='embed_html'.");
	}

	if (normalized.type === 'embed_iframe') {
		if (raw.iframeUrl !== undefined && !normalized.iframeUrl && normalized.strict) {
			throw new Error('embed_iframe iframeUrl cannot be empty when provided.');
		}
	} else if (raw.iframeUrl !== undefined && normalized.strict) {
		throw new Error("The 'iframeUrl' field can only be used with type='embed_iframe'.");
	}

	if (normalized.type === 'surface_ref') {
		if (!normalized.reference) {
			throw new Error("surface_ref blocks require 'reference' (target element/block id).");
		}
		if (!normalized.refFlavour) {
			throw new Error("surface_ref blocks require 'refFlavour' (for example affine:frame).");
		}
	} else if ((raw.reference !== undefined || raw.refFlavour !== undefined) && normalized.strict) {
		throw new Error(
			"The 'reference'/'refFlavour' fields can only be used with type='surface_ref'."
		);
	}

	if (
		normalized.type === 'frame' ||
		normalized.type === 'edgeless_text' ||
		normalized.type === 'note'
	) {
		if (
			!Number.isInteger(normalized.width) ||
			normalized.width < 1 ||
			normalized.width > 10000
		) {
			throw new Error(`${normalized.type} width must be an integer between 1 and 10000.`);
		}
		if (
			!Number.isInteger(normalized.height) ||
			normalized.height < 1 ||
			normalized.height > 10000
		) {
			throw new Error(`${normalized.type} height must be an integer between 1 and 10000.`);
		}
	} else if ((raw.width !== undefined || raw.height !== undefined) && normalized.strict) {
		throw new Error("The 'width'/'height' fields are only valid for frame/edgeless_text/note.");
	}

	if (
		normalized.type !== 'frame' &&
		normalized.type !== 'note' &&
		raw.background !== undefined &&
		normalized.strict
	) {
		throw new Error("The 'background' field is only valid for frame/note.");
	}

	if (normalized.type === 'table') {
		if (!Number.isInteger(normalized.rows) || normalized.rows < 1 || normalized.rows > 20) {
			throw new Error('table rows must be an integer between 1 and 20.');
		}
		if (
			!Number.isInteger(normalized.columns) ||
			normalized.columns < 1 ||
			normalized.columns > 20
		) {
			throw new Error('table columns must be an integer between 1 and 20.');
		}
		if (normalized.tableData) {
			if (
				!Array.isArray(normalized.tableData) ||
				normalized.tableData.length !== normalized.rows
			) {
				throw new Error('tableData row count must match table rows.');
			}
			for (const row of normalized.tableData) {
				if (!Array.isArray(row) || row.length !== normalized.columns) {
					throw new Error('tableData column count must match table columns.');
				}
			}
		}
	} else if ((raw.rows !== undefined || raw.columns !== undefined) && normalized.strict) {
		throw new Error("The 'rows'/'columns' fields can only be used with type='table'.");
	} else if (raw.tableData !== undefined && normalized.strict) {
		throw new Error("The 'tableData' field can only be used with type='table'.");
	}

	if (
		normalized.type !== 'database' &&
		normalized.type !== 'data_view' &&
		raw.viewMode !== undefined &&
		normalized.strict
	) {
		throw new Error(
			"The 'viewMode' field can only be used with type='database' or type='data_view'."
		);
	}
}

/**
 * Internal document creation function
 */
async function createDocInternal(
	workspaceId: string,
	title: string,
	content?: string
): Promise<{ workspaceId: string; docId: string; title: string }> {
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		const docId = generateId(12, 'doc');
		const docTitle = title || 'Untitled';
		const ydoc = new Y.Doc();
		const blocks = ydoc.getMap('blocks');

		// Create page block
		const pageId = generateId(12, 'page');
		const page = new Y.Map();
		setSysFields(page, pageId, 'affine:page');
		const titleText = new Y.Text();
		titleText.insert(0, docTitle);
		page.set('prop:title', titleText);
		const children = new Y.Array();
		page.set('sys:children', children);
		blocks.set(pageId, page);

		// Create surface block
		const surfaceId = generateId(12, 'surf');
		const surface = new Y.Map();
		setSysFields(surface, surfaceId, 'affine:surface');
		surface.set('sys:parent', null);
		surface.set('sys:children', new Y.Array());
		const elements = new Y.Map<any>();
		elements.set('type', '$blocksuite:internal:native$');
		elements.set('value', new Y.Map<any>());
		surface.set('prop:elements', elements);
		blocks.set(surfaceId, surface);
		children.push([surfaceId]);

		// Create note block
		const noteId = generateId(12, 'note');
		const note = new Y.Map();
		setSysFields(note, noteId, 'affine:note');
		note.set('sys:parent', null);
		note.set('prop:displayMode', 'both');
		note.set('prop:xywh', '[0,0,800,95]');
		note.set('prop:index', 'a0');
		note.set('prop:hidden', false);
		const background = new Y.Map<any>();
		background.set('light', '#ffffff');
		background.set('dark', '#252525');
		note.set('prop:background', background);
		const noteChildren = new Y.Array();
		note.set('sys:children', noteChildren);
		blocks.set(noteId, note);
		children.push([noteId]);

		// If initial content exists, add paragraph
		if (content) {
			const paraId = generateId(12, 'para');
			const para = new Y.Map();
			setSysFields(para, paraId, 'affine:paragraph');
			para.set('sys:parent', null);
			para.set('sys:children', new Y.Array());
			para.set('prop:type', 'text');
			const paragraphText = new Y.Text();
			paragraphText.insert(0, content);
			para.set('prop:text', paragraphText);
			blocks.set(paraId, para);
			noteChildren.push([paraId]);
		}

		// Set meta
		const meta = ydoc.getMap('meta');
		meta.set('id', docId);
		meta.set('title', docTitle);
		meta.set('createDate', Date.now());
		meta.set('tags', new Y.Array());

		// Push document update
		await updateYDoc(socket, workspaceId, docId, ydoc);

		// Update workspace metadata
		const { doc: wsDoc, prevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
		const wsMeta = wsDoc.getMap('meta');

		let pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;
		if (!pages) {
			pages = new Y.Array();
			wsMeta.set('pages', pages);
		}

		const entry = new Y.Map();
		entry.set('id', docId);
		entry.set('title', docTitle);
		entry.set('createDate', Date.now());
		entry.set('tags', new Y.Array());
		pages.push([entry as any]);

		await updateYDoc(socket, workspaceId, workspaceId, wsDoc, prevSV);

		return { workspaceId, docId, title: docTitle };
	} finally {
	}
}

/**
 * Get or create tag option
 */
async function ensureTagOption(wsDoc: Y.Doc, tagName: string): Promise<string> {
	const wsMeta = wsDoc.getMap('meta');
	const properties = wsMeta.get('properties') as Y.Map<any> | undefined;
	const tags = properties?.get('tags') as Y.Map<any> | undefined;
	const options = tags?.get('options') as Y.Array<any> | undefined;

	// Find existing tag
	if (options) {
		for (let i = 0; i < options.length; i++) {
			const opt = options.get(i);
			if (opt instanceof Y.Map) {
				const value = opt.get('value');
				if (value && value.toLowerCase() === tagName.toLowerCase()) {
					return opt.get('id');
				}
			}
		}
	}

	// Create new tag
	const tagId = generateId(8, 'tag');
	const color = TAG_COLORS[(options?.length || 0) % TAG_COLORS.length];
	const now = Date.now();

	// Ensure properties.tags.options structure exists
	let targetOptions = options;
	if (!targetOptions) {
		if (!properties) {
			const newProps = new Y.Map<any>();
			wsMeta.set('properties', newProps);
		}
		const finalProps = properties || (wsMeta.get('properties') as Y.Map<any>);
		if (!tags) {
			const newTags = new Y.Map<any>();
			finalProps.set('tags', newTags);
		}
		const finalTags = finalProps.get('tags') as Y.Map<any>;
		targetOptions = new Y.Array<any>();
		finalTags.set('options', targetOptions);
	}

	const optionMap = new Y.Map<any>();
	optionMap.set('id', tagId);
	optionMap.set('value', tagName);
	optionMap.set('color', color);
	optionMap.set('createDate', now);
	optionMap.set('updateDate', now);
	targetOptions.push([optionMap]);

	return tagId;
}

/**
 * Add document to folder
 */
async function addDocToFolder(workspaceId: string, docId: string, folderId: string): Promise<void> {
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// Folders are stored in special documents
		const foldersDocId = `db$${workspaceId}$folders`;
		const { doc: foldersDoc, exists: hasSnapshot } = await fetchYDoc(socket, workspaceId, foldersDocId);

		// Collect existing nodes
		const nodes: any[] = [];
		if (hasSnapshot) {
			try {
				for (const key of foldersDoc.share.keys()) {
					if (!foldersDoc.share.has(key)) continue;
					const record = foldersDoc.getMap(key);
					if (!(record instanceof Y.Map)) continue;
					if (record.get('$$DELETED') === true || record.size === 0) continue;

					nodes.push({
						id: key,
						type: record.get('type'),
						data: record.get('data'),
						parentId: record.get('parentId'),
						index: record.get('index')
					});
				}
			} catch {
				// Ignore traversal errors
			}
		}

		// Find the maximum index among folder children
		let maxIndex = 0;
		const folderChildren = nodes.filter((n) => n.parentId === folderId && n.type === 'doc');
		folderChildren.forEach((n) => {
			if (n.index && parseInt(n.index) > maxIndex) {
				maxIndex = parseInt(n.index);
			}
		});

		// Create new link record
		const linkId = generateId(12, 'link');
		const record = foldersDoc.getMap(linkId);
		record.set('id', linkId);
		record.set('type', 'doc');
		record.set('data', docId);
		record.set('parentId', folderId);
		record.set('index', String(maxIndex + 1));

		await updateYDoc(socket, workspaceId, foldersDocId, foldersDoc);
	} finally {
	}
}

export async function appendBlockInternal(parsed: AppendBlockInput) {
	const normalized = normalizeAppendBlockInput(parsed);
	const workspaceId = await getWorkspaceId(normalized.workspaceId);
	if (!workspaceId) throw new Error('workspaceId is required');

	const socket = await createWorkspaceSocket();
	try {
		await joinWorkspace(socket, workspaceId);

		const { doc: doc, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, normalized.docId);
		const blocks = doc.getMap('blocks') as Y.Map<any>;
		const context = resolveInsertContext(blocks, normalized);
		const { blockId, block, flavour, blockType, extraBlocks } = createBlock(normalized);

		blocks.set(blockId, block);
		if (Array.isArray(extraBlocks)) {
			for (const extra of extraBlocks) {
				blocks.set(extra.blockId, extra.block);
			}
		}
		if (context.insertIndex >= context.children.length) {
			context.children.push([blockId]);
		} else {
			context.children.insert(context.insertIndex, [blockId]);
		}

		await updateYDoc(socket, workspaceId, normalized.docId, doc, prevSV);

		return {
			appended: true,
			blockId,
			flavour,
			blockType,
			normalizedType: normalized.type,
			legacyType: normalized.legacyType || null
		};
	} finally {
	}
}
/**
 * Create document from Markdown (core function)
 */
export async function createDocFromMarkdownCore(parsed: {
	workspaceId?: string;
	title?: string;
	markdown: string;
	strict?: boolean;
	parentDocId?: string;
	tags?: string;
	folder?: string;
}) {
	const workspaceId = parsed.workspaceId;
	if (!workspaceId) {
		throw new Error('workspaceId is required');
	}

	// Parse Markdown
	const parsedMarkdown = parseMarkdownToOperations(parsed.markdown);
	let operations = [...parsedMarkdown.operations];

	// Extract title (if unspecified, use first h1 heading)
	let title = (parsed.title ?? '').trim();
	if (!title && operations.length > 0) {
		const first = operations[0];
		if (first.type === 'heading' && first.level === 1) {
			title = first.text.trim();
			operations = operations.slice(1);
		}
	}

	// If still no valid title (empty or whitespace-only content), use timestamp format
	if (!title) {
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		title = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} New Document`;
	}

	// Parse tags
	const tagNames =
		parsed.tags
			?.trim()
			.split(',')
			.map((t) => t.trim())
			.filter((t) => t) ?? [];

	// Create document
	const created = await createDocInternal(workspaceId, title);

	// Add tags to document
	if (tagNames.length > 0) {
		const socket = await createWorkspaceSocket();

		try {
			await joinWorkspace(socket, workspaceId);

			// Load workspace document
			const { doc: wsDoc, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
			const wsMeta = wsDoc.getMap('meta');
			const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

			if (pages) {
				for (let i = 0; i < pages.length; i++) {
					const entry = pages.get(i);
					if (entry.get('id') === created.docId) {
						// Get or create IDs for all tags
						const tagIds: string[] = [];
						for (const tagName of tagNames) {
							const tagId = await ensureTagOption(wsDoc, tagName);
							tagIds.push(tagId);
						}

						// Add tag IDs to document entry
						const docTags = entry.get('tags') as Y.Array<string> | undefined;
						if (docTags) {
							for (const tagId of tagIds) {
								docTags.push([tagId]);
							}
						} else {
							const newTags = new Y.Array<string>();
							for (const tagId of tagIds) {
								newTags.push([tagId]);
							}
							entry.set('tags', newTags);
						}
						break;
					}
				}
			}

			// Push updates
			await updateYDoc(socket, workspaceId, workspaceId, wsDoc, prevSV);
		} finally {
		}
	}

	// Add document to folder
	if (parsed.folder) {
		try {
			await addDocToFolder(workspaceId, created.docId, parsed.folder);
		} catch {
			// Non-fatal
		}
	}

	// Apply Markdown operations
	let applied = {
		appendedCount: 0,
		skippedCount: 0,
		blockIds: [] as string[]
	};

	if (operations.length > 0) {
		applied = await applyMarkdownOperationsInternal({
			workspaceId: created.workspaceId,
			docId: created.docId,
			operations,
			strict: parsed.strict
		});
	}

	// If parent document specified, add link
	let linkedToParent = false;
	if (parsed.parentDocId) {
		try {
			await appendBlockInternal({
				workspaceId: created.workspaceId,
				docId: parsed.parentDocId,
				type: 'embed_linked_doc',
				pageId: created.docId
			});
			linkedToParent = true;
		} catch {
			// Non-fatal
		}
	}

	// Generate warnings
	const applyWarnings: string[] = [];
	if (applied.skippedCount > 0) {
		applyWarnings.push(
			`${applied.skippedCount} markdown block(s) could not be applied to AFFiNE and were skipped.`
		);
	}
	if (parsed.parentDocId && !linkedToParent) {
		applyWarnings.push(
			`Doc created but could not be linked to parent doc "${parsed.parentDocId}". Link it manually.`
		);
	}

	return {
		workspaceId: created.workspaceId,
		docId: created.docId,
		title: created.title,
		linkedToParent,
		tags: tagNames,
		warnings: mergeWarnings(parsedMarkdown.warnings, applyWarnings),
		lossy: parsedMarkdown.lossy || applied.skippedCount > 0,
		stats: {
			parsedBlocks: parsedMarkdown.operations.length,
			appliedBlocks: applied.appendedCount,
			skippedBlocks: applied.skippedCount
		}
	};
}

/**
 * Collect document info for Markdown export
 * Reference implementation in .resources/core/docs/util.ts
 */

// ==================== Utility Functions ====================

// /**
//  * Get tag array (from meta)
//  */
// function getTagArray(meta: Y.Map<any>): string[] {
// 	const pages = meta.get('pages') as Y.Array<any> | undefined;
// 	if (!pages) return [];
// 	for (const page of pages) {
// 		if (page instanceof Y.Map) {
// 			const tags = page.get('tags');
// 			if (tags instanceof Y.Array) {
// 				return tags.toArray() as string[];
// 			}
// 		}
// 	}
// 	return [];
// }

/**
 * Convert text content to string
 */
export function asText(value: unknown): string {
	if (value instanceof Y.Text) return value.toString();
	if (typeof value === 'string') return value;
	return '';
}

/**
 * Get string or null
 */
export function asStringOrNull(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/**
 * Get child element ID array
 */
export function childIdsFrom(value: unknown): string[] {
	if (!(value instanceof Y.Array)) return [];
	const childIds: string[] = [];
	value.forEach((entry: unknown) => {
		if (typeof entry === 'string') {
			childIds.push(entry);
			return;
		}
		if (Array.isArray(entry)) {
			for (const child of entry) {
				if (typeof child === 'string') {
					childIds.push(child);
				}
			}
		}
	});
	return childIds;
}

/**
 * Find block ID by flavour
 */
export function findBlockIdByFlavour(blocks: Y.Map<any>, flavour: string): string | null {
	for (const [, value] of blocks) {
		const block = value as Y.Map<any>;
		if (block?.get && block.get('sys:flavour') === flavour) {
			return String(block.get('sys:id'));
		}
	}
	return null;
}

/**
 * Find block by ID
 */
export function findBlockById(blocks: Y.Map<any>, blockId: string): Y.Map<any> | null {
	const value = blocks.get(blockId);
	if (value instanceof Y.Map) return value;
	return null;
}

/**
 * Ensure children array exists
 */
export function ensureChildrenArray(block: Y.Map<any>): Y.Array<any> {
	const current = block.get('sys:children');
	if (current instanceof Y.Array) return current;
	const created = new Y.Array<any>();
	block.set('sys:children', created);
	return created;
}

/**
 * Get workspace tag options map
 */
export function getWorkspaceTagOptionMaps(meta: Y.Map<any>): {
	options: WorkspaceTagOption[];
	byId: Map<string, WorkspaceTagOption>;
	byValueLower: Map<string, WorkspaceTagOption>;
} {
	const options = getWorkspaceTagOptions(meta);
	const byId = new Map<string, WorkspaceTagOption>();
	const byValueLower = new Map<string, WorkspaceTagOption>();
	for (const option of options) {
		if (!byId.has(option.id)) {
			byId.set(option.id, option);
		}
		const key = option.value.toLocaleLowerCase();
		if (!byValueLower.has(key)) {
			byValueLower.set(key, option);
		}
	}
	return { options, byId, byValueLower };
}

/**
 * Resolve tag labels
 */
export function resolveTagLabels(
	tagEntries: string[],
	byId: Map<string, WorkspaceTagOption>
): string[] {
	const deduped = new Set<string>();
	const resolved: string[] = [];
	for (const entry of tagEntries) {
		const raw = entry.trim();
		if (!raw) {
			continue;
		}
		const option = byId.get(raw);
		const label = (option ? option.value : raw).trim();
		if (!label) {
			continue;
		}
		const dedupeKey = label.toLocaleLowerCase();
		if (deduped.has(dedupeKey)) {
			continue;
		}
		deduped.add(dedupeKey);
		resolved.push(label);
	}
	return resolved;
}

/**
 * Map entries
 */
function mapEntries(value: unknown): Array<[string, any]> {
	if (value instanceof Y.Map) {
		const entries: Array<[string, any]> = [];
		value.forEach((mapValue: unknown, key: string) => {
			entries.push([key, mapValue]);
		});
		return entries;
	}
	if (value && typeof value === 'object') return Object.entries(value as Record<string, any>);
	return [];
}

/**
 * Rich text value to string
 */
function richTextValueToString(value: unknown): string {
	if (value instanceof Y.Text) return value.toString();
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		return value
			.map((entry) => {
				if (typeof entry === 'string') return entry;
				if (entry && typeof entry === 'object' && typeof (entry as any).insert === 'string')
					return (entry as any).insert as string;
				return '';
			})
			.join('');
	}
	if (value && typeof value === 'object' && typeof (value as any).insert === 'string')
		return (value as any).insert as string;
	return '';
}

/**
 * Extract table data
 */
function extractTableData(block: Y.Map<any>): string[][] | null {
	const rowsValue = block.get('prop:rows');
	const columnsValue = block.get('prop:columns');
	const cellsValue = block.get('prop:cells');

	let rowEntries = mapEntries(rowsValue)
		.map(([rowId, payload]) => ({
			rowId,
			order:
				payload && typeof payload === 'object' && typeof (payload as any).order === 'string'
					? (payload as any).order
					: rowId
		}))
		.sort((a, b) => a.order.localeCompare(b.order));

	let columnEntries = mapEntries(columnsValue)
		.map(([columnId, payload]) => ({
			columnId,
			order:
				payload && typeof payload === 'object' && typeof (payload as any).order === 'string'
					? (payload as any).order
					: columnId
		}))
		.sort((a, b) => a.order.localeCompare(b.order));

	let cells = new Map<string, string>();
	if (rowEntries.length === 0 || columnEntries.length === 0) {
		const flatRows = new Map<string, string>();
		const flatColumns = new Map<string, string>();
		const flatCells = new Map<string, string>();
		block.forEach((value: unknown, key: string) => {
			const rowMatch = key.match(/^prop:rows\.([^.]+)\.order$/);
			if (rowMatch) {
				flatRows.set(rowMatch[1], typeof value === 'string' ? value : rowMatch[1]);
				return;
			}
			const colMatch = key.match(/^prop:columns\.([^.]+)\.order$/);
			if (colMatch) {
				flatColumns.set(colMatch[1], typeof value === 'string' ? value : colMatch[1]);
				return;
			}
			const cellMatch = key.match(/^prop:cells\.([^.]+:[^.]+)\.text$/);
			if (cellMatch) {
				flatCells.set(cellMatch[1], richTextValueToString(value));
			}
		});
		if (flatRows.size > 0 && flatColumns.size > 0) {
			rowEntries = Array.from(flatRows.entries())
				.map(([rowId, order]) => ({ rowId, order }))
				.sort((a, b) => a.order.localeCompare(b.order));
			columnEntries = Array.from(flatColumns.entries())
				.map(([columnId, order]) => ({ columnId, order }))
				.sort((a, b) => a.order.localeCompare(b.order));
			cells = flatCells;
		}
	} else {
		// Extract cell data using cellsValue
		if (cellsValue instanceof Y.Map) {
			cellsValue.forEach((cellValue: unknown, key: string) => {
				cells.set(key, richTextValueToString(cellValue));
			});
		}
	}

	const tableData: string[][] = [];
	for (const { rowId } of rowEntries) {
		const row: string[] = [];
		for (const { columnId } of columnEntries) {
			// Try multiple possible cell key formats
			const key1 = `${rowId}:${columnId}`;
			const key2 = `${columnId}:${rowId}`;
			let cellText = cells.get(key1) || cells.get(key2) || '';

			// If not found, try reading directly from block
			if (!cellText) {
				const cellKey1 = `prop:cells.${rowId}:${columnId}.text`;
				const cellKey2 = `prop:cells.${columnId}:${rowId}.text`;
				cellText =
					richTextValueToString(block.get(cellKey1)) ||
					richTextValueToString(block.get(cellKey2));
			}

			row.push(cellText);
		}
		tableData.push(row);
	}
	return tableData.length > 0 ? tableData : null;
}

/**
 * Markdown renderable block types
 */
export interface MarkdownRenderableBlock {
	id: string;
	parentId: string | null;
	flavour: string | null;
	type: string | null;
	text: string | null;
	checked: boolean | null;
	language: string | null;
	childIds: string[];
	url: string | null;
	sourceId: string | null;
	caption: string | null;
	tableData: string[][] | null;
}

/**
 * Collect document info for Markdown export
 * Reference .resources/core/docs/util.ts collectDocForMarkdown implementation
 */
export function collectDocForMarkdown(doc: Y.Doc) {
	const blocks = doc.getMap('blocks') as Y.Map<any>;
	const pageId = findBlockIdByFlavour(blocks, 'affine:page');
	const noteId = findBlockIdByFlavour(blocks, 'affine:note');
	const blocksById = new Map<string, MarkdownRenderableBlock>();
	const visited = new Set<string>();
	let title = '';
	const rootBlockIds: string[] = [];
	if (pageId) {
		const pageBlock = findBlockById(blocks, pageId);
		if (pageBlock) {
			title = asText(pageBlock.get('prop:title'));
			rootBlockIds.push(...childIdsFrom(pageBlock.get('sys:children')));
		}
	} else if (noteId) rootBlockIds.push(noteId);
	if (rootBlockIds.length === 0) for (const [id] of blocks) rootBlockIds.push(String(id));

	const visit = (blockId: string) => {
		if (visited.has(blockId)) return;
		visited.add(blockId);
		const block = findBlockById(blocks, blockId);
		if (!block) return;
		const childIds = childIdsFrom(block.get('sys:children'));
		const entry: MarkdownRenderableBlock = {
			id: blockId,
			parentId: asStringOrNull(block.get('sys:parent')),
			flavour: asStringOrNull(block.get('sys:flavour')),
			type: asStringOrNull(block.get('prop:type')),
			text: asText(block.get('prop:text')) || null,
			checked:
				typeof block.get('prop:checked') === 'boolean'
					? Boolean(block.get('prop:checked'))
					: null,
			language: asStringOrNull(block.get('prop:language')),
			childIds,
			url: asStringOrNull(block.get('prop:url')),
			sourceId: asStringOrNull(block.get('prop:sourceId')),
			caption: asStringOrNull(block.get('prop:caption')),
			tableData: block.get('sys:flavour') === 'affine:table' ? extractTableData(block) : null
		};
		blocksById.set(blockId, entry);
		for (const childId of childIds) visit(childId);
	};
	for (const rootId of rootBlockIds) visit(rootId);
	for (const [id] of blocks) visit(String(id));
	return { title, rootBlockIds, blocksById };
}

/**
 * Extract emoji icon from text beginning
 * Uses same regex matching rules as Affine
 *
 * @param text - Input text
 * @returns Object with extracted emoji and remaining text, or null if no emoji
 */
export function extractEmojiIcon(text: string): { emoji: string; rest: string } | null {
	const emojiRe =
		/(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
	emojiRe.lastIndex = 0;
	const match = emojiRe.exec(text);
	if (match && match.index === 0) {
		const emojiEnd = nextGraphemeBreak(text, 0);
		return {
			emoji: text.slice(0, emojiEnd),
			rest: text.slice(emojiEnd)
		};
	}
	return null;
}

/**
 * Simple grapheme break implementation (for handling composed emoji)
 * Note: This is a simplified version, sufficient for most use cases
 *
 * @param text - Input text
 * @param index - Starting position
 * @returns Position of next grapheme break
 */
function nextGraphemeBreak(text: string, index: number): number {
	if (index >= text.length) return text.length;
	const char = text.charCodeAt(index);
	// Check if part of emoji modifier sequence
	if (char >= 0x1f3fb && char <= 0x1f3ff) return index + 1; // Emoji modifier
	if (char >= 0x1f1e6 && char <= 0x1f1ff) {
		// Flag emoji (regional indicator)
		if (index + 1 < text.length && text.charCodeAt(index + 1) >= 0x1f1e6 && text.charCodeAt(index + 1) <= 0x1f1ff) {
			return index + 2;
		}
	}
	// Check combining marks
	if (char >= 0x300 && char <= 0x36f) return index + 1; // Combining mark
	if (char >= 0xfe00 && char <= 0xfe0f) return index + 1; // Variation selector
	// Basic: return next character (for BMP characters)
	if (char < 0xd800 || char > 0xdbff) return index + 1;
	return index + 2;
}

/**
 * Set document emoji icon
 * Implemented by updating explorerIcon database
 *
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @param emoji - Emoji character
 */
export async function setDocEmojiIcon(workspaceId: string, docId: string, emoji: string): Promise<void> {
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		const explorerIconDocId = 'db$explorerIcon';
		const iconData = {
			type: 'emoji',
			unicode: emoji
		};

		const { doc: iconDoc, exists, prevSV } = await fetchYDoc(
			socket,
			workspaceId,
			explorerIconDocId
		);

		const iconKey = `doc:${docId}`;

		if (!exists) {
			const newDoc = new Y.Doc();
			const iconMap = newDoc.getMap(iconKey);
			iconMap.set('id', iconKey);
			iconMap.set('icon', iconData);

			await updateYDoc(socket, workspaceId, explorerIconDocId, newDoc);
		} else {
			const iconMap = iconDoc.getMap(iconKey);
			iconMap.set('id', iconKey);
			iconMap.set('icon', iconData);

			await updateYDoc(socket, workspaceId, explorerIconDocId, iconDoc, prevSV);
		}
	} finally {
	}
}
