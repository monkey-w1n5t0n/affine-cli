/**
 * Authentication core module
 * Handles login, logout, status check, and other auth operations
 *
 * Supported authentication methods:
 * 1. Email/password login (auto-generates API Token)
 * 2. API Token login (manually obtained or pasted)
 *
 * Config storage:
 * - Global config: ~/.affine-cli/affine-cli.env
 * - Local config: current directory .env
 */

import * as readline from 'readline';
import {
	loadConfigFile,
	writeConfigFile,
	validateBaseUrl,
	redactSecret,
	GLOBAL_CONFIG_FILE
} from '../utils/config.js';
import { loginWithPassword } from '../utils/auth.js';
import { GraphQLClient } from '../utils/graphqlClient.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/* ============================================================================
 * Interactive input helpers
 * ============================================================================ */

/**
 * Generic interactive input function
 *
 * Prompts user for input, supports visible and hidden modes
 *
 * @param prompt - Prompt text
 * @param hidden - Whether to hide input (password mode)
 * @returns User input string
 *
 * @example
 * const name = await ask('Enter name: ');
 * const password = await ask('Enter password: ', true);
 */
function ask(prompt: string, hidden = false): Promise<string> {
	if (hidden && process.stdin.isTTY) {
		return readHidden(prompt);
	}
	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stderr,
			terminal: process.stdin.isTTY ?? false
		});
		rl.question(prompt, (answer) => {
			rl.close();
			resolve((answer || '').trim());
		});
	});
}

/**
 * Hidden input implementation (TTY password input)
 *
 * Uses raw mode to capture keyboard input, supports backspace and Ctrl+C to cancel
 *
 * @param prompt - Prompt text
 * @returns User input string
 * @throws Error when user presses Ctrl+C
 */
function readHidden(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		process.stderr.write(prompt);
		const buf: string[] = [];
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.setEncoding('utf8');
		const onData = (ch: string) => {
			switch (ch) {
				case '\r':
				case '\n':
					cleanup();
					process.stderr.write('\n');
					resolve(buf.join(''));
					break;
				case '': // Ctrl+C
					cleanup();
					process.stderr.write('\n');
					reject(new Error('Cancelled'));
					break;
				case '':
				case '\b': // Backspace
					buf.pop();
					break;
				default:
					buf.push(ch);
			}
		};
		const cleanup = () => {
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stdin.removeListener('data', onData);
		};
		process.stdin.on('data', onData);
	});
}

/* ============================================================================
 * GraphQL request helpers
 * ============================================================================ */

/**
 * Execute GraphQL request (for login phase)
 *
 * Wraps GraphQL POST request, supports Token and Cookie authentication
 *
 * @param baseUrl - Affine server base URL
 * @param auth - Auth info { token?, cookie? }
 * @param query - GraphQL query string
 * @param variables - Optional variables object
 * @returns Parsed response data
 * @throws Network error, timeout, GraphQL error
 */
async function gql(
	baseUrl: string,
	auth: { token?: string; cookie?: string },
	query: string,
	variables?: Record<string, any>
): Promise<any> {
	const headers: Record<string, string> = {};
	if (auth.token) {
		headers['Authorization'] = `Bearer ${auth.token}`;
	}
	if (auth.cookie) {
		headers['Cookie'] = auth.cookie;
	}

	const client = new GraphQLClient(`${baseUrl}/graphql`, headers);
	return await client.request(query, variables);
}

/**
 * Check connection and get user info
 *
 * Validates authentication via GraphQL query and gets current user info
 *
 * @param baseUrl - Affine server base URL
 * @param auth - Auth info
 * @returns User info object { userName, userEmail, workspaceCount }
 * @throws Authentication failed
 */
async function inspectConnection(
	baseUrl: string,
	auth: { token?: string; cookie?: string }
): Promise<{ userName: string; userEmail: string; workspaceCount: number }> {
	const data = await gql(baseUrl, auth, 'query { currentUser { name email } workspaces { id } }');
	return {
		userName: data.currentUser.name,
		userEmail: data.currentUser.email,
		workspaceCount: data.workspaces.length
	};
}

/**
 * Detect and select workspace
 *
 * If a preferred workspace ID is specified, uses it directly; otherwise lists all workspaces for user to select
 *
 * @param baseUrl - Affine server base URL
 * @param auth - Auth info
 * @param preferredWorkspaceId - Preferred workspace ID (optional)
 * @returns Selected workspace ID
 * @throws No available workspaces or invalid selection
 */
async function detectWorkspace(
	baseUrl: string,
	auth: { token?: string; cookie?: string },
	preferredWorkspaceId?: string
): Promise<string> {
	if (preferredWorkspaceId) {
		console.error(`Using specified workspace: ${preferredWorkspaceId}`);
		return preferredWorkspaceId;
	}

	console.error('Detecting workspace...');
	const data = await gql(baseUrl, auth, `query {workspaces {id createdAt}}`);

	const workspaces: any[] = data.workspaces;
	if (workspaces.length === 0) {
		console.error('  No workspaces found');
		throw new Error('No available workspaces, please create one first');
	}

	const formatWs = (w: any) => {
		const date = w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '';
		return `${w.id}  (${date})`;
	};

	if (workspaces.length === 1) {
		console.error(`  Found 1 workspace: ${formatWs(workspaces[0])}`);
		console.error('  Auto-selected');
		return workspaces[0].id;
	}

	console.error(`  Found ${workspaces.length} workspaces:`);
	workspaces.forEach((w, i) => console.error(`    ${i + 1}) ${formatWs(w)}`));
	const choice = (await ask(`\nSelect [1]: `)) || '1';
	const idx = parseInt(choice, 10) - 1;
	if (idx < 0 || idx >= workspaces.length) {
		throw new Error('Invalid selection');
	}
	return workspaces[idx].id;
}

/* ============================================================================
 * Login handler
 * ============================================================================ */

/**
 * Login handler
 *
 * Main login entry point, supports multiple login methods:
 * 1. Direct API Token (--token param)
 * 2. Interactive selection: email/password login or paste Token
 *
 * Config save location:
 * - --local: current directory .env
 * - Default: ~/.affine-cli/affine-cli.env
 *
 * @param params - Parameter object
 * @param params.url - Affine server URL (default https://app.affine.pro)
 * @param params.token - API Token (optional)
 * @param params.workspaceId - Preferred workspace ID (optional)
 * @param params.local - Whether to save to local config
 * @param params.force - Whether to force overwrite existing config
 * @returns Login result { success, message, baseUrl, workspaceId }
 *
 * @example
 * // Login with Token
 * await authLoginHandler({ token: 'xxx', workspaceId: 'ws123' });
 *
 * // Interactive login
 * await authLoginHandler({});
 */
export async function authLoginHandler(params: {
	url?: string;
	token?: string;
	workspaceId?: string;
	local?: boolean;
	force?: boolean;
}): Promise<any> {
	console.error('Affine Skill CLI — Login\n');

	const configFile = params.local
		? path.join(process.cwd(), '.env')
		: path.join(os.homedir(), '.affine-cli', 'affine-cli.env');

	const existing = loadConfigFile();
	if (existing.AFFINE_API_TOKEN && !params.force) {
		console.error(`Existing config: ${configFile}`);
		console.error(`  URL:       ${existing.AFFINE_BASE_URL || '(default)'}`);
		console.error('  Token:     (set)');
		console.error(`  Workspace: ${existing.AFFINE_WORKSPACE_ID || '(none)'}\n`);
		const overwrite = await ask('Overwrite? [y/N] ');
		if (!/^[yY]$/.test(overwrite)) {
			console.error('Keeping existing config');
			return { success: false, message: 'Cancelled' };
		}
		console.error('');
	}

	const defaultUrl = existing.AFFINE_BASE_URL || 'https://app.affine.pro';
	const rawUrl = params.url ?? ((await ask(`Affine URL [${defaultUrl}]: `)) || defaultUrl);
	const baseUrl = validateBaseUrl(rawUrl);

	let result: { token: string; workspaceId: string };

	if (params.token) {
		console.error('Testing provided Token...');
		try {
			const info = await inspectConnection(baseUrl, { token: params.token });
			console.error(`✓ Authenticated as: ${info.userName} <${info.userEmail}>\n`);
		} catch (err: any) {
			throw new Error(`Authentication failed: ${err.message}`);
		}
		result = {
			token: params.token,
			workspaceId: await detectWorkspace(baseUrl, { token: params.token }, params.workspaceId)
		};
	} else {
		const method = await ask('\nLogin method — [1] Email/password (recommended)  [2] Paste API Token: ');
		if (method === '2') {
			result = await loginWithToken(baseUrl, params.workspaceId);
		} else {
			result = await loginWithEmail(baseUrl, params.workspaceId);
		}
	}

	writeConfigFile(
		{
			AFFINE_BASE_URL: baseUrl,
			AFFINE_API_TOKEN: result.token,
			AFFINE_WORKSPACE_ID: result.workspaceId
		},
		params.local
	);

	console.error(`\n✓ Saved to ${configFile}`);
	return {
		success: true,
		message: 'Login successful',
		baseUrl,
		workspaceId: result.workspaceId
	};
}

/**
 * Email/password login
 *
 * Logs in with email and password, auto-creates API Token for subsequent use
 *
 * @param baseUrl - Affine server base URL
 * @param preferredWorkspaceId - Preferred workspace ID (optional)
 * @returns Login result { token, workspaceId }
 * @throws Login failed, session validation failed, Token creation failed
 */
async function loginWithEmail(
	baseUrl: string,
	preferredWorkspaceId?: string
): Promise<{ token: string; workspaceId: string }> {
	const email = await ask('Email: ');
	const password = await ask('Password: ', true);
	if (!email || !password) {
		throw new Error('Email and password cannot be empty');
	}

	console.error('Logging in...');
	let cookieHeader: string;
	try {
		({ cookieHeader } = await loginWithPassword(baseUrl, email, password));
	} catch (err: any) {
		throw new Error(`Login failed: ${err.message}`);
	}

	const auth = { cookie: cookieHeader };
	try {
		const data = await gql(baseUrl, auth, 'query { currentUser { name email } }');
		console.error(`✓ Logged in as: ${data.currentUser.name} <${data.currentUser.email}>\n`);
	} catch (err: any) {
		throw new Error(`Session validation failed: ${err.message}`);
	}

	console.error('Generating API Token...');
	let token: string;
	try {
		const data = await gql(
			baseUrl,
			auth,
			`mutation($input: GenerateAccessTokenInput!) { generateUserAccessToken(input: $input) { id name token } }`,
			{ input: { name: `affine-cli-${new Date().toISOString().slice(0, 10)}` } }
		);
		token = data.generateUserAccessToken.token;
		console.error(`✓ Token created (name: ${data.generateUserAccessToken.name})\n`);
	} catch (err: any) {
		throw new Error(
			`Failed to create Token: ${err.message}\n` +
				'You can manually create one in Affine Settings → Integrations → MCP Server'
		);
	}

	const workspaceId = await detectWorkspace(baseUrl, { token }, preferredWorkspaceId);
	return { token, workspaceId };
}

/**
 * Token login
 *
 * User manually obtains API Token and pastes it to login
 *
 * @param baseUrl - Affine server base URL
 * @param preferredWorkspaceId - Preferred workspace ID (optional)
 * @returns Login result { token, workspaceId }
 * @throws Token not provided, authentication failed
 */
async function loginWithToken(
	baseUrl: string,
	preferredWorkspaceId?: string
): Promise<{ token: string; workspaceId: string }> {
	console.error('\nHow to generate a Token:');
	console.error(`  1. Open ${baseUrl}/settings in your browser`);
	console.error('  2. Account Settings → Integrations → MCP Server');
	console.error('  3. Copy Personal access token\n');

	const token = await ask('API Token: ', true);
	if (!token) {
		throw new Error('Token not provided');
	}

	console.error('Testing connection...');
	try {
		const data = await gql(baseUrl, { token }, 'query { currentUser { name email } }');
		console.error(`✓ Authenticated as: ${data.currentUser.name} <${data.currentUser.email}>\n`);
	} catch (err: any) {
		throw new Error(`Authentication failed: ${err.message}`);
	}

	const workspaceId = await detectWorkspace(baseUrl, { token }, preferredWorkspaceId);
	return { token, workspaceId };
}

/**
 * Logout handler
 *
 * Deletes config file, supports local and global config
 *
 * @param params - Parameter object
 * @param params.local - Whether to delete local config (deletes global config by default)
 * @returns Logout result { success, message }
 *
 * @example
 * // Logout globally
 * await authLogoutHandler({});
 *
 * // Logout locally
 * await authLogoutHandler({ local: true });
 */
export async function authLogoutHandler(params: { local?: boolean }): Promise<any> {
	const configFile = params.local ? process.cwd() + '/.env' : GLOBAL_CONFIG_FILE;
	if (fs.existsSync(configFile)) {
		fs.unlinkSync(configFile);
		console.error(`Removed ${configFile}`);
		return { success: true, message: 'Logged out' };
	} else {
		console.error('Config file not found');
		return { success: false, message: 'Config file not found' };
	}
}

/**
 * Status check handler
 *
 * Checks current login status, displays user info and config details
 *
 * @param params - Parameter object
 * @param params.json - Whether to output in JSON format (default false)
 * @returns Status info object, containing config details and user info
 * @throws Not logged in, connection failed
 *
 * @example
 * // Simple output
 * await authStatusHandler({});
 *
 * // JSON output
 * await authStatusHandler({ json: true });
 */
export async function authStatusHandler(params: { json?: boolean }): Promise<any> {
	const config = loadConfigFile();
	if (!config.AFFINE_API_TOKEN) {
		throw new Error('Not logged in. Please run: affine-cli auth login');
	}

	try {
		const inspection = await inspectConnection(
			config.AFFINE_BASE_URL || 'https://app.affine.pro',
			{ token: config.AFFINE_API_TOKEN }
		);

		if (params.json) {
			return {
				configFile: GLOBAL_CONFIG_FILE,
				baseUrl: config.AFFINE_BASE_URL || 'https://app.affine.pro',
				workspaceId: config.AFFINE_WORKSPACE_ID || null,
				userName: inspection.userName,
				userEmail: inspection.userEmail,
				workspaceCount: inspection.workspaceCount,
				token: redactSecret(config.AFFINE_API_TOKEN)
			};
		}

		console.error(`Global config: ${GLOBAL_CONFIG_FILE}`);
		console.error(`URL:       ${config.AFFINE_BASE_URL || '(default)'}`);
		console.error(`Token:     ${redactSecret(config.AFFINE_API_TOKEN)}`);
		console.error(`Workspace: ${config.AFFINE_WORKSPACE_ID || '(none)'}\n`);
		console.error(`User: ${inspection.userName} <${inspection.userEmail}>`);
		console.error(`Workspace count: ${inspection.workspaceCount}`);

		return {
			success: true,
			userName: inspection.userName,
			userEmail: inspection.userEmail,
			workspaceCount: inspection.workspaceCount
		};
	} catch (err: any) {
		throw new Error(`Connection failed: ${err.message}`);
	}
}
