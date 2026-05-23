/**
 * Workspace core module
 * Handles workspace operations such as getting workspace list
 */

import { createGraphQLClient } from '../utils/graphqlClient.js';

/**
 * Workspace basic info interface
 */
export interface WorkspaceInfo {
	id: string;           // Workspace ID
	public: boolean;      // Whether public
	enableAi: boolean;    // Whether AI is enabled
	createdAt: string;    // Creation time (localized string)
}

/**
 * Get workspace list handler
 *
 * Fetches all workspace basic info for the current user via GraphQL query
 *
 * @returns Workspace info array, containing:
 *   - id: Workspace ID
 *   - public: Whether public
 *   - enableAi: Whether AI is enabled
 *   - createdAt: Creation time (localized format)
 *
 * @example
 * const workspaces = await workspaceListHandler();
 * // Returns: [{ id: 'ws123', public: false, enableAi: true, createdAt: '2024/1/1' }, ...]
 */
export async function workspaceListHandler(): Promise<WorkspaceInfo[]> {
	const gql = await createGraphQLClient();

	const query = `query { workspaces { id public enableAi createdAt } }`;
	const data = await gql.request<{ workspaces: any[] }>(query);

	return (data.workspaces || []).map((ws: any) => ({
		id: ws.id,
		public: ws.public,
		enableAi: ws.enableAi,
		createdAt: new Date(ws.createdAt).toLocaleString('zh-CN')
	}));
}
