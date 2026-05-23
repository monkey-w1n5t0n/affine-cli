/**
 * Journal core module
 * Handles journal listing, creation, appending, and other operations
 *
 * Description:
 * - Journals are essentially documents with the journal property set
 * - Properties are stored in a separate workspace database db$docProperties (SQLite)
 * - Journal property value format is "YYYY-MM-DD" (e.g. "2024-01-15")
 * - Operates on docProperties database via WebSocket + Yjs
 * - Uses the same markdown processing as createDocFromMarkdownCore
 */

import { getWorkspaceId } from '../utils/config.js';
import { createWorkspaceSocket, joinWorkspace, fetchYDoc, updateYDoc } from '../utils/wsClient.js';
import {
	createDocFromMarkdownCore,
	collectDocForMarkdown,
	ensureNoteBlock,
	findBlockById,
	markdownOperationToAppendInput,
	normalizeAppendBlockInput,
	createBlock,
	resolveInsertContext,
	setDocEmojiIcon
} from '../utils/docsUtil.js';
import { renderBlocksToMarkdown } from '../markdown/render.js';
import { parseMarkdownToOperations } from '../markdown/parse.js';
import * as Y from 'yjs';
import * as fs from 'fs';

/**
 * JOURNAL_DATE_FORMAT: Journal date format
 */
export const JOURNAL_DATE_FORMAT = 'YYYY-MM-DD';

/**
 * isValidJournalString: Validate if value is a valid journal date string
 */
function isValidJournalString(value: unknown): value is string {
	if (!value || typeof value !== 'string') return false;
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return false;

	const year = parseInt(match[1]);
	const month = parseInt(match[2]);
	const day = parseInt(match[3]);

	if (month < 1 || month > 12) return false;
	if (day < 1 || day > 31) return false;

	const daysInMonth = [
		31,
		28 + (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0),
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31
	];
	if (day > daysInMonth[month - 1]) return false;

	return true;
}

/**
 * formatJournalDate: Format date as journal format (using local timezone)
 */
function formatJournalDate(date?: string | Date | number): string {
	/**
	 * Get local date string (YYYY-MM-DD format)
	 * Uses local timezone instead of UTC to ensure journal date matches user's local date
	 */
	function getLocalDateString(d: Date): string {
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	if (!date) {
		return getLocalDateString(new Date());
	}

	if (date instanceof Date) {
		return getLocalDateString(date);
	}

	if (typeof date === 'string') {
		if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			return date;
		}
		const d = new Date(date);
		if (!isNaN(d.getTime())) {
			return getLocalDateString(d);
		}
	}

	if (typeof date === 'number') {
		return getLocalDateString(new Date(date));
	}

	return getLocalDateString(new Date());
}

/**
 * getDocPropertiesDocId: Get the special document ID for the docProperties database
 */
function getDocPropertiesDocId(): string {
	return 'db$docProperties';
}

/**
 * journalListHandler: List all journals in the workspace
 */
export async function journalListHandler(params: {
	workspace?: string;
	count?: number;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const limit = params.count || 20;

	try {
		await joinWorkspace(socket, workspaceId);

		const { doc: wsDoc, exists: wsSnapExists } = await fetchYDoc(
			socket,
			workspaceId,
			workspaceId
		);
		if (!wsSnapExists) {
			return { totalCount: 0, journals: [] };
		}

		const wsMeta = wsDoc.getMap('meta');
		const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

		if (!pages) {
			return { totalCount: 0, journals: [] };
		}

		const docPropsDocId = getDocPropertiesDocId();
		const { doc: propsDoc, exists: propsDocExists } = await fetchYDoc(
			socket,
			workspaceId,
			docPropsDocId
		);

		const journals: Array<{
			id: string;
			title: string;
			date: string;
			createDate?: number;
			updateDate?: number;
		}> = [];

		if (propsDocExists) {
			for (let i = 0; i < pages.length; i++) {
				const page = pages.get(i);
				if (!(page instanceof Y.Map)) continue;

				const docId = page.get('id');
				if (!docId) continue;

				const docPropsMap = propsDoc.getMap(docId);
				const journalValue = docPropsMap?.get('journal');

				if (journalValue && isValidJournalString(journalValue)) {
					const title = page.get('title') || journalValue;
					const createDate = page.get('createDate');
					const updateDate = page.get('updateDate');

					journals.push({
						id: docId,
						title,
						date: journalValue,
						createDate,
						updateDate
					});
				}
			}
		}

		journals.sort((a, b) => b.date.localeCompare(a.date));
		const results = journals.slice(0, limit);

		return {
			totalCount: journals.length,
			journals: results
		};
	} finally {
	}
}

/**
 * setJournalPropertyInDocProperties: Set journal property in docProperties database
 */
async function setJournalPropertyInDocProperties(
	socket: any,
	workspaceId: string,
	docId: string,
	date: string
): Promise<void> {
	const docPropsDocId = getDocPropertiesDocId();

	const {
		doc: existingDoc,
		exists,
		prevSV
	} = await fetchYDoc(socket, workspaceId, docPropsDocId);

	if (!exists) {
		const newDoc = new Y.Doc();
		const docPropsMap = newDoc.getMap(docId);
		docPropsMap.set('journal', date);

		await updateYDoc(socket, workspaceId, docPropsDocId, newDoc);
	} else {
		const docPropsMap = existingDoc.getMap(docId);
		docPropsMap.set('journal', date);

		await updateYDoc(socket, workspaceId, docPropsDocId, existingDoc, prevSV);
	}
}

/**
 * getJournalPropertyFromDocProperties: Get journal property from docProperties database
 */
async function getJournalPropertyFromDocProperties(
	socket: any,
	workspaceId: string,
	docId: string
): Promise<string | undefined> {
	const docPropsDocId = getDocPropertiesDocId();
	const { doc: propsDoc, exists: propsDocExists } = await fetchYDoc(
		socket,
		workspaceId,
		docPropsDocId
	);

	if (!propsDocExists) return undefined;

	const docPropsMap = propsDoc.getMap(docId);
	if (!docPropsMap) return undefined;

	const journalValue = docPropsMap.get('journal');
	if (isValidJournalString(journalValue)) {
		return journalValue;
	}

	return undefined;
}

/**
 * findJournalByDate: Find journal by date
 */
async function findJournalByDate(
	socket: any,
	workspaceId: string,
	date: string
): Promise<{ id: string; title: string } | null> {
	const { doc: wsDoc, exists: wsSnapExists } = await fetchYDoc(socket, workspaceId, workspaceId);
	if (!wsSnapExists) return null;

	const wsMeta = wsDoc.getMap('meta');
	const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;
	if (!pages) return null;

	const docPropsDocId = getDocPropertiesDocId();
	const { doc: propsDoc, exists: propsDocExists } = await fetchYDoc(
		socket,
		workspaceId,
		docPropsDocId
	);

	if (!propsDocExists) return null;

	for (let i = 0; i < pages.length; i++) {
		const page = pages.get(i);
		if (!(page instanceof Y.Map)) continue;

		const docId = page.get('id');
		if (!docId) continue;

		const docPropsMap = propsDoc.getMap(docId);
		const journalValue = docPropsMap?.get('journal');

		if (journalValue === date && isValidJournalString(journalValue)) {
			const title = page.get('title') || date;
			return { id: docId, title };
		}
	}

	return null;
}

/**
 * journalCreateHandler: Create a new journal
 */
export async function journalCreateHandler(params: {
	date?: string;
	content?: string;
	workspace?: string;
	icon?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const journalDate = formatJournalDate(params.date);
	const title = params.icon ? `${params.icon} ${journalDate}` : journalDate;

	try {
		await joinWorkspace(socket, workspaceId);

		const existingJournal = await findJournalByDate(socket, workspaceId, journalDate);
		if (existingJournal) {
			if (params.icon) {
				await setDocEmojiIcon(workspaceId, existingJournal.id, params.icon);
			}
			return {
				success: true,
				exists: true,
				message: `Journal for ${journalDate} already exists`,
				docId: existingJournal.id,
				title: existingJournal.title,
				date: journalDate
			};
		}

		const result = await createDocFromMarkdownCore({
			workspaceId,
			title,
			markdown: params.content || '',
			tags: undefined,
			folder: undefined
		});

		await setJournalPropertyInDocProperties(socket, workspaceId, result.docId, journalDate);

		if (params.icon) {
			await setDocEmojiIcon(workspaceId, result.docId, params.icon);
		}

		return {
			success: true,
			exists: false,
			message: params.icon ? `Journal ${journalDate} created, icon: ${params.icon}` : `Journal ${journalDate} created`,
			docId: result.docId,
			title,
			date: journalDate
		};
	} finally {
	}
}

/**
 * journalAppendHandler: Append content to journal
 * Uses the same markdown processing as createDocFromMarkdownCore
 */
export async function journalAppendHandler(params: {
	id?: string;
	date?: string;
	content: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	let content = params.content;
	if (content && fs.existsSync(content)) {
		content = fs.readFileSync(content, 'utf-8');
	}

	if (!content || !content.trim()) {
		return {
			success: true,
			message: 'No content to append'
		};
	}

	let targetDocId = params.id;

	try {
		await joinWorkspace(socket, workspaceId);

		if (!targetDocId) {
			const journalDate = formatJournalDate(params.date);
			const journal = await findJournalByDate(socket, workspaceId, journalDate);
			if (!journal) {
				throw new Error(`Journal for ${journalDate} does not exist, please create it first`);
			}
			targetDocId = journal.id;
		}

		const {
			doc: doc,
			exists: snapExists,
			prevSV: prevSV
		} = await fetchYDoc(socket, workspaceId, targetDocId);
		if (!snapExists) {
			throw new Error(`Document ${targetDocId} does not exist`);
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

		const noteId = ensureNoteBlock(blocks);
		const noteBlock = findBlockById(blocks, noteId);
		if (!noteBlock) {
			throw new Error('Unable to resolve note block');
		}

		// Uses the same processing as createDocFromMarkdownCore
		let lastInsertedBlockId: string | undefined;
		let appendedCount = 0;

		for (const operation of operations) {
			const placement = lastInsertedBlockId
				? { afterBlockId: lastInsertedBlockId }
				: { parentId: noteId };

			// strict: false skips URL validation
			const input = markdownOperationToAppendInput(
				operation,
				targetDocId,
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

		await updateYDoc(socket, workspaceId, targetDocId, doc, prevSV);

		return {
			success: true,
			message: `Appended ${appendedCount} content blocks to journal`,
			docId: targetDocId
		};
	} finally {
	}
}

/**
 * journalInfoHandler: Get journal details
 */
export async function journalInfoHandler(params: {
	id?: string;
	date?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	let targetDocId = params.id;

	try {
		await joinWorkspace(socket, workspaceId);

		if (!targetDocId) {
			const journalDate = formatJournalDate(params.date);
			const journal = await findJournalByDate(socket, workspaceId, journalDate);
			if (!journal) {
				throw new Error(`Journal for ${journalDate} does not exist`);
			}
			targetDocId = journal.id;
		}

		const { doc: wsDoc } = await fetchYDoc(socket, workspaceId, workspaceId);
		const wsMeta = wsDoc.getMap('meta');
		const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

		let docTitle = '';
		let createDate: number | undefined;
		let updateDate: number | undefined;

		if (pages) {
			for (let i = 0; i < pages.length; i++) {
				const page = pages.get(i);
				if (page instanceof Y.Map && page.get('id') === targetDocId) {
					docTitle = page.get('title') || '';
					createDate = page.get('createDate');
					updateDate = page.get('updateDate');
					break;
				}
			}
		}

		const journalDate = await getJournalPropertyFromDocProperties(
			socket,
			workspaceId,
			targetDocId
		);

		const { doc: doc, exists: snapExists } = await fetchYDoc(socket, workspaceId, targetDocId);
		if (!snapExists) {
			throw new Error(`Document ${targetDocId} does not exist`);
		}

		const collected = collectDocForMarkdown(doc);
		const rendered = renderBlocksToMarkdown({
			rootBlockIds: collected.rootBlockIds,
			blocksById: collected.blocksById
		});

		return {
			id: targetDocId,
			title: docTitle,
			date: journalDate,
			createdAt: createDate ? new Date(createDate).toLocaleString('zh-CN') : undefined,
			updatedAt: updateDate ? new Date(updateDate).toLocaleString('zh-CN') : undefined,
			markdown: rendered.markdown,
			markdownWarnings: rendered.warnings,
			markdownStats: rendered.stats
		};
	} finally {
	}
}

/**
 * journalUpdateHandler: Full update of journal content
 * Uses the same markdown processing as createDocFromMarkdownCore
 */
export async function journalUpdateHandler(params: {
	id?: string;
	date?: string;
	content?: string;
	workspace?: string;
	icon?: string;
}): Promise<any> {
	const workspaceId = await getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	let content = params.content || '';
	if (content && fs.existsSync(content)) {
		content = fs.readFileSync(content, 'utf-8');
	}

	let targetDocId = params.id;

	try {
		await joinWorkspace(socket, workspaceId);

		if (!targetDocId) {
			const journalDate = formatJournalDate(params.date);
			const journal = await findJournalByDate(socket, workspaceId, journalDate);
			if (!journal) {
				throw new Error(`Journal for ${journalDate} does not exist, please create it first`);
			}
			targetDocId = journal.id;
		}

		if (params.icon) {
			await setDocEmojiIcon(workspaceId, targetDocId, params.icon);
		}

		const {
			doc: doc,
			exists: docExists,
			prevSV
		} = await fetchYDoc(socket, workspaceId, targetDocId);
		if (!docExists) {
			throw new Error(`Document ${targetDocId} does not exist`);
		}

		const blocks = doc.getMap('blocks');

		let noteBlock: Y.Map<any> | undefined;
		for (const [, block] of blocks.entries()) {
			if (block instanceof Y.Map && block.get('sys:flavour') === 'affine:note') {
				noteBlock = block;
				break;
			}
		}

		if (!noteBlock) {
			throw new Error('Document structure error: note block not found');
		}

		const noteChildren = noteBlock.get('sys:children');
		const childIds: string[] = [];
		if (noteChildren instanceof Y.Array) {
			for (let i = 0; i < noteChildren.length; i++) {
				const child = noteChildren.get(i);
				if (typeof child === 'string') {
					childIds.push(child);
				} else if (Array.isArray(child)) {
					childIds.push(...child.filter((c: any) => typeof c === 'string'));
				}
			}
		}

		for (const childId of childIds) {
			blocks.delete(childId);
		}

		if (noteChildren instanceof Y.Array) {
			noteChildren.delete(0, noteChildren.length);
		}

		const parsedMarkdown = parseMarkdownToOperations(content);
		const operations = parsedMarkdown.operations;

		let lastInsertedBlockId: string | undefined;
		let appendedCount = 0;

		if (operations.length > 0) {
			const noteId = noteBlock.get('sys:id');
			for (const operation of operations) {
				const placement = lastInsertedBlockId
					? { afterBlockId: lastInsertedBlockId }
					: { parentId: noteId };

				// strict: false skips URL validation
				const input = markdownOperationToAppendInput(
					operation,
					targetDocId,
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
		}

		await updateYDoc(socket, workspaceId, targetDocId, doc, prevSV);

		return {
			success: true,
			message: params.icon
				? `Journal ${targetDocId} updated, icon: ${params.icon}`
				: `Journal ${targetDocId} updated`,
			docId: targetDocId
		};
	} finally {
	}
}
