/**
 * Document CLI module
 * Provides command-line interface for document management, including list, details, create, delete, copy, update, search, replace, and append
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { convertToMarkdown } from '../utils/fileConverter.js';
import { isFilePath } from '../utils/misc.js';

import {
	docAllHandler,
	docInfoHandler,
	docCreateHandler,
	docDeleteHandler,
	docCopyHandler,
	docUpdateHandler,
	docSearchHandler,
	docReplaceHandler,
	docAppendHandler,
	docPublishHandler,
	docUnpublishHandler
} from '../core/docs.js';

/**
 * Parse content parameter
 * Supports --content for direct input or file paths starting with @
 *
 * @param contentValue - --content parameter value (supports @filePath format)
 * @returns Parsed content string
 */
function parseContentParam(contentValue?: string): string {
	if (!contentValue) {
		return '';
	}

	// Check if it's a valid file path format
	if (isFilePath(contentValue)) {
		const filePath = contentValue.slice(1);
		return convertToMarkdown(filePath);
	}

	return contentValue;
}

/**
 * Document command configuration
 * Defines parameter and handler mappings for all document-related commands
 */
const docCommands: Record<string, CommandConfig> = {
	/**
	 * all command: list all documents in the workspace, including deleted document records
	 * Usage: all [--count <n>] [--skip <n>] [--after <cursor>] [--workspace <workspace-id>]
	 */
	all: {
		name: 'all',
		description: 'List all documents in the workspace, including deleted document records (supports pagination)',
		usage: 'all [--count <n>] [--skip <n>] [--after <cursor>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'count',
				short: 'c',
				description: 'Number of results per page (default 50)',
				type: 'number'
			},
			{
				name: 'skip',
				short: 's',
				description: 'Offset (for skipping preceding documents)',
				type: 'number'
			},
			{
				name: 'after',
				short: 'a',
				description: 'Cursor value (for pagination, fetch next page)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: docAllHandler,
		paramsMapper: (parsed) => ({
			count: parsed.count,
			skip: parsed.skip,
			after: parsed.after,
			workspace: parsed.workspace
		})
	},
	/**
	 * list command: list all documents in the workspace
	 * Usage: list [--count <n>] [--skip <n>] [--after <cursor>] [--workspace <workspace-id>]
	 */
	list: {
		name: 'list',
		description: 'List all documents in the workspace (supports pagination)',
		usage: 'list [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			},
			{
				name: 'count',
				short: 'c',
				description: 'Number of results to return (default 20)',
				type: 'number'
			},
			{
				name: 'tag',
				short: 't',
				description: 'Tag',
				type: 'string'
			}
		],
		handler: docSearchHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace,
			count: parsed.count,
			tag: parsed.tag
		})
	},

	/**
	 * info command: get document details
	 * Usage: info --id <doc-id> [--workspace <workspace-id>] [--content <mode>]
	 */
	info: {
		name: 'info',
		description: 'Get detailed information for the specified document (including content and metadata)',
		usage: 'info --id <doc-id> [--workspace <workspace-id>] [--content <mode>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'Content output mode: markdown(default)/raw/hidden',
				type: 'string'
			}
		],
		handler: docInfoHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace,
			content: parsed.content || 'markdown'
		})
	},

	/**
	 * create command: create a document
	 * Usage: create --title <title> [--content <markdown|@file>] [--folder <folder-id>] [--tags <tag1,tag2>] [--icon <emoji>] [--workspace <workspace-id>]
	 */
	create: {
		name: 'create',
		description: 'Create a new document (supports import from Markdown file)',
		usage: 'create --title <title> [--content <markdown|@file>] [--folder <folder-id>] [--tags <tag1,tag2>] [--icon <emoji>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'title',
				short: 't',
				description: 'Document title (required)',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'Document content (Markdown format; prefix with @ for file path)',
				type: 'string'
			},
			{
				name: 'folder',
				short: 'f',
				description: 'Folder ID where the document resides (optional)',
				type: 'string'
			},
			{
				name: 'tags',
				description: 'Tag list (comma-separated, e.g. "tag1,tag2")',
				type: 'string'
			},
			{
				name: 'icon',
				short: 'I',
				description: 'Document icon (emoji character, e.g. 🎯, 📝, 💡)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: docCreateHandler,
		paramsMapper: (parsed) => ({
			title: parsed.title,
			content: parseContentParam(parsed.content),
			folder: parsed.folder,
			tags: parsed.tags,
			icon: parsed.icon,
			workspace: parsed.workspace
		})
	},

	/**
	 * search command: search documents
	 * Usage: search [--query <keyword>] [--workspace <workspace-id>] [--count <n>] [--match-mode <mode>] [--tag <tag>]
	 */
	search: {
		name: 'search',
		description: 'Search for keywords in documents (supports tag filtering)',
		usage: 'search [--query <keyword>] [--workspace <workspace-id>] [--count <n>] [--match-mode <mode>] [--tag <tag>]',
		args: [
			{
				name: 'query',
				short: 'q',
				description: 'Search keyword (can be combined with --tag)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			},
			{
				name: 'count',
				short: 'c',
				description: 'Number of results to return (default 20)',
				type: 'number'
			},
			{
				name: 'match-mode',
				short: 'm',
				description: 'Match mode: substring(contains)/prefix/suffix/exact',
				default: 'substring',
				type: 'string'
			},
			{
				name: 'tag',
				description: 'Filter by tag (can be combined with --query)',
				type: 'string'
			}
		],
		handler: docSearchHandler,
		paramsMapper: (parsed) => ({
			query: parsed.query,
			workspace: parsed.workspace,
			count: parsed.count,
			matchMode: parsed['match-mode'],
			tag: parsed.tag
		})
	},

	/**
	 * delete command: delete a document
	 * Usage: delete --id <doc-id> [--workspace <workspace-id>]
	 */
	delete: {
		name: 'delete',
		description: 'Delete the specified document',
		usage: 'delete --id <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Document ID to delete',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: docDeleteHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace
		})
	},

	/**
	 * copy command: copy a document
	 * Usage: copy --id <doc-id> [--title <title>] [--parent <parent-id>] [--folder <folder-id>] [--workspace <workspace-id>]
	 */
	copy: {
		name: 'copy',
		description: 'Copy an existing document as a new document',
		usage: 'copy --id <doc-id> [--title <title>] [--parent <parent-id>] [--folder <folder-id>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Source document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'title',
				short: 't',
				description: 'Title for the new document (uses original title if not specified)',
				type: 'string'
			},
			{
				name: 'parent',
				short: 'p',
				description: 'Parent document ID (creates as child document)',
				type: 'string'
			},
			{
				name: 'folder',
				short: 'f',
				description: 'Target folder ID',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: docCopyHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			title: parsed.title,
			parent: parsed.parent,
			folder: parsed.folder,
			workspace: parsed.workspace
		})
	},

	/**
	 * update command: update document properties
	 * Usage: update --id <doc-id> [--title <title>] [--parent <parent-id>] [--folder <folder-id>] [--icon <emoji>] [--workspace <workspace-id>]
	 */
	update: {
		name: 'update',
		description: 'Update document properties (title, parent-child relationship, folder, icon)',
		usage: 'update --id <doc-id> [--title <title>] [--parent <parent-id>] [--folder <folder-id>] [--icon <emoji>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Document ID to update',
				required: true,
				type: 'string'
			},
			{
				name: 'title',
				short: 't',
				description: 'New document title',
				type: 'string'
			},
			{
				name: 'parent',
				short: 'p',
				description: 'New parent document ID (can remove parent-child relationship)',
				type: 'string'
			},
			{
				name: 'folder',
				short: 'f',
				description: 'New target folder for the document',
				type: 'string'
			},
			{
				name: 'icon',
				short: 'I',
				description: 'Document icon (emoji character, e.g. 🎯, 📝, 💡)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: docUpdateHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			title: parsed.title,
			parent: parsed.parent,
			folder: parsed.folder,
			icon: parsed.icon,
			workspace: parsed.workspace
		})
	},

	/**
	 * replace command: replace document content
	 * Usage: replace --id <doc-id> --search <text> --replace <text> [--workspace <workspace-id>] [--match-all] [--preview]
	 */
	replace: {
		name: 'replace',
		description: 'Replace specified text in a document',
		usage: 'replace --id <doc-id> --search <text> --replace <text> [--workspace <workspace-id>] [--match-all] [--preview]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'search',
				short: 's',
				description: 'Text to search and replace',
				required: true,
				type: 'string'
			},
			{
				name: 'replace',
				short: 'r',
				description: 'Replacement text',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			},
			{
				name: 'match-all',
				short: 'a',
				description: 'Replace all matches (default true)',
				type: 'boolean'
			},
			{
				name: 'preview',
				short: 'p',
				description: 'Preview mode (show replacement results without making changes)',
				type: 'boolean'
			}
		],
		handler: docReplaceHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			search: parsed.search,
			replace: parsed.replace,
			workspace: parsed.workspace,
			matchAll: parsed['match-all'],
			preview: parsed.preview
		})
	},

	/**
	 * append command: append content to a document
	 * Usage: append --id <doc-id> [--content <markdown|@file>] [--workspace <workspace-id>]
	 */
	append: {
		name: 'append',
		description: 'Append Markdown content to the end of a document',
		usage: 'append --id <doc-id> [--content <markdown|@file>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Target document ID',
				required: true,
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'Markdown content to append (prefix with @ for file path)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: docAppendHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			content: parseContentParam(parsed.content),
			workspace: parsed.workspace
		})
	},

	/**
	 * publish command: publish a document (public access)
	 * Usage: publish --id <doc-id> [--mode <Page|Edgeless>] [--workspace <workspace-id>]
	 */
	publish: {
		name: 'publish',
		description: 'Publish a document (public access)',
		usage: 'publish --id <doc-id> [--mode <Page|Edgeless>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Document ID to publish',
				required: true,
				type: 'string'
			},
			{
				name: 'mode',
				short: 'm',
				description: 'Public mode: Page or Edgeless',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: docPublishHandler,
		paramsMapper: (parsed) => ({
			docId: parsed.id,
			mode: parsed.mode as 'Page' | 'Edgeless' | undefined,
			workspace: parsed.workspace
		})
	},

	/**
	 * unpublish command: unpublish a document
	 * Usage: unpublish --id <doc-id> [--workspace <workspace-id>]
	 */
	unpublish: {
		name: 'unpublish',
		description: 'Unpublish a document',
		usage: 'unpublish --id <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Document ID to unpublish',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: docUnpublishHandler,
		paramsMapper: (parsed) => ({
			docId: parsed.id,
			workspace: parsed.workspace
		})
	}
};

/**
 * Document CLI operation mapping
 * Converts command configuration to command mapping for use by the CLI entry point
 */
export const runDocCommands = generateCommandMap(docCommands);
