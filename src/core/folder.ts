/**
 * Folder core module
 * Handles folder creation, listing, renaming, deletion, adding/moving/removing documents, etc.
 */

import { getWorkspaceId } from '../utils/config.js';
import {
	createWorkspaceSocket,
	joinWorkspace,
	loadDoc,
	pushDocUpdate,
	getWorkspaceDocs
} from '../utils/wsClient.js';
import * as Y from 'yjs';
import { generateId } from '../utils/misc.js';

/**
 * specialWorkspaceDbDocId: Generate workspace special document ID
 *
 * Description:
 * - Affine uses a special document ID format to store workspace auxiliary data
 * - Format: db${workspaceId}${tableName}
 *
 * @param workspaceId - Workspace ID
 * @param tableName - Table name (e.g. 'folders')
 * @returns Special document ID string
 */
function specialWorkspaceDbDocId(workspaceId: string, tableName: string): string {
	return `db$${workspaceId}$${tableName}`;
}

/**
 * isDeletedRecord: Check if a record is deleted
 *
 * @param record - Y.Map record
 * @returns Whether the record is deleted
 */
function isDeletedRecord(record: Y.Map<any>): boolean {
	return record.get('$$DELETED') === true || record.size === 0;
}

/**
 * readOrganizeNodes: Read organize nodes
 *
 * Description:
 * - Reads all organize nodes from Y.Doc's share
 * - Filters out deleted and invalid records
 *
 * @param doc - Y.Doc object
 * @returns Node array, each containing id, type, data, parentId, index
 */
function readOrganizeNodes(doc: Y.Doc): any[] {
	const nodes: any[] = [];
	for (const key of doc.share.keys()) {
		if (!doc.share.has(key)) {
			continue;
		}
		const record = doc.getMap(key);
		if (!(record instanceof Y.Map) || isDeletedRecord(record)) {
			continue;
		}
		const raw = record.toJSON();
		if (!raw || !raw.id || !raw.type) {
			continue;
		}
		nodes.push(raw);
	}
	return nodes;
}

/**
 * Generate sort index (between two indices)
 */
async function nextOrganizeIndex(nodes: any[], parentId: string | null): Promise<string> {
	const siblings = nodes
		.filter((node) => node.parentId === parentId)
		.sort((left, right) => left.index.localeCompare(right.index));
	const last = siblings.at(-1);
	return await generateFractionalIndexingKeyBetween(last?.index ?? null, null);
}

function hasSamePrefix(a: string, b: string): boolean {
	return a.startsWith(b) || b.startsWith(a);
}

let generateKeyBetween: ((a: string | null, b: string | null) => string) | null = null;

async function getGenerateKeyBetween() {
	if (!generateKeyBetween) {
		const mod = await import('fractional-indexing');
		generateKeyBetween = mod.generateKeyBetween;
	}
	return generateKeyBetween!;
}

async function generateFractionalIndexingKeyBetween(
	a: string | null,
	b: string | null
): Promise<string> {
	const randomSize = 32;
	const genKey = await getGenerateKeyBetween();

	function postfix(): string {
		return generateId(randomSize, 'blob');
	}

	function subkey(key: string | null): string | null {
		if (key === null) {
			return null;
		}
		if (key.length <= randomSize + 1) {
			return key;
		}
		return key.substring(0, key.length - randomSize - 1);
	}

	const aSubkey = subkey(a);
	const bSubkey = subkey(b);

	if (aSubkey === null && bSubkey === null) {
		return genKey(null, null) + '0' + postfix();
	}
	if (aSubkey === null && bSubkey !== null) {
		return genKey(null, bSubkey) + '0' + postfix();
	}
	if (bSubkey === null && aSubkey !== null) {
		return genKey(aSubkey, null) + '0' + postfix();
	}
	if (aSubkey !== null && bSubkey !== null) {
		if (hasSamePrefix(aSubkey, bSubkey) && a !== null && b !== null) {
			return genKey(a, b) + '0' + postfix();
		}
		return genKey(aSubkey, bSubkey) + '0' + postfix();
	}
	throw new Error('Unreachable fractional indexing state');
}

/**
 * folderAllHandler: Get all folders
 *
 * Description:
 * - Gets all folders in the workspace via WebSocket + Yjs
 * - Returns folder list with id, title, parentId, index
 *
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Folder array
 */
export async function folderAllHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folders = nodes
			.filter((node: any) => node.type === 'folder')
			.map((folder: any) => ({
				id: folder.id,
				title: folder.data || 'Unnamed folder',
				parentId: folder.parentId,
				index: folder.index
			}));

		return folders;
	} finally {
	}
}

/**
 * folderListHandler: Get children list of a specified folder
 *
 * Description:
 * - Gets all children (folders or documents) under the specified folder
 * - Supports returning only folders
 * - Gets real-time data via WebSocket + Yjs
 *
 * @param params.id - Parent folder ID (required)
 * @param params.folder - Whether to return only folders/tags, default false returns documents
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Children array, containing id, type, data, title, index
 */
export async function folderListHandler(params: {
	id: string;
	folder?: boolean;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const children = nodes.filter((node: any) => node.parentId === params.id);

		const filteredChildren = params.folder
			? children.filter((node: any) => node.type === 'folder' || node.type === 'tag')
			: children.filter((node: any) => node.type === 'doc');

		const pagesInfo = await getWorkspaceDocs(workspaceId);

		return filteredChildren.map((child: any) => {
			const isFolderRef = child.type === 'tag';
			const title = isFolderRef
				? nodes.find((n: any) => n.id === child.data)?.data || child.data
				: pagesInfo.get(child.data)?.title || child.data || 'Untitled';
			return {
				id: child.id,
				type: child.type,
				data: child.data,
				title,
				index: child.index
			};
		});
	} finally {
	}
}

/**
 * folderCreateHandler: Create a new folder
 *
 * Description:
 * - Creates a new folder in the workspace
 * - Supports specifying parent folder and sort index
 * - Creates in real-time via WebSocket + Yjs
 *
 * @param params.name - Folder name (required)
 * @param params.parent - Parent folder ID, empty string means root level (optional)
 * @param params.index - Sort index (optional, auto-calculated by default)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing creation result
 */
export async function folderCreateHandler(params: {
	name: string;
	parent?: string;
	index?: number;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folderId = generateId(12, 'folder');
		const nextIndex =
			params.index?.toString() ?? (await nextOrganizeIndex(nodes, params.parent ?? null));

		const record = doc.getMap(folderId);
		record.set('id', folderId);
		record.set('type', 'folder');
		record.set('data', params.name);
		if (params.parent !== undefined) {
			record.set('parentId', params.parent === '' ? null : params.parent);
		}
		record.set('index', nextIndex);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			id: folderId,
			title: params.name,
			parentId: params.parent === '' ? null : params.parent,
			index: nextIndex
		};
	} finally {
	}
}

/**
 * folderDeleteHandler: Delete a folder
 *
 * Description:
 * - Deletes the specified folder
 * - Uses soft delete (sets $$DELETED marker)
 * - Does not delete documents in the folder, only the folder itself
 *
 * @param params.id - Folder ID to delete (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing deletion result
 */
export async function folderDeleteHandler(params: {
	id: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folder = nodes.find((n: any) => n.id === params.id && n.type === 'folder');
		if (!folder) {
			throw new Error(`Folder ${params.id} does not exist`);
		}

		const record = doc.getMap(params.id);
		record.set('$$DELETED', true);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			message: `Folder ${params.id} deleted`
		};
	} finally {
	}
}

/**
 * folderAddHandler: Add document to folder
 *
 * Description:
 * - Adds a document link under the specified folder
 * - Auto-calculates sort index
 * - Updates in real-time via WebSocket + Yjs
 *
 * @param params.id - Target folder ID (required)
 * @param params.target - Document ID to add (required)
 * @param params.index - Sort index (optional, auto-calculated by default)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing addition result
 */
export async function folderAddHandler(params: {
	id: string;
	target: string;
	index?: number;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const nodeMap = new Map(nodes.map((n: any) => [n.id, n]));

		const folder = nodeMap.get(params.id);
		if (!folder || folder.type !== 'folder') {
			throw new Error(`Folder ${params.id} does not exist`);
		}

		const linkId = generateId(12, 'link');
		const nextIndex = params.index?.toString() ?? (await nextOrganizeIndex(nodes, params.id));

		const record = doc.getMap(linkId);
		record.set('id', linkId);
		record.set('type', 'doc');
		record.set('data', params.target);
		record.set('parentId', params.id);
		record.set('index', nextIndex);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			id: linkId,
			parentId: params.id,
			data: params.target,
			index: nextIndex
		};
	} finally {
	}
}

/**
 * folderMoveHandler: Move document to target folder
 *
 * Description:
 * - If document is already in a folder, moves it to the new folder
 * - If document is not in any folder, adds it to the target folder
 * - Updates in real-time via WebSocket + Yjs
 *
 * @param params.id - Target folder ID (required)
 * @param params.target - Document ID to move (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing move result
 */
export async function folderMoveHandler(params: {
	id: string;
	target: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const targetFolder = nodes.find((n: any) => n.id === params.id && n.type === 'folder');
		if (!targetFolder) {
			throw new Error(`Target folder ${params.id} does not exist`);
		}

		const existingLink = nodes.find(
			(n: any) => n.data === params.target && n.type === 'doc' && n.parentId
		);

		if (existingLink) {
			const record = doc.getMap(existingLink.id);
			record.set('parentId', params.id);
			const newIndex = await nextOrganizeIndex(nodes, params.id);
			record.set('index', newIndex);
		} else {
			const linkId = generateId(12, 'link');
			const newIndex = await nextOrganizeIndex(nodes, params.id);
			const record = doc.getMap(linkId);
			record.set('id', linkId);
			record.set('type', 'doc');
			record.set('data', params.target);
			record.set('parentId', params.id);
			record.set('index', newIndex);
		}

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			message: `Document ${params.target} moved to folder ${params.id}`
		};
	} finally {
	}
}

/**
 * folderRemoveHandler: Remove document from folder
 *
 * Description:
 * - Removes document link from the specified folder
 * - Supports removal by link ID or document ID
 * - Uses soft delete (sets $$DELETED marker)
 *
 * @param params.id - Document ID or link ID (required)
 * @param params.folder - Source folder ID (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing removal result
 */
export async function folderRemoveHandler(params: {
	id: string;
	folder: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const link = nodes.find(
			(n: any) =>
				n.parentId === params.folder &&
				(n.data === params.id || n.id === params.id) &&
				n.type === 'doc'
		);
		if (!link) {
			throw new Error(`Document ${params.id} does not exist in folder ${params.folder}`);
		}

		const record = doc.getMap(link.id);
		record.set('$$DELETED', true);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			message: `Document ${params.id} removed from folder ${params.folder}`
		};
	} finally {
	}
}

/**
 * folderUpdateHandler: Update folder properties
 *
 * Description:
 * - Supports updating folder name, parent folder, and sort index
 * - If only parent folder is updated, sort index is auto-recalculated
 * - Updates in real-time via WebSocket + Yjs
 *
 * @param params.id - Folder ID to update (required)
 * @param params.name - New folder name (optional)
 * @param params.parent - New parent folder ID, empty string means root level (optional)
 * @param params.index - Sort index (optional)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing update result
 */
export async function folderUpdateHandler(params: {
	id: string;
	name?: string;
	parent?: string;
	index?: number;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folder = nodes.find((n: any) => n.id === params.id && n.type === 'folder');
		if (!folder) {
			throw new Error(`Folder ${params.id} does not exist`);
		}

		const record = doc.getMap(params.id);
		if (params.name !== undefined) {
			record.set('data', params.name);
		}
		if (params.parent !== undefined) {
			record.set('parentId', params.parent === '' ? null : params.parent);
		}
		if (params.index !== undefined) {
			record.set('index', params.index.toString());
		} else if (params.parent !== undefined) {
			const parentId = params.parent === '' ? null : params.parent;
			const newIndex = await nextOrganizeIndex(nodes, parentId);
			record.set('index', newIndex);
		}

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			message: `Folder ${params.id} updated`
		};
	} finally {
	}
}

/**
 * folderClearHandler: Clear all empty folders
 *
 * Description:
 * - Deletes all folders with no child folders or associated documents
 * - Runs recursively until no orphan folders remain
 * - Uses soft delete (sets $$DELETED marker)
 *
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing deletion count
 */
export async function folderClearHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folders = nodes.filter((n: any) => n.type === 'folder');
		const links = nodes.filter((n: any) => n.type !== 'folder');

		const folderIds = new Set(folders.map((f: any) => f.id));
		const parentToChildren = new Map<string, string[]>();
		for (const link of links) {
			if (link.parentId && folderIds.has(link.parentId)) {
				if (!parentToChildren.has(link.parentId)) {
					parentToChildren.set(link.parentId, []);
				}
				parentToChildren.get(link.parentId)!.push(link.id);
			}
		}

		const hasChildren = (folderId: string): boolean => {
			if (parentToChildren.has(folderId) && parentToChildren.get(folderId)!.length > 0) {
				return true;
			}
			const childFolders = folders.filter((f: any) => f.parentId === folderId);
			for (const child of childFolders) {
				if (hasChildren(child.id)) {
					return true;
				}
			}
			return false;
		};

		const deletedFolders: string[] = [];
		let changed = true;
		while (changed) {
			changed = false;
			const currentNodes = readOrganizeNodes(doc);
			const currentFolders = currentNodes.filter((n: any) => n.type === 'folder');

			for (const folder of currentFolders) {
				if (!hasChildren(folder.id)) {
					const record = doc.getMap(folder.id);
					record.set('$$DELETED', true);
					deletedFolders.push(folder.id);
					changed = true;
				}
			}

			if (changed) {
				const update = Y.encodeStateAsUpdate(doc);
				await pushDocUpdate(
					socket,
					workspaceId,
					docId,
					Buffer.from(update).toString('base64')
				);
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}

		return {
			success: true,
			total: deletedFolders.length,
			folers: deletedFolders
		};
	} finally {
	}
}
