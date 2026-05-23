/**
 * Collection core module
 * Handles collection create, list, update, delete, add/remove documents, and other operations
 * Stored in workspace setting.map.collections via WebSocket + Yjs
 */

import { getWorkspaceId } from '../utils/config.js';
import {
	createWorkspaceSocket,
	joinWorkspace,
	fetchYDoc,
	updateYDoc,
	getWorkspaceDocs
} from '../utils/wsClient.js';
import * as Y from 'yjs';
import { generateId } from '../utils/misc.js';

/**
 * CollectionInfo: Collection type definition
 *
 * @property id - Collection unique ID
 * @property name - Collection name
 * @property rules - Collection rules (filter conditions)
 * @property allowList - Array of document IDs in the allow list
 */
interface CollectionInfo {
	id: string;
	name: string;
	rules: {
		filters: unknown[];
	};
	allowList: string[];
}

/**
 * normalizeCollection: Normalize collection data
 *
 * @param value - Raw value
 * @returns Normalized CollectionInfo or null
 */
function normalizeCollection(value: unknown): CollectionInfo | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const collection = value as Record<string, unknown>;
	if (typeof collection.id !== 'string' || typeof collection.name !== 'string') {
		return null;
	}
	const allowList = Array.isArray(collection.allowList)
		? collection.allowList.filter((entry): entry is string => typeof entry === 'string')
		: [];
	const rules =
		collection.rules &&
		typeof collection.rules === 'object' &&
		!Array.isArray(collection.rules) &&
		Array.isArray((collection.rules as Record<string, unknown>).filters)
			? {
					filters: (
						(collection.rules as Record<string, unknown>).filters as unknown[]
					).slice()
				}
			: { filters: [] };

	return {
		id: collection.id,
		name: collection.name,
		rules,
		allowList
	};
}

/**
 * readCollections: Read collection list
 *
 * @param array - Y.Array object
 * @returns CollectionInfo array
 */
function readCollections(array: Y.Array<any>): CollectionInfo[] {
	const collections: CollectionInfo[] = [];
	for (let i = 0; i < array.length; i++) {
		const normalized = normalizeCollection(array.get(i));
		if (normalized) {
			collections.push(normalized);
		}
	}
	return collections;
}

/**
 * findCollectionIndex: Find collection index
 *
 * @param array - Y.Array object
 * @param id - Collection ID
 * @returns Index position, or -1 if not found
 */
function findCollectionIndex(array: Y.Array<any>, id: string): number {
	for (let i = 0; i < array.length; i++) {
		const normalized = normalizeCollection(array.get(i));
		if (normalized?.id === id) {
			return i;
		}
	}
	return -1;
}

/**
 * collectionListHandler: Get all collections
 *
 * Description:
 * - Fetches all collections in the workspace via WebSocket + Yjs
 * - Returns sorted collection list by name, including ID, name, and document count
 *
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Collection array
 */
export async function collectionListHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc } = await fetchYDoc(socket, workspaceId, workspaceId);

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		const collections = current instanceof Y.Array ? readCollections(current) : [];

		return [...collections]
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((col) => ({
				id: col.id,
				name: col.name,
				docCount: col.allowList.length
			}));
	} finally {
	}
}

/**
 * collectionInfoHandler: Get specified collection info
 *
 * Description:
 * - Gets detailed info for the specified collection
 * - Returns document list in the collection (including ID and title)
 *
 * @param params.id - Collection ID (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing collection ID, name, document list, and count
 */
export async function collectionInfoHandler(params: {
	id: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc } = await fetchYDoc(socket, workspaceId, workspaceId);

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		const collections = current instanceof Y.Array ? readCollections(current) : [];
		const collection = collections.find((entry) => entry.id === params.id);

		if (!collection) {
			throw new Error(`Collection ${params.id} does not exist`);
		}

		const pagesInfo = await getWorkspaceDocs(workspaceId);

		const docs = collection.allowList.map((docId) => {
			const pageInfo = pagesInfo.get(docId);
			return {
				id: docId,
				title: pageInfo?.title || 'Untitled'
			};
		});

		return {
			id: collection.id,
			name: collection.name,
			docs,
			docCount: collection.allowList.length
		};
	} finally {
	}
}

/**
 * collectionCreateHandler: Create a new collection
 *
 * Description:
 * - Creates a new collection in the workspace
 * - Initial collection is empty (allowList is an empty array)
 * - Real-time creation via WebSocket + Yjs
 *
 * @param params.name - Collection name (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing creation result
 */
export async function collectionCreateHandler(params: {
	name: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc } = await fetchYDoc(socket, workspaceId, workspaceId);

		const setting = doc.getMap('setting');
		let current = setting.get('collections') as Y.Array<any> | undefined;
		if (!(current instanceof Y.Array)) {
			current = new Y.Array<any>();
			setting.set('collections', current);
		}

		const collection: CollectionInfo = {
			id: generateId(12, 'coll'),
			name: params.name,
			rules: {
				filters: []
			},
			allowList: []
		};

		current.push([collection]);

		await updateYDoc(socket, workspaceId, workspaceId, doc);

		return {
			success: true,
			id: collection.id,
			name: collection.name
		};
	} finally {
	}
}

/**
 * collectionUpdateHandler: Update collection name
 *
 * Description:
 * - Updates the name of the specified collection
 * - Real-time update via WebSocket + Yjs
 *
 * @param params.id - Collection ID (required)
 * @param params.name - New collection name (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing update result
 */
export async function collectionUpdateHandler(params: {
	id: string;
	name: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc } = await fetchYDoc(socket, workspaceId, workspaceId);

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		if (!(current instanceof Y.Array)) {
			throw new Error('Workspace has no collections');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`Collection ${params.id} does not exist`);
		}

		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`Collection ${params.id} has invalid data format`);
		}
		const next: CollectionInfo = {
			...previous,
			name: params.name
		};

		doc.transact(() => {
			current.delete(index, 1);
			current.insert(index, [next]);
		});

		await updateYDoc(socket, workspaceId, workspaceId, doc);

		return {
			success: true,
			message: `Collection renamed to "${params.name}"`
		};
	} finally {
	}
}

/**
 * collectionDeleteHandler: Delete collection
 *
 * Description:
 * - Deletes the specified collection
 * - Does not delete documents in the collection, only the collection itself
 *
 * @param params.id - Collection ID (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing deletion result
 */
export async function collectionDeleteHandler(params: {
	id: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc } = await fetchYDoc(socket, workspaceId, workspaceId);

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		if (!(current instanceof Y.Array)) {
			throw new Error('Workspace has no collections');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`Collection ${params.id} does not exist`);
		}
		current.delete(index, 1);

		await updateYDoc(socket, workspaceId, workspaceId, doc);

		return {
			success: true,
			message: `Collection ${params.id} deleted`
		};
	} finally {
	}
}

/**
 * collectionAddHandler: Add document to collection
 *
 * Description:
 * - Adds the specified document to the collection
 * - If the document is already in the collection, it is not added again
 * - Real-time update via WebSocket + Yjs
 *
 * @param params.id - Collection ID (required)
 * @param params.target - Document ID to add (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing add result
 */
export async function collectionAddHandler(params: {
	id: string;
	target: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc } = await fetchYDoc(socket, workspaceId, workspaceId);

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		if (!(current instanceof Y.Array)) {
			throw new Error('Workspace has no collections');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`Collection ${params.id} does not exist`);
		}
		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`Collection ${params.id} has invalid data format`);
		}
		const next: CollectionInfo = {
			...previous,
			allowList: Array.from(new Set([...previous.allowList, params.target]))
		};

		doc.transact(() => {
			current.delete(index, 1);
			current.insert(index, [next]);
		});

		await updateYDoc(socket, workspaceId, workspaceId, doc);

		return {
			success: true,
			message: `Document ${params.target} added to collection ${params.id}`
		};
	} finally {
	}
}

/**
 * collectionRemoveHandler: Remove document from collection
 *
 * Description:
 * - Removes the document from the specified collection
 * - The document itself is not deleted, only its association with the collection
 *
 * @param params.id - Collection ID (required)
 * @param params.target - Document ID to remove (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing remove result
 */
export async function collectionRemoveHandler(params: {
	id: string;
	target: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc } = await fetchYDoc(socket, workspaceId, workspaceId);

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		if (!(current instanceof Y.Array)) {
			throw new Error('Workspace has no collections');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`Collection ${params.id} does not exist`);
		}
		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`Collection ${params.id} has invalid data format`);
		}
		const next: CollectionInfo = {
			...previous,
			allowList: previous.allowList.filter((id) => id !== params.target)
		};

		doc.transact(() => {
			current.delete(index, 1);
			current.insert(index, [next]);
		});

		await updateYDoc(socket, workspaceId, workspaceId, doc);

		return {
			success: true,
			message: `Document ${params.target} removed from collection ${params.id}`
		};
	} finally {
	}
}
