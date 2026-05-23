/**
 * Module: wsClient.ts
 * WebSocket client module
 *
 * Description:
 * - Provides functionality for interacting with Affine WebSocket service
 * - Used for reading and writing Y.js CRDT state
 * - Supports document load, update, and delete operations
 * - Supports workspace metadata extraction (page info, tag options)
 *
 * Exported functions:
 * - wsUrlFromGraphQLEndpoint: Derive WebSocket URL from GraphQL URL
 * - createWorkspaceSocket: Connect to workspace WebSocket
 * - joinWorkspace: Join workspace
 * - loadDoc: Load document snapshot
 * - pushDocUpdate: Push document update
 * - deleteDoc: Delete document
 * - extractWorkspacePages: Extract page metadata
 * - extractTagNames: Extract tag names
 * - getWorkspaceDocs: Get workspace document info
 */

import { io, Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { getApiConfig } from './config.js';
import { getWorkspaceTagOptions } from '../core/tags.js';

const DEFAULT_WS_CLIENT_VERSION = '0.26.0';
const WS_CONNECT_TIMEOUT_MS = 10000;
const WS_ACK_TIMEOUT_MS = 10000;

let _sharedSocket: Socket | null = null;
let _sharedSocketPromise: Promise<Socket> | null = null;
const _joinedWorkspaces = new Set<string>();

export function closeWorkspaceSocket() {
	if (_sharedSocket) {
		_sharedSocket.disconnect();
		_sharedSocket = null;
	}
	_sharedSocketPromise = null;
	_joinedWorkspaces.clear();
}

/**
 * wsUrlFromGraphQLEndpoint: Derive WebSocket URL from GraphQL endpoint URL
 *
 * @param endpoint - GraphQL endpoint URL (e.g. https://app.affine.pro/graphql)
 * @returns WebSocket URL (e.g. wss://app.affine.pro)
 *
 * Conversion rules:
 * - https:// → wss://
 * - http:// → ws://
 * - Remove trailing /graphql
 */
export function wsUrlFromGraphQLEndpoint(endpoint: string): string {
	return endpoint
		.replace('https://', 'wss://')
		.replace('http://', 'ws://')
		.replace(/\/graphql\/?$/, '');
}

/**
 * createWorkspaceSocket: Connect to workspace WebSocket
 *
 * @param wsUrl - WebSocket URL
 * @param cookie - Auth cookie (optional)
 * @param bearer - Bearer token (optional)
 * @returns Socket.io connection object
 * @throws Connection timeout or connection failure
 *
 * Notes:
 * - Uses websocket transport
 * - Default timeout 10 seconds
 * - Supports custom auth headers
 */
export async function createWorkspaceSocket(): Promise<Socket> {
	if (_sharedSocket && _sharedSocket.connected) {
		return _sharedSocket;
	}
	if (_sharedSocketPromise) {
		return _sharedSocketPromise;
	}

	const { apiUrl, apiToken } = getApiConfig();

	const extraHeaders: Record<string, string> = {};
	if (apiToken) extraHeaders['Authorization'] = `Bearer ${apiToken}`;

	const url = wsUrlFromGraphQLEndpoint(apiUrl);
	const socket = io(url, {
		transports: ['websocket'],
		path: '/socket.io/',
		extraHeaders: Object.keys(extraHeaders).length ? extraHeaders : undefined,
		autoConnect: true,
		timeout: WS_CONNECT_TIMEOUT_MS
	});

	_sharedSocketPromise = new Promise((resolve, reject) => {
		const onConnect = () => {
			socket.off('connect_error', onError);
			resolve(socket);
		};

		const onError = (err: any) => {
			socket.off('connect', onConnect);
			socket.disconnect();
			_sharedSocketPromise = null;
			reject(err);
		};

		socket.on('connect', onConnect);
		socket.on('connect_error', onError);

		// If timeout configured but not connected, socket.io-client auto-triggers connect_error
		// Timeout error message will be "timeout"
		setTimeout(() => {
			if (!socket.connected) {
				socket.off('connect', onConnect);
				socket.off('connect_error', onError);
				socket.disconnect();
				_sharedSocketPromise = null;
				reject(new Error(`WebSocket connection timeout (${WS_CONNECT_TIMEOUT_MS}ms)`));
			}
		}, WS_CONNECT_TIMEOUT_MS + 1000);
	});

	try {
		_sharedSocket = await _sharedSocketPromise;
		return _sharedSocket;
	} catch (err) {
		throw err;
	}
}

/**
 * joinWorkspace: Join workspace
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @returns Resolves on success, rejects on timeout or failure
 * @throws Join workspace timeout
 */
export async function joinWorkspace(socket: Socket, workspaceId: string) {
	if (_joinedWorkspaces.has(workspaceId)) return;
	try {
		const ack = await socket.timeout(WS_ACK_TIMEOUT_MS).emitWithAck('space:join', {
			spaceType: 'workspace',
			spaceId: workspaceId,
			clientVersion: DEFAULT_WS_CLIENT_VERSION
		});

		if (ack?.error) {
			throw new Error(ack.error.message || 'Failed to join workspace');
		}
		_joinedWorkspaces.add(workspaceId);
	} catch (err: any) {
		if (err.message?.includes('timeout')) {
			throw new Error(`Join workspace timeout (${WS_ACK_TIMEOUT_MS}ms)`);
		}
		throw err;
	}
}

/**
 * loadDoc: Load document snapshot
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @returns Object containing missing (Base64-encoded Y.js update) or state
 * @throws Load document timeout
 *
 * Return object:
 * - missing: Base64-encoded Y.js update data (new content)
 * - state: Base64-encoded full Y.js state
 * - timestamp: Update timestamp
 */
export async function loadDoc(
	socket: Socket,
	workspaceId: string,
	docId: string
): Promise<{ missing?: string; state?: string; timestamp?: number }> {
	try {
		const ack = await socket.timeout(WS_ACK_TIMEOUT_MS).emitWithAck('space:load-doc', {
			spaceType: 'workspace',
			spaceId: workspaceId,
			docId
		});

		if (ack?.error) {
			if (ack.error.name === 'DOC_NOT_FOUND') {
				return {};
			}
			throw new Error(ack.error.message || 'Failed to load document');
		}

		return ack?.data || {};
	} catch (err: any) {
		if (err.message?.includes('timeout')) {
			throw new Error(`Load document timeout (${WS_ACK_TIMEOUT_MS}ms)`);
		}
		throw err;
	}
}

/**
 * pushDocUpdate: Push document update
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @param updateBase64 - Base64-encoded Y.js update data
 * @returns Update timestamp
 * @throws Push update timeout
 */
export async function pushDocUpdate(
	socket: Socket,
	workspaceId: string,
	docId: string,
	updateBase64: string
): Promise<number> {
	try {
		const ack = await socket.timeout(WS_ACK_TIMEOUT_MS).emitWithAck('space:push-doc-update', {
			spaceType: 'workspace',
			spaceId: workspaceId,
			docId,
			update: updateBase64
		});

		if (ack?.error) {
			throw new Error(ack.error.message || 'Failed to push update');
		}

		return ack?.data?.timestamp || Date.now();
	} catch (err: any) {
		if (err.message?.includes('timeout')) {
			throw new Error(`Push update timeout (${WS_ACK_TIMEOUT_MS}ms)`);
		}
		throw err;
	}
}

/**
 * deleteDoc: Delete document
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 *
 * Notes:
 * - This is a one-way operation, does not wait for response
 */
export function deleteDoc(socket: Socket, workspaceId: string, docId: string): void {
	socket.emit('space:delete-doc', { spaceType: 'workspace', spaceId: workspaceId, docId });
}

/**
 * extractWorkspacePages: Extract page metadata from Y.js workspace document
 *
 * @param wsDoc - Y.Doc workspace document
 * @returns Page array with id, title, tagsArray, createDate, updateDate
 *
 * Notes:
 * - Extracts page info from meta.pages
 */
export function extractWorkspacePages(wsDoc: Y.Doc) {
	const meta = wsDoc.getMap('meta');
	const pages = meta.get('pages') as Y.Array<Y.Map<any>> | undefined;
	if (!pages) return [];
	return pages.toArray().map((page) => ({
		id: page.get('id'),
		title: page.get('title'),
		tagsArray: page.get('tags'),
		createDate: page.get('createDate'),
		updateDate: page.get('updateDate')
	}));
}

/**
 * extractTagNames: Extract tag name array from Y.Array
 *
 * @param tagsArray - Y.Array of tag IDs
 * @param tagOptions - Tag options array (id-to-value mapping)
 * @returns Tag name array
 *
 * Notes:
 * - Converts tag IDs to names using tagOptions
 * - Only returns tags with matching names
 */
export function extractTagNames(
	tagsArray: any,
	tagOptions: Array<{ id: string; value: string }>
): string[] {
	if (!tagsArray || !(tagsArray instanceof Y.Array)) {
		return [];
	}
	const byId = new Map<string, string>();
	for (const opt of tagOptions) {
		byId.set(opt.id, opt.value);
	}
	const names: string[] = [];
	tagsArray.forEach((tagId: string) => {
		const tagName = byId.get(tagId);
		if (tagName) {
			names.push(tagName);
		}
	});
	return names;
}

/**
 * getWorkspaceDocs: Get workspace document info
 *
 * Description:
 * - Loads workspace document via WebSocket
 * - Extracts title and tag info for all pages
 * - Returns Map<docId, { title, tags, createDate, updateDate }>
 *
 * @param wsUrl - WebSocket URL
 * @param workspaceId - Workspace ID
 * @param cookie - Auth cookie (optional)
 * @param bearer - Bearer token (optional)
 * @returns Document info Map
 */
export async function getWorkspaceDocs(workspaceId: string) {
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc } = await fetchYDoc(socket, workspaceId, workspaceId);

		const meta = doc.getMap('meta');
		const tagOptions = getWorkspaceTagOptions(meta);
		const pages = extractWorkspacePages(doc);
		const pagesInfo = new Map<
			string,
			{ title: string; tags: string[]; createDate?: string; updateDate?: string }
		>();
		for (const page of pages) {
			if (page.id) {
				const tagNames = extractTagNames(page.tagsArray, tagOptions);
				pagesInfo.set(page.id, {
					title: page.title || '',
					tags: tagNames,
					createDate: page.createDate,
					updateDate: page.updateDate
				});
			}
		}
		return pagesInfo;
	} finally {
	}
}

/**
 * fetchYDoc: Load document snapshot and initialize Y.Doc
 *
 * Description:
 * - Loads specified document snapshot data from server
 * - Creates and initializes Y.Doc instance
 * - Computes and returns initial state vector for subsequent incremental updates
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @returns Contains Y.Doc instance (doc), whether snapshot exists (exists), and initial state vector (prevSV)
 */
export async function fetchYDoc(
	socket: Socket,
	workspaceId: string,
	docId: string
): Promise<{ doc: Y.Doc; exists: boolean; prevSV: Uint8Array }> {
	const snapshot = await loadDoc(socket, workspaceId, docId);
	const doc = new Y.Doc();
	const exists = !!snapshot.missing;
	if (snapshot.missing) {
		Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
	}
	const prevSV = Y.encodeStateVector(doc);
	return { doc, exists, prevSV };
}

/**
 * updateYDoc: Push Y.Doc updates to server
 *
 * Description:
 * - Computes Y.Doc incremental update based on previous state vector (prevSV)
 * - Converts incremental update to Base64 format and pushes to server
 *
 * @param socket - WebSocket connection object
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @param doc - Y.Doc instance
 * @param prevSV - Previous state vector for computing delta
 * @returns Update timestamp
 */
export async function updateYDoc(
	socket: Socket,
	workspaceId: string,
	docId: string,
	doc: Y.Doc,
	prevSV?: Uint8Array
): Promise<number> {
	const update = prevSV ? Y.encodeStateAsUpdate(doc, prevSV) : Y.encodeStateAsUpdate(doc);
	return pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));
}

/**
 * getSpecialWorkspaceDocId: Generate special workspace document ID
 *
 * Description:
 * - Affine uses a special document ID format to store workspace additional data
 * - Format: db${workspaceId}${tableName}
 *
 * @param workspaceId - Workspace ID
 * @param tableName - Table name (e.g. 'folders')
 * @returns Special document ID string
 */
export function getSpecialWorkspaceDocId(workspaceId: string, tableName: string): string {
	return `db$${workspaceId}$${tableName}`;
}
