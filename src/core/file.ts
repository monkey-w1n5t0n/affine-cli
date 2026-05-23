/**
 * File attachment core module
 * Handles file upload, delete, cleanup, and other operations
 *
 * Supported features:
 * 1. Upload files/content to workspace as attachments
 * 2. Delete specified attachments (supports soft delete and permanent delete)
 * 3. Clean up deleted attachments to release storage space
 */

import { createGraphQLClient } from '../utils/graphqlClient.js';
import { getWorkspaceId, loadConfig } from '../utils/config.js';
import { generateId } from '../utils/misc.js';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';

/* ============================================================================
 * Helper functions
 * ============================================================================ */

/**
 * Decode blob content
 *
 * Automatically detects whether input is Base64 encoded or plain text
 * If it looks like Base64, decodes it; otherwise treats as plain text
 *
 * @param content - Input content string
 * @returns Decoded Buffer
 *
 * @example
 * const buf = decodeBlobContent('SGVsbG8gV29ybGQ='); // Base64 "Hello World"
 * const buf2 = decodeBlobContent('Hello World');     // Plain text
 */
function decodeBlobContent(content: string): Buffer {
	const normalized = content.trim().replace(/\s+/g, '');
	const base64Like =
		normalized.length > 0 &&
		normalized.length % 4 === 0 &&
		/^[A-Za-z0-9+/=]+$/.test(normalized);
	if (base64Like) {
		try {
			const decoded = Buffer.from(normalized, 'base64');
			if (decoded.length > 0) {
				return decoded;
			}
		} catch {
			// Fall back to UTF-8 text
		}
	}
	return Buffer.from(content, 'utf8');
}

/* ============================================================================
 * Public interface
 * ============================================================================ */

/**
 * Upload attachment handler
 *
 * Uploads a file or content to the workspace as an attachment
 * Supports two modes:
 * 1. --file: Read file from filesystem
 * 2. --content: Pass Base64 encoded or text content directly
 *
 * @param params - Parameter object
 * @param params.file - File path (takes priority)
 * @param params.content - Base64 encoded content or text content
 * @param params.filename - Custom filename (optional)
 * @param params.contentType - MIME type (optional, default application/octet-stream)
 * @param params.workspace - Workspace ID (optional, defaults to configured workspace)
 * @returns Upload result, containing:
 *   - success: Whether successful
 *   - data: { id, key, workspaceId, filename, contentType, size, downloadUrl, uploadedAt }
 *
 * @throws Errors for file not found, missing parameters, upload failure, etc.
 *
 * @example
 * // Upload file
 * await fileUploadHandler({ file: '/path/to/image.png' });
 *
 * // Upload Base64 content
 * await fileUploadHandler({ content: 'base64...', filename: 'doc.pdf' });
 *
 * // Upload text content
 * await fileUploadHandler({ content: 'Hello World', filename: 'hello.txt', contentType: 'text/plain' });
 */
export async function fileUploadHandler(params: {
	file?: string;
	content?: string;
	filename?: string;
	contentType?: string;
	workspace?: string;
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = await getWorkspaceId(params.workspace);

	let content: string;
	let filename: string;

	if (params.file) {
		if (!fs.existsSync(params.file)) {
			throw new Error(`File not found: ${params.file}`);
		}
		content = fs.readFileSync(params.file).toString('base64');
		filename = params.filename || path.basename(params.file);
	} else if (params.content) {
		content = params.content;
		filename = params.filename || '-content';
	} else {
		throw new Error('Must provide --file or --content parameter');
	}

	const payload = decodeBlobContent(content);
	const uniqueId = generateId(12, 'file');
	const safeFilename = `${uniqueId}-${filename}`;
	const mime = params.contentType || 'application/octet-stream';

	const form = new FormData();
	form.append(
		'operations',
		JSON.stringify({
			query: `mutation SetBlob($workspaceId: String!, $blob: Upload!) {
        setBlob(workspaceId: $workspaceId, blob: $blob)
      }`,
			variables: {
				workspaceId,
				blob: null
			}
		})
	);
	form.append('map', JSON.stringify({ '0': ['variables.blob'] }));
	form.append('0', payload, { filename: safeFilename, contentType: mime });

	const endpoint = gql.endpoint;
	const headers = gql.headers;
	const cookie = gql.cookie;

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			...headers,
			Cookie: cookie,
			...form.getHeaders()
		},
		body: form as any
	});

	const result = (await response.json()) as any;
	if (result.errors?.length) {
		throw new Error(result.errors[0].message);
	}
	const blobKey = result.data?.setBlob;

	if (!blobKey) {
		throw new Error('Upload succeeded but no blob key was returned.');
	}

	const config = loadConfig();
	const baseUrl = config.baseUrl.replace(/\/$/, '');
	const downloadUrl = `${baseUrl}/api/workspaces/${workspaceId}/blobs/${blobKey}`;

	return {
		success: true,
		data: {
			id: blobKey,
			// key: blobKey,
			// workspaceId,
			filename: safeFilename,
			contentType: mime,
			size: payload.length,
			downloadUrl
			// uploadedAt: new Date().toISOString()
		}
	};
}

/**
 * Delete attachment handler
 *
 * Deletes the specified attachment, supports soft delete (default) and permanent delete
 * Soft delete only marks as deleted, can be cleaned up via clean command
 *
 * @param params - Parameter object
 * @param params.id - Attachment ID to delete (Blob key)
 * @param params.permanently - Whether to permanently delete (default false)
 * @param params.workspace - Workspace ID (optional)
 * @returns Deletion result { success, message }
 *
 * @throws Errors for deletion failure, etc.
 *
 * @example
 * // Soft delete (recoverable)
 * await fileDeleteHandler({ id: 'blob123' });
 *
 * // Permanent delete
 * await fileDeleteHandler({ id: 'blob123', permanently: true });
 */
export async function fileDeleteHandler(params: {
	id: string;
	permanently?: boolean;
	workspace?: string;
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = await getWorkspaceId(params.workspace);

	const mutation = `mutation DeleteBlob($workspaceId: String!, $key: String!, $permanently: Boolean) {
    deleteBlob(workspaceId: $workspaceId, key: $key, permanently: $permanently)
  }`;

	await gql.request<any>(mutation, {
		workspaceId,
		key: params.id,
		permanently: params.permanently || false
	});

	return {
		success: true,
		message: `Attachment ${params.id} ${params.permanently ? 'permanently ' : ''}deleted`
	};
}

/**
 * Clean deleted attachments handler
 *
 * Cleans up all attachments marked as deleted, releasing storage space
 * This operation is irreversible
 *
 * @param params - Parameter object
 * @param params.workspace - Workspace ID (optional)
 * @returns Cleanup result { success, blobsReleased, message }
 *
 * @example
 * await fileCleanHandler({ workspace: 'ws123' });
 */
export async function fileCleanHandler(params: { workspace?: string }): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = await getWorkspaceId(params.workspace);

	const mutation = `mutation ReleaseDeletedBlobs($workspaceId: String!) {
    releaseDeletedBlobs(workspaceId: $workspaceId)
  }`;

	const data = await gql.request<any>(mutation, { workspaceId });

	return {
		success: true,
		blobsReleased: data.releaseDeletedBlobs,
		message: `Cleaned up deleted attachments`
	};
}
