/**
 * Comments CLI module
 * Provides command-line interface for comment management
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';

import {
	listCommentsHandler,
	createCommentHandler,
	updateCommentHandler,
	deleteCommentHandler,
	resolveCommentHandler
} from '../core/comments.js';

/**
 * commentsCommands: Comment command configuration
 *
 * Defines all comment-related CLI commands:
 * - list: List document comments
 * - create: Create a comment
 * - update: Update comment content
 * - delete: Delete a comment
 * - resolve: Resolve/unresolve a comment
 */
const commentsCommands: Record<string, CommandConfig> = {
	list: {
		name: 'list',
		description: 'List document comments',
		usage: 'list --doc-id <id> [--workspace <workspace-id>] [--first <n>] [--offset <n>] [--full]',
		args: [
			{
				name: 'doc-id',
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
			},
			{
				name: 'first',
				short: 'n',
				description: 'Number of results',
				type: 'number'
			},
			{
				name: 'offset',
				short: 'o',
				description: 'Offset',
				type: 'number'
			},
			{
				name: 'full',
				short: 'f',
				description: 'Return full comment data',
				type: 'boolean'
			}
		],
		handler: listCommentsHandler,
		paramsMapper: (parsed) => {
			const params: any = { docId: parsed['doc-id'] };
			if (parsed.workspace) params.workspaceId = parsed.workspace;
			if (parsed.first) params.first = parsed.first;
			if (parsed.offset) params.offset = parsed.offset;
			if (parsed.full) params.full = parsed.full;
			return params;
		}
	},
	create: {
		name: 'create',
		description: 'Create a comment',
		usage: 'create --doc-id <id> --content <text> [--workspace <workspace-id>] [--selection <text>] [--doc-title <title>] [--doc-mode <mode>]',
		args: [
			{
				name: 'doc-id',
				short: 'd',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'Comment content',
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
				name: 'selection',
				short: 's',
				description: 'Quoted text snippet (will be searched and linked in the document)',
				type: 'string'
			},
			{
				name: 'doc-title',
				description: 'Document title',
				type: 'string'
			},
			{
				name: 'doc-mode',
				short: 'm',
				description: 'Document mode (page/edgeless)',
				type: 'string'
			}
		],
		handler: createCommentHandler,
		paramsMapper: (parsed) => {
			const params: any = { docId: parsed['doc-id'], content: parsed.content };
			if (parsed.workspace) params.workspaceId = parsed.workspace;
			if (parsed.selection) params.selection = parsed.selection;
			if (parsed['doc-title']) params.docTitle = parsed['doc-title'];
			if (parsed['doc-mode']) params.docMode = parsed['doc-mode'];
			return params;
		}
	},
	update: {
		name: 'update',
		description: 'Update a comment',
		usage: 'update --id <id> --content <text>',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Comment ID',
				required: true,
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'New comment content',
				required: true,
				type: 'string'
			}
		],
		handler: updateCommentHandler,
		paramsMapper: (parsed) => {
			return { id: parsed.id, content: parsed.content };
		}
	},
	delete: {
		name: 'delete',
		description: 'Delete a comment (also removes associated markers in the document)',
		usage: 'delete --id <id> [--workspace <workspace-id>] [--doc-id <id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Comment ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (optional, auto-fetched from comment)',
				type: 'string'
			},
			{
				name: 'doc-id',
				short: 'd',
				description: 'Document ID (optional, auto-fetched from comment)',
				type: 'string'
			}
		],
		handler: deleteCommentHandler,
		paramsMapper: (parsed) => {
			const params: any = { id: parsed.id };
			if (parsed.workspace) params.workspaceId = parsed.workspace;
			if (parsed['doc-id']) params.docId = parsed['doc-id'];
			return params;
		}
	},
	resolve: {
		name: 'resolve',
		description: 'Resolve/unresolve a comment',
		usage: 'resolve --id <id> --resolved <true|false>',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Comment ID',
				required: true,
				type: 'string'
			},
			{
				name: 'resolved',
				short: 'r',
				description: 'Whether resolved (true/false)',
				required: true,
				type: 'boolean'
			}
		],
		handler: resolveCommentHandler,
		paramsMapper: (parsed) => {
			// Handle boolean parsing: --resolved false needs to correctly parse as false
			const resolved = parsed.resolved === true || String(parsed.resolved) === 'true';
			return { id: parsed.id, resolved };
		}
	}
};

/**
 * Comments CLI operation mapping
 */
export const runCommentCommands = generateCommandMap(commentsCommands);
