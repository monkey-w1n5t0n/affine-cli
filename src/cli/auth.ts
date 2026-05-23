/**
 * Authentication CLI module
 * Provides login, logout, status query, and other authentication-related commands
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { authLoginHandler, authLogoutHandler, authStatusHandler } from '../core/auth.js';

// /**
//  * Resolve config path parameter
//  * Determines the config file save location based on the --local parameter
//  *
//  * @param isLocal - Whether to save to the local directory
//  * @returns Full path to the config file
//  */
// function resolveConfigPath(isLocal?: boolean): string {
// 	return isLocal ? process.cwd() + '/.env' : 'Global config';
// }

/**
 * Authentication command configuration
 * Defines parameter and handler mappings for all authentication-related commands
 */
const authCommands: Record<string, CommandConfig> = {
	/**
	 * login command: log in with account or Token
	 * Usage: login [--url <url>] [--token <token>] [--workspace <workspace-id>] [--local] [--force]
	 */
	login: {
		name: 'login',
		description: 'Log in with account or Token',
		usage: 'login [--url <url>] [--token <token>] [--workspace <workspace-id>] [--local] [--force]',
		args: [
			{
				name: 'url',
				short: 'u',
				description: 'Affine server URL (default https://app.affine.pro)',
				type: 'string'
			},
			{
				name: 'token',
				short: 't',
				description: 'API Token (optional, enables interactive login if not provided)',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: 'Workspace ID (optional, auto-detected)',
				type: 'string'
			},
			{
				name: 'local',
				description: 'Save to current directory (.env) instead of global config',
				type: 'boolean'
			},
			{
				name: 'force',
				short: 'f',
				description: 'Force overwrite existing config without confirmation prompt',
				type: 'boolean'
			}
		],
		handler: authLoginHandler
	},

	/**
	 * logout command: log out
	 * Usage: logout [--local]
	 */
	logout: {
		name: 'logout',
		description: 'Log out and remove login credentials',
		usage: 'logout [--local]',
		args: [
			{
				name: 'local',
				description: 'Delete local config (.env) instead of global config',
				type: 'boolean'
			}
		],
		handler: authLogoutHandler
	},

	/**
	 * status command: get login status
	 * Usage: status [--json]
	 */
	status: {
		name: 'status',
		description: 'Get current login status',
		usage: 'status [--json]',
		args: [
			{
				name: 'json',
				description: 'Output detailed information in JSON format',
				type: 'boolean'
			}
		],
		handler: authStatusHandler
	}
};

/**
 * Authentication CLI operation mapping
 * Converts command configuration to command mapping for use by the CLI entry point
 */
export const runAuthCommands = generateCommandMap(authCommands);
