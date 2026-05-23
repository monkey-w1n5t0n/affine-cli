/**
 * Tags CLI module
 * Provides command-line interface for tag management
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import {
	tagsListHandler,
	tagsCreateHandler,
	tagsDocAddHandler,
	tagsDocRemoveHandler,
	tagsDocListHandler,
	tagsDeleteHandler
} from '../core/tags.js';

/**
 * tagsCommands: Tag command configuration
 *
 * Defines all tag-related CLI commands:
 * - list: List all tags
 * - create: Create a tag
 * - add: Add a tag to a document
 * - remove: Remove a tag from a document
 * - delete: Delete a tag
 * - info: Get document list associated with a specified tag
 */
const tagsCommands: Record<string, CommandConfig> = {
	list: {
		name: 'list',
		description: 'List all tags',
		usage: 'list [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: tagsListHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	},
	create: {
		name: 'create',
		description: 'Create a tag',
		usage: 'create --name <name> [--color <color>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'name',
				short: 'n',
				description: 'Tag name',
				required: true,
				type: 'string'
			},
			{
				name: 'color',
				short: 'c',
				description: 'Tag color (e.g. #3B82F6)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			}
		],
		handler: tagsCreateHandler,
		paramsMapper: (parsed) => ({
			name: parsed.name,
			color: parsed.color,
			workspace: parsed.workspace
		})
	},
	add: {
		name: 'add',
		description: 'Add a tag to a document',
		usage: 'add -d <doc-id> --tag <tag-name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'tag',
				short: 't',
				description: 'Tag name',
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
		handler: tagsDocAddHandler,
		paramsMapper: (parsed) => ({
			id: parsed.doc,
			tag: parsed.tag,
			workspace: parsed.workspace
		})
	},
	remove: {
		name: 'remove',
		description: 'Remove a tag from a document',
		usage: 'remove -d <doc-id> --tag <tag-name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'tag',
				short: 't',
				description: 'Tag name',
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
		handler: tagsDocRemoveHandler,
		paramsMapper: (parsed) => ({
			id: parsed.doc,
			tag: parsed.tag,
			workspace: parsed.workspace
		})
	},
	delete: {
		name: 'delete',
		description: 'Delete a tag',
		usage: 'delete --tag <tag-name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'tag',
				short: 't',
				description: 'Tag name',
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
		handler: tagsDeleteHandler,
		paramsMapper: (parsed) => ({
			tag: parsed.tag,
			workspace: parsed.workspace
		})
	},
	info: {
		name: 'info',
		description: 'Get document list associated with a specified tag',
		usage: 'info --tag <tag-name> [--workspace <workspace-id>] [--ignore-case]',
		args: [
			{
				name: 'tag',
				short: 't',
				description: 'Tag name',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID',
				type: 'string'
			},
			{
				name: 'ignore-case',
				short: 'i',
				description: 'Case-insensitive matching',
				type: 'boolean'
			}
		],
		handler: tagsDocListHandler,
		paramsMapper: (parsed) => ({
			tag: parsed.tag,
			workspace: parsed.workspace,
			ignoreCase: parsed['ignore-case']
		})
	}
};

/**
 * Tags CLI operation mapping
 */
export const runTagsCommands = generateCommandMap(tagsCommands);
