/**
 * Tags core module
 * Handles tag creation, listing, adding/removing documents, etc.
 * Uses WebSocket + Yjs for storage
 */

import { getWorkspaceId } from '../utils/config.js';
import { createWorkspaceSocket, joinWorkspace, fetchYDoc, updateYDoc } from '../utils/wsClient.js';
import { resolveWorkspaceName } from '../utils/workspaceCache.js';
import { TAG_COLORS } from './constants.js';
import * as Y from 'yjs';
import { generateId } from '../utils/misc.js';

/**
 * Tag option type
 */
export type WorkspaceTagOption = {
	id: string;
	value: string;
	color: string;
	createDate?: number;
	updateDate?: number;
};

/**
 * normalizeTag: Normalize tag name
 *
 * @param tag - Raw tag name
 * @returns Tag name with leading/trailing whitespace removed
 */
function normalizeTag(tag: string): string {
	return tag.trim();
}

/**
 * getTagOptionsArray: Get tag options array
 *
 * Description:
 * - Gets tag options array from the correct path: meta.properties.tags.options
 * - This is the standard structure Affine uses to store tag options
 *
 * @param meta - Workspace meta Y.Map
 * @returns Tag options array, or null if not found
 */
function getTagOptionsArray(meta: Y.Map<any>) {
	const properties = meta.get('properties');
	if (!properties || !(properties instanceof Y.Map)) return;

	const tags = properties.get('tags');
	if (!tags || !(tags instanceof Y.Map)) return;

	const options = tags.get('options');
	if (!options || !(options instanceof Y.Array)) return;

	return options;
}

/**
 * parseTagOption: Parse a single tag option
 *
 * @param opt - Raw Y.Map object
 * @returns Parsed object with id, value, color; or null if parsing fails
 */
function parseTagOption(opt: Y.Map<any>, index: number): WorkspaceTagOption | null {
	if (opt && opt instanceof Y.Map) {
		const id = opt.get('id');
		const value = opt.get('value');
		if (typeof id === 'string' && typeof value === 'string') {
			return {
				id,
				value,
				color: opt.get('color') || TAG_COLORS[index % TAG_COLORS.length],
				createDate: opt.get('createDate'),
				updateDate: opt.get('updateDate')
			};
		}
	}

	return null;
}

/**
 * Get workspace tag options
 */
export function getWorkspaceTagOptions(meta: Y.Map<any>) {
	const opts = getTagOptionsArray(meta);
	if (!opts) return [];

	const tags: Array<WorkspaceTagOption> = [];

	opts.forEach((opt: any, index: number) => {
		const tag = parseTagOption(opt, index);
		if (tag) tags.push(tag);
	});

	return tags;
}

/**
 * ensureTagOptionsArray: Ensure tag options array exists
 *
 * Description:
 * - Creates meta.properties.tags.options if it doesn't exist
 * - Returns the usable tag options array
 *
 * @param meta - Workspace meta Y.Map
 * @returns Tag options Y.Array
 */
function ensureTagOptionsArray(meta: Y.Map<any>): Y.Array<any> {
	let properties = meta.get('properties') as Y.Map<any> | undefined;
	if (!properties) {
		properties = new Y.Map<any>();
		meta.set('properties', properties);
	}

	let tags = properties.get('tags') as Y.Map<any> | undefined;
	if (!tags) {
		tags = new Y.Map<any>();
		properties.set('tags', tags);
	}

	let options = tags.get('options') as Y.Array<any> | undefined;
	if (!options) {
		options = new Y.Array<any>();
		tags.set('options', options);
	}

	return options;
}

/**
 * getWorkspacePageEntries: Get workspace page entries
 *
 * @param wsMeta - Workspace meta Y.Map
 * @returns Page entry array, each containing id and entry (Y.Map)
 */
function getWorkspacePageEntries(wsMeta: Y.Map<any>): Array<{ id: string; entry: Y.Map<any> }> {
	const pages = wsMeta.get('pages');
	if (!pages || !(pages instanceof Y.Array)) {
		return [];
	}

	const result: Array<{ id: string; entry: Y.Map<any> }> = [];
	pages.forEach((page: any) => {
		if (page instanceof Y.Map) {
			const id = page.get('id');
			if (typeof id === 'string') {
				result.push({ id, entry: page });
			}
		}
	});
	return result;
}

/**
 * getStringArray: Get string array from Y.Array
 *
 * @param value - Y.Array or other value
 * @returns String array
 */
export function getStringArray(value: unknown): string[] {
	if (!value || !(value instanceof Y.Array)) {
		return [];
	}
	const result: string[] = [];
	value.forEach((item: unknown) => {
		if (typeof item === 'string') {
			result.push(item);
		}
	});
	return result;
}

/**
 * tagsListHandler: List all tags in the workspace
 *
 * Description:
 * - Gets all tag options in the workspace via WebSocket
 * - Counts documents associated with each tag
 * - Returns tag list sorted by name
 *
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing workspace ID, total tag count, and tag list
 *
 * Notes:
 * - Tag list is sorted alphabetically by name
 * - Each tag includes name, document count, and color info
 */
export async function tagsListHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: wsDoc, exists: snapshotExists } = await fetchYDoc(socket, workspaceId, workspaceId);
		const workspaceName = await resolveWorkspaceName(workspaceId);
		if (!snapshotExists) {
			return { workspaceId, workspaceName, totalTags: 0, tags: [] };
		}
		const meta = wsDoc.getMap('meta');
		const pages = getWorkspacePageEntries(meta);
		const tagOptions = getWorkspaceTagOptions(meta);

		const tagCounts = new Map<string, number>();
		for (const option of tagOptions) {
			tagCounts.set(option.value, 0);
		}

		for (const page of pages) {
			const pageTags = page.entry.get('tags');
			if (pageTags) {
				const tagIds = getStringArray(pageTags);
				const byId = new Map<string, { value: string; color: string }>();
				for (const opt of tagOptions) {
					byId.set(opt.id, opt);
				}
				for (const tagId of tagIds) {
					const opt = byId.get(tagId);
					if (opt) {
						tagCounts.set(opt.value, (tagCounts.get(opt.value) || 0) + 1);
					}
				}
			}
		}

		const tags = [...tagCounts.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([name, docCount]) => {
				const option = tagOptions.find((o) => o.value === name);
				return {
					name,
					docCount,
					color: option?.color
				};
			});

		return {
			workspaceId,
			workspaceName,
			total: tags.length,
			tags
		};
	} finally {
	}
}

/**
 * tagsCreateHandler: Create a new tag
 *
 * Description:
 * - Creates a new tag in the workspace
 * - If tag already exists, returns existing info without creating duplicate
 * - Auto-assigns color (cycles through predefined colors)
 *
 * @param params.tag - Tag name (required)
 * @param params.color - Tag color, e.g. #3B82F6 (optional)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing creation result
 *
 * Notes:
 * - Tag names are case-insensitive
 * - If color is not specified, auto-selects from predefined colors
 * - On success, returns tag id, value, color
 */
export async function tagsCreateHandler(params: {
	name: string;
	color?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();
	const name = normalizeTag(params.name);

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: wsDoc, exists: snapshotExists, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
		if (!snapshotExists) {
			throw new Error(`Workspace root document does not exist`);
		}
		const meta = wsDoc.getMap('meta');

		const existingOptions = getWorkspaceTagOptions(meta);
		const existing = existingOptions.find((t) => t.value.toLowerCase() === name.toLowerCase());
		if (existing) {
			return {
				workspaceId,
				name,
				created: false,
				message: `Tag "${name}" already exists`
			};
		}

		const optionsArray = ensureTagOptionsArray(meta);
		const color = params.color || TAG_COLORS[existingOptions.length % TAG_COLORS.length];
		const now = Date.now();

		const optionMap = new Y.Map<any>();
		optionMap.set('id', generateId(8, 'tag'));
		optionMap.set('value', name);
		optionMap.set('color', color);
		optionMap.set('createDate', now);
		optionMap.set('updateDate', now);
		optionsArray.push([optionMap]);

		await updateYDoc(socket, workspaceId, workspaceId, wsDoc, prevSV);

		return {
			success: true,
			// workspaceId,
			name,
			color
			// created: true
		};
	} finally {
	}
}

/**
 * tagsDocAddHandler: Add tag to document
 *
 * Description:
 * - Adds specified tag to document
 * - If tag doesn't exist, auto-creates it
 * - If document already has the tag, doesn't add duplicate
 *
 * @param params.id - Document ID (required)
 * @param params.tag - Tag name (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing operation result
 *
 * Notes:
 * - Tag names are case-insensitive
 * - If tag doesn't exist it will be auto-created with auto-assigned color
 */
export async function tagsDocAddHandler(params: {
	id: string;
	tag: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();
	const tag = normalizeTag(params.tag);

	try {
		await joinWorkspace(socket, workspaceId);

		const { doc: wsDoc, exists: wsSnapshotExists, prevSV: wsPrevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
		if (!wsSnapshotExists) {
			throw new Error(`Workspace root document does not exist`);
		}
		const wsMeta = wsDoc.getMap('meta');

		const pages = getWorkspacePageEntries(wsMeta);
		const page = pages.find((entry) => entry.id === params.id);
		if (!page) {
			throw new Error(`Document ${params.id} does not exist in workspace`);
		}

		const existingOptions = getWorkspaceTagOptions(wsMeta);
		let tagOption = existingOptions.find((t) => t.value.toLowerCase() === tag.toLowerCase());

		if (!tagOption) {
			const optionsArray = ensureTagOptionsArray(wsMeta);
			const color = TAG_COLORS[existingOptions.length % TAG_COLORS.length];
			const now = Date.now();

			const optionMap = new Y.Map<any>();
			optionMap.set('id', generateId(8, 'tag'));
			optionMap.set('value', tag);
			optionMap.set('color', color);
			optionMap.set('createDate', now);
			optionMap.set('updateDate', now);
			optionsArray.push([optionMap]);

			tagOption = { id: optionMap.get('id'), value: tag, color };
		}

		const pageTags = page.entry.get('tags') as Y.Array<string> | undefined;
		if (pageTags) {
			const existing = pageTags.toArray();
			if (!existing.includes(tagOption.id)) {
				pageTags.push([tagOption.id]);
			}
		} else {
			const newTags = new Y.Array<string>();
			newTags.push([tagOption.id]);
			page.entry.set('tags', newTags);
		}

		await updateYDoc(socket, workspaceId, workspaceId, wsDoc, wsPrevSV);

		return {
			success: true,
			message: `Tag "${tag}" added to document ${params.id}`
		};
	} finally {
	}
}

/**
 * tagsDocRemoveHandler: Remove tag from document
 *
 * Description:
 * - Removes specified tag from document
 * - The tag itself is not deleted, only the association with the document
 *
 * @param params.id - Document ID (required)
 * @param params.tag - Tag name (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing operation result
 *
 * Notes:
 * - Tag names are case-insensitive
 * - Throws if tag or document doesn't exist
 */
export async function tagsDocRemoveHandler(params: {
	id: string;
	tag: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();
	const tag = normalizeTag(params.tag);

	try {
		await joinWorkspace(socket, workspaceId);

		const { doc: wsDoc, exists: wsSnapshotExists, prevSV: wsPrevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
		if (!wsSnapshotExists) {
			throw new Error(`Workspace root document does not exist`);
		}
		const wsMeta = wsDoc.getMap('meta');

		const pages = getWorkspacePageEntries(wsMeta);
		const page = pages.find((entry) => entry.id === params.id);
		if (!page) {
			throw new Error(`Document ${params.id} does not exist in workspace`);
		}

		const existingOptions = getWorkspaceTagOptions(wsMeta);
		const tagOption = existingOptions.find((t) => t.value.toLowerCase() === tag.toLowerCase());
		if (!tagOption) {
			throw new Error(`Tag "${tag}" does not exist`);
		}

		const pageTags = page.entry.get('tags') as Y.Array<string> | undefined;
		if (pageTags) {
			const existing = pageTags.toArray();
			const newTags = existing.filter((t) => t !== tagOption.id);
			pageTags.delete(0, existing.length);
			if (newTags.length > 0) {
				pageTags.insert(0, newTags);
			}
		}

		await updateYDoc(socket, workspaceId, workspaceId, wsDoc, wsPrevSV);

		return {
			success: true,
			message: `Tag "${tag}" removed from document ${params.id}`
		};
	} finally {
	}
}

/**
 * tagsDeleteHandler: Delete a tag
 *
 * Description:
 * - Deletes specified tag from workspace
 * - Deleting a tag affects all documents using that tag
 *
 * @param params.tag - Tag name (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @returns Object containing operation result
 *
 * Notes:
 * - Tag names are case-insensitive
 * - After deletion, all associations with this tag are removed from documents
 * - Throws if tag doesn't exist
 */
export async function tagsDeleteHandler(params: { tag: string; workspace?: string }): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();
	const tag = normalizeTag(params.tag);

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: wsDoc, exists: snapshotExists, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
		if (!snapshotExists) {
			throw new Error(`Workspace root document does not exist`);
		}
		const meta = wsDoc.getMap('meta');

		const optionsArray = getTagOptionsArray(meta);
		if (!optionsArray) {
			throw new Error(`Tag "${tag}" does not exist`);
		}

		let foundIndex = -1;
		for (let i = 0; i < optionsArray.length; i++) {
			const item = optionsArray.get(i);
			const parsed = parseTagOption(item, i);
			if (parsed && parsed.value.toLowerCase() === tag.toLowerCase()) {
				foundIndex = i;
				break;
			}
		}

		if (foundIndex === -1) {
			throw new Error(`Tag "${tag}" does not exist`);
		}

		optionsArray.delete(foundIndex, 1);

		await updateYDoc(socket, workspaceId, workspaceId, wsDoc, prevSV);

		return {
			success: true,
			message: `Tag "${tag}" deleted`
		};
	} finally {
	}
}

/**
 * tagsDocListHandler: Get list of documents associated with a tag
 *
 * Description:
 * - Finds all documents using the specified tag
 * - Supports case-sensitive and case-insensitive matching
 * - Returns document ID and title list
 *
 * @param params.tag - Tag name (required)
 * @param params.workspace - Workspace ID, defaults to configured workspace
 * @param params.ignoreCase - Whether to ignore case, default true
 * @returns Object containing workspace ID, tag name, match mode, and document list
 *
 * Notes:
 * - Returns empty list if tag doesn't exist
 * - Each document returns ID and title ('Untitled document' if no title)
 */
export async function tagsDocListHandler(params: {
	tag: string;
	workspace?: string;
	ignoreCase?: boolean;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();
	const tag = normalizeTag(params.tag);
	const ignoreCase = params.ignoreCase ?? true;

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: wsDoc, exists: snapshotExists } = await fetchYDoc(socket, workspaceId, workspaceId);
		const workspaceName = await resolveWorkspaceName(workspaceId);
		if (!snapshotExists) {
			return { workspaceId, workspaceName, tag, ignoreCase, totalDocs: 0, docs: [] };
		}
		const meta = wsDoc.getMap('meta');
		const pages = getWorkspacePageEntries(meta);
		const tagOptions = getWorkspaceTagOptions(meta);

		const tagOption = tagOptions.find((t) =>
			ignoreCase ? t.value.toLowerCase() === tag.toLowerCase() : t.value === tag
		);

		if (!tagOption) {
			return { workspaceId, workspaceName, tag, ignoreCase, totalDocs: 0, docs: [] };
		}

		const docs = pages
			.filter((page) => {
				const docTags = page.entry.get('tags') as Y.Array<string> | undefined;
				if (!docTags) {
					return false;
				}
				const tagIds = getStringArray(docTags);
				return tagIds.includes(tagOption.id);
			})
			.map((page) => {
				const title = page.entry.get('title');
				return {
					id: page.id,
					title: title || 'Untitled document'
				};
			});

		return {
			workspaceId,
			workspaceName,
			tag,
			ignoreCase,
			total: docs.length,
			docs
		};
	} finally {
	}
}
