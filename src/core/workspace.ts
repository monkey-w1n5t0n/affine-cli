/**
 * Workspace core module
 * Handles workspace operations such as getting workspace list
 */

import { createGraphQLClient } from '../utils/graphqlClient.js';
import { getWorkspaceMetaNames } from '../utils/wsClient.js';
import { writeWorkspaceCache } from '../utils/workspaceCache.js';

export interface WorkspaceInfo {
	id: string;
	name: string | null;
	public: boolean;
	enableAi: boolean;
	createdAt: string;
}

export async function workspaceListHandler(): Promise<WorkspaceInfo[]> {
	const gql = await createGraphQLClient();

	const query = `query { workspaces { id public enableAi createdAt } }`;
	const data = await gql.request<{ workspaces: any[] }>(query);

	const workspaces = data.workspaces || [];
	const ids = workspaces.map((ws: any) => ws.id);
	const names = await getWorkspaceMetaNames(ids);

	writeWorkspaceCache(names);

	return workspaces.map((ws: any) => ({
		id: ws.id,
		name: names.get(ws.id) ?? null,
		public: ws.public,
		enableAi: ws.enableAi,
		createdAt: new Date(ws.createdAt).toLocaleString('zh-CN')
	}));
}
