/**
 * File attachment CLI module
 * Provides command-line interface for file upload, delete, clean, and more
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { fileUploadHandler, fileDeleteHandler, fileCleanHandler } from '../core/file.js';

/**
 * File command configuration
 * Defines parameter and handler mappings for all file-related commands
 */
const fileCommands: Record<string, CommandConfig> = {
	/**
	 * upload command: upload an attachment
	 * Usage: upload [--file <path>] [--content <base64>] [--filename <name>] [--content-type <mime>] [--workspace <workspace-id>]
	 */
	upload: {
		name: 'upload',
		description: 'Upload an attachment to the workspace',
		usage: 'upload [--file <path>] [--content <base64>] [--filename <name>] [--content-type <mime>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'file',
				short: 'f',
				description: 'File path to upload',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'Base64-encoded content or direct text content',
				type: 'string'
			},
			{
				name: 'filename',
				short: 'n',
				description: 'Filename (uses original filename or "content" if not specified)',
				type: 'string'
			},
			{
				name: 'content-type',
				description: 'MIME type (auto-detected or defaults to application/octet-stream if not specified)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: fileUploadHandler,
		paramsMapper: (parsed) => ({
			file: parsed.file,
			content: parsed.content,
			filename: parsed.filename,
			contentType: parsed['content-type'],
			workspace: parsed.workspace
		})
	},

	/**
	 * delete command: delete an attachment
	 * Usage: delete --id <blob-id> [--permanently] [--workspace <workspace-id>]
	 */
	delete: {
		name: 'delete',
		description: 'Delete the specified attachment',
		usage: 'delete --id <blob-id> [--permanently] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: 'Attachment ID to delete (Blob key)',
				required: true,
				type: 'string'
			},
			{
				name: 'permanently',
				short: 'p',
				description: 'Permanently delete (default only marks as deleted)',
				type: 'boolean'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: fileDeleteHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			permanently: parsed.permanently,
			workspace: parsed.workspace
		})
	},

	/**
	 * clean command: clean up deleted attachments
	 * Usage: clean [--workspace <workspace-id>]
	 */
	clean: {
		name: 'clean',
		description: 'Clean up attachments marked as deleted to free storage space',
		usage: 'clean [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (uses configured workspace by default)',
				type: 'string'
			}
		],
		handler: fileCleanHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	}
};

/**
 * File CLI operation mapping
 * Converts command configuration to command mapping for use by the CLI entry point
 */
export const runFileCommands = generateCommandMap(fileCommands);
