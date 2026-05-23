/**
 * Folder CLI module
 * Provides command-line interface for folder management
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import {
	folderAllHandler,
	folderListHandler,
	folderCreateHandler,
	folderDeleteHandler,
	folderAddHandler,
	folderMoveHandler,
	folderRemoveHandler,
	folderUpdateHandler,
	folderClearHandler
} from '../core/folder.js';

/**
 * folderCommands: Folder command configuration
 *
 * Defines all folder-related CLI commands:
 * - all: Get list of all folders
 * - list: Get items under a specified folder
 * - create: Create a new folder
 * - delete: Delete a folder
 * - update: Update folder properties
 * - clear: Remove all empty folders
 * - add: Add a document to a folder
 * - move: Move a document to a target folder
 * - remove: Remove a document from a folder
 */
const folderCommands: Record<string, CommandConfig> = {
	all: {
		name: 'all',
		description: 'List of all folders',
		usage: 'all [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: folderAllHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	},
	list: {
		name: 'list',
		description: 'List of folders/documents under a specified folder',
		usage: 'list --id <folder-id> [--folder] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Folder ID',
				required: true,
				type: 'string'
			},
			{
				name: 'folder',
				short: 'f',
				description: 'Return only folder list; defaults to returning document list',
				type: 'boolean'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: folderListHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			folder: parsed.folder,
			workspace: parsed.workspace
		})
	},
	create: {
		name: 'create',
		description: 'Create a folder',
		usage: 'create --name <name> [--parent <parent-id>] [--index <idx>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'name',
				short: 'n',
				description: 'Folder name',
				required: true,
				type: 'string'
			},
			{
				name: 'parent',
				short: 'p',
				description: 'Parent folder ID',
				type: 'string'
			},
			{
				name: 'index',
				description: 'Sort index',
				type: 'number'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: folderCreateHandler,
		paramsMapper: (parsed) => ({
			name: parsed.name,
			parent: parsed.parent,
			index: parsed.index,
			workspace: parsed.workspace
		})
	},
	delete: {
		name: 'delete',
		description: 'Delete a folder',
		usage: 'delete --id <folder-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Folder ID',
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
		handler: folderDeleteHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace
		})
	},
	update: {
		name: 'update',
		description: 'Update folder properties (e.g. name, parentId, index)',
		usage: 'update --id <folder-id> [--name <name>] [--parent <parent-id>] [--index <idx>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Folder ID',
				required: true,
				type: 'string'
			},
			{
				name: 'name',
				short: 'n',
				description: 'Folder name',
				type: 'string'
			},
			{
				name: 'parent',
				short: 'p',
				description: 'New parent folder ID (set empty to move to top level)',
				type: 'string',
				allowEmpty: true
			},
			{
				name: 'index',
				description: 'Sort index',
				type: 'number'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: folderUpdateHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			name: parsed.name,
			parent: parsed.parent,
			index: parsed.index,
			workspace: parsed.workspace
		})
	},
	clear: {
		name: 'clear',
		description: 'Remove all empty folders (with no subfolders or associated documents)',
		usage: 'clear [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: folderClearHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	},
	add: {
		name: 'add',
		description: 'Add a document to a folder',
		usage: 'add --id <folder-id> --doc <doc-id> [--index <idx>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Folder ID',
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
				name: 'index',
				description: 'Sort index',
				type: 'number'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: folderAddHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			target: parsed.doc,
			index: parsed.index,
			workspace: parsed.workspace
		})
	},
	move: {
		name: 'move',
		description: 'Move a document from source folder to target folder',
		usage: 'move --id <folder-id> --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Target folder ID',
				required: true,
				type: 'string'
			},
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID to move',
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
		handler: folderMoveHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			target: parsed.doc,
			workspace: parsed.workspace
		})
	},
	remove: {
		name: 'remove',
		description: 'Remove a document from a folder (does not delete the document)',
		usage: 'remove --id <folder-id> --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Folder ID',
				required: true,
				type: 'string'
			},
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID to remove (supports link ID or document ID)',
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
		handler: folderRemoveHandler,
		paramsMapper: (parsed) => ({
			id: parsed.doc,
			folder: parsed.id,
			workspace: parsed.workspace
		})
	}
};

/**
 * Folder CLI operation mapping
 */
export const runFolderCommands = generateCommandMap(folderCommands);
