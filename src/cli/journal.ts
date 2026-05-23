/**
 * Journal CLI module
 * Provides command-line interface for journal management, including list, create, append, and more
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { convertToMarkdown } from '../utils/fileConverter.js';
import { isFilePath } from '../utils/misc.js';

import {
	journalListHandler,
	journalCreateHandler,
	journalAppendHandler,
	journalInfoHandler,
	journalUpdateHandler
} from '../core/journal.js';

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

	if (isFilePath(contentValue)) {
		const filePath = contentValue.slice(1);
		return convertToMarkdown(filePath);
	}

	return contentValue;
}

/**
 * Journal command configuration
 * Defines parameter and handler mappings for all journal-related commands
 */
const journalCommands: Record<string, CommandConfig> = {
	/**
	 * list command: list all journals in the workspace
	 * Usage: list [--count <n>] [--workspace <workspace-id>]
	 */
	list: {
		name: 'list',
		description: 'List all journals in the workspace (supports pagination)',
		usage: 'list [--count <n>] [--workspace <workspace-id>]',
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
			}
		],
		handler: journalListHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace,
			count: parsed.count
		})
	},

	/**
	 * create command: create a journal entry
	 * Usage: create [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--icon <emoji>] [--workspace <workspace-id>]
	 */
	create: {
		name: 'create',
		description: 'Create a new journal entry (defaults to today)',
		usage: 'create [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--icon <emoji>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'date',
				short: 'd',
				description: 'Journal date (defaults to today, format YYYY-MM-DD)',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'Journal content (Markdown format; prefix with @ for file path)',
				type: 'string'
			},
			{
				name: 'icon',
				short: 'I',
				description: 'Journal icon (emoji character, e.g. 🎯, 📝, 💡)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: journalCreateHandler,
		paramsMapper: (parsed) => ({
			date: parsed.date,
			content: parseContentParam(parsed.content),
			icon: parsed.icon,
			workspace: parsed.workspace
		})
	},

	/**
	 * append command: append content to a journal entry
	 * Usage: append [--id <doc-id>] [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--workspace <workspace-id>]
	 */
	append: {
		name: 'append',
		description: 'Append Markdown content to the end of a journal entry',
		usage: 'append [--id <doc-id>] [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Journal document ID (use either this or the date parameter)',
				type: 'string'
			},
			{
				name: 'date',
				short: 'd',
				description: 'Journal date (defaults to today, format YYYY-MM-DD, use either this or the id parameter)',
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
		handler: journalAppendHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			date: parsed.date,
			content: parseContentParam(parsed.content),
			workspace: parsed.workspace
		})
	},

	/**
	 * info command: get journal entry details
	 * Usage: info --id <doc-id> [--workspace <workspace-id>]
	 */
	info: {
		name: 'info',
		description: 'Get journal entry details (includes Markdown content)',
		usage: 'info --id <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Journal document ID (use either this or the date parameter)',
				type: 'string'
			},
			{
				name: 'date',
				short: 'd',
				description: 'Journal date (format YYYY-MM-DD, use either this or the id parameter)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: journalInfoHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			date: parsed.date,
			workspace: parsed.workspace
		})
	},

	/**
	 * update command: update journal entry content (full replacement)
	 * Usage: update --id <doc-id> [--content <markdown|@file>] [--icon <emoji>] [--workspace <workspace-id>]
	 */
	update: {
		name: 'update',
		description: 'Fully update journal entry content (replaces entire document)',
		usage: 'update --id <doc-id> [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--icon <emoji>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Journal document ID (use either this or the date parameter)',
				type: 'string'
			},
			{
				name: 'date',
				short: 'd',
				description: 'Journal date (format YYYY-MM-DD, use either this or the id parameter)',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'New journal content (Markdown format; prefix with @ for file path)',
				type: 'string'
			},
			{
				name: 'icon',
				short: 'I',
				description: 'Journal icon (emoji character, e.g. 🎯, 📝, 💡)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: journalUpdateHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			date: parsed.date,
			content: parseContentParam(parsed.content),
			icon: parsed.icon,
			workspace: parsed.workspace
		})
	}
};

/**
 * Journal CLI operation mapping
 * Converts command configuration to command mapping for use by the CLI entry point
 */
export const runJournalCommands = generateCommandMap(journalCommands);
