/**
 * Database core module
 * Handles CRUD operations for Affine databases
 *
 * Main features:
 * - Database row management (CRUD)
 * - Database column definition reading
 * - Database view management
 * - Filter condition processing
 * - Data import/export
 */

import * as Y from 'yjs';
import { getWorkspaceId } from '../utils/config.js';
import { createWorkspaceSocket, joinWorkspace, loadDoc, fetchYDoc, updateYDoc } from '../utils/wsClient.js';
import { generateId } from '../utils/misc.js';
import { TAG_COLORS } from './constants.js';

/**
 * Database column definition type
 * Describes the structure of each column in a database
 */
export interface DatabaseColumnDef {
	id: string; // Column unique identifier
	name: string; // Column name
	type: string; // Column type (title, rich-text, number, select, multi-select, date, checkbox, progress, link)
	options: Array<{ id: string; value: string; color: string }>; // Option list (for select/multi-select types)
	raw?: any; // Raw column definition object
}

/**
 * Database view column definition type
 * Describes column configuration in a view
 */
export interface DatabaseViewColumnDef {
	id: string; // Column unique identifier
	name: string | null; // Column name (may be null)
	hidden: boolean; // Whether hidden
	width: number | null; // Column width
}

/**
 * Database view definition type
 * Describes the complete configuration of a database view
 */
export interface DatabaseViewDef {
	id: string; // View unique identifier
	name: string; // View name
	mode: string; // View mode (table, kanban, etc.)
	columns: DatabaseViewColumnDef[]; // Column configuration list in the view
	columnIds: string[]; // Column ID list (for quick access)
	groupBy: {
		// Grouping configuration (for kanban view)
		columnId: string | null;
		name: string | null;
		type: string | null;
	} | null;
	header: {
		// Header configuration
		titleColumn: string | null; // Title column ID
		iconColumn: string | null; // Icon column ID
	};
}

/**
 * Database column lookup structure
 * Index structure for efficient column lookups
 */
export interface DatabaseColumnLookup {
	columnDefs: DatabaseColumnDef[]; // All column definitions
	colById: Map<string, DatabaseColumnDef>; // Column map indexed by ID
	colByName: Map<string, DatabaseColumnDef>; // Column map indexed by name (case-sensitive)
	colByNameLower: Map<string, DatabaseColumnDef>; // Column map indexed by lowercase name (case-insensitive lookup)
	titleCol: DatabaseColumnDef | null; // Title column definition
}

/**
 * Database document context
 * Contains all state needed to operate on a database
 */
export interface DatabaseDocContext extends DatabaseColumnLookup {
	socket: any; // WebSocket connection
	doc: Y.Doc; // Yjs document object
	prevSV: Uint8Array; // Previous state vector (for incremental updates)
	blocks: Y.Map<any>; // All blocks in the document
	dbBlock: Y.Map<any>; // The database block itself
	cellsMap: Y.Map<any>; // Database cell map
	rowIds: string[]; // Database row ID list
}

/* ============================================================================
 * Reusable helper functions
 * ============================================================================ */

/**
 * Create base properties for an Affine block
 *
 * @param id - Block unique ID
 * @param flavour - Block type (e.g. 'affine:page', 'affine:note', 'affine:database')
 * @param parentId - Parent block ID
 * @returns Configured Y.Map object
 */
function createBlockBase(id: string, flavour: string, parentId: string | null = null): Y.Map<any> {
	const block = new Y.Map<any>();
	block.set('sys:id', id);
	block.set('sys:flavour', flavour);
	block.set('sys:version', flavour === 'affine:page' ? 2 : 1);
	block.set('sys:parent', parentId);
	block.set('sys:children', new Y.Array<string>());
	return block;
}

/**
 * Create a database column definition
 *
 * @param columnId - Column unique ID
 * @param name - Column name
 * @param type - Column type
 * @param width - Column width
 * @param options - Option list (for select/multi-select types)
 * @returns Configured column definition Y.Map
 */
function createColumnDefinition(
	columnId: string,
	name: string,
	type: string,
	width?: number,
	options?: string[]
): Y.Map<any> {
	const colDef = new Y.Map<any>();
	colDef.set('id', columnId);
	colDef.set('name', name);
	colDef.set('type', type);

	// Set additional properties based on type
	if (type === 'number') {
		const data = new Y.Map<any>();
		data.set('decimal', 0);
		data.set('format', 'number');
		colDef.set('data', data);
	} else if (type === 'progress') {
		const data = new Y.Map<any>();
		colDef.set('data', data);
	} else if ((type === 'select' || type === 'multi-select') && options?.length) {
		const data = new Y.Map<any>();
		const opts = new Y.Array<any>();
		for (let i = 0; i < options.length; i++) {
			const optMap = new Y.Map<any>();
			const optId = generateId(8, 'opt');
			optMap.set('id', optId);
			optMap.set('value', options[i]);
			optMap.set('color', TAG_COLORS[i % TAG_COLORS.length]);
			opts.push([optMap]);
		}
		data.set('options', opts);
		colDef.set('data', data);
	}

	!width && (width = getDefaultColumnWidth(type));
	colDef.set('width', width);

	return colDef;
}

/**
 * Create a view column configuration
 *
 * @param columnId - Corresponding column ID
 * @param hide - Whether to hide
 * @param width - Column width
 * @returns Configured view column Y.Map
 */
function createViewColumn(columnId: string, hide: boolean = false, type: string): Y.Map<any> {
	const viewCol = new Y.Map<any>();
	viewCol.set('id', columnId);
	viewCol.set('hide', hide);
	viewCol.set('width', getDefaultColumnWidth(type || 'rich-text'));
	return viewCol;
}

/**
 * Create a database row block
 *
 * @param rowBlockId - Row block ID
 * @param dbBlockId - Parent database block ID
 * @param title - Row title text
 * @param linkedDocId - Optional linked document ID
 * @returns Configured row block Y.Map
 */
function createDatabaseRowBlock(
	rowBlockId: string,
	dbBlockId: string,
	title: string,
	linkedDocId?: string
): Y.Map<any> {
	const rowBlock = new Y.Map<any>();
	rowBlock.set('sys:id', rowBlockId);
	rowBlock.set('sys:flavour', 'affine:paragraph');
	rowBlock.set('sys:version', 1);
	rowBlock.set('sys:parent', dbBlockId);
	rowBlock.set('sys:children', new Y.Array<string>());
	rowBlock.set('prop:type', 'text');

	// Set title or linked document
	if (linkedDocId) {
		rowBlock.set('prop:text', makeLinkedDocText(linkedDocId));
	} else {
		rowBlock.set('prop:text', makeText(title));
	}

	return rowBlock;
}

// /**
//  * Infer column type from data rows
//  *
//  * @param key - Column key name
//  * @param values - All values in this column
//  * @returns Inferred column type string
//  */
// function inferColumnType(key: string, values: unknown[]): string {
// 	// Title column
// 	if (key.toLowerCase() === 'title') return 'title';

// 	// Filter empty values
// 	const nonEmptyValues = values.filter((v) => v !== undefined && v !== null && v !== '');
// 	if (nonEmptyValues.length === 0) return 'rich-text';

// 	// Detect booleans
// 	if (nonEmptyValues.every((v) => typeof v === 'boolean')) return 'checkbox';

// 	// Detect numbers
// 	if (nonEmptyValues.every((v) => typeof v === 'number' || !isNaN(Number(v)))) return 'number';

// 	// Detect dates
// 	if (nonEmptyValues.every((v) => !isNaN(Date.parse(String(v))) || typeof v === 'number'))
// 		return 'date';

// 	// Detect URLs
// 	if (
// 		nonEmptyValues.every(
// 			(v) => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
// 		)
// 	)
// 		return 'link';

// 	// Detect progress (numbers 0-100)
// 	if (
// 		nonEmptyValues.every((v) => {
// 			const n = Number(v);
// 			return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
// 		})
// 	)
// 		return 'progress';

// 	// Detect multi-select (arrays)
// 	if (nonEmptyValues.every((v) => Array.isArray(v))) return 'multi-select';

// 	// Detect select (few repeated values)
// 	const uniqueValues = new Set(nonEmptyValues.map(String));
// 	if (uniqueValues.size <= 20 && uniqueValues.size < nonEmptyValues.length * 0.5) {
// 		return 'select';
// 	}

// 	return 'rich-text';
// }

/**
 * Get default width for a column type
 *
 * @param type - Column type
 * @returns Default width value
 */
function getDefaultColumnWidth(type: string): number {
	switch (type) {
		case 'title':
			return 250;
		case 'number':
			return 75;
		case 'date':
			return 100;
		case 'link':
			return 200;
		case 'progress':
			return 150;
		case 'select':
		case 'multi-select':
			return 200;
		case 'checkbox':
			return 50;
		case 'rich-text':
			return 250;
		default:
			return 150;
	}
}

/* ============================================================================
 * Text processing helper functions
 * ============================================================================ */

/**
 * Convert a text string or delta array to a Y.Text object
 *
 * Text in Affine is stored as Y.Text, supporting rich-text delta format
 *
 * @param content - Input content, can be:
 *   - Plain string: inserted directly as plain text
 *   - Delta array: for rich text with style attributes
 *     Format: [{ insert: string, attributes?: { ... } }, ...]
 * @returns Y.Text object
 *
 * @example
 * // Plain text
 * makeText("Hello World")
 *
 * // Rich text
 * makeText([{ insert: "Bold", attributes: { bold: true } }])
 */
function makeText(content: string | any[]): Y.Text {
	const yText = new Y.Text();
	if (typeof content === 'string') {
		if (content.length > 0) {
			yText.insert(0, content);
		}
		return yText;
	}
	let offset = 0;
	for (const delta of content) {
		if (!delta.insert) continue;
		yText.insert(offset, delta.insert, delta.attributes ? { ...delta.attributes } : {});
		offset += delta.insert.length;
	}
	return yText;
}

/**
 * Create a linked document text object
 *
 * Used to create links to other documents (Linked Page) in database rows
 * Internally uses a zero-width character + reference attribute
 *
 * @param docId - Document ID to link to
 * @returns Y.Text object containing the linked reference
 *
 * @example
 * const text = makeLinkedDocText("abc123def");
 * // Result text contains a reference to document "abc123def"
 */
function makeLinkedDocText(docId: string): Y.Text {
	const delta = [
		{
			insert: '\u200B', // Zero-width character, serves as a visual placeholder for the link
			attributes: { reference: { type: 'LinkedPage', pageId: docId } }
		}
	];
	return makeText(delta);
}

/**
 * Read the linked document ID from a database row block
 *
 * Parses the text in the row block and extracts the LinkedPage reference
 *
 * @param rowBlock - Database row block (Y.Map object)
 * @returns Linked document ID, or null if none exists
 *
 * @example
 * const linkedDocId = readLinkedDocId(rowBlock);
 * if (linkedDocId) {
 *   console.log("This row links to:", linkedDocId);
 * }
 */
function readLinkedDocId(rowBlock: Y.Map<any>): string | null {
	const propText = rowBlock.get('prop:text');
	if (!(propText instanceof Y.Text)) return null;
	const delta = propText.toDelta();
	if (!Array.isArray(delta)) return null;
	for (const d of delta) {
		if (d.attributes?.reference?.type === 'LinkedPage' && d.attributes.reference.pageId) {
			return d.attributes.reference.pageId;
		}
	}
	return null;
}

/**
 * Convert a value to string
 *
 * Handles Y.Text objects and other value types, converting them uniformly to strings
 *
 * @param value - Input value, supports Y.Text, string, or other types
 * @returns String representation
 */
function asText(value: unknown): string {
	if (value instanceof Y.Text) return value.toString();
	if (typeof value === 'string') return value;
	return '';
}

/**
 * Extract child IDs from a Y.Array
 *
 * Elements in a Y.Array may be strings or arrays; extract them uniformly
 * Used to get the list of child block IDs
 *
 * @param value - Y.Array object or plain array
 * @returns Array of child ID strings
 *
 * @example
 * // Y.Array: ["child1", "child2"]
 * // Or nested arrays: [["child1"], ["child2"]]
 * childIdsFrom(children) // ["child1", "child2"]
 */
function childIdsFrom(value: unknown): string[] {
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
 * Check if a key is a title alias
 *
 * Used to identify keys that may represent "title" (e.g. various variants of "title")
 *
 * @param value - Key name to check
 * @returns Whether the key is a title alias
 */
function isTitleAliasKey(value: string): boolean {
	return value.trim().toLowerCase() === 'title';
}

/**
 * Read database column definitions
 *
 * Parses column definitions from the database block's prop:columns property
 * Supports both Y.Map and plain object formats
 *
 * @param dbBlock - Database block object (Y.Map)
 * @returns Array of database column definitions
 *
 * @example
 * const columns = readColumnDefs(dbBlock);
 * // Returns: [{ id: "col1", name: "Title", type: "title", options: [] }, ...]
 */
function readColumnDefs(dbBlock: Y.Map<any>): DatabaseColumnDef[] {
	const columnsRaw = dbBlock.get('prop:columns');
	const defs: DatabaseColumnDef[] = [];
	if (!(columnsRaw instanceof Y.Array)) return defs;
	columnsRaw.forEach((col: any) => {
		const id = col instanceof Y.Map ? col.get('id') : col?.id;
		const name = col instanceof Y.Map ? col.get('name') : col?.name;
		const type = col instanceof Y.Map ? col.get('type') : col?.type;
		const data = col instanceof Y.Map ? col.get('data') : col?.data;
		let options: Array<{ id: string; value: string; color: string }> = [];
		if (data) {
			const rawOpts = data instanceof Y.Map ? data.get('options') : data?.options;
			if (Array.isArray(rawOpts)) {
				options = rawOpts.map((o: any) => ({
					id: String(o?.id ?? o?.get?.('id') ?? ''),
					value: String(o?.value ?? o?.get?.('value') ?? ''),
					color: String(o?.color ?? o?.get?.('color') ?? '')
				}));
			} else if (rawOpts instanceof Y.Array) {
				rawOpts.forEach((o: any) => {
					options.push({
						id: String(o instanceof Y.Map ? o.get('id') : (o?.id ?? '')),
						value: String(o instanceof Y.Map ? o.get('value') : (o?.value ?? '')),
						color: String(o instanceof Y.Map ? o.get('color') : (o?.color ?? ''))
					});
				});
			}
		}
		if (id) {
			defs.push({
				id: String(id),
				name: String(name || ''),
				type: String(type || 'rich-text'),
				options,
				raw: col
			});
		}
	});
	return defs;
}

/**
 * Read database view definition list
 *
 * Parses all view configurations from the database block's prop:views property
 * Includes view name, mode, column configuration, grouping settings, etc.
 *
 * @param dbBlock - Database block object
 * @param lookup - Column lookup structure (contains column ID to column definition mapping)
 * @returns Array of database view definitions
 *
 * @example
 * const views = readDatabaseViewDefs(dbBlock, lookup);
 * // Returns: [{ id: "view1", name: "Table View", mode: "table", columns: [...], groupBy: null }, ...]
 */
function readDatabaseViewDefs(
	dbBlock: Y.Map<any>,
	lookup: DatabaseColumnLookup
): DatabaseViewDef[] {
	const viewsRaw = dbBlock.get('prop:views');
	const views: DatabaseViewDef[] = [];
	if (!(viewsRaw instanceof Y.Array)) return views;
	viewsRaw.forEach((view: any) => {
		const id = view instanceof Y.Map ? view.get('id') : view?.id;
		if (!id) return;
		const columnsRaw = view instanceof Y.Map ? view.get('columns') : view?.columns;
		const headerRaw = view instanceof Y.Map ? view.get('header') : view?.header;
		const groupByRaw = view instanceof Y.Map ? view.get('groupBy') : view?.groupBy;
		const columns: DatabaseViewColumnDef[] = databaseArrayValues(columnsRaw)
			.map((entry: any) => {
				const columnId = entry instanceof Y.Map ? entry.get('id') : entry?.id;
				if (!columnId || typeof columnId !== 'string') return null;
				const columnDef = lookup.colById.get(columnId) || null;
				const hidden = entry instanceof Y.Map ? entry.get('hide') : entry?.hide;
				const width = entry instanceof Y.Map ? entry.get('width') : entry?.width;
				return {
					id: columnId,
					name: columnDef?.name || null,
					hidden: hidden === true,
					width: typeof width === 'number' ? width : null
				};
			})
			.filter((entry): entry is DatabaseViewColumnDef => entry !== null);
		views.push({
			id: String(id),
			name: String((view instanceof Y.Map ? view.get('name') : view?.name) || ''),
			mode: String((view instanceof Y.Map ? view.get('mode') : view?.mode) || ''),
			columns,
			columnIds: columns.map((column) => column.id),
			groupBy: groupByRaw
				? {
						columnId:
							typeof (groupByRaw as any)?.columnId === 'string'
								? (groupByRaw as any).columnId
								: null,
						name:
							typeof (groupByRaw as any)?.name === 'string'
								? (groupByRaw as any).name
								: null,
						type:
							typeof (groupByRaw as any)?.type === 'string'
								? (groupByRaw as any).type
								: null
					}
				: null,
			header: {
				titleColumn:
					typeof (headerRaw as any)?.titleColumn === 'string'
						? (headerRaw as any).titleColumn
						: null,
				iconColumn:
					typeof (headerRaw as any)?.iconColumn === 'string'
						? (headerRaw as any).iconColumn
						: null
			}
		});
	});
	return views;
}

/**
 * Extract element list from array values
 *
 * Uniformly handles conversion of Y.Array and plain arrays
 *
 * @param value - Input value (Y.Array or plain array)
 * @returns Element array
 */
function databaseArrayValues(value: unknown): unknown[] {
	if (value instanceof Y.Array) {
		const entries: unknown[] = [];
		value.forEach((entry: unknown) => entries.push(entry));
		return entries;
	}
	if (Array.isArray(value)) return value;
	return [];
}

/**
 * Build column lookup structure
 *
 * Creates multiple index structures for column definitions to improve lookup efficiency
 * - colById: indexed by column ID
 * - colByName: indexed by column name (case-sensitive)
 * - colByNameLower: indexed by lowercase column name (case-insensitive)
 * - titleCol: Title type column
 *
 * @param columnDefs - Database column definition array
 * @returns Lookup structure with multiple indexes
 */
function buildDatabaseColumnLookup(columnDefs: DatabaseColumnDef[]): DatabaseColumnLookup {
	const colById = new Map<string, DatabaseColumnDef>();
	const colByName = new Map<string, DatabaseColumnDef>();
	const colByNameLower = new Map<string, DatabaseColumnDef>();
	let titleCol: DatabaseColumnDef | null = null;
	for (const col of columnDefs) {
		colById.set(col.id, col);
		if (col.name) {
			colByName.set(col.name, col);
			colByNameLower.set(col.name.trim().toLowerCase(), col);
		}
		if (!titleCol && col.type === 'title') titleCol = col;
	}
	return { columnDefs, colById, colByName, colByNameLower, titleCol };
}

/**
 * Find a database column
 *
 * Looks up a column definition by key, supporting three methods:
 * ID, name (case-sensitive), and name (lowercase, case-insensitive)
 *
 * @param key - Lookup key (column name or column ID)
 * @param lookup - Column lookup structure
 * @returns Found column definition, or null if not found
 */
function findDatabaseColumn(key: string, lookup: DatabaseColumnLookup): DatabaseColumnDef | null {
	return (
		lookup.colByName.get(key) ||
		lookup.colById.get(key) ||
		lookup.colByNameLower.get(key.trim().toLowerCase()) ||
		null
	);
}

/**
 * Get list of available column names
 *
 * Generates a comma-separated string of available column names, used for error messages
 *
 * @param lookup - Column lookup structure
 * @returns Available column names string (e.g. "title, Name, Status")
 */
function availableDatabaseColumns(lookup: DatabaseColumnLookup): string {
	return ['title', ...lookup.columnDefs.map((col) => col.name || col.id)].join(', ');
}

/**
 * Get database row ID list
 *
 * Extracts all row IDs from the database block's sys:children property
 *
 * @param dbBlock - Database block object
 * @returns Array of row ID strings
 */
export function getDatabaseRowIds(dbBlock: Y.Map<any>): string[] {
	return childIdsFrom(dbBlock.get('sys:children'));
}

/**
 * Read database row title
 *
 * Extracts title text from the row block's prop:text property
 *
 * @param rowBlock - Row block object
 * @returns Title text string
 */
function readDatabaseRowTitle(rowBlock: Y.Map<any>): string {
	return asText(rowBlock.get('prop:text'));
}

// /**
//  * Resolve database title value
//  *
//  * Parses the title value from cell data, priority:
//  * 1. Value from the Title column
//  * 2. Value with key "title"
//  * 3. Value from a column named "title"
//  *
//  * @param cells - Row cell data object
//  * @param lookup - Column lookup structure
//  * @returns Resolved title string
//  */
// function resolveDatabaseTitleValue(
// 	cells: Record<string, unknown>,
// 	lookup: DatabaseColumnLookup
// ): string {
// 	// Prefer Title column
// 	if (lookup.titleCol) {
// 		const value = cells[lookup.titleCol.name] ?? cells[lookup.titleCol.id];
// 		if (value !== undefined) return String(value ?? '');
// 	}
// 	// Look for title alias key
// 	for (const [key, value] of Object.entries(cells)) {
// 		if (isTitleAliasKey(key)) return String(value ?? '');
// 	}
// 	// Look for column named title
// 	const namedTitleColumn = lookup.colByNameLower.get('title');
// 	if (namedTitleColumn) {
// 		const value = cells[namedTitleColumn.name] ?? cells[namedTitleColumn.id];
// 		if (value !== undefined) return String(value ?? '');
// 	}
// 	return '';
// }

/**
 * Ensure database row cells exist
 *
 * Gets the cell map for the specified row, creating it if it doesn't exist
 *
 * @param cellsMap - Database cell map
 * @param rowBlockId - Row block ID
 * @returns Row cell map (Y.Map)
 */
function ensureDatabaseRowCells(cellsMap: Y.Map<any>, rowBlockId: string): Y.Map<any> {
	const existing = cellsMap.get(rowBlockId);
	if (existing instanceof Y.Map) return existing;
	const rowCells = new Y.Map<any>();
	cellsMap.set(rowBlockId, rowCells);
	return rowCells;
}

/**
 * Get a database row block
 *
 * Validates and retrieves the row block with the specified ID, ensuring it belongs to the current database
 *
 * @param blocks - Document blocks map
 * @param dbBlock - Database block object
 * @param databaseBlockId - Database block ID
 * @param rowBlockId - Row block ID
 * @returns Row block object
 * @throws If the row does not exist or does not belong to the database
 */
function getDatabaseRowBlock(
	blocks: Y.Map<any>,
	dbBlock: Y.Map<any>,
	databaseBlockId: string,
	rowBlockId: string
): Y.Map<any> {
	const rowBlock = findBlockById(blocks, rowBlockId);
	if (!rowBlock) throw new Error(`Row block '${rowBlockId}' not found`);
	const parentId = rowBlock.get('sys:parent');
	const isDatabaseChild = getDatabaseRowIds(dbBlock).includes(rowBlockId);
	if (parentId !== databaseBlockId && !isDatabaseChild)
		throw new Error(
			`Row block '${rowBlockId}' does not belong to database '${databaseBlockId}'`
		);
	if (rowBlock.get('sys:flavour') !== 'affine:paragraph')
		throw new Error(`Row block '${rowBlockId}' is not a database row paragraph`);
	return rowBlock;
}

/**
 * Find a block by ID
 *
 * @param blocks - Blocks map
 * @param blockId - Block ID
 * @returns Found block or null
 */
function findBlockById(blocks: Y.Map<any>, blockId: string): Y.Map<any> | null {
	const value = blocks.get(blockId);
	return value instanceof Y.Map ? value : null;
}

/**
 * Recursively collect all descendant block IDs
 *
 * @param blocks - Blocks map
 * @param blockIds - Starting block ID array
 * @returns Array containing all descendant block IDs
 */
function collectDescendantBlockIds(blocks: Y.Map<any>, blockIds: string[]): string[] {
	const collected: string[] = [];
	for (const blockId of blockIds) {
		const block = findBlockById(blocks, blockId);
		if (!block) continue;
		const children = block.get('sys:children');
		if (children instanceof Y.Array) {
			const childIds = childIdsFrom(children);
			collected.push(...collectDescendantBlockIds(blocks, childIds));
		}
	}
	return [...blockIds, ...collected];
}

/**
 * Get the index of a child element in an array
 *
 * @param array - Y.Array object
 * @param item - Element to find
 * @returns Index position, or -1 if not found
 */
function indexOfChild(array: Y.Array<any>, item: string): number {
	for (let i = 0; i < array.length; i++) {
		const entry = array.get(i);
		if (typeof entry === 'string' && entry === item) return i;
		if (Array.isArray(entry) && entry.includes(item)) return i;
	}
	return -1;
}

/**
 * Resolve select option ID
 *
 * Finds the corresponding ID by option value; creates a new option if not found and createOption is true
 *
 * @param col - Column definition
 * @param value - Option value
 * @param createOption - Whether to create a new option if it doesn't exist
 * @returns Option ID
 * @throws If option not found and createOption is false
 */
function resolveSelectOptionId(
	col: DatabaseColumnDef,
	value: string,
	createOption: boolean
): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	for (const opt of col.options) {
		if (opt.value.toLowerCase() === trimmed.toLowerCase()) return opt.id;
	}
	if (!createOption) {
		throw new Error(`Option '${value}' not found in column '${col.name}'`);
	}
	// Create new option
	const newId = generateId(8, 'opt');
	const newOption = {
		id: newId,
		value: trimmed,
		color: TAG_COLORS[col.options.length % TAG_COLORS.length]
	};
	const data = col.raw?.get?.('data');
	if (data instanceof Y.Map) {
		const opts = data.get('options');
		if (opts instanceof Y.Array) {
			const optMap = new Y.Map<any>();
			optMap.set('id', newId);
			optMap.set('value', trimmed);
			optMap.set('color', newOption.color);
			opts.push([optMap]);
		}
	}
	col.options.push(newOption);
	return newId;
}

/**
 * Decode a database cell value
 *
 * Converts Affine's internal storage format to a readable JavaScript value
 *
 * @param col - Column definition
 * @param cellEntry - Cell entry (Y.Map)
 * @returns Decoded value
 *
 * @example
 * // rich-text: returns string
 * // number: returns number
 * // checkbox: returns boolean
 * // select: returns option text
 * // multi-select: returns array of option texts
 * // date: returns ISO date string
 * // progress: returns 0-100 number
 * // link: returns URL string
 */
function decodeDatabaseCellValue(col: DatabaseColumnDef, cellEntry: Y.Map<any>): any {
	if (!cellEntry) return null;
	const value = cellEntry.get('value');
	if (value === undefined) return null;
	switch (col.type) {
		case 'rich-text':
		case 'title':
			if (value instanceof Y.Text) return value.toString();
			if (Array.isArray(value)) {
				return value.map((d: any) => d.insert || '').join('');
			}
			return String(value ?? '');
		case 'number':
			return typeof value === 'number' ? value : Number(value) || 0;
		case 'checkbox':
			return Boolean(value);
		case 'select':
			if (typeof value === 'string') {
				const opt = col.options.find((o) => o.id === value);
				return opt?.value || value;
			}
			return value;
		case 'multi-select':
			if (value instanceof Y.Array) {
				const ids: string[] = [];
				value.forEach((id: string) => ids.push(id));
				return ids.map((id) => {
					const opt = col.options.find((o) => o.id === id);
					return opt?.value || id;
				});
			}
			return [];
		case 'date':
			return typeof value === 'number' ? new Date(value).toISOString() : null;
		case 'progress':
			return typeof value === 'number' ? value : Number(value) || 0;
		case 'link':
			return String(value ?? '');
		default:
			return value;
	}
}

/**
 * Write a database cell value
 *
 * Converts a JavaScript value to Affine's internal storage format and writes it to the cell
 *
 * @param rowCells - Row cell map (Y.Map)
 * @param col - Column definition
 * @param value - Value to write
 * @param createOption - Whether to auto-create new options for select/multi-select types
 *
 * @throws Throws error when value format doesn't match column type requirements
 *
 * @example
 * // Write text
 * writeDatabaseCellValue(rowCells, textColumn, "Hello", false);
 *
 * // Write number
 * writeDatabaseCellValue(rowCells, numberColumn, 42, false);
 *
 * // Write option (auto-create option)
 * writeDatabaseCellValue(rowCells, selectColumn, "In Progress", true);
 */
function writeDatabaseCellValue(
	rowCells: Y.Map<any>,
	col: DatabaseColumnDef,
	value: unknown,
	createOption: boolean
) {
	const cellValue = new Y.Map<any>();
	cellValue.set('columnId', col.id);
	switch (col.type) {
		case 'rich-text':
		case 'title':
			cellValue.set('value', makeText(String(value ?? '')));
			break;
		case 'number': {
			const num = Number(value);
			if (Number.isNaN(num))
				throw new Error(
					`Column "${col.name}": expected a number, got ${JSON.stringify(value)}`
				);
			cellValue.set('value', num);
			break;
		}
		case 'progress': {
			const num = Number(value);
			if (!Number.isNaN(num)) {
				const clamped = Math.max(0, Math.min(100, Math.floor(num)));
				cellValue.set('value', clamped);
			}
			break;
		}
		case 'checkbox': {
			let bool: boolean;
			if (typeof value === 'boolean') bool = value;
			else if (typeof value === 'string') {
				const lower = value.toLowerCase().trim();
				bool = lower === 'true' || lower === '1' || lower === 'yes';
			} else bool = !!value;
			cellValue.set('value', bool);
			break;
		}
		case 'select':
			cellValue.set('value', resolveSelectOptionId(col, String(value ?? ''), createOption));
			break;
		case 'multi-select': {
			const labels = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
			const optionIds = new Y.Array<string>();
			optionIds.push(labels.map((label) => resolveSelectOptionId(col, label, createOption)));
			cellValue.set('value', optionIds);
			break;
		}
		case 'date': {
			const numericValue =
				typeof value === 'number'
					? value
					: Number.isNaN(Number(value))
						? Date.parse(String(value))
						: Number(value);
			if (!Number.isFinite(numericValue))
				throw new Error(
					`Column "${col.name}": expected a timestamp-compatible value, got ${JSON.stringify(value)}`
				);
			cellValue.set('value', numericValue);
			break;
		}
		case 'link':
			cellValue.set('value', String(value ?? ''));
			break;
		default:
			if (typeof value === 'string') cellValue.set('value', makeText(value));
			else cellValue.set('value', value);
	}
	rowCells.set(col.id, cellValue);
}

/**
 * Load database document context
 *
 * Initializes all state needed to operate on the database:
 * 1. Establish WebSocket connection
 * 2. Load document snapshot
 * 3. Build column lookup index
 * 4. Get row ID list
 *
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @param databaseBlockId - Database block ID
 * @returns Database document context
 * @throws Connection failure, document/database not found, etc.
 */
async function loadDatabaseDocContext(
	workspaceId: string,
	docId: string,
	databaseBlockId: string
): Promise<DatabaseDocContext> {
	const socket = await createWorkspaceSocket();
	await joinWorkspace(socket, workspaceId);
	const doc = new Y.Doc();
	const snapshot = await loadDoc(socket, workspaceId, docId);
	if (!snapshot.missing) {
		throw new Error('Document not found');
	}
	Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
	const prevSV = Y.encodeStateVector(doc);
	const blocks = doc.getMap('blocks') as Y.Map<any>;
	const dbBlock = findBlockById(blocks, databaseBlockId);
	if (!dbBlock) {
		throw new Error(`Database block '${databaseBlockId}' not found`);
	}
	const dbFlavour = dbBlock.get('sys:flavour');
	if (dbFlavour !== 'affine:database') {
		throw new Error(`Block '${databaseBlockId}' is not a database (flavour: ${dbFlavour})`);
	}
	const cellsMap = dbBlock.get('prop:cells') as Y.Map<any>;
	if (!(cellsMap instanceof Y.Map)) {
		throw new Error('Database block has no cells map');
	}
	const lookup = buildDatabaseColumnLookup(readColumnDefs(dbBlock));
	const rowIds = getDatabaseRowIds(dbBlock);
	return { socket, doc, prevSV, blocks, dbBlock, cellsMap, rowIds, ...lookup };
}

export type FilterCondition = { column: string; operator: string; value: string };
export type FilterGroup = { mode: 'and' | 'or'; filters: FilterCondition[] };
export type FilterParams = FilterCondition[] | FilterGroup;

/**
 * Find row IDs matching filter conditions
 *
 * Finds matching rows in the database based on specified filter conditions
 * Supports two filter formats:
 * - Simple format: array form [{ column, operator, value }, ...], defaults to AND logic
 * - Advanced format: { mode: "and"|"or", filters: [...] }
 *
 * Supported operators:
 * - eq: equals
 * - neq: not equals
 * - contains: contains
 * - startsWith: starts with
 * - endsWith: ends with
 * - gt: greater than (numbers/dates only)
 * - gte: greater than or equal
 * - lt: less than
 * - lte: less than or equal
 *
 * @param cellsMap - Database cell map (Y.Map)
 * @param columnDefs - Database column definition array
 * @param filters - Filter conditions (array or object format)
 * @param rowIds - Optional row ID list, defaults to searching all rows
 * @returns Array of matching row IDs
 *
 * @example
 * // Simple format (AND logic)
 * findRowsByFilters(cellsMap, columns, [
 *   { column: 'Status', operator: 'eq', value: 'In Progress' },
 *   { column: 'Priority', operator: 'eq', value: 'High' }
 * ]);
 *
 * // Advanced format (OR logic)
 * findRowsByFilters(cellsMap, columns, {
 *   mode: 'or',
 *   filters: [
 *     { column: 'Status', operator: 'eq', value: 'Completed' },
 *     { column: 'Status', operator: 'eq', value: 'Cancelled' }
 *   ]
 * });
 */
export function findRowsByFilters(
	cellsMap: Y.Map<any>,
	columnDefs: DatabaseColumnDef[],
	filters: FilterParams,
	rowIds: string[] = []
): string[] {
	// Parse filters format
	let mode: 'and' | 'or' = 'and';
	let filterList: FilterCondition[];

	if ('mode' in filters && 'filters' in filters) {
		mode = filters.mode?.toLowerCase() === 'or' ? 'or' : 'and';
		filterList = filters.filters;
	} else {
		filterList = filters as FilterCondition[];
	}

	// Build column lookup map (supports column names and column IDs)
	const colByName = new Map<string, DatabaseColumnDef>();
	const colById = new Map<string, DatabaseColumnDef>();
	const colByNameLower = new Map<string, DatabaseColumnDef>();
	for (const col of columnDefs) {
		if (col.name) {
			colByName.set(col.name, col);
			colByNameLower.set(col.name.toLowerCase(), col);
		}
		colById.set(col.id, col);
	}

	/**
	 * Check if a single condition matches
	 * Performs correct value comparison based on column type
	 */
	function matchCondition(
		filter: { column: string; operator: string; value: string },
		rowCells: Y.Map<any>
	): boolean {
		// Defensive check
		if (!filter.column) return false;

		const titleCol = columnDefs.find((c) => c.type === 'title');
		const isTitleFilter = titleCol && filter.column.toLowerCase() === 'title';

		// Title filter reads from rowBlock's prop:text (not yet supported)
		if (isTitleFilter) {
			return false;
		}

		// Supports lookup by column name (case-sensitive), lowercase column name, or column ID
		const col =
			colByName.get(filter.column) ||
			colByNameLower.get(filter.column.toLowerCase()) ||
			colById.get(filter.column);
		if (!col) return false;

		const cellEntry = rowCells.get(col.id);
		const cellValue = cellEntry ? decodeDatabaseCellValue(col, cellEntry) : null;
		const filterValue = filter.value;

		// Perform correct comparison based on column type
		switch (col.type) {
			case 'number':
			case 'progress': {
				// Numeric type comparison
				const numCell = Number(cellValue);
				const numFilter = Number(filterValue);
				if (Number.isNaN(numFilter)) return false;
				switch (filter.operator) {
					case 'eq':
						return numCell === numFilter;
					case 'neq':
						return numCell !== numFilter;
					case 'gt':
						return numCell > numFilter;
					case 'gte':
						return numCell >= numFilter;
					case 'lt':
						return numCell < numFilter;
					case 'lte':
						return numCell <= numFilter;
					case 'isempty':
						return cellValue === null || cellValue === undefined;
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined;
					default:
						return numCell === numFilter;
				}
			}
			case 'checkbox': {
				// Boolean type comparison
				const boolCell = Boolean(cellValue);
				const boolFilter = filterValue.toLowerCase() === 'true' || filterValue === '1';
				switch (filter.operator) {
					case 'eq':
						return boolCell === boolFilter;
					case 'neq':
						return boolCell !== boolFilter;
					case 'isempty':
						return cellValue === null || cellValue === undefined;
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined;
					default:
						return boolCell === boolFilter;
				}
			}
			case 'date': {
				// Date type comparison (using timestamps)
				const dateCell = cellValue ? new Date(cellValue).getTime() : null;
				const dateFilter = new Date(filterValue).getTime();
				if (Number.isNaN(dateFilter)) {
					// If filter value is not a valid date, try as timestamp
					const tsFilter = Number(filterValue);
					if (!Number.isNaN(tsFilter)) {
						switch (filter.operator) {
							case 'eq':
								return dateCell === tsFilter;
							case 'neq':
								return dateCell !== tsFilter;
							case 'gt':
								return dateCell !== null && dateCell > tsFilter;
							case 'gte':
								return dateCell !== null && dateCell >= tsFilter;
							case 'lt':
								return dateCell !== null && dateCell < tsFilter;
							case 'lte':
								return dateCell !== null && dateCell <= tsFilter;
							default:
								return false;
						}
					}
					return false;
				}
				switch (filter.operator) {
					case 'eq':
						return dateCell === dateFilter;
					case 'neq':
						return dateCell !== dateFilter;
					case 'gt':
						return dateCell !== null && dateCell > dateFilter;
					case 'gte':
						return dateCell !== null && dateCell >= dateFilter;
					case 'lt':
						return dateCell !== null && dateCell < dateFilter;
					case 'lte':
						return dateCell !== null && dateCell <= dateFilter;
					case 'isempty':
						return cellValue === null || cellValue === undefined;
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined;
					default:
						return dateCell === dateFilter;
				}
			}
			case 'select': {
				// Select type comparison (comparing option IDs)
				const selectCell = cellValue as string;
				// Find option ID
				const option = col.options.find((o) => o.value === filterValue);
				const filterOptionId = option?.id || filterValue;
				switch (filter.operator) {
					case 'eq':
						return selectCell === filterOptionId;
					case 'neq':
						return selectCell !== filterOptionId;
					case 'contains':
						return selectCell?.includes(filterValue);
					case 'notcontains':
						return !selectCell?.includes(filterValue);
					case 'isempty':
						return cellValue === null || cellValue === undefined || cellValue === '';
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined && cellValue !== '';
					default:
						return selectCell === filterOptionId;
				}
			}
			case 'multi-select': {
				// Multi-select type comparison
				const multiCell = Array.isArray(cellValue) ? cellValue : [];
				// Find option ID
				const option = col.options.find((o) => o.value === filterValue);
				const filterOptionId = option?.id || filterValue;
				switch (filter.operator) {
					case 'eq':
						return (
							multiCell.includes(filterOptionId) || multiCell.includes(filterValue)
						);
					case 'neq':
						return (
							!multiCell.includes(filterOptionId) && !multiCell.includes(filterValue)
						);
					case 'contains':
						return (
							multiCell.includes(filterOptionId) || multiCell.includes(filterValue)
						);
					case 'notcontains':
						return (
							!multiCell.includes(filterOptionId) && !multiCell.includes(filterValue)
						);
					case 'isempty':
						return multiCell.length === 0;
					case 'isnotempty':
						return multiCell.length > 0;
					default:
						return (
							multiCell.includes(filterOptionId) || multiCell.includes(filterValue)
						);
				}
			}
			default: {
				// Text type comparison (rich-text, title, link, etc.)
				const strCell = String(cellValue ?? '');
				switch (filter.operator) {
					case 'eq':
						return strCell === filterValue;
					case 'neq':
						return strCell !== filterValue;
					case 'contains':
						return strCell.includes(filterValue);
					case 'notcontains':
						return !strCell.includes(filterValue);
					case 'gt':
						return strCell > filterValue;
					case 'gte':
						return strCell >= filterValue;
					case 'lt':
						return strCell < filterValue;
					case 'lte':
						return strCell <= filterValue;
					case 'isempty':
						return cellValue === null || cellValue === undefined || cellValue === '';
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined && cellValue !== '';
					default:
						return strCell === filterValue;
				}
			}
		}
	}

	const matchingRowIds: string[] = [];

	// If rowIds were provided, iterate those; otherwise iterate all keys in cellsMap
	const targetRowIds = rowIds.length > 0 ? rowIds : Array.from(cellsMap.keys());

	for (const rowBlockId of targetRowIds) {
		const rowCells = cellsMap.get(rowBlockId);
		if (!(rowCells instanceof Y.Map)) continue;

		if (mode === 'and') {
			// AND: all conditions must match
			const allMatch = filterList.every((f) => matchCondition(f, rowCells));
			if (allMatch) matchingRowIds.push(rowBlockId);
		} else {
			// OR: any condition must match
			const anyMatch = filterList.some((f) => matchCondition(f, rowCells));
			if (anyMatch) matchingRowIds.push(rowBlockId);
		}
	}

	return matchingRowIds;
}

// /**
//  * Add database row
//  *
//  * Adds a new row to the specified database, optionally linking to a document
//  *
//  * @param params - Parameter object
//  * @param params.workspace - Workspace ID (optional, defaults to configured workspace)
//  * @param params.docId - Document ID
//  * @param params.databaseBlockId - Database block ID
//  * @param params.cells - Row cell data, keys are column names or column IDs, values are cell values
//  * @param params.linkedDocId - Optional linked document ID (creates a link row pointing to another document)
//  * @returns Result object containing:
//  *   - added: Whether successfully added
//  *   - rowBlockId: Block ID of the new row
//  *   - databaseBlockId: Database ID
//  *   - cellCount: Number of cells written
//  *   - linkedDocId: Linked document ID (if any)
//  *
//  * @throws Missing workspace ID, document/database not found, column not found, etc.
//  *
//  * @example
//  * // Add a normal row
//  * await addDatabaseRowHandler({
//  *   docId: 'abc123',
//  *   databaseBlockId: 'db456',
//  *   cells: { 'Name': 'New Product', 'Status': 'In Progress', 'Priority': 'High' }
//  * });
//  *
//  * // Add a linked document row
//  * await addDatabaseRowHandler({
//  *   docId: 'abc123',
//  *   databaseBlockId: 'db456',
//  *   linkedDocId: 'doc789'
//  * });
//  */
// export async function addDatabaseRowHandler(params: {
// 	workspace?: string;
// 	docId: string;
// 	databaseBlockId: string;
// 	cells: Record<string, unknown>;
// 	linkedDocId?: string;
// }): Promise<any> {
// 	const workspaceId = getWorkspaceId(params.workspace);
// 	if (!workspaceId) throw new Error('workspaceId is required');
// 	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
// 	try {
// 		const rowBlockId = generateId();
// 		const rowBlock = new Y.Map<any>();
// 		rowBlock.set('sys:id', rowBlockId);
// 		rowBlock.set('sys:flavour', 'affine:paragraph');
// 		rowBlock.set('sys:version', 1);
// 		rowBlock.set('sys:parent', params.databaseBlockId);
// 		rowBlock.set('sys:children', new Y.Array<string>());
// 		rowBlock.set('prop:type', 'text');
// 		if (params.linkedDocId) {
// 			rowBlock.set('prop:text', makeLinkedDocText(params.linkedDocId));
// 		} else {
// 			const titleValue = resolveDatabaseTitleValue(params.cells, ctx);
// 			rowBlock.set('prop:text', makeText(String(titleValue)));
// 		}
// 		ctx.blocks.set(rowBlockId, rowBlock);

// 		const dbChildren = ctx.dbBlock.get('sys:children') as Y.Array<any>;
// 		if (!(dbChildren instanceof Y.Array)) {
// 			const newChildren = new Y.Array<string>();
// 			ctx.dbBlock.set('sys:children', newChildren);
// 			newChildren.push([rowBlockId]);
// 		} else {
// 			dbChildren.push([rowBlockId]);
// 		}

// 		const rowCells = ensureDatabaseRowCells(ctx.cellsMap, rowBlockId);
// 		for (const [key, value] of Object.entries(params.cells)) {
// 			const col = findDatabaseColumn(key, ctx);
// 			if (!col) {
// 				if (isTitleAliasKey(key)) continue;
// 				throw new Error(
// 					`Column '${key}' not found. Available columns: ${availableDatabaseColumns(ctx)}`
// 				);
// 			}
// 			writeDatabaseCellValue(rowCells, col, value, true);
// 		}

// 		const delta = Y.encodeStateAsUpdate(ctx.doc, ctx.prevSV);
// 		await pushDocUpdate(
// 			ctx.socket,
// 			workspaceId,
// 			params.docId,
// 			Buffer.from(delta).toString('base64')
// 		);

// 		return {
// 			added: true,
// 			rowBlockId,
// 			databaseBlockId: params.databaseBlockId,
// 			cellCount: Object.keys(params.cells).length,
// 			linkedDocId: params.linkedDocId || null
// 		};
// 	} finally {
// 	}
// }

// /**
//  * Delete database row
//  *
//  * Deletes the specified row and all its descendant blocks from the database
//  *
//  * @param params - Parameter object
//  * @param params.workspace - Workspace ID (optional)
//  * @param params.docId - Document ID
//  * @param params.databaseBlockId - Database block ID
//  * @param params.rowBlockId - Row block ID to delete
//  * @returns Result object containing:
//  *   - deleted: Whether successfully deleted
//  *   - rowBlockId: Deleted row ID
//  *   - descendantCount: Number of descendant blocks deleted
//  *
//  * @throws Row does not exist or does not belong to the database
//  */
// export async function deleteDatabaseRowHandler(params: {
// 	workspace?: string;
// 	docId: string;
// 	databaseBlockId: string;
// 	rowBlockId: string;
// }): Promise<any> {
// 	const workspaceId = getWorkspaceId(params.workspace);
// 	if (!workspaceId) throw new Error('workspaceId is required');
// 	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
// 	try {
// 		const rowBlock = getDatabaseRowBlock(
// 			ctx.blocks,
// 			ctx.dbBlock,
// 			params.databaseBlockId,
// 			params.rowBlockId
// 		);
// 		const descendantBlockIds = collectDescendantBlockIds(ctx.blocks, [
// 			params.rowBlockId,
// 			...childIdsFrom(rowBlock.get('sys:children'))
// 		]);
// 		const dbChildren = ctx.dbBlock.get('sys:children') as Y.Array<any>;
// 		const rowIndex = indexOfChild(dbChildren, params.rowBlockId);
// 		if (rowIndex < 0) {
// 			throw new Error(
// 				`Row block '${params.rowBlockId}' is not present in database '${params.databaseBlockId}' children`
// 			);
// 		}

// 		dbChildren.delete(rowIndex, 1);
// 		ctx.cellsMap.delete(params.rowBlockId);
// 		for (const blockId of descendantBlockIds) {
// 			ctx.blocks.delete(blockId);
// 		}

// 		const delta = Y.encodeStateAsUpdate(ctx.doc, ctx.prevSV);
// 		await pushDocUpdate(
// 			ctx.socket,
// 			workspaceId,
// 			params.docId,
// 			Buffer.from(delta).toString('base64')
// 		);

// 		return {
// 			deleted: true,
// 			rowBlockId: params.rowBlockId,
// 			databaseBlockId: params.databaseBlockId
// 		};
// 	} finally {
// 	}
// }

/**
 * Remove database rows (supports batch delete via filter matching)
 *
 * Deletes rows from the database based on specified conditions, supporting single row or batch filter delete
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Document ID
 * @param params.databaseBlockId - Database block ID
 * @param params.rowBlockId - Single row block ID to delete (mutually exclusive with filters)
 * @param params.filters - Filter condition array for batch matching and deletion
 *   - Format: [{ column: string, operator: string, value: string }]
 *   - Supported operators: eq (equals), neq (not equals), contains, startsWith, endsWith
 * @returns Result object containing:
 *   - deleted: Whether successfully deleted
 *   - deletedIds: Array of deleted row IDs
 *   - deletedCount: Number of rows deleted
 *
 * @throws Invalid filter conditions or deletion failure
 *
 * @example
 * // Delete a single row
 * await removeDatabaseRowHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   rowBlockId: 'row789'
 * });
 *
 * // Batch delete matching rows
 * await removeDatabaseRowHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   filters: [{ column: 'Status', operator: 'eq', value: 'Completed' }]
 * });
 */
export async function removeDatabaseRowHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	rowBlockId?: string;
	filters?: Array<{ column: string; operator: string; value: string }>;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		let deletedCount = 0;
		let deletedIds: string[] = [];

		// If filter conditions exist, find matching rows and delete
		if (params.filters) {
			const matchingRowIds = findRowsByFilters(
				ctx.cellsMap,
				ctx.columnDefs,
				params.filters,
				ctx.rowIds
			);

			for (const rowId of matchingRowIds) {
				try {
					const rowBlock = getDatabaseRowBlock(
						ctx.blocks,
						ctx.dbBlock,
						params.databaseBlockId,
						rowId
					);
					const descendantBlockIds = collectDescendantBlockIds(ctx.blocks, [
						rowId,
						...childIdsFrom(rowBlock.get('sys:children'))
					]);
					const dbChildren = ctx.dbBlock.get('sys:children') as Y.Array<any>;
					const rowIndex = indexOfChild(dbChildren, rowId);
					if (rowIndex >= 0) {
						dbChildren.delete(rowIndex, 1);
					}
					ctx.cellsMap.delete(rowId);
					for (const blockId of descendantBlockIds) {
						ctx.blocks.delete(blockId);
					}
					deletedIds.push(rowId);
					deletedCount++;
				} catch {
					// Ignore individual deletion errors
				}
			}
		} else if (params.rowBlockId) {
			// No filter conditions, delete single row
			const rowBlock = getDatabaseRowBlock(
				ctx.blocks,
				ctx.dbBlock,
				params.databaseBlockId,
				params.rowBlockId
			);
			const descendantBlockIds = collectDescendantBlockIds(ctx.blocks, [
				params.rowBlockId,
				...childIdsFrom(rowBlock.get('sys:children'))
			]);
			const dbChildren = ctx.dbBlock.get('sys:children') as Y.Array<any>;
			const rowIndex = indexOfChild(dbChildren, params.rowBlockId);
			if (rowIndex < 0) {
				throw new Error(
					`Row block '${params.rowBlockId}' is not present in database '${params.databaseBlockId}' children`
				);
			}
			dbChildren.delete(rowIndex, 1);
			ctx.cellsMap.delete(params.rowBlockId);
			for (const blockId of descendantBlockIds) {
				ctx.blocks.delete(blockId);
			}
			deletedIds = [params.rowBlockId];
			deletedCount = 1;
		} else {
			throw new Error('Must specify either row-id or filter parameter');
		}

		await updateYDoc(ctx.socket, workspaceId, params.docId, ctx.doc, ctx.prevSV);

		return {
			deleted: deletedCount,
			rowBlockIds: deletedIds,
			databaseBlockId: params.databaseBlockId
		};
	} finally {
	}
}

/**
 * Query database
 *
 * Queries row data in the database, supports two output formats:
 * - rows format: simple row data array
 * - full/export format: complete database structure (including title, column definitions, data)
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Document ID
 * @param params.databaseBlockId - Database block ID
 * @param params.rowBlockIds - Row ID array to query (optional, defaults to all rows)
 * @param params.columns - Column name array to return (optional, defaults to all columns)
 * @param params.filters - Filter condition array for filtering rows
 * @param params.full - Whether to return full format (includes column definitions and other metadata)
 * @returns Query result
 *   - rows format: { rows: [{ id, title, cells: {...}}, ...] }
 *   - full format: { title, columns: [{name, type, options}], data: [{title, col1, col2}, ...] }
 *
 * @example
 * // Query all rows (simple format)
 * await queryDatabaseHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456'
 * });
 *
 * // Filter and return full format
 * await queryDatabaseHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   filters: [{ column: 'Status', operator: 'eq', value: 'In Progress' }],
 *   full: true
 * });
 */
export async function queryDatabaseHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	rowBlockIds?: string[];
	columns?: string[];
	filters?: Array<{ column: string; operator: string; value: string }>;
	full?: boolean;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		// Handle output format
		if (params.full) {
			// Export format
			const titleText = ctx.dbBlock.get('prop:title');
			let title = '';
			if (titleText instanceof Y.Text) {
				title = titleText.toString();
			} else if (Array.isArray(titleText)) {
				title = titleText.map((d: any) => d.insert || '').join('');
			}

			let rowIds = params.rowBlockIds?.length ? params.rowBlockIds : ctx.rowIds;
			if (params.filters) {
				rowIds = findRowsByFilters(
					ctx.cellsMap,
					ctx.columnDefs,
					params.filters,
					ctx.rowIds
				);
			}

			const data: Record<string, any>[] = [];
			for (const rowId of rowIds) {
				const rowBlock = ctx.blocks.get(rowId);
				if (!rowBlock || !(rowBlock instanceof Y.Map)) continue;

				const rowTitle = readDatabaseRowTitle(rowBlock);
				const rowCells = ctx.cellsMap.get(rowId);
				const rowData: Record<string, any> = {};

				if (rowTitle) rowData['title'] = rowTitle;

				if (rowCells instanceof Y.Map) {
					for (const col of ctx.columnDefs) {
						if (col.type === 'title') continue;
						if (params.columns?.length && !params.columns.includes(col.name || ''))
							continue;
						const cellEntry = rowCells.get(col.id);
						if (cellEntry !== undefined) {
							rowData[col.name] = decodeDatabaseCellValue(col, cellEntry);
						}
					}
				}
				data.push(rowData);
			}

			return {
				title,
				columns: ctx.columnDefs.map((col) => ({
					name: col.name,
					type: col.type,
					options: col.options?.map((o) => o.value)
				})),
				data
			};
		}

		// Default rows format
		return readDatabaseCellsHandler(params);
	} finally {
	}
}

/**
 * Read database cells
 *
 * Reads cell data from the specified database, returning detailed row and column information
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Document ID
 * @param params.databaseBlockId - Database block ID
 * @param params.rowBlockIds - Row ID array to read (optional, defaults to all rows)
 * @param params.columns - Column name array to read (optional, defaults to all columns)
 * @param params.filters - Filter condition array
 * @returns Read result, format: { rows: [{ id, title, cells: { colId: { value, type } } }] }
 *
 * @example
 * await readDatabaseCellsHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   columns: ['Name', 'Status']
 * });
 */
export async function readDatabaseCellsHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	rowBlockIds?: string[];
	columns?: string[];
	filters?: Array<{ column: string; operator: string; value: string }>;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		let requestedRows = params.rowBlockIds?.length
			? params.rowBlockIds
			: getDatabaseRowIds(ctx.dbBlock);

		const requestedColumns = params.columns?.length
			? params.columns.map((columnKey) => {
					const col = findDatabaseColumn(columnKey, ctx);
					if (!col) {
						throw new Error(
							`Column '${columnKey}' not found. Available columns: ${availableDatabaseColumns(ctx)}`
						);
					}
					return col;
				})
			: ctx.columnDefs;
		const requestedColumnIds = new Set(requestedColumns.map((col) => col.id));

		// Apply filters
		if (params.filters) {
			requestedRows = findRowsByFilters(
				ctx.cellsMap,
				ctx.columnDefs,
				params.filters,
				ctx.rowIds
			);
		}

		const rows = requestedRows.map((rowBlockId) => {
			const rowBlock = getDatabaseRowBlock(
				ctx.blocks,
				ctx.dbBlock,
				params.databaseBlockId,
				rowBlockId
			);
			const title = readDatabaseRowTitle(rowBlock) || null;
			const rowCells = ctx.cellsMap.get(rowBlockId);
			const cells: Record<string, Record<string, unknown>> = {};

			if (rowCells instanceof Y.Map) {
				for (const col of ctx.columnDefs) {
					if (ctx.titleCol && col.id === ctx.titleCol.id) continue;
					if (!requestedColumnIds.has(col.id)) continue;
					const cellEntry = rowCells.get(col.id);
					if (cellEntry === undefined) continue;
					cells[col.name || col.id] = decodeDatabaseCellValue(col, cellEntry);
				}
			}

			return {
				rowBlockId,
				title,
				linkedDocId: readLinkedDocId(rowBlock),
				cells
			};
		});

		return { rows };
	} finally {
	}
}

/**
 * Read database column definitions
 *
 * Gets the complete structure info of the database, including column definitions, view configurations, etc.
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Document ID
 * @param params.databaseBlockId - Database block ID
 * @returns Column definition result containing:
 *   - databaseBlockId: Database ID
 *   - title: Database title
 *   - rowCount: Row count
 *   - columnCount: Column count
 *   - titleColumnId: Title column ID
 *   - columns: Column definition array [{ id, name, type, options }]
 *   - views: View definition array
 *
 * @example
 * await readDatabaseColumnsHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456'
 * });
 */
export async function readDatabaseColumnsHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		const columns = ctx.columnDefs.map((col) => ({
			id: col.id,
			name: col.name || null,
			type: col.type,
			options: col.options
		}));

		const titleText = ctx.dbBlock.get('prop:title');
		let title = '';
		if (titleText instanceof Y.Text) {
			title = titleText.toString();
		} else if (Array.isArray(titleText)) {
			title = titleText.map((d: any) => d.insert || '').join('');
		}

		return {
			databaseBlockId: params.databaseBlockId,
			title: title || null,
			rowCount: getDatabaseRowIds(ctx.dbBlock).length,
			columnCount: columns.length,
			titleColumnId: ctx.titleCol?.id || null,
			columns,
			views: readDatabaseViewDefs(ctx.dbBlock, ctx)
		};
	} finally {
	}
}

/**
 * Batch update database rows
 *
 * Updates row data in the database, supporting single row or batch filter update
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Document ID
 * @param params.databaseBlockId - Database block ID
 * @param params.cells - Cell data to update, keys are column names or column IDs
 * @param params.rowBlockId - Single row ID to update (mutually exclusive with filters)
 * @param params.filters - Filter condition array for batch matching and updating
 * @param params.createOption - Whether to auto-create new options for select type, defaults to true
 * @param params.linkedDocId - Optional linked document ID (converts the row to a link pointing to a document)
 * @returns Update result containing:
 *   - updated: Whether successfully updated
 *   - updatedIds: Array of updated row IDs
 *   - updatedCount: Number of rows updated
 *
 * @example
 * // Update a single row
 * await updateDatabaseRowHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   rowBlockId: 'row789',
 *   cells: { 'Status': 'Completed', 'Progress': 100 }
 * });
 *
 * // Batch update matching rows
 * await updateDatabaseRowHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   filters: [{ column: 'Status', operator: 'eq', value: 'In Progress' }],
 *   cells: { 'Status': 'Completed' }
 * });
 */
export async function updateDatabaseRowHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	cells: Record<string, unknown>;
	rowBlockId?: string;
	filters?: Array<{ column: string; operator: string; value: string }>;
	createOption?: boolean;
	linkedDocId?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		let updatedCount = 0;
		let updatedIds: string[] = [];

		// If filter conditions exist, find matching rows and update
		if (params.filters) {
			const matchingRowIds = findRowsByFilters(
				ctx.cellsMap,
				ctx.columnDefs,
				params.filters,
				ctx.rowIds
			);

			for (const rowId of matchingRowIds) {
				try {
					const rowBlock = getDatabaseRowBlock(
						ctx.blocks,
						ctx.dbBlock,
						params.databaseBlockId,
						rowId
					);
					const rowCells = ensureDatabaseRowCells(ctx.cellsMap, rowId);
					let titleValue: string | null = null;

					for (const [key, value] of Object.entries(params.cells)) {
						const col = findDatabaseColumn(key, ctx);
						if (!col) {
							if (isTitleAliasKey(key)) {
								titleValue = String(value ?? '');
								continue;
							}
							continue;
						}

						writeDatabaseCellValue(rowCells, col, value, params.createOption ?? true);
						if (col.type === 'title' || isTitleAliasKey(col.name)) {
							titleValue = String(value ?? '');
						}
					}

					if (params.linkedDocId) {
						rowBlock.set('prop:text', makeLinkedDocText(params.linkedDocId));
					} else if (titleValue !== null) {
						rowBlock.set('prop:text', makeText(titleValue));
					}

					updatedIds.push(rowId);
					updatedCount++;
				} catch {
					// Ignore individual update errors
				}
			}
		} else if (params.rowBlockId) {
			// No filter conditions, update single row
			const rowBlock = getDatabaseRowBlock(
				ctx.blocks,
				ctx.dbBlock,
				params.databaseBlockId,
				params.rowBlockId
			);
			const rowCells = ensureDatabaseRowCells(ctx.cellsMap, params.rowBlockId);
			let titleValue: string | null = null;

			for (const [key, value] of Object.entries(params.cells)) {
				const col = findDatabaseColumn(key, ctx);
				if (!col) {
					if (isTitleAliasKey(key)) {
						titleValue = String(value ?? '');
						continue;
					}
					throw new Error(
						`Column '${key}' not found. Available columns: ${availableDatabaseColumns(ctx)}`
					);
				}

				writeDatabaseCellValue(rowCells, col, value, params.createOption ?? true);
				if (col.type === 'title' || isTitleAliasKey(col.name)) {
					titleValue = String(value ?? '');
				}
			}

			if (params.linkedDocId) {
				rowBlock.set('prop:text', makeLinkedDocText(params.linkedDocId));
			} else if (titleValue !== null) {
				rowBlock.set('prop:text', makeText(titleValue));
			}

			updatedIds = [params.rowBlockId];
			updatedCount = 1;
		} else {
			throw new Error('Must specify either row-id or filter parameter');
		}

		await updateYDoc(ctx.socket, workspaceId, params.docId, ctx.doc, ctx.prevSV);

		return {
			updated: updatedCount,
			rowBlockIds: updatedIds,
			databaseBlockId: params.databaseBlockId
		};
	} finally {
	}
}

/**
 * List databases in a document
 *
 * Gets basic info for all databases in the specified document
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Document ID
 * @returns List result containing:
 *   - databases: Database array
 *     - id: Database block ID
 *     - title: Database title
 *     - rowCount: Row count
 *     - columnCount: Column count
 *
 * @example
 * await listDatabasesHandler({
 *   docId: 'abc123'
 * });
 */
export async function listDatabasesHandler(params: {
	workspace?: string;
	docId: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc, exists: snapshotExists } = await fetchYDoc(socket, workspaceId, params.docId);
		if (!snapshotExists) {
			throw new Error('Document not found');
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		const databases: Array<{
			id: string;
			title: string;
			rowCount: number;
			columnCount: number;
		}> = [];

		for (const [blockId, block] of blocks.entries()) {
			if (!(block instanceof Y.Map)) continue;
			const flavour = block.get('sys:flavour');
			if (flavour !== 'affine:database') continue;

			// Read database title
			const titleText = block.get('prop:title');
			let title = '';
			if (titleText instanceof Y.Text) {
				title = titleText.toString();
			} else if (Array.isArray(titleText)) {
				title = titleText.map((d: any) => d.insert || '').join('');
			}

			// Read row and column counts
			const columns = readColumnDefs(block);
			const children = block.get('sys:children');
			const rowCount = childIdsFrom(children).length;

			databases.push({
				id: blockId,
				title: title || 'Untitled Database',
				rowCount,
				columnCount: columns.length
			});
		}

		return { databases };
	} finally {
	}
}

/**
 * Create database
 *
 * Creates a new database in the specified document, or creates a new document containing a database
 * Supports inferring column definitions from data and importing initial data
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Target document ID (creates a new document if not provided)
 * @param params.title - Database/document title
 * @param params.columns - Predefined column array (optional)
 *   - Format: [{ name: string, type: string, width?: number, options?: string[] }]
 * @param params.viewMode - View mode: 'table' or 'kanban' (defaults to 'table')
 * @param params.data - Initial data (optional)
 *   - Supports array format: [{col1: val1}, ...]
 *   - Supports object format: {title, data: [], columns: []}
 *   - Column types in data are automatically inferred
 * @returns Creation result containing:
 *   - created: Whether successfully created
 *   - docId: Document ID
 *   - databaseBlockId: Database block ID
 *   - title: Database title
 *   - importedRows: Number of imported rows
 *
 * @throws Missing workspace ID, etc.
 *
 * @example
 * // Create database in an existing document
 * await createDatabaseHandler({
 *   docId: 'abc123',
 *   title: 'Project List',
 *   columns: [{ name: 'Name', type: 'rich-text' }, { name: 'Status', type: 'select', options: ['In Progress', 'Completed'] }]
 * });
 *
 * // Create new document with database (with data)
 * await createDatabaseHandler({
 *   title: 'Sales Data',
 *   viewMode: 'table',
 *   data: [{ product: 'Product A', sales: 100 }, { product: 'Product B', sales: 200 }]
 * });
 */
export async function createDatabaseHandler(params: {
	workspace?: string;
	docId?: string;
	title?: string;
	columns?: Array<{ name: string; type: string; width?: number; options?: string[] }>;
	viewMode?: string;
	data?: any;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');

	const socket = await createWorkspaceSocket();

	let targetDocId = params.docId;

	const isKanban = params.viewMode === 'kanban';
	if (isKanban) {
		throw new Error('Kanban mode is not yet supported');
	}

	try {
		await joinWorkspace(socket, workspaceId);

		// If no docId is specified, create a new document
		if (!targetDocId) {
			const newDocId = generateId(12, 'doc');
			const newDoc = new Y.Doc();
			const prevSV = Y.encodeStateVector(newDoc);

			// Create page block
			const pageBlockId = generateId(12, 'page');
			const pageBlock = new Y.Map<any>();
			pageBlock.set('sys:id', pageBlockId);
			pageBlock.set('sys:flavour', 'affine:page');
			pageBlock.set('sys:version', 2);
			pageBlock.set('sys:parent', null);
			pageBlock.set('sys:children', new Y.Array<string>());

			// Set document title
			const titleText = new Y.Text();
			titleText.insert(0, params.title || 'Untitled Database');
			pageBlock.set('prop:title', titleText);

			// Add note block
			const noteId = generateId(12, 'note');
			const noteBlock = new Y.Map<any>();
			noteBlock.set('sys:id', noteId);
			noteBlock.set('sys:flavour', 'affine:note');
			noteBlock.set('sys:version', 1);
			noteBlock.set('sys:parent', pageBlockId);
			noteBlock.set('sys:children', new Y.Array<string>());
			noteBlock.set('prop:xywh', '[0,0,800,95]');
			noteBlock.set('prop:index', 'a0');
			noteBlock.set('prop:hidden', false);
			noteBlock.set('prop:displayMode', 'both');
			const background = new Y.Map<any>();
			background.set('light', '#ffffff');
			background.set('dark', '#252525');
			noteBlock.set('prop:background', background);

			// Add surface block
			const surfaceId = generateId(12, 'surf');
			const surfaceBlock = new Y.Map<any>();
			surfaceBlock.set('sys:id', surfaceId);
			surfaceBlock.set('sys:flavour', 'affine:surface');
			surfaceBlock.set('sys:version', 1);
			surfaceBlock.set('sys:parent', null);
			surfaceBlock.set('sys:children', new Y.Array<string>());
			const elements = new Y.Map<any>();
			elements.set('type', '$blocksuite:internal:native$');
			elements.set('value', new Y.Map<any>());
			surfaceBlock.set('prop:elements', elements);

			const blocks = newDoc.getMap('blocks');
			blocks.set(pageBlockId, pageBlock);
			blocks.set(noteId, noteBlock);
			blocks.set(surfaceId, surfaceBlock);

			const pageChildren = pageBlock.get('sys:children') as Y.Array<string>;
			pageChildren.push([surfaceId]);
			pageChildren.push([noteId]);

			// Add to workspace meta (so Affine UI can see the document)
			const meta = newDoc.getMap('meta');
			meta.set('id', newDocId);
			meta.set('title', params.title || 'Untitled Database');
			meta.set('createDate', Date.now());
			meta.set('tags', new Y.Array<string>());

			await updateYDoc(socket, workspaceId, newDocId, newDoc, prevSV);

			// Update workspace pages list
			const { doc: wsDoc, prevSV: wsPrevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
			const wsMeta = wsDoc.getMap('meta');
			let pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;
			if (!pages) {
				pages = new Y.Array();
				wsMeta.set('pages', pages);
			}
			const entry = new Y.Map();
			entry.set('id', newDocId);
			entry.set('title', params.title || 'Untitled Database');
			entry.set('createDate', Date.now());
			entry.set('tags', new Y.Array<string>());
			pages.push([entry as any]);
			await updateYDoc(socket, workspaceId, workspaceId, wsDoc, wsPrevSV);

			targetDocId = newDocId;
		}

		// Get target document
		const { doc: doc, exists: snapshotExists, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, targetDocId);
		if (!snapshotExists) {
			throw new Error('Document not found');
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		// Generate database block
		const dbBlockId = generateId(12, 'db');
		const dbBlock = createBlockBase(dbBlockId, 'affine:database', null);
		dbBlock.set('prop:title', makeText(params.title || 'Untitled Database'));
		dbBlock.set('prop:cells', new Y.Map<any>());
		dbBlock.set('prop:comments', undefined);

		// Create column definitions
		const columns = new Y.Array<any>();
		const titleColumnId = generateId(8, 'col');
		const titleColDef = createColumnDefinition(titleColumnId, 'Title', 'title', 250);
		columns.push([titleColDef]);

		// Track field properties
		const colIdMap: Map<string, string> = new Map();

		// Add custom columns
		if (params.columns) {
			for (const col of params.columns) {
				const colId = generateId(8, 'col');
				colIdMap.set(col.name, colId);
				const colWidth = col.width || getDefaultColumnWidth(col.type || 'rich-text');
				const colDef = createColumnDefinition(
					colId,
					col.name,
					col.type || 'rich-text',
					colWidth,
					col.options
				);
				columns.push([colDef]);
			}
		}

		// Create view columns
		const viewColumns = new Y.Array<any>();
		viewColumns.push([createViewColumn(titleColumnId, false, 'title')]);

		// Add view columns for custom columns
		for (const col of params.columns || []) {
			const colId = colIdMap.get(col.name);
			if (colId) {
				viewColumns.push([createViewColumn(colId, false, col.type), col.name]);
			}
		}

		const header = {
			titleColumn: titleColumnId,
			iconColumn: 'type'
		};

		const view = new Y.Map<any>();
		view.set('id', generateId(8, 'view'));
		view.set('name', params.viewMode === 'kanban' ? 'Kanban View' : 'Table View');
		view.set('mode', params.viewMode || 'table');
		view.set('columns', viewColumns);
		view.set('filter', { type: 'group', op: 'and', conditions: [] });
		view.set('groupBy', null);
		view.set('sort', null);
		view.set('header', header);

		const views = new Y.Array<any>();
		views.push([view]);

		dbBlock.set('prop:columns', columns);
		dbBlock.set('prop:views', views);

		// If data is provided, infer column types from data and create columns, then import data
		let importedRows = 0;

		if (params.data) {
			let dataToImport: any[] = [];
			try {
				const parsedData =
					typeof params.data === 'string' ? JSON.parse(params.data) : params.data;
				if (Array.isArray(parsedData)) {
					dataToImport = parsedData;
				} else if (parsedData && parsedData.data && Array.isArray(parsedData.data)) {
					dataToImport = parsedData.data;
				}
			} catch {
				// Ignore parse errors
			}

			if (dataToImport.length > 0) {
				// Check if data contains a title field
				const hasTitleField = dataToImport.some(
					(row) => row && typeof row === 'object' && 'Title' in row
				);

				// Infer column types from data
				const allKeys = new Set<string>();
				for (const row of dataToImport) {
					if (row && typeof row === 'object') {
						Object.keys(row).forEach((k) => allKeys.add(k));
					}
				}

				// Only exclude title when data has no title field (first column will be used as title later)
				// If title field exists, keep all columns

				// Infer type for each column
				const inferredColumns: Array<{
					name: string;
					type: string;
					options?: Array<{ id?: string; value: string; color?: string }>;
				}> = [];
				for (const key of allKeys) {
					const values = dataToImport
						.filter(
							(r) => r && r[key] !== undefined && r[key] !== null && r[key] !== ''
						)
						.map((r) => r[key]);

					let inferredType = 'rich-text';
					let options: Array<{ id?: string; value: string; color?: string }> | undefined;

					// Detect arrays (multi-select)
					if (values.length > 0 && values.every((v) => Array.isArray(v))) {
						inferredType = 'multi-select';
						// Collect all unique options
						const allOptions = new Set<string>();
						values.forEach((v: any) => {
							if (Array.isArray(v)) {
								v.forEach((item: string) => allOptions.add(String(item)));
							}
						});
						options = Array.from(allOptions).map((v) => ({ value: v }));
					}
					// Detect booleans
					else if (values.length > 0 && values.every((v) => typeof v === 'boolean')) {
						inferredType = 'checkbox';
					}
					// Detect numbers
					else if (
						values.length > 0 &&
						values.every((v) => typeof v === 'number' || !isNaN(Number(v)))
					) {
						inferredType = 'number';
					}
					// Detect dates
					else if (
						values.length > 0 &&
						values.every((v) => !isNaN(Date.parse(String(v))) || typeof v === 'number')
					) {
						inferredType = 'date';
					}
					// Detect progress (numbers 0-100)
					else if (
						values.length > 0 &&
						values.every((v) => {
							const n = Number(v);
							return (
								typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
							);
						})
					) {
						inferredType = 'progress';
					}
					// Detect URLs
					else if (
						values.length > 0 &&
						values.every(
							(v) =>
								typeof v === 'string' &&
								(v.startsWith('http://') || v.startsWith('https://'))
						)
					) {
						inferredType = 'link';
					}
					// Detect options
					else if (values.length > 0) {
						const uniqueValues = new Set(values.map(String));
						if (uniqueValues.size <= 20 && uniqueValues.size < values.length * 0.5) {
							inferredType = 'select';
							// Convert to object array
							options = Array.from(uniqueValues).map((v) => ({ value: v }));
						}
					}

					inferredColumns.push({ name: key, type: inferredType, options });
				}

				// Determine title column: if data has no title field, use the first column as title
				let titleKey: string | null = null;
				if (!hasTitleField && inferredColumns.length > 0) {
					titleKey = inferredColumns[0].name;
				}

				// Create inferred column definitions
				for (const col of inferredColumns) {
					// Skip title column
					if (titleKey && col.name === titleKey) continue;
					if (colIdMap.has(col.name)) continue;

					const colId = generateId(8, 'col');
					colIdMap.set(col.name, colId);

					// Extract option value array
					const optionValues = col.options?.map((o) => (o as any)?.value || String(o));

					const colDef = createColumnDefinition(
						colId,
						col.name,
						col.type,
						getDefaultColumnWidth(col.type),
						optionValues
					);
					columns.push([colDef]);

					// Add view columns
					viewColumns.push([createViewColumn(colId, false, col.type)]);

					// Update options to object format (with id)
					if (col.options?.length && optionValues) {
						const colDefData = colDef.get('data');
						if (colDefData instanceof Y.Map) {
							const opts = colDefData.get('options');
							if (opts instanceof Y.Array) {
								opts.forEach((opt: any, idx: number) => {
									if (opt instanceof Y.Map) {
										col.options![idx] = {
											id: opt.get('id'),
											value: opt.get('value'),
											color: opt.get('color')
										};
									}
								});
							}
						}
					}
				}

				let dbChildren = dbBlock.get('sys:children') as Y.Array<any>;
				if (!(dbChildren instanceof Y.Array)) {
					dbChildren = new Y.Array<string>();
					dbBlock.set('sys:children', dbChildren);
				}

				// Get cells map (create if not exists)
				let cells = dbBlock.get('prop:cells') as Y.Map<any>;
				if (!(cells instanceof Y.Map)) {
					cells = new Y.Map<any>();
					dbBlock.set('prop:cells', cells);
				}

				// Create rows and populate data
				for (const rowData of dataToImport) {
					if (!rowData || typeof rowData !== 'object') continue;

					const rowBlockId = generateId(12, 'row');
					const rowBlock = new Y.Map<any>();
					rowBlock.set('sys:id', rowBlockId);
					rowBlock.set('sys:flavour', 'affine:paragraph');
					rowBlock.set('sys:version', 1);
					rowBlock.set('sys:parent', dbBlockId);
					rowBlock.set('sys:children', new Y.Array<string>());
					rowBlock.set('prop:type', 'text');

					// Extract title from row data
					// If data has a title field, use the title field value
					// If no title field, use the first column value as title
					let titleValue = '';
					if ('title' in rowData && rowData.title !== undefined) {
						titleValue = String(rowData.title);
					} else if (titleKey && rowData[titleKey] !== undefined) {
						titleValue = String(rowData[titleKey]);
					}
					rowBlock.set('prop:text', makeText(titleValue));

					// Add rowBlock to blocks first
					blocks.set(rowBlockId, rowBlock);

					// Add to db children
					dbChildren.push([rowBlockId]);

					// Create row cells
					const rowCells = new Y.Map<any>();

					// Set cell values for each inferred column (skip title column)
					for (const colInfo of inferredColumns) {
						// Skip title column
						if (titleKey && colInfo.name === titleKey) continue;

						const colId = colIdMap.get(colInfo.name);
						if (!colId) continue;
						const cellData = new Y.Map<any>();
						cellData.set('columnId', colId);
						const value = rowData[colInfo.name];
						if (value !== undefined && value !== null) {
							// Set value based on type
							if (colInfo.type === 'checkbox') {
								cellData.set('value', value ? true : false);
							} else if (colInfo.type === 'number') {
								const num = Number(value);
								if (!Number.isNaN(num)) {
									cellData.set('value', num);
								}
							} else if (colInfo.type === 'progress') {
								const num = Number(value);
								if (!Number.isNaN(num)) {
									cellData.set(
										'value',
										Math.max(0, Math.min(100, Math.floor(num)))
									);
								}
							} else if (colInfo.type === 'select' && colInfo.options?.length) {
								// Find corresponding option ID, create new option if not found
								const strValue = String(value);
								let opt = colInfo.options.find(
									(o) => (o as any).value === strValue
								);
								if (!opt) {
									// Create new option
									const optId = generateId(8, 'opt');
									opt = {
										id: optId,
										value: strValue,
										color: TAG_COLORS[
											colInfo.options.length % TAG_COLORS.length
										]
									};
									colInfo.options.push(opt);
								}
								cellData.set('value', (opt as any).id);
							} else if (colInfo.type === 'multi-select' && colInfo.options?.length) {
								// Multi-select: value is array
								const values = Array.isArray(value) ? value : [value];
								const optionIds = new Y.Array<string>();
								for (const v of values) {
									const strValue = String(v);
									let opt = colInfo.options.find(
										(o) => (o as any).value === strValue
									);
									if (!opt) {
										const optId = generateId(8, 'opt');
										opt = {
											id: optId,
											value: strValue,
											color: TAG_COLORS[
												colInfo.options.length % TAG_COLORS.length
											]
										};
										colInfo.options.push(opt);
									}
									optionIds.push([(opt as any).id]);
								}
								cellData.set('value', optionIds);
							} else if (colInfo.type === 'date') {
								const ts = Date.parse(String(value));
								cellData.set('value', isNaN(ts) ? String(value) : ts);
							} else if (colInfo.type === 'progress') {
								const n = Number(value);
								if (Number.isFinite(n)) {
									const clamped = Math.max(0, Math.min(100, Math.floor(n)));
									cellData.set('value', clamped);
								}
							} else {
								// rich-text, link, etc. use makeText
								cellData.set('value', makeText(String(value)));
							}
						}
						rowCells.set(colId, cellData);
					}

					// Add to cells map
					cells.set(rowBlockId, rowCells);

					importedRows++;
				}
			}
		}

		// Add to document
		blocks.set(dbBlockId, dbBlock);

		// Find page block and add child
		let pageBlockId: string | null = null;
		for (const [id, block] of blocks.entries()) {
			if (block instanceof Y.Map && block.get('sys:flavour') === 'affine:page') {
				pageBlockId = id;
				break;
			}
		}

		if (pageBlockId) {
			const pageBlock = blocks.get(pageBlockId) as Y.Map<any>;
			let pageChildren = pageBlock.get('sys:children') as Y.Array<string> | undefined;
			if (!(pageChildren instanceof Y.Array)) {
				pageChildren = new Y.Array<string>();
				pageBlock.set('sys:children', pageChildren);
			}
			pageChildren.push([dbBlockId]);
		}

		// Push update
		await updateYDoc(socket, workspaceId, targetDocId, doc, prevSV);

		return {
			created: true,
			docId: targetDocId,
			databaseBlockId: dbBlockId,
			title: params.title || 'Untitled Database',
			importedRows
		};
	} finally {
	}
}

/**
 * Delete database
 *
 * Deletes the specified database block and all its associated row data from the document
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Document ID
 * @param params.databaseBlockId - Database block ID to delete
 * @returns Deletion result containing:
 *   - deleted: Whether successfully deleted
 *   - databaseBlockId: Deleted database ID
 *   - deletedBlockCount: Number of blocks deleted
 *
 * @example
 * await deleteDatabaseHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456'
 * });
 */
export async function deleteDatabaseHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc, exists: snapshotExists, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, params.docId);
		if (!snapshotExists) {
			throw new Error('Document not found');
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		// Check if database exists
		const dbBlock = blocks.get(params.databaseBlockId);
		if (!dbBlock || !(dbBlock instanceof Y.Map)) {
			throw new Error(`Database block '${params.databaseBlockId}' not found`);
		}
		if (dbBlock.get('sys:flavour') !== 'affine:database') {
			throw new Error(`Block '${params.databaseBlockId}' is not a database`);
		}

		// Collect all block IDs to delete (including rows and sub-blocks)
		const blocksToDelete: string[] = [params.databaseBlockId];

		// Get all children of the database (rows)
		const dbChildren = dbBlock.get('sys:children');
		if (dbChildren instanceof Y.Array) {
			for (const entry of dbChildren) {
				if (typeof entry === 'string') {
					blocksToDelete.push(entry);
				} else if (Array.isArray(entry)) {
					blocksToDelete.push(...entry.filter((e: any) => typeof e === 'string'));
				}
			}
		}

		// Delete all related blocks
		for (const blockId of blocksToDelete) {
			blocks.delete(blockId);
		}

		// Remove database reference from page block
		let pageBlockId: string | null = null;
		for (const [id, block] of blocks.entries()) {
			if (block instanceof Y.Map && block.get('sys:flavour') === 'affine:page') {
				pageBlockId = id;
				break;
			}
		}

		if (pageBlockId) {
			const pageBlock = blocks.get(pageBlockId) as Y.Map<any>;
			const pageChildren = pageBlock.get('sys:children') as Y.Array<any>;
			if (pageChildren instanceof Y.Array) {
				for (let i = 0; i < pageChildren.length; i++) {
					const entry = pageChildren.get(i);
					if (typeof entry === 'string' && entry === params.databaseBlockId) {
						pageChildren.delete(i, 1);
						break;
					}
					if (Array.isArray(entry) && entry.includes(params.databaseBlockId)) {
						pageChildren.delete(i, 1);
						break;
					}
				}
			}
		}

		// Push update
		await updateYDoc(socket, workspaceId, params.docId, doc, prevSV);

		return {
			deleted: true,
			databaseBlockId: params.databaseBlockId
		};
	} finally {
	}
}

/**
 * Insert data into database
 *
 * Adds new row data to an existing database, supports auto-inferring and creating new columns
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @param params.docId - Document ID
 * @param params.databaseBlockId - Database block ID
 * @param params.json - Data to insert
 *   - Simple format: [{col1: val1, col2: val2}, ...]
 *   - Standard format: {title: string, data: [], columns: []}
 * @returns Insert result containing:
 *   - imported: Actual number of imported rows
 *   - newColumns: Number of newly inferred and created columns
 *
 * @example
 * await insertDatabaseHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   json: [
 *     { title: 'New Task 1', status: 'In Progress', priority: 'High' },
 *     { title: 'New Task 2', status: 'Completed', priority: 'Low' }
 *   ]
 * });
 */
export async function insertDatabaseHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	json: any;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');

	// Parse JSON
	let importData: any;
	try {
		importData = typeof params.json === 'string' ? JSON.parse(params.json) : params.json;
	} catch {
		throw new Error('Invalid JSON format');
	}

	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc, exists: snapshotExists, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, params.docId);
		if (!snapshotExists) {
			throw new Error('Document not found');
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		// Get database
		const dbBlock = blocks.get(params.databaseBlockId);
		if (!dbBlock || !(dbBlock instanceof Y.Map)) {
			throw new Error(`Database block '${params.databaseBlockId}' not found`);
		}
		if (dbBlock.get('sys:flavour') !== 'affine:database') {
			throw new Error(`Block '${params.databaseBlockId}' is not a database`);
		}

		// Detect format and get data
		let rowsToImport: Record<string, any>[];

		// Simple format: array
		if (Array.isArray(importData)) {
			rowsToImport = importData;
		}
		// Standard format: object
		else if (typeof importData === 'object' && importData !== null) {
			rowsToImport = importData.data || [];
		} else {
			throw new Error('Unsupported JSON format');
		}

		if (rowsToImport.length === 0) {
			return { imported: 0, message: 'No data to import' };
		}

		// Get existing column definitions
		const existingColumns = readColumnDefs(dbBlock);
		const existingColNames = new Set(existingColumns.map((c) => c.name));

		// Infer new columns needed from data
		const inferredColumns: Array<{ name: string; type: string; options?: string[] }> = [];
		const allKeys = new Set<string>();

		for (const row of rowsToImport) {
			if (row && typeof row === 'object') {
				Object.keys(row).forEach((k) => allKeys.add(k));
			}
		}

		// Exclude title column
		allKeys.delete('title');

		// Infer type for each column
		for (const key of allKeys) {
			const values = rowsToImport
				.filter((r) => r && r[key] !== undefined && r[key] !== null && r[key] !== '')
				.map((r) => r[key]);

			let inferredType = 'rich-text';
			let options: string[] | undefined;

			// Detect if values are booleans
			if (values.every((v) => typeof v === 'boolean')) {
				inferredType = 'checkbox';
			}
			// Detect if values are numbers
			else if (values.every((v) => typeof v === 'number' || !isNaN(Number(v)))) {
				inferredType = 'number';
			}
			// Detect if values are dates
			else if (values.every((v) => !isNaN(Date.parse(String(v))) || typeof v === 'number')) {
				inferredType = 'date';
			}
			// Detect URLs
			else if (
				values.every(
					(v) =>
						typeof v === 'string' &&
						(v.startsWith('http://') || v.startsWith('https://'))
				)
			) {
				inferredType = 'link';
			}
			// Detect options (fewer repeated values, likely options)
			else {
				const uniqueValues = new Set(values.map(String));
				if (uniqueValues.size <= 20 && uniqueValues.size < values.length * 0.5) {
					inferredType = 'select';
					options = Array.from(uniqueValues);
				}
			}

			inferredColumns.push({ name: key, type: inferredType, options });
		}

		// Add new columns to database
		const columns = dbBlock.get('prop:columns') as Y.Array<any>;
		const newColumnIds: Map<string, string> = new Map();

		for (const col of inferredColumns) {
			if (!existingColNames.has(col.name)) {
				const columnId = generateId(8, 'col');
				const colDef = createColumnDefinition(
					columnId,
					col.name,
					col.type,
					getDefaultColumnWidth(col.type),
					col.options
				);
				columns.push([colDef]);
				newColumnIds.set(col.name, columnId);

				// Update view columns
				const views = dbBlock.get('prop:views') as Y.Array<any>;
				if (views instanceof Y.Array) {
					views.forEach((view: any) => {
						if (view instanceof Y.Map) {
							const viewColumns = view.get('columns');
							if (viewColumns instanceof Y.Array) {
								const viewCol = new Y.Map<any>();
								viewCol.set('id', columnId);
								viewCol.set('hide', false);
								viewCol.set('width', 200);
								viewColumns.push([viewCol]);
							}
						}
					});
				}
			}
		}

		// Re-read column definitions (including newly added columns)
		const allColumns = readColumnDefs(dbBlock);
		const colByName = new Map<string, any>();
		for (const col of allColumns) {
			colByName.set(col.name, col);
		}

		// Add rows
		let importedCount = 0;
		const cellsMap = dbBlock.get('prop:cells') as Y.Map<any>;
		const dbChildren = dbBlock.get('sys:children') as Y.Array<any>;

		for (const rowData of rowsToImport) {
			if (!rowData || typeof rowData !== 'object') continue;

			const rowBlockId = generateId(12, 'row');
			const titleValue = rowData.title || '';
			const rowBlock = createDatabaseRowBlock(rowBlockId, params.databaseBlockId, titleValue);

			blocks.set(rowBlockId, rowBlock);
			dbChildren.push([rowBlockId]);

			const rowCells = ensureDatabaseRowCells(cellsMap, rowBlockId);

			// Process each field
			for (const [key, value] of Object.entries(rowData)) {
				if (key === 'title') continue;

				const col = colByName.get(key);
				if (col) {
					writeDatabaseCellValue(rowCells, col, value, true);
				}
			}

			importedCount++;
		}

		// Push update
		await updateYDoc(socket, workspaceId, params.docId, doc, prevSV);

		return {
			imported: importedCount,
			newColumns: inferredColumns.length
		};
	} finally {
	}
}
