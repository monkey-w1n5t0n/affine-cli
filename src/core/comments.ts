/**
 * Comments core module
 * Handles comment CRUD, resolve, and other operations
 */

import { createGraphQLClient } from '../utils/graphqlClient.js';
import { getWorkspaceId } from '../utils/config.js';
import { createWorkspaceSocket, joinWorkspace, loadDoc, updateYDoc } from '../utils/wsClient.js';
import { generateId } from '../utils/misc.js';
import * as Y from 'yjs';

/**
 * listCommentsHandler: List document comments
 *
 * Description:
 * - Fetches comment list for a specified document via GraphQL API
 * - Supports pagination, offset, and cursor
 * - Supports returning full data or simplified data
 *
 * @param params.workspaceId - Workspace ID, defaults to configured workspace
 * @param params.docId - Document ID (required)
 * @param params.first - Return count limit
 * @param params.offset - Offset
 * @param params.after - Cursor
 * @param params.full - Whether to return full comment data, default false
 * @returns Comment array or full comment object
 */
export async function listCommentsHandler(params: {
	workspaceId?: string;
	docId: string;
	first?: number;
	offset?: number;
	after?: string;
	full?: boolean;
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = await getWorkspaceId(params.workspaceId);

	const { docId, first, offset, after } = params;

	// Full data query
	const fullQuery = `query ListComments($workspaceId:String!,$docId:String!,$first:Int,$offset:Int,$after:String){ workspace(id:$workspaceId){ comments(docId:$docId, pagination:{first:$first, offset:$offset, after:$after}){ totalCount pageInfo{ hasNextPage endCursor } edges{ cursor node{ id content createdAt updatedAt resolved user{ id name avatarUrl } replies{ id content createdAt updatedAt user{ id name avatarUrl } } } } } } }`;

	const data = await gql.request<{ workspace: any }>(fullQuery, {
		workspaceId,
		docId,
		first,
		offset,
		after
	});

	// If not full mode, simplify return data
	if (!params.full) {
		const edges = data.workspace.comments.edges;
		return edges.map((edge: any) => {
			const node = edge.node;
			// Extract comment body text from snapshot.blocks
			const commentContent = extractCommentContent(node.content);
			return {
				id: node.id,
				content: commentContent, // Comment body text
				preview: node.content?.preview || '', // Quoted document text
				title: node.content?.snapshot?.meta?.title || '', // Document title
				resolved: node.resolved,
				user: node.user ? { name: node.user.name } : null,
				createdAt: node.createdAt,
				updatedAt: node.updatedAt,
				repliesCount: node.replies?.length || 0
			};
		});
	}

	return data.workspace.comments;
}

/**
 * extractCommentContent: Extract comment body text from comment content
 *
 * @param content - Comment content object
 * @returns Comment body text string
 */
function extractCommentContent(content: any): string {
	if (!content?.snapshot?.blocks) return '';
	const blocks = content.snapshot.blocks;
	// Recursively find text in paragraphs
	return extractTextFromSnapshotBlock(blocks);
}

/**
 * extractTextFromSnapshotBlock: Recursively extract text from snapshot blocks
 *
 * @param block - Snapshot block object
 * @returns Extracted text string
 */
function extractTextFromSnapshotBlock(block: any): string {
	if (!block) return '';

	// If paragraph type, extract text
	if (block.flavour === 'affine:paragraph') {
		const text = block.props?.text;
		if (text?.delta && Array.isArray(text.delta)) {
			return text.delta.map((d: any) => d.insert || '').join('');
		}
	}

	// Recursively search children
	if (block.children && Array.isArray(block.children)) {
		for (const child of block.children) {
			const text = extractTextFromSnapshotBlock(child);
			if (text) return text;
		}
	}

	return '';
}

/**
 * createCommentHandler: Create a comment
 *
 * Description:
 * - Creates a new comment in the specified document
 * - Supports setting comment content and quoted document text
 * - Creates a comment mark in the document (if selection param is provided)
 *
 * @param params.workspaceId - Workspace ID, defaults to configured workspace
 * @param params.docId - Document ID (required)
 * @param params.docTitle - Document title (optional, defaults to document's own title)
 * @param params.docMode - Document mode (page/edgeless)
 * @param params.content - Comment content (required)
 * @param params.selection - Quoted document text (optional)
 * @param params.mentions - Mentioned users (optional)
 * @returns Created comment object
 */
export async function createCommentHandler(params: {
	workspaceId?: string;
	docId: string;
	docTitle?: string;
	docMode?: 'Page' | 'Edgeless' | 'page' | 'edgeless';
	content?: string;
	selection?: string;
	mentions?: string[];
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = await getWorkspaceId(params.workspaceId);

	if (!params.content) {
		throw new Error('Comment content cannot be empty');
	}

	// Get document info
	const docQuery = `query GetDoc($workspaceId: String!, $docId: String!) {
		workspace(id: $workspaceId) {
			doc(docId: $docId) {
				title
				mode
			}
		}
	}`;
	const docData = await gql.request<any>(docQuery, { workspaceId, docId: params.docId });
	const docInfo = docData?.workspace?.doc || { title: '', mode: 'page' };
	const docTitle = params.docTitle || docInfo.title || '';
	const docMode = params.docMode || docInfo.mode || 'page';

	const normalizedDocMode = docMode.toLowerCase() === 'edgeless' ? 'edgeless' : 'page';

	// Generate random IDs
	const pageId = generateId(12, 'page');
	const surfaceId = generateId(12, 'surf');
	const noteId = generateId(12, 'note');
	const paragraphId = generateId(12, 'para');

	// preview: use selection if available, otherwise use document title
	const preview = params.selection || docTitle || 'Untitled';

	// Build comment content - using DocCommentContent format
	const commentContent = {
		preview: preview,
		mode: normalizedDocMode,
		attachments: [],
		snapshot: {
			type: 'page',
			meta: {
				id: pageId,
				title: docTitle || 'Untitled',
				createDate: Date.now(),
				tags: []
			},
			blocks: {
				type: 'block',
				id: pageId,
				flavour: 'affine:page',
				version: 2,
				props: {
					title: {
						'$blocksuite:internal:text$': true,
						delta: []
					}
				},
				children: [
					{
						type: 'block',
						id: surfaceId,
						flavour: 'affine:surface',
						version: 5,
						props: {
							elements: {
								type: '$blocksuite:internal:native$',
								value: {}
							}
						},
						children: []
					},
					{
						type: 'block',
						id: noteId,
						flavour: 'affine:note',
						version: 1,
						props: {
							xywh: '[0,0,800,95]',
							background: {
								dark: '#252525',
								light: '#ffffff'
							},
							index: 'a0',
							lockedBySelf: false,
							hidden: false,
							displayMode: 'both',
							edgeless: {
								style: {
									borderRadius: 8,
									borderSize: 4,
									borderStyle: 'solid',
									shadowType: '--affine-note-shadow-box'
								}
							}
						},
						children: [
							{
								type: 'block',
								id: paragraphId,
								flavour: 'affine:paragraph',
								version: 1,
								props: {
									type: 'text',
									text: {
										'$blocksuite:internal:text$': true,
										delta: [{ insert: params.content }]
									},
									collapsed: false
								},
								children: []
							}
						]
					}
				]
			}
		}
	};

	// Create the comment first
	const mutation = `mutation CreateComment($input: CommentCreateInput!){ createComment(input:$input){ id content createdAt updatedAt resolved } }`;
	const input = {
		content: commentContent,
		docId: params.docId,
		workspaceId,
		docTitle: docTitle,
		docMode: normalizedDocMode,
		mentions: params.mentions || []
	};

	const data = await gql.request<{ createComment: any }>(mutation, { input });
	const comment = data.createComment;

	// If selection param is provided, add comment mark to the document
	if (params.selection && comment.id) {
		try {
			await addCommentMarkToDocument(workspaceId, params.docId, params.selection, comment.id);
		} catch (err) {
			console.error('Failed to add comment mark:', err);
		}
	}

	return comment;
}

/**
 * addCommentMarkToDocument: Add comment mark to document text
 *
 * Description:
 * - Searches document text for the selection string
 * - Adds a comment mark at the found text position
 * - Updates the document in real-time via WebSocket + Yjs
 *
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @param endpoint - GraphQL endpoint
 * @param cookie - Auth cookie
 * @param bearer - Auth bearer token
 * @param selection - Text to mark
 * @param commentId - Comment ID
 */
async function addCommentMarkToDocument(
	workspaceId: string,
	docId: string,
	selection: string,
	commentId: string
): Promise<void> {
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// Get document state
		const snapshot = await loadDoc(socket, workspaceId, docId);

		// Apply state to Y.Doc
		const yDoc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(yDoc, Buffer.from(snapshot.missing, 'base64'));
		} else if (snapshot.state) {
			Y.applyUpdate(yDoc, Buffer.from(snapshot.state, 'base64'));
		}

		// If neither missing nor state, need to re-fetch full state
		if (!snapshot.missing && !snapshot.state) {
			return;
		}

		// Find and mark matching text
		const blocks = yDoc.getMap('blocks');
		const markKey = `comment-${commentId}`;
		let modified = false;

		for (const [_, block] of blocks) {
			if (!(block instanceof Y.Map)) continue;

			// const flavour = block.get('sys:flavour');

			// Check all possible text properties
			const textKeys: string[] = [];
			block.forEach((_: any, key: string) => {
				if (key.startsWith('prop:text') || key === 'prop:title') {
					textKeys.push(key);
				}
			});

			for (const key of textKeys) {
				const yText = block.get(key) as Y.Text | undefined;
				if (!yText || !(yText instanceof Y.Text)) continue;

				const text = yText.toString();
				if (text.includes(selection)) {
					// Add comment mark at found text position
					const index = text.indexOf(selection);
					const commentAttr: any = {};
					commentAttr[markKey] = true;

					yText.format(index, selection.length, commentAttr);
					modified = true;
				}
			}
		}

		if (modified) {
			// Send update to server
			await updateYDoc(socket, workspaceId, docId, yDoc);
		}
	} finally {
	}
}

/**
 * updateCommentHandler: Update comment content
 *
 * Description:
 * - Updates the content of a specified comment
 * - Supports string or BlockSuite node format
 * - If string, preserves existing snapshot structure and only updates text
 *
 * @param params.id - Comment ID (required)
 * @param params.content - New comment content (required)
 * @returns Update result object
 */
export async function updateCommentHandler(params: { id: string; content: any }): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = await getWorkspaceId();

	// Get full comment info
	const commentQuery = `query GetComment($workspaceId: String!, $docId: String!, $first: Int) {
		workspace(id: $workspaceId) {
			comments(docId: $docId, pagination: { first: $first }) {
				edges {
					node {
						id
						content
						resolved
					}
				}
			}
		}
	}`;

	// Get all documents to find the comment
	const docsQuery = `query ListDocs($workspaceId: String!, $first: Int) {
		workspace(id: $workspaceId) {
			docs(pagination: { first: $first }) {
				edges {
					node {
						id
					}
				}
			}
		}
	}`;

	let docId: string | null = null;
	let existingContent: any = null;

	try {
		const docsData = await gql.request<any>(docsQuery, { workspaceId, first: 100 });
		const docIds: string[] = docsData.workspace?.docs?.edges?.map((e: any) => e.node.id) || [];

		for (const id of docIds) {
			const commentData = await gql.request<any>(commentQuery, {
				workspaceId,
				docId: id,
				first: 100
			});
			const comments = commentData.workspace?.comments?.edges || [];
			for (const edge of comments) {
				if (edge.node.id === params.id) {
					docId = id;
					existingContent = edge.node.content;
					break;
				}
			}
			if (docId) break;
		}
	} catch (err) {
		// Ignore errors
	}

	// Convert string content to BlockSuite node format
	let commentContent: any;
	if (typeof params.content === 'string') {
		// Preserve existing snapshot structure, only update paragraph text
		commentContent = existingContent ? { ...existingContent } : null;

		if (commentContent?.snapshot?.blocks) {
			// Find paragraph and update text
			const blocks = commentContent.snapshot.blocks;
			updateParagraphText(blocks, params.content);
		} else {
			// Create new paragraph structure
			commentContent = {
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: params.content
					}
				]
			};
		}
	} else {
		commentContent = params.content;
	}

	const mutation = `mutation UpdateComment($input: CommentUpdateInput!){ updateComment(input:$input) }`;
	const data = await gql.request<{ updateComment: boolean }>(mutation, {
		input: { id: params.id, content: commentContent }
	});
	return { success: data.updateComment };
}

/**
 * updateParagraphText: Recursively update text in paragraph blocks
 *
 * @param block - Block object
 * @param newText - New text content
 * @returns Whether update succeeded
 */
function updateParagraphText(block: any, newText: string): boolean {
	if (!block) return false;

	// If paragraph type, update text
	if (block.flavour === 'affine:paragraph') {
		block.props = block.props || {};
		block.props.text = {
			'$blocksuite:internal:text$': true,
			delta: [{ insert: newText }]
		};
		return true;
	}

	// Recursively search children
	if (block.children && Array.isArray(block.children)) {
		for (const child of block.children) {
			if (updateParagraphText(child, newText)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * deleteCommentHandler: Delete a comment
 *
 * Description:
 * - Deletes the specified comment
 * - If docId is not provided, automatically searches workspace documents
 * - Removes comment marks from the document before deletion
 *
 * @param params.id - Comment ID (required)
 * @param params.workspaceId - Workspace ID (optional, defaults to configured workspace)
 * @param params.docId - Document ID (optional, auto-search)
 * @returns Deletion result object
 */
export async function deleteCommentHandler(params: {
	id: string;
	workspaceId?: string;
	docId?: string;
}): Promise<any> {
	const gql = await createGraphQLClient();

	const workspaceId = params.workspaceId || (await getWorkspaceId());
	let docId: string | null = params.docId || null;

	// If docId not provided, try to find the comment in workspace documents
	if (!docId) {
		docId = await findCommentDocId(gql, workspaceId, params.id);
	}

	// If docId found, remove comment marks from document first
	if (docId) {
		try {
			await removeCommentMarkFromDocument(workspaceId, docId, params.id);
		} catch (err) {
			console.error('Failed to remove comment mark:', err);
		}
	}

	// Delete the comment
	const mutation = `mutation DeleteComment($id:String!){ deleteComment(id:$id) }`;
	const data: any = await gql.request(mutation, {
		id: params.id
	});
	return { success: data.deleteComment };
}

/**
 * findCommentDocId: Find the document ID that a comment belongs to
 *
 * Description:
 * - Iterates all documents in the workspace
 * - Searches for the specified comment ID in each document's comments
 * - Returns the found document ID
 *
 * @param gql - GraphQL client
 * @param workspaceId - Workspace ID
 * @param commentId - Comment ID
 * @returns Document ID, or null if not found
 */
async function findCommentDocId(
	gql: any,
	workspaceId: string,
	commentId: string
): Promise<string | null> {
	// Get workspace document list
	const docsQuery = `query ListDocs($workspaceId: String!, $first: Int) {
		workspace(id: $workspaceId) {
			docs(pagination: { first: $first }) {
				edges {
					node {
						id
					}
				}
			}
		}
	}`;

	try {
		const docsData = await gql.request(docsQuery, { workspaceId, first: 100 });
		const docIds: string[] = docsData.workspace?.docs?.edges?.map((e: any) => e.node.id) || [];

		// Search for the comment in each document in parallel
		const promises = docIds.map(async (docId: string) => {
			const commentQuery = `query CheckComment($workspaceId: String!, $docId: String!) {
				workspace(id: $workspaceId) {
					comments(docId: $docId, pagination: { first: 100 }) {
						edges {
							node {
								id
							}
						}
					}
				}
			}`;
			const data = await gql.request(commentQuery, { workspaceId, docId });
			const comments = data.workspace?.comments?.edges || [];
			for (const edge of comments) {
				if (edge.node.id === commentId) {
					return docId;
				}
			}
			return null;
		});

		const results = await Promise.all(promises);
		return results.find((id) => id !== null) || null;
	} catch (err) {
		// Ignore errors
	}

	return null;
}

/**
 * removeCommentMarkFromDocument: Remove comment marks from document
 *
 * Description:
 * - Iterates all text blocks in the document
 * - Finds and removes marks for the specified comment
 * - Updates the document in real-time via WebSocket + Yjs
 *
 * @param workspaceId - Workspace ID
 * @param docId - Document ID
 * @param endpoint - GraphQL endpoint
 * @param cookie - Auth cookie
 * @param bearer - Auth bearer token
 * @param commentId - Comment ID
 */
async function removeCommentMarkFromDocument(
	workspaceId: string,
	docId: string,
	commentId: string
): Promise<void> {
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// Get document state
		const snapshot = await loadDoc(socket, workspaceId, docId);

		// Apply state to Y.Doc
		const yDoc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(yDoc, Buffer.from(snapshot.missing, 'base64'));
		} else if (snapshot.state) {
			Y.applyUpdate(yDoc, Buffer.from(snapshot.state, 'base64'));
		}

		if (!snapshot.missing && !snapshot.state) {
			return;
		}

		// Find and remove comment marks
		const blocks = yDoc.getMap('blocks');
		const markKey = `comment-${commentId}`;
		let modified = false;

		for (const [_, block] of blocks) {
			if (!(block instanceof Y.Map)) continue;

			// Check all possible text properties
			const textKeys: string[] = [];
			block.forEach((_: any, key: string) => {
				if (key.startsWith('prop:text') || key === 'prop:title') {
					textKeys.push(key);
				}
			});

			for (const key of textKeys) {
				const yText = block.get(key) as Y.Text | undefined;
				if (!yText || !(yText instanceof Y.Text)) continue;

				// Get delta snapshot first
				const delta = yText.toDelta();
				for (let i = 0; i < delta.length; i++) {
					const d = delta[i];
					if (d.attributes && markKey in d.attributes) {
						// Found comment mark, calculate position
						let pos = 0;
						for (let j = 0; j < i; j++) {
							if (delta[j].insert) {
								pos +=
									typeof delta[j].insert === 'string'
										? delta[j].insert.length
										: 1;
							}
						}
						const len = typeof d.insert === 'string' ? d.insert.length : 1;

						// Remove the comment mark - use null to clear the attribute
						yText.format(pos, len, { [markKey]: null });
						modified = true;
					}
				}
			}
		}

		if (modified) {
			// Send update to server
			await updateYDoc(socket, workspaceId, docId, yDoc);
		}
	} finally {
	}
}

/**
 * resolveCommentHandler: Resolve/unresolve a comment
 *
 * Description:
 * - Sets the resolved state of a comment
 * - true means resolved, false means unresolved
 *
 * @param params.id - Comment ID (required)
 * @param params.resolved - Whether resolved (required)
 * @returns Operation result object
 */
export async function resolveCommentHandler(params: {
	id: string;
	resolved: boolean;
}): Promise<any> {
	const gql = await createGraphQLClient();
	const mutation = `mutation ResolveComment($input: CommentResolveInput!){ resolveComment(input:$input) }`;
	const data = await gql.request<{ resolveComment: boolean }>(mutation, {
		input: params
	});
	return { success: data.resolveComment };
}
