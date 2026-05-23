/**
 * Document core module
 * Handles CRUD, search, copy, update, append, and other document operations
 */

import { createGraphQLClient } from '../utils/graphqlClient.js';
import { getWorkspaceId, getBaseUrl } from '../utils/config.js';
import {
	createDocFromMarkdownCore,
	collectDocForMarkdown,
	findBlockById,
	ensureNoteBlock,
	resolveInsertContext,
	markdownOperationToAppendInput,
	normalizeAppendBlockInput,
	createBlock,
	setDocEmojiIcon
} from '../utils/docsUtil.js';
import { getWorkspaceTagOptions } from '../core/tags.js';
import {
	getWorkspaceDocs,
	createWorkspaceSocket,
	joinWorkspace,
	loadDoc,
	fetchYDoc,
	updateYDoc,
	extractTagNames
} from '../utils/wsClient.js';
import { renderBlocksToMarkdown } from '../markdown/render.js';
import { parseMarkdownToOperations } from '../markdown/parse.js';
import { generateId } from '../utils/misc.js';
import * as fs from 'fs';
import * as Y from 'yjs';

/**
 * docAllHandler: List all documents in the workspace, including deleted document records
 *
 * Description:
 * - Fetches document list via GraphQL API
 * - Fetches real-time document title info via WebSocket
 * - Returns pagination info and document metadata
 *
 * @param params.count - Number of results per page, default 50
 * @param params.skip - Number of records to skip, for pagination
 * @param params.after - Cursor, for pagination
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Returns total document count, whether there is a next page, cursor, and document list
 *
 * Notes:
 * - Document title prefers the WebSocket real-time title, falling back to the GraphQL title
 * - If neither has a title, returns 'Untitled'
 */
export async function docAllHandler(params: {
	count?: number;
	skip?: number;
	after?: string;
	workspace?: string;
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = getWorkspaceId(params.workspace);

	const first = params.count || 50;
	const offset = params.skip || 0;
	const after = params.after || null;

	const query = `query ListDocs($workspaceId: String!, $first: Int, $offset: Int, $after: String) {
    workspace(id: $workspaceId) {
      docs(pagination: { first: $first, offset: $offset, after: $after }) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            workspaceId
            public
            defaultRole
            createdAt
            updatedAt
          }
        }
      }
    }
  }`;

	const data = await gql.request<any>(query, {
		workspaceId,
		first,
		offset,
		after
	});

	const docs = data.workspace.docs;
	const pagesInfo = await getWorkspaceDocs(workspaceId);

	const edges = docs.edges.map((edge: any) => {
		const pageInfo = pagesInfo.get(edge.node.id);
		return {
			cursor: edge.cursor,
			node: {
				...edge.node,
				title: pageInfo?.title || '',
				deleted: !pageInfo
			}
		};
	});

	return {
		total: docs.totalCount,
		hasNextPage: docs.pageInfo.hasNextPage,
		endCursor: docs.pageInfo.endCursor,
		docs: edges.map((e: any) => e.node)
	};
}

/**
 * docInfoHandler: Get detailed info for a single document
 *
 * Description:
 * - Fetches document metadata via GraphQL (title, summary, creation time, etc.)
 * - Fetches real-time document content and tags via WebSocket connection
 * - Supports three content output modes: markdown (default), raw, hidden
 *
 * @param params.id - Document ID (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @param params.content - Content output mode:
 *   - markdown (default): output rendered Markdown format
 *   - raw: output raw blocks data
 *   - hidden: output metadata only, no content
 * @returns Object containing document metadata and optional content
 *
 * Notes:
 * - hidden mode does not establish a WebSocket connection, returns metadata directly
 * - Tag info is extracted from workspace metadata
 * - raw mode returns blocksById and blockCount
 * - markdown mode returns rendered result, warnings, stats, and lossy flag
 */
export async function docInfoHandler(params: {
	id: string;
	workspace?: string;
	content?: 'markdown' | 'raw' | 'hidden';
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = getWorkspaceId(params.workspace);

	const query = `query GetDoc($workspaceId: String!, $docId: String!) {
    workspace(id: $workspaceId) {
      doc(docId: $docId) {
        id
        workspaceId
        title
        summary
        public
        defaultRole
        createdAt
        updatedAt
        mode
      }
    }
  }`;

	const data = await gql.request<any>(query, {
		workspaceId,
		docId: params.id
	});

	const doc = data.workspace.doc;
	if (!doc) {
		throw new Error(`Document ${params.id} does not exist`);
	}

	const pagesInfo = await getWorkspaceDocs(workspaceId);
	const pageInfo = pagesInfo.get(params.id);

	const result: any = {
		id: doc.id,
		title: pageInfo?.title || doc.title || 'Untitled',
		summary: doc.summary,
		public: doc.public,
		mode: doc.mode,
		tags: pageInfo?.tags || [],
		createdAt: new Date(doc.createdAt).toLocaleString('zh-CN'),
		updatedAt: new Date(doc.updatedAt).toLocaleString('zh-CN')
	};

	// Default to markdown mode
	const contentMode = params.content || 'markdown';

	// hidden mode: no content output
	if (contentMode === 'hidden') {
		return result;
	}

	// Connect WebSocket to get document content
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// Load document content
		const snap = await loadDoc(socket, workspaceId, params.id);
		if (snap.missing) {
			const doc = new Y.Doc();
			Y.applyUpdate(doc, Buffer.from(snap.missing, 'base64'));

			const collected = collectDocForMarkdown(doc);

			if (contentMode === 'raw') {
				// raw mode: output raw blocks data
				result.blocks = Object.fromEntries(collected.blocksById);
				result.blockCount = collected.blocksById.size;
			} else {
				// markdown mode (default): output Markdown
				const rendered = renderBlocksToMarkdown({
					rootBlockIds: collected.rootBlockIds,
					blocksById: collected.blocksById
				});

				result.markdown = rendered.markdown;
				result.markdownWarnings = rendered.warnings;
				result.markdownStats = rendered.stats;
				result.lossy = rendered.lossy;
			}
		}
	} finally {
	}

	return result;
}

/**
 * docCreateHandler: Create a new document
 *
 * Description:
 * - Creates a new document using Markdown import
 * - Supports setting title, content, folder, and tags
 * - Internally calls createDocFromMarkdownCore to complete creation
 *
 * @param params.title - Document title (optional)
 * @param params.content - Document content, supports Markdown format (optional)
 * @param params.folder - Parent folder ID (optional)
 * @param params.tags - Tags, comma-separated (optional)
 * @param params.icon - Document icon (emoji character) (optional)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing creation result, including document ID, title, tags, etc.
 *
 * Notes:
 * - If no title is provided, creates document with default empty title
 * - If no content is provided, creates empty document
 * - Return result includes warnings and lossy flags to indicate potential content loss
 */
export async function docCreateHandler(params: {
	title?: string;
	content?: string;
	folder?: string;
	tags?: string;
	icon?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);

	let markdown = params.content || '';

	// Only use title if explicitly provided; otherwise let createDocFromMarkdownCore auto-generate it
	const title = params.title;

	const result = await createDocFromMarkdownCore({
		workspaceId,
		title: title,
		markdown,
		tags: params.tags,
		folder: params.folder
	});

	// If icon is provided, set document icon
	if (params.icon) {
		await setDocEmojiIcon(workspaceId, result.docId, params.icon);
	}

	return {
		success: true,
		docId: result.docId
	};
}

/**
 * docDeleteHandler: Delete a document
 *
 * Description:
 * - Operates on the Yjs document via WebSocket connection
 * - Removes the document reference from the workspace pages list
 * - The actual delete operation marks the document as deleted
 *
 * @param params.id - Document ID to delete (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Deletion result object
 *
 * Notes:
 * - This only removes the document reference from the workspace pages list
 * - Actual document data may still exist on the server
 * - Requires a WebSocket connection to perform deletion
 */
export async function docDeleteHandler(params: { id: string; workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		const wsDoc = new Y.Doc();
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);
		if (!snapshot.missing) {
			throw new Error('Workspace root document does not exist');
		}

		Y.applyUpdate(wsDoc, Buffer.from(snapshot.missing, 'base64'));
		const prevSV = Y.encodeStateVector(wsDoc);
		const wsMeta = wsDoc.getMap('meta');
		const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

		if (pages) {
			let foundIndex = -1;
			pages.forEach((page: Y.Map<any>, index: number) => {
				if (page.get('id') === params.id) {
					foundIndex = index;
				}
			});

			if (foundIndex !== -1) {
				pages.delete(foundIndex, 1);
			}
		}

		await updateYDoc(socket, workspaceId, workspaceId, wsDoc, prevSV);

		return {
			success: true,
			message: `Document ${params.id} deleted`
		};
	} finally {
	}
}

/**
 * docCopyHandler: Copy a document
 *
 * Description:
 * - Copies source document content to a new document
 * - Preserves source document tags and parent document info
 * - Supports custom title, target parent document, and folder for the new document
 * - Internally completes the copy via WebSocket + Yjs
 *
 * @param params.id - Source document ID (required)
 * @param params.title - New document title, defaults to 'Copy of document'
 * @param params.parent - Parent document ID, new document will be a child of it (optional)
 * @param params.folder - Folder ID, new document will be placed in this folder (optional)
 *   - If not specified, inherits the source document's folder by default
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Result object containing new document ID and title
 *
 * Notes:
 * - Copy operation generates a new unique ID for the new document
 * - Source document tags are copied to the new document
 * - Source document parent info can be inherited or overridden
 * - Source document folder can be inherited or a new folder specified
 */
export async function docCopyHandler(params: {
	id: string;
	title?: string;
	parent?: string;
	folder?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const newDocId = generateId(12, 'doc');
	const newTitle = params.title || 'Copy of document';

	try {
		await joinWorkspace(socket, workspaceId);

		// Get source document info (tags and parent document)
		const sourceDocInfo = await getSourceDocInfo(socket, workspaceId, params.id);
		const sourceTags = sourceDocInfo.tags || [];
		const sourceParent = sourceDocInfo.parentId;

		// Get the folder containing the source document
		let sourceFolderId: string | null = null;
		if (!params.folder) {
			sourceFolderId = await getDocFolderId(socket, workspaceId, params.id);
		}

		const { doc: sourceDoc, exists: sourceSnapshotExists } = await fetchYDoc(
			socket,
			workspaceId,
			params.id
		);
		if (!sourceSnapshotExists) {
			throw new Error('Source document does not exist');
		}
		const sourceUpdate = Y.encodeStateAsUpdate(sourceDoc);

		const newDoc = new Y.Doc();
		Y.applyUpdate(newDoc, sourceUpdate);

		const blocks = newDoc.getMap('blocks');
		let foundPage = false;
		blocks.forEach((value: unknown, _: string) => {
			if (foundPage) return;
			if (value instanceof Y.Map) {
				const flavour = value.get('sys:flavour');
				if (flavour === 'affine:page') {
					const titleText = new Y.Text();
					titleText.insert(0, newTitle);
					value.set('prop:title', titleText);
					foundPage = true;
				}
			}
		});

		const meta = newDoc.getMap('meta');
		meta.set('id', newDocId);
		meta.set('title', newTitle);
		meta.set('createDate', Date.now());

		await updateYDoc(socket, workspaceId, newDocId, newDoc);

		const { doc: wsDoc, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
		const wsMeta = wsDoc.getMap('meta');

		let pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;
		if (!pages) {
			pages = new Y.Array<Y.Map<any>>();
			wsMeta.set('pages', pages);
		}

		// Copy source document tags
		const newTags = new Y.Array<any>();
		sourceTags.forEach((tagId: string) => {
			newTags.push([tagId]);
		});

		const entry = new Y.Map<any>();
		entry.set('id', newDocId);
		entry.set('title', newTitle);
		entry.set('createDate', Date.now());
		entry.set('tags', newTags);
		// Copy parent document ID (if any)
		if (params.parent) {
			entry.set('parentId', params.parent);
		} else if (sourceParent) {
			entry.set('parentId', sourceParent);
		}
		pages.push([entry as any]);

		await updateYDoc(socket, workspaceId, workspaceId, wsDoc, prevSV);

		// If no folder specified, inherit source document's folder; otherwise add to specified folder
		const targetFolderId = params.folder || sourceFolderId;
		if (targetFolderId) {
			await addDocToFolder(socket, workspaceId, newDocId, targetFolderId);
		}

		return {
			success: true,
			id: newDocId,
			title: newTitle
		};
	} finally {
	}
}

/**
 * getSourceDocInfo: Get source document info (tags and parent document ID)
 *
 * Description:
 * - Looks up the specified document's info from workspace metadata
 * - Extracts the tag ID list associated with the document
 * - Gets the parent document ID (if any)
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID to query
 * @returns Object containing tags (tag ID array) and parentId (parent document ID)
 *
 * Notes:
 * - Returned tags are tag IDs, not tag names
 * - If the document has no tags or parent, returns empty array and null
 */
async function getSourceDocInfo(
	socket: any,
	workspaceId: string,
	docId: string
): Promise<{
	tags: string[];
	parentId: string | null;
}> {
	const wsDoc = new Y.Doc();
	const wsSnapshot = await loadDoc(socket, workspaceId, workspaceId);
	if (!wsSnapshot.missing) {
		return { tags: [], parentId: null };
	}

	Y.applyUpdate(wsDoc, Buffer.from(wsSnapshot.missing, 'base64'));
	const wsMeta = wsDoc.getMap('meta');
	const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

	if (!pages) {
		return { tags: [], parentId: null };
	}

	for (let i = 0; i < pages.length; i++) {
		const entry = pages.get(i);
		if (entry.get('id') === docId) {
			const tagsArray = entry.get('tags') as Y.Array<any> | undefined;
			const tags: string[] = [];
			if (tagsArray) {
				for (let j = 0; j < tagsArray.length; j++) {
					const tagId = tagsArray.get(j);
					if (typeof tagId === 'string') {
						tags.push(tagId);
					}
				}
			}
			const parentId = entry.get('parentId') || null;
			return { tags, parentId };
		}
	}

	return { tags: [], parentId: null };
}

/**
 * getDocFolderId: Get the folder ID containing a document
 *
 * Description:
 * - Queries the workspace folder structure
 * - Iterates all folder links to find the folder pointing to the target document
 * - Returns the parent folder ID of the document
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @returns Folder ID, or null if the document is not in any folder
 *
 * Notes:
 * - Uses special document ID (db${workspaceId}$folders) to access folder data
 * - Iterates folder link records, looking for type='doc' and data=docId
 * - Returns the record's parentId, which is the folder containing the document
 */
async function getDocFolderId(
	socket: any,
	workspaceId: string,
	docId: string
): Promise<string | null> {
	const docId_special = `db$${workspaceId}$folders`;
	const { doc: doc } = await fetchYDoc(socket, workspaceId, docId_special);

	// const nodes: any[] = [];
	for (const key of doc.share.keys()) {
		if (!doc.share.has(key)) continue;
		const record = doc.getMap(key);
		if (!(record instanceof Y.Map)) continue;
		if (record.get('$$DELETED') === true || record.size === 0) continue;

		const type = record.get('type');
		const data = record.get('data');
		const parentId = record.get('parentId');

		if (type === 'doc' && data === docId) {
			const pid = parentId as string | null;
			return pid || null;
		}
	}

	return null;
}

/**
 * addDocToFolder: Add a document to a specified folder
 *
 * Description:
 * - Adds a new document link record to the folder's children
 * - Automatically calculates and assigns the correct sort index
 * - Updates folder data via WebSocket + Yjs
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID to add
 * @param folderId - Target folder ID
 *
 * Notes:
 * - Uses special document ID (db${workspaceId}$folders) to access folder data
 * - Finds the max index among folder children, sets new link index to maxIndex + 1
 * - Creates new link record with id, type, data, parentId, index fields
 */
async function addDocToFolder(
	socket: any,
	workspaceId: string,
	docId: string,
	folderId: string
): Promise<void> {
	const docId_special = `db$${workspaceId}$folders`;
	const { doc: doc } = await fetchYDoc(socket, workspaceId, docId_special);

	const nodes: any[] = [];
	for (const key of doc.share.keys()) {
		if (!doc.share.has(key)) continue;
		const record = doc.getMap(key);
		if (!(record instanceof Y.Map)) continue;
		if (record.get('$$DELETED') === true || record.size === 0) continue;

		nodes.push({
			id: key,
			type: record.get('type'),
			data: record.get('data'),
			parentId: record.get('parentId'),
			index: record.get('index')
		});
	}

	// Find the max index among folder children
	let maxIndex = 0;
	const folderChildren = nodes.filter((n: any) => n.parentId === folderId && n.type === 'doc');
	folderChildren.forEach((n: any) => {
		if (n.index && parseInt(n.index) > maxIndex) {
			maxIndex = parseInt(n.index);
		}
	});

	const linkId = generateId(12, 'link');
	const record = doc.getMap(linkId);
	record.set('id', linkId);
	record.set('type', 'doc');
	record.set('data', docId);
	record.set('parentId', folderId);
	record.set('index', String(maxIndex + 1));

	await updateYDoc(socket, workspaceId, docId_special, doc);
}

/**
 * docUpdateHandler: Update document properties
 *
 * Description:
 * - Supports updating document title, folder, and parent document
 * - Real-time updates via WebSocket + Yjs
 * - Title update simultaneously updates workspace metadata and the document itself
 * - Folder update removes from original folder first, then adds to new folder
 *
 * @param params.id - Document ID to update (required)
 * @param params.title - New title (optional)
 * @param params.parent - Parent document ID (optional, not yet implemented)
 * @param params.folder - Folder ID (optional)
 * @param params.icon - Document icon (emoji character) (optional)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing update results
 *
 * Notes:
 * - Title must not be empty, otherwise throws an error
 * - Folder update clears all existing folder associations first
 * - Parent document update is not yet implemented
 * - Return message lists all successful update operations
 */
export async function docUpdateHandler(params: {
	id: string;
	title?: string;
	parent?: string;
	folder?: string;
	icon?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		const results: string[] = [];

		// Update document icon
		if (params.icon) {
			await setDocEmojiIcon(workspaceId, params.id, params.icon);
			results.push('Icon updated');
		}

		// Update document title
		if (params.title) {
			const newTitle = params.title.trim();
			if (!newTitle) {
				throw new Error('Title must not be empty');
			}

			// Update document title in workspace metadata
			const wsSnap = await loadDoc(socket, workspaceId, workspaceId);
			if (wsSnap.missing) {
				const wsDoc = new Y.Doc();
				Y.applyUpdate(wsDoc, Buffer.from(wsSnap.missing, 'base64'));
				const prevSV = Y.encodeStateVector(wsDoc);
				const pages = wsDoc.getMap('meta').get('pages') as Y.Array<any> | undefined;
				if (pages) {
					pages.forEach((page: Y.Map<any>) => {
						if (page instanceof Y.Map && page.get('id') === params.id) {
							page.set('title', newTitle);
						}
					});
				}
				await updateYDoc(socket, workspaceId, workspaceId, wsDoc, prevSV);
			}

			// Update the title within the document itself
			const snap = await loadDoc(socket, workspaceId, params.id);
			if (snap.missing) {
				const doc = new Y.Doc();
				Y.applyUpdate(doc, Buffer.from(snap.missing, 'base64'));
				const prevSV = Y.encodeStateVector(doc);
				const blocks = doc.getMap('blocks') as Y.Map<any>;
				for (const [, raw] of blocks) {
					if (!(raw instanceof Y.Map)) continue;
					if (raw.get('sys:flavour') === 'affine:page') {
						const titleText = new Y.Text();
						titleText.insert(0, newTitle);
						raw.set('prop:title', titleText);
						break;
					}
				}
				await updateYDoc(socket, workspaceId, params.id, doc, prevSV);
			}

			results.push('Title updated');
		}

		// Update folder
		if (params.folder) {
			// First remove from original folder
			await removeDocFromAllFolders(socket, workspaceId, params.id);

			// Add to new folder
			const foldersDocId = `db$${workspaceId}$folders`;
			const { doc: foldersDoc } = await fetchYDoc(socket, workspaceId, foldersDocId);

			const nodes: any[] = [];
			for (const key of foldersDoc.share.keys()) {
				if (!foldersDoc.share.has(key)) continue;
				const record = foldersDoc.getMap(key);
				if (!(record instanceof Y.Map)) continue;
				if (record.get('$$DELETED') === true || record.size === 0) continue;
				nodes.push({
					id: key,
					type: record.get('type'),
					data: record.get('data'),
					parentId: record.get('parentId'),
					index: record.get('index')
				});
			}

			// Find the max index among folder children
			let maxIndex = 0;
			const folderChildren = nodes.filter(
				(n) => n.parentId === params.folder && n.type === 'doc'
			);
			folderChildren.forEach((n) => {
				if (n.index && parseInt(n.index) > maxIndex) {
					maxIndex = parseInt(n.index);
				}
			});

			// Create new link record
			const linkId = generateId(12, 'link');
			const record = foldersDoc.getMap(linkId);
			record.set('id', linkId);
			record.set('type', 'doc');
			record.set('data', params.id);
			record.set('parentId', params.folder);
			record.set('index', String(maxIndex + 1));

			await updateYDoc(socket, workspaceId, foldersDocId, foldersDoc);

			results.push('Folder updated');
		}

		// Update parent document
		if (params.parent) {
			// This needs to be implemented via embed-linked-doc
			results.push('Parent document update not yet implemented');
		}

		return {
			success: true,
			message: results.length > 0 ? results.join(', ') : 'No updates'
		};
	} finally {
	}
}

/**
 * removeDocFromAllFolders: Remove a document from all folders
 *
 * Description:
 * - Iterates all folder links in the workspace
 * - Finds all records pointing to the target document
 * - Sets the $$DELETED flag to true on those records for soft deletion
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID to remove
 *
 * Notes:
 * - Uses soft deletion by setting the $$DELETED flag
 * - Only pushes update when there are actual links to delete
 * - Uses special document ID (db${workspaceId}$folders) to access folder data
 */
async function removeDocFromAllFolders(
	socket: any,
	workspaceId: string,
	docId: string
): Promise<void> {
	const foldersDocId = `db$${workspaceId}$folders`;
	const { doc: foldersDoc } = await fetchYDoc(socket, workspaceId, foldersDocId);

	let hasChanges = false;

	for (const key of foldersDoc.share.keys()) {
		if (!foldersDoc.share.has(key)) continue;
		const record = foldersDoc.getMap(key);
		if (!(record instanceof Y.Map)) continue;

		const type = record.get('type');
		const data = record.get('data');

		// Find all records pointing to this document
		if (type === 'doc' && data === docId) {
			record.set('$$DELETED', true);
			hasChanges = true;
		}
	}

	if (hasChanges) {
		await updateYDoc(socket, workspaceId, foldersDocId, foldersDoc);
	}
}

/**
 * docSearchHandler: Search documents
 *
 * Description:
 * - Fetches all documents in the workspace via WebSocket
 * - Supports keyword search by title and ID
 * - Supports filtering by tags
 * - Supports multiple match modes: substring, prefix, suffix, exact
 *
 * @param params.query - Search keyword (optional)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @param params.count - Max number of results, default 20
 * @param params.matchMode - Match mode: substring/prefix/suffix/exact, default substring
 * @param params.tag - Filter by tag (optional, always uses contains match)
 * @returns Object containing match count and document list
 *
 * Notes:
 * - Tag filtering always uses contains match (case-insensitive)
 * - Keyword search supports configurable match modes, defaulting to substring match
 * - Search is performed on both title and document ID fields
 * - Results are sorted by document creation time descending (earliest first)
 */
export async function docSearchHandler(params: {
	query?: string;
	workspace?: string;
	count?: number;
	matchMode?: string;
	tag?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const limit = params.count || 20;
	const query = (params.query || '').trim();
	const matchMode = params.matchMode || 'substring';

	/**
	 * matches: Check if text matches based on match mode
	 *
	 * @param text - Text to check
	 * @param pattern - Match pattern
	 * @returns Whether it matches
	 *
	 * Supported match modes:
	 * - substring: substring contains match (default)
	 * - prefix: prefix match
	 * - suffix: suffix match
	 * - exact: exact match (case-insensitive)
	 */
	function matches(text: string, pattern: string): boolean {
		const t = text.toLowerCase();
		const p = pattern.toLowerCase();

		switch (matchMode) {
			case 'prefix':
				return t.startsWith(p);
			case 'suffix':
				return t.endsWith(p);
			case 'exact':
				return t === p;
			case 'substring':
			default:
				return t.includes(p);
		}
	}

	try {
		await joinWorkspace(socket, workspaceId);

		// Get workspace metadata
		const { doc: wsDoc, exists: wsSnapExists } = await fetchYDoc(
			socket,
			workspaceId,
			workspaceId
		);
		if (!wsSnapExists) {
			return {
				totalCount: 0,
				documents: []
			};
		}
		const wsMeta = wsDoc.getMap('meta');
		const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

		if (!pages) {
			return {
				totalCount: 0,
				documents: []
			};
		}

		// Collect document info
		const allDocs: any[] = [];
		const tagOptions = getWorkspaceTagOptions(wsMeta);

		pages.forEach((page: Y.Map<any>) => {
			const docId = page.get('id');
			const title = page.get('title') || '';
			const tagsArray = page.get('tags');
			const createDate = page.get('createDate');
			const updateDate = page.get('updateDate');

			// Extract tag names
			const tagNames: string[] = [];
			if (tagsArray) {
				extractTagNames(tagsArray, tagOptions).forEach((name) => tagNames.push(name));
			}

			allDocs.push({
				id: docId,
				title,
				tags: tagNames,
				createDate,
				updateDate
			});
		});

		// Filter matching results
		let results = allDocs;

		// Filter by tag (tag always uses contains match)
		if (params.tag) {
			results = results.filter((doc) =>
				doc.tags.some((t: string) => t.toLowerCase().includes(params.tag!.toLowerCase()))
			);
		}

		// Search by keyword (supports match modes)
		if (query) {
			results = results.filter((doc) => {
				const titleMatch = matches(doc.title, query);
				const idMatch = matches(doc.id, query);
				return titleMatch || idMatch;
			});
		}

		// Limit result count
		results = results.slice(0, limit);

		return {
			totalCount: results.length,
			documents: results
		};
	} finally {
	}
}

/**
 * docReplaceHandler: Replace document content
 *
 * Description:
 * - Searches and replaces specified content across all text blocks in the document
 * - Supports handling Y.Text type and array format (deltas) text
 * - Supports preview mode and replace-all/replace-first
 * - Replacement preserves original text attributes
 *
 * @param params.id - Document ID to operate on (required)
 * @param params.search - Text to search and replace (required)
 * @param params.replace - Replacement text (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @param params.matchAll - Whether to replace all matches, default true
 * @param params.preview - Whether to preview only without executing replacement, default false
 * @returns Object containing replacement results
 *
 * Notes:
 * - search text must not be empty
 * - matchAll defaults to true, replacing all matches
 * - Preview mode returns affected block list without executing replacement
 * - Non-preview mode returns affected block count
 * - Only processes text-type blocks (paragraph, list, code, page, note, callout)
 */
export async function docReplaceHandler(params: {
	id: string;
	search: string;
	replace: string;
	workspace?: string;
	matchAll?: boolean;
	preview?: boolean;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const searchText = params.search;
	const replaceText = params.replace;
	// Default to true, handle boolean or string 'false'
	const matchAllValue = params.matchAll;
	const matchAll = matchAllValue !== false && String(matchAllValue) !== 'false';

	if (!searchText) {
		throw new Error('Search text must not be empty');
	}

	try {
		await joinWorkspace(socket, workspaceId);

		// Load document
		const {
			doc: doc,
			exists: snapExists,
			prevSV: prevSV
		} = await fetchYDoc(socket, workspaceId, params.id);
		if (!snapExists) {
			throw new Error(`Document ${params.id} does not exist`);
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		let replaceCount = 0;
		const affectedBlocks: string[] = [];

		// Iterate all blocks
		for (const [blockId, blockRaw] of blocks.entries()) {
			if (!(blockRaw instanceof Y.Map)) continue;

			const flavour = blockRaw.get('sys:flavour');
			// Only process text-type blocks
			if (
				![
					'affine:paragraph',
					'affine:list',
					'affine:code',
					'affine:page',
					'affine:note',
					'affine:callout'
				].includes(flavour)
			) {
				continue;
			}

			const textProp = blockRaw.get('prop:text');
			if (!textProp) continue;

			// Handle Y.Text type
			if (textProp instanceof Y.Text) {
				const fullText = textProp.toString();
				const occurrences = matchAll
					? countOccurrences(fullText, searchText)
					: fullText.includes(searchText)
						? 1
						: 0;

				if (occurrences > 0) {
					replaceCount += occurrences;
					affectedBlocks.push(blockId);

					if (!params.preview) {
						// Execute replacement
						let newText = fullText;
						if (matchAll) {
							newText = replaceAll(newText, searchText, replaceText);
						} else {
							newText = newText.replace(searchText, replaceText);
						}

						// Replace Y.Text content
						textProp.delete(0, textProp.length);
						textProp.insert(0, newText);
					}
				}
			}
			// Handle array format deltas
			else if (Array.isArray(textProp)) {
				let fullText = '';
				for (const delta of textProp) {
					if (typeof delta === 'object' && delta.insert) {
						fullText += delta.insert;
					} else if (typeof delta === 'string') {
						fullText += delta;
					}
				}

				const occurrences = matchAll
					? countOccurrences(fullText, searchText)
					: fullText.includes(searchText)
						? 1
						: 0;

				if (occurrences > 0) {
					replaceCount += occurrences;
					affectedBlocks.push(blockId);

					if (!params.preview) {
						// Need to rebuild deltas
						let newText = fullText;
						if (matchAll) {
							newText = replaceAll(newText, searchText, replaceText);
						} else {
							newText = newText.replace(searchText, replaceText);
						}

						// Convert to deltas format
						const newDeltas: any[] = [];
						if (newText.length > 0) {
							// Try to preserve original attributes
							const firstDelta = textProp.find(
								(d: any) => typeof d === 'object' && d.attributes
							);
							newDeltas.push({
								insert: newText,
								...(firstDelta?.attributes
									? { attributes: { ...firstDelta.attributes } }
									: {})
							});
						}

						blockRaw.set('prop:text', newDeltas);
						replaceCount += occurrences;
						affectedBlocks.push(blockId);
					}
				}
			}
		}

		// If not preview mode, push update
		if (!params.preview && replaceCount > 0) {
			await updateYDoc(socket, workspaceId, params.id, doc, prevSV);
		}

		return {
			success: true,
			replaceCount,
			affectedBlocks: params.preview ? affectedBlocks : affectedBlocks.length,
			mode: params.preview ? 'preview' : 'applied',
			preview: params.preview || false
		};
	} finally {
	}
}

/**
 * countOccurrences: Count occurrences of a substring in a string
 *
 * @param str - Original string
 * @param search - Substring to find
 * @returns Number of occurrences of the substring in the string
 */
function countOccurrences(str: string, search: string): number {
	if (!search) return 0;
	let count = 0;
	let pos = 0;
	while ((pos = str.indexOf(search, pos)) !== -1) {
		count++;
		pos += search.length;
	}
	return count;
}

/**
 * Replace all matches
 */
function replaceAll(str: string, search: string, replace: string): string {
	if (!search) return str;
	return str.split(search).join(replace);
}

/**
 * docAppendHandler: Append Markdown content to document
 *
 * Description:
 * - Appends Markdown content to the end of an existing document
 * - Supports reading content from file path or passing content string directly
 * - Parses Markdown into Yjs operations, then applies to document
 * - Automatically handles note block creation (if not present)
 *
 * @param params.id - Target document ID (required)
 * @param params.content - Content to append, can be Markdown text or file path (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing append results
 *
 * Notes:
 * - If content is a file path, file content is read automatically
 * - Empty or whitespace-only content is not appended
 * - Return result includes parsed block count and actual appended block count
 * - Warnings are returned in stats.warnings
 */
export async function docAppendHandler(params: {
	id: string;
	content: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);

	let content = params.content;
	if (content && fs.existsSync(content)) {
		content = fs.readFileSync(content, 'utf-8');
	}

	// If no content, return directly
	if (!content || !content.trim()) {
		return {
			success: true,
			message: 'No content to append'
		};
	}

	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// Load document
		const {
			doc: doc,
			exists: snapExists,
			prevSV: prevSV
		} = await fetchYDoc(socket, workspaceId, params.id);
		if (!snapExists) {
			throw new Error(`Document ${params.id} does not exist`);
		}

		const blocks = doc.getMap('blocks');

		const parsedMarkdown = parseMarkdownToOperations(content);
		const operations = parsedMarkdown.operations;

		if (operations.length === 0) {
			return {
				success: true,
				message: 'No valid content to append'
			};
		}

		// Find or create note block
		const noteId = ensureNoteBlock(blocks);
		const noteBlock = findBlockById(blocks, noteId);
		if (!noteBlock) {
			throw new Error('Cannot resolve note block');
		}
		// Use the same processing as createDocFromMarkdownCore
		let lastInsertedBlockId: string | undefined;
		let appendedCount = 0;

		for (const operation of operations) {
			const placement = lastInsertedBlockId
				? { afterBlockId: lastInsertedBlockId }
				: { parentId: noteId };

			// strict: false skips URL validation
			const input = markdownOperationToAppendInput(
				operation,
				params.id,
				workspaceId,
				false,
				placement
			);
			try {
				const normalized = normalizeAppendBlockInput(input);
				const context = resolveInsertContext(blocks, normalized);
				const { blockId, block, extraBlocks } = createBlock(normalized);
				blocks.set(blockId, block);
				if (Array.isArray(extraBlocks)) {
					for (const extra of extraBlocks) blocks.set(extra.blockId, extra.block);
				}
				if (context.insertIndex >= context.children.length) {
					context.children.push([blockId]);
				} else {
					context.children.insert(context.insertIndex, [blockId]);
				}
				lastInsertedBlockId = blockId;
			} catch {
				// Skip blocks that fail validation
			}
			appendedCount++;
		}

		await updateYDoc(socket, workspaceId, params.id, doc, prevSV);
		return {
			success: true,
			message: `Appended ${appendedCount} content blocks to document ${params.id}`
		};
	} finally {
	}
}

/**
 * docPublishHandler: Publish document (public access)
 *
 * Description:
 * - Sets document as publicly accessible via GraphQL API
 * - Returns published document info
 *
 * @param params.workspace - Workspace ID (defaults to configured workspace)
 * @param params.docId - Document ID (required)
 * @param params.mode - Public mode, 'Page' or 'Edgeless' (default 'Page')
 * @returns Published document info
 */
export async function docPublishHandler(params: {
	workspace?: string;
	docId: string;
	mode?: 'Page' | 'Edgeless';
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) {
		throw new Error(
			'workspaceId is required. Provide it as a parameter or set AFFINE_WORKSPACE_ID in environment.'
		);
	}

	const gql = await createGraphQLClient();
	const mutation = `mutation PublishDoc($workspaceId:String!,$docId:String!,$mode:PublicDocMode){ publishDoc(workspaceId:$workspaceId, docId:$docId, mode:$mode){ id workspaceId public mode } }`;

	const data = await gql.request<{ publishDoc: any }>(mutation, {
		workspaceId,
		docId: params.docId,
		mode: params.mode || 'Page'
	});

	const result = data.publishDoc;
	const baseUrl = getBaseUrl();
	const publicMode = params.mode || 'Page';
	result.publicUrl = `${baseUrl}/workspace/${workspaceId}/${params.docId}?mode=${publicMode}`;

	return result;
}

/**
 * docUnpublishHandler: Unpublish document (revoke public access)
 *
 * Description:
 * - Revokes document public access via GraphQL API
 * - Returns unpublished document info
 *
 * @param params.workspace - Workspace ID (defaults to configured workspace)
 * @param params.docId - Document ID (required)
 * @returns Unpublished document info
 */
export async function docUnpublishHandler(params: {
	workspace?: string;
	docId: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) {
		throw new Error(
			'workspaceId is required. Provide it as a parameter or set AFFINE_WORKSPACE_ID in environment.'
		);
	}

	const gql = await createGraphQLClient();
	const mutation = `mutation RevokeDoc($workspaceId:String!,$docId:String!){ revokePublicDoc(workspaceId:$workspaceId, docId:$docId){ id workspaceId public } }`;

	const data = await gql.request<{ revokePublicDoc: any }>(mutation, {
		workspaceId,
		docId: params.docId
	});

	return data.revokePublicDoc;
}
