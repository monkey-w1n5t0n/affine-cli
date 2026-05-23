/**
 * Collection CLI module
 * Provides command-line interface for collection management
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import {
	collectionListHandler,
	collectionInfoHandler,
	collectionCreateHandler,
	collectionUpdateHandler,
	collectionDeleteHandler,
	collectionAddHandler,
	collectionRemoveHandler
} from '../core/collection.js';

/**
 * collectionCommands: Collection command configuration
 *
 * Defines all collection-related CLI commands:
 * - list: Get list of all collections
 * - info: Get document list under a specified collection
 * - create: Create a new collection
 * - update: Update collection name
 * - delete: Delete a collection
 * - add: Add a document to a collection
 * - remove: Remove a document from a collection
 */
const collectionCommands: Record<string, CommandConfig> = {
	list: {
		name: 'list',
		description: 'List of all collections',
		usage: 'list [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: collectionListHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	},
	info: {
		name: 'info',
		description: 'Document list under a specified collection',
		usage: 'info --id <collection-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Collection ID',
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
		handler: collectionInfoHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace
		})
	},
	create: {
		name: 'create',
		description: 'Create a new collection',
		usage: 'create --name <name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'name',
				short: 'n',
				description: 'Collection name',
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
		handler: collectionCreateHandler,
		paramsMapper: (parsed) => ({
			name: parsed.name,
			workspace: parsed.workspace
		})
	},
	update: {
		name: 'update',
		description: 'Update a collection',
		usage: 'update --id <collection-id> --name <new-name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Collection ID',
				required: true,
				type: 'string'
			},
			{
				name: 'name',
				short: 'n',
				description: 'New collection name',
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
		handler: collectionUpdateHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			name: parsed.name,
			workspace: parsed.workspace
		})
	},
	delete: {
		name: 'delete',
		description: 'Delete a collection',
		usage: 'delete --id <collection-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Collection ID',
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
		handler: collectionDeleteHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace
		})
	},
	add: {
		name: 'add',
		description: 'Add a document to a collection',
		usage: 'add --id <collection-id> --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Collection ID',
				required: true,
				type: 'string'
			},
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID to add',
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
		handler: collectionAddHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			target: parsed.doc,
			workspace: parsed.workspace
		})
	},
	remove: {
		name: 'remove',
		description: 'Remove a document from a collection',
		usage: 'remove --id <collection-id> --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Collection ID',
				required: true,
				type: 'string'
			},
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID to remove',
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
		handler: collectionRemoveHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			target: parsed.doc,
			workspace: parsed.workspace
		})
	}
};

/**
 * Collection CLI operation mapping
 */
export const runCollectionCommands = generateCommandMap(collectionCommands);
