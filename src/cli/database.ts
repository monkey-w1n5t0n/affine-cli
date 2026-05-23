/**
 * Database CLI module
 * Provides command-line interface for database management
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { parseJsonContent } from '../utils/misc.js';

import {
	queryDatabaseHandler,
	readDatabaseColumnsHandler,
	updateDatabaseRowHandler,
	listDatabasesHandler,
	createDatabaseHandler,
	deleteDatabaseHandler,
	insertDatabaseHandler,
	removeDatabaseRowHandler
} from '../core/database.js';

/**
 * Parse filter parameter
 * Parses the user-provided filter string into a usable array format
 * Supports JSON strings and @file format file paths
 *
 * @param filterValue - Filter string, supports:
 *   - JSON array format (e.g. '[{"column":"name","operator":"eq","value":"test"}]')
 *   - Advanced filter format (e.g. '{"mode":"and","filters":[...]}')
 *   - @file format (e.g. '@filter.json' reads file contents)
 * @returns Parsed filter array, or undefined if no input
 * @throws Error if format is invalid
 */
function parseFilter(filterValue: string | undefined) {
	// Return undefined when no input
	if (!filterValue) return undefined;

	// Use generic JSON parsing function for strings or files
	const parsed = parseJsonContent(filterValue, {
		allowArray: true,
		allowObject: true,
		fieldName: 'filter'
	});

	// Handle array format (standard filter conditions)
	if (Array.isArray(parsed)) {
		return parsed.length > 0 ? parsed : undefined;
	}

	// Handle object format (advanced filter with mode field)
	const data = parsed as Record<string, any>;
	if (data && 'mode' in data && Array.isArray(data['filters'])) {
		return data;
	}

	// Invalid format
	throw new Error('filter parameter must be a valid JSON array format');
}

/**
 * Parse JSON content parameter (object format)
 * Helper function for parsing cells, values, and other parameters requiring object format
 *
 * @param value - Input string, supports JSON string or @file format
 * @param fieldName - Parameter name, used in error messages
 * @returns Parsed object
 * @throws Error if format is invalid
 */
function parseObjectContent(value: string | undefined, fieldName: string): Record<string, unknown> {
	if (!value) return {};

	const parsed = parseJsonContent(value, {
		allowArray: false,
		allowObject: true,
		fieldName
	});

	return parsed as Record<string, unknown>;
}

/**
 * Parse JSON content parameter (array or object format)
 * Generic helper function for parsing content and other flexible-format parameters
 *
 * @param value - Input string, supports JSON string or @file format
 * @param fieldName - Parameter name, used in error messages
 * @returns Parsed data (array or object)
 * @throws Error if format is invalid
 */
function parseDataContent(value: string | undefined, fieldName: string): unknown {
	if (!value) return undefined;

	return parseJsonContent(value, {
		allowArray: true,
		allowObject: true,
		fieldName
	});
}

/**
 * Database command configuration
 * Defines parameter and handler mappings for all database-related commands
 */
const databaseCommands: Record<string, CommandConfig> = {
	/**
	 * list command: list all databases in a document
	 * Usage: list --doc <doc-id> [--workspace <workspace-id>]
	 */
	list: {
		name: 'list',
		description: 'List all databases in a document',
		usage: 'list --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: listDatabasesHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			workspace: parsed.workspace
		})
	},

	/**
	 * columns command: read database column definitions
	 * Usage: columns --doc <doc-id> --id <database-block-id> [--workspace <workspace-id>]
	 */
	columns: {
		name: 'columns',
		description: 'Read database column definitions',
		usage: 'columns --doc <doc-id> --id <database-block-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: 'Database block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: readDatabaseColumnsHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			workspace: parsed.workspace
		})
	},

	/**
	 * query command: query database row data
	 * Usage: query --doc <doc-id> --id <database-block-id> [--rows <ids>] [--columns <names>] [--query <json>] [--full] [--workspace <workspace-id>]
	 */
	query: {
		name: 'query',
		description: 'Query database row data',
		usage: 'query --doc <doc-id> --id <database-block-id> [--rows <ids>] [--columns <names>] [--query <json>] [--full] [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: 'Database block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'columns',
				description: 'Column names for query output (comma-separated)',
				type: 'string'
			},
			{
				name: 'rows',
				description: 'Row IDs for query output (comma-separated)',
				type: 'string'
			},
			{
				name: 'query',
				short: 'q',
				description:
					'Filter conditions (JSON array, e.g.: [{ column: string; operator: string; value: string }] or { mode: "and" | "or"; filters: FilterCondition[] })',
				type: 'string'
			},
			{
				name: 'full',
				short: 'f',
				description: 'Whether to output full data',
				type: 'boolean'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: queryDatabaseHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			rowBlockIds: parsed.rows ? parsed.rows.split(',') : undefined,
			columns: parsed.columns ? parsed.columns.split(',') : undefined,
			filters: parseFilter(parsed.query || parsed.q),
			full: parsed.full,
			workspace: parsed.workspace
		})
	},

	/**
	 * remove command: delete database rows
	 * Usage: remove --doc <doc-id> --id <database-block-id> [--row <row-id>] [--query <json>] [--workspace <workspace-id>]
	 */
	remove: {
		name: 'remove',
		description: 'Delete database rows',
		usage: 'remove --doc <doc-id> --id <database-block-id> [--row <row-id>] [--query <json>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: 'Database block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'row',
				short: 'r',
				description: 'Row block ID (specify a single row)',
				type: 'string'
			},
			{
				name: 'query',
				short: 'q',
				description: 'Filter conditions (JSON array, match multiple rows for deletion)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: removeDatabaseRowHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			rowBlockId: parsed['row'],
			filters: parseFilter(parsed.query || parsed.q),
			workspace: parsed.workspace
		})
	},

	/**
	 * update command: update database rows
	 * Usage: update --doc <doc-id> --id <database-block-id> --values <json|@file> [--row <id>] [--query <json>] [--workspace <workspace-id>]
	 */
	update: {
		name: 'update',
		description: 'Update database rows',
		usage: 'update --doc <doc-id> --id <database-block-id> --values <json|@file> [--row <id>] [--query <json>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: 'Database block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'values',
				short: 'v',
				description: 'Cell data (JSON format; prefix with @ for file path)',
				required: true,
				type: 'string'
			},
			{
				name: 'row',
				short: 'r',
				description: 'Row block ID (specify a single row)',
				type: 'string'
			},
			{
				name: 'query',
				short: 'q',
				description: 'Filter conditions (JSON array, match multiple rows for update)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: updateDatabaseRowHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			cells: parseObjectContent(parsed.values || parsed.v, 'values'),
			rowBlockId: parsed['row'],
			filters: parseFilter(parsed.query || parsed.q),
			workspace: parsed.workspace
		})
	},

	/**
	 * create command: create a database
	 * Usage: create --content <json|@file> [--doc <doc-id>] [--title <name>] [--view-mode <mode>] [--workspace <workspace-id>]
	 *
	 * Content format supports:
	 *   - Array format: e.g. [{"title":"Row 1","status":"In progress"},...]
	 *   - Object format: e.g. {"title":"Database title","data":[...],"columns":[...]}
	 */
	create: {
		name: 'create',
		description: 'Create a database (can specify a document or create a new one)',
		usage: 'create --content <json|@file> [--doc <doc-id>] [--title <name>] [--view-mode <mode>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID (creates a new document if not specified)',
				type: 'string'
			},
			{
				name: 'title',
				short: 't',
				description: 'Title for the new document, title of the database',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description:
					'Data (JSON format, supports array or {title:"",data:[],columns:[]} format; prefix with @ for file path)',
				required: true,
				type: 'string'
			},
			{
				name: 'view-mode',
				short: 'm',
				description: 'View mode (table/kanban)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: createDatabaseHandler,
		paramsMapper: (parsed) => {
			// Parse content data
			const data = parseDataContent(parsed.content || parsed.c, 'content');

			// Extract column definitions (if any)
			let columns: Array<{ name: string; type: string; options?: string[] }> = [];
			let title = parsed.title || '';

			// Extract columns and title from object format
			if (data && typeof data === 'object' && !Array.isArray(data)) {
				const content = data as Record<string, unknown>;

				// Extract column definitions
				if (Array.isArray(content.columns)) {
					columns = content.columns;
				}

				// Extract title
				if (!title && content.title) {
					title = String(content.title);
				}
			}

			return {
				docId: parsed['doc'] || undefined,
				title,
				columns,
				data,
				viewMode: parsed['view-mode'],
				workspace: parsed.workspace
			};
		}
	},

	/**
	 * delete command: delete a database
	 * Usage: delete --doc <doc-id> --id <database-block-id> [--workspace <workspace-id>]
	 */
	delete: {
		name: 'delete',
		description: 'Delete a database',
		usage: 'delete --doc <doc-id> --id <database-block-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: 'Database block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: deleteDatabaseHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			workspace: parsed.workspace
		})
	},

	/**
	 * insert command: insert data into a database
	 * Usage: insert --doc <doc-id> --id <database-block-id> --content <json|@file> [--workspace <workspace-id>]
	 */
	insert: {
		name: 'insert',
		description: 'Insert data into a database',
		usage: 'insert --doc <doc-id> --id <database-block-id> --content <json|@file> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: 'Database block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'Data (JSON format, supports array or {data:[]} format; prefix with @ for file path)',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: insertDatabaseHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			json: parseDataContent(parsed.content || parsed.c, 'content'),
			workspace: parsed.workspace
		})
	}
};

/**
 * Database CLI operation mapping
 * Converts command configuration to command mapping for use by the CLI entry point
 */
export const runDatabaseCommands = generateCommandMap(databaseCommands);
