/**
 * Workspace name cache.
 *
 * Affine's GraphQL WorkspaceType has no name field — workspace names live in
 * the root Y.Doc at meta.get('name'). Fetching a name requires a WebSocket
 * join + snapshot fetch, so we cache id→name on disk at
 * ~/.affine-cli/workspaces.json and refresh lazily on miss or fully when
 * `workspace list` runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GLOBAL_CONFIG_DIR } from './config.js';
import { getWorkspaceMetaName, getWorkspaceMetaNames } from './wsClient.js';
import { createGraphQLClient } from './graphqlClient.js';

const CACHE_FILE = path.join(GLOBAL_CONFIG_DIR, 'workspaces.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CacheFile {
	version: 1;
	updatedAt: string;
	workspaces: Record<string, { name: string; fetchedAt: string }>;
}

export function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

export function readWorkspaceCache(): Map<string, string> {
	const out = new Map<string, string>();
	if (!fs.existsSync(CACHE_FILE)) return out;
	try {
		const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheFile;
		if (parsed?.workspaces) {
			for (const [id, entry] of Object.entries(parsed.workspaces)) {
				if (entry?.name) out.set(id, entry.name);
			}
		}
	} catch {
		// corrupt or unreadable — treat as empty
	}
	return out;
}

export function writeWorkspaceCache(map: Map<string, string>): void {
	const now = new Date().toISOString();
	const file: CacheFile = {
		version: 1,
		updatedAt: now,
		workspaces: {}
	};
	for (const [id, name] of map) {
		file.workspaces[id] = { name, fetchedAt: now };
	}

	const tmpFile = path.join(GLOBAL_CONFIG_DIR, `.workspaces.tmp.${process.pid}`);
	try {
		fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true, mode: 0o700 });
		fs.writeFileSync(tmpFile, JSON.stringify(file, null, 2), { mode: 0o600 });
		fs.renameSync(tmpFile, CACHE_FILE);
	} catch (err) {
		try {
			fs.unlinkSync(tmpFile);
		} catch {}
		throw err;
	}
}

export function mergeWorkspaceCache(updates: Map<string, string>): void {
	if (updates.size === 0) return;
	const current = readWorkspaceCache();
	for (const [id, name] of updates) current.set(id, name);
	writeWorkspaceCache(current);
}

export async function resolveWorkspaceName(id: string): Promise<string | null> {
	const cache = readWorkspaceCache();
	const hit = cache.get(id);
	if (hit) return hit;
	try {
		const name = await getWorkspaceMetaName(id);
		if (name) {
			mergeWorkspaceCache(new Map([[id, name]]));
			return name;
		}
	} catch {
		// fall through to null
	}
	return null;
}

export async function refreshWorkspaceCache(): Promise<Map<string, string>> {
	const gql = await createGraphQLClient();
	const data = await gql.request<{ workspaces: Array<{ id: string }> }>(
		`query { workspaces { id } }`
	);
	const ids = (data.workspaces || []).map((w) => w.id);
	const names = await getWorkspaceMetaNames(ids);
	writeWorkspaceCache(names);
	return names;
}

export async function resolveWorkspaceIdOrName(input: string): Promise<string> {
	if (isUuid(input)) return input;

	const matchByName = (cache: Map<string, string>): string[] => {
		const matches: string[] = [];
		for (const [id, name] of cache) {
			if (name === input) matches.push(id);
		}
		return matches;
	};

	let matches = matchByName(readWorkspaceCache());
	if (matches.length === 0) {
		// Cache miss — refresh and retry once.
		const refreshed = await refreshWorkspaceCache();
		matches = matchByName(refreshed);
	}

	if (matches.length === 0) {
		throw new Error(`No workspace named "${input}". Run \`affine-cli workspace list\` to see available workspaces.`);
	}
	if (matches.length > 1) {
		throw new Error(
			`Multiple workspaces named "${input}" (${matches.join(', ')}). Pass the UUID directly to disambiguate.`
		);
	}
	return matches[0];
}
