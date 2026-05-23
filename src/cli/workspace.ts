/**
 * Workspace CLI module
 * Provides commands such as workspace list queries
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { workspaceListHandler } from '../core/workspace.js';

/**
 * Workspace command configuration
 * Defines parameter and handler mappings for all workspace-related commands
 */
const workspaceCommands: Record<string, CommandConfig> = {
	/**
	 * list command: get workspace list
	 * Usage: list [--format text|json]
	 */
	list: {
		name: 'list',
		description: 'Get basic information for all workspaces of the current user',
		usage: 'list [--format text|json]',
		args: [],
		handler: workspaceListHandler
	}
};

/**
 * Workspace CLI operation mapping
 * Converts command configuration to command mapping for use by the CLI entry point
 */
export const runWorkspaceCommands = generateCommandMap(workspaceCommands);
