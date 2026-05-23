/**
 * Module: graphqlClient.ts
 * GraphQL client module
 *
 * Description:
 * - Provides functionality for interacting with Affine GraphQL API
 * - Supports cookie and Bearer token authentication
 * - Handles request timeout and errors
 *
 * Exported classes and functions:
 * - GraphQLClient: GraphQL client class
 * - createGraphQLClient: Create GraphQL client instance
 */

import { fetch } from 'undici';
import { loadConfig } from './config.js';
import { CLI_VERSION } from './version.js';

const GRAPHQL_FETCH_TIMEOUT_MS = 30_000;

/**
 * GraphQL client class
 */
export class GraphQLClient {
	private _headers: Record<string, string>;
	private authenticated: boolean = false;

	constructor(
		private _endpoint: string,
		headers?: Record<string, string>,
		bearer?: string
	) {
		this._headers = { ...(headers || {}) };

		// Set authentication (priority: Bearer token > cookie)
		if (bearer) {
			this._headers['Authorization'] = `Bearer ${bearer}`;
			this.authenticated = true;
		} else if (this._headers.Cookie) {
			this.authenticated = true;
		}
	}

	/** GraphQL endpoint URL */
	get endpoint(): string {
		return this._endpoint;
	}

	/** Get current request headers */
	get headers(): Record<string, string> {
		return { ...this._headers };
	}

	/** Get cookie value */
	get cookie(): string {
		return this._headers['Cookie'] || '';
	}

	/** Get Bearer token */
	get bearer(): string {
		const auth = this._headers['Authorization'] || '';
		return auth.startsWith('Bearer ') ? auth.slice(7) : '';
	}

	/** Check if authenticated */
	isAuthenticated(): boolean {
		return this.authenticated;
	}

	/**
	 * Execute GraphQL request
	 * @param query Query string
	 * @param variables Query variables
	 * @returns Query result
	 */
	async request<T>(query: string, variables?: Record<string, any>): Promise<T> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'User-Agent': `affine-cli/${CLI_VERSION}`,
			...this._headers
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), GRAPHQL_FETCH_TIMEOUT_MS);
		let res;
		try {
			res = await fetch(this.endpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify({ query, variables }),
				signal: controller.signal
			});
		} catch (err: any) {
			if (err.name === 'AbortError')
				throw new Error(`Request timeout (${GRAPHQL_FETCH_TIMEOUT_MS / 1000}s)`);
			throw err;
		} finally {
			clearTimeout(timer);
		}

		if (!res.ok) {
			let body: string;
			try {
				const json = (await res.json()) as any;
				body = json.errors?.map((e: any) => e.message).join('; ') || JSON.stringify(json);
			} catch {
				body = await res.text().catch(() => '(unable to read response body)');
			}
			throw new Error(`GraphQL HTTP ${res.status}: ${body}`);
		}

		const json = (await res.json()) as any;
		if (json.errors) {
			const msg = json.errors.map((e: any) => e.message).join('; ');
			throw new Error(`GraphQL error: ${msg}`);
		}
		return json.data as T;
	}
}

let cachedClient: GraphQLClient | null = null;

export function clearGraphQLClientCache() {
	cachedClient = null;
}

/**
 * Create GraphQL client instance
 * @returns GraphQL client
 */
export async function createGraphQLClient(): Promise<GraphQLClient> {
	if (cachedClient) return cachedClient;

	const config = loadConfig();
	const apiToken = config.apiToken;

	const headers: Record<string, string> = {};

	const gql = new GraphQLClient(`${config.baseUrl}/graphql`, headers, apiToken);

	if (!gql.isAuthenticated()) {
		throw new Error(
			'Authentication not configured. Run affine-skill auth login or set AFFINE_API_TOKEN environment variable'
		);
	}

	cachedClient = gql;
	return gql;
}
