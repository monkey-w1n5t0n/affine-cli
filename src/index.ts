/**
 * Module: index.ts
 * CLI main entry module
 *
 * Description:
 * - Provides the main entry point for the Affine Skill basic CLI tool
 * - Registers all CLI modules (auth, workspace, doc, tags, folder, collection, file, comment, database)
 * - Parses command-line arguments and executes corresponding actions
 * - Provides help and version info
 *
 * Usage:
 * - affine-cli <module> <action> [options]  Run module command
 * - affine-cli <module> --help         Show module help
 * - affine-cli help [module]           Show help
 * - affine-cli --version           Show version
 *
 * Exports:
 * - CLI_MODULES: All registered CLI modules
 * - runCli: CLI entry function, for external use
 */

import { CliModule, generateHelp, outputResult, setOutputFormat, getOutputFormat } from './utils/cliUtils.js';
import { loadConfig } from './utils/config.js';
import { resolveWorkspaceName, isUuid } from './utils/workspaceCache.js';

/**
 * Imported CLI modules (command mapping)
 */
import { runAuthCommands } from './cli/auth.js';
import { runWorkspaceCommands } from './cli/workspace.js';
import { runDocCommands } from './cli/doc.js';
import { runTagsCommands } from './cli/tags.js';
import { runFolderCommands } from './cli/folder.js';
import { runCollectionCommands } from './cli/collection.js';
import { runFileCommands } from './cli/file.js';
import { runCommentCommands } from './cli/comments.js';
import { runDatabaseCommands } from './cli/database.js';
import { runJournalCommands } from './cli/journal.js';

/**
 * CLI_MODULES: CLI module registry
 *
 * Description:
 * - Stores all registered CLI modules
 * - Contains module name, description, and action mapping
 */
const CLI_MODULES: Record<string, CliModule> = {
	auth: {
		name: 'auth',
		description: 'Auth management (login, logout, status)',
		actions: runAuthCommands
	},
	workspace: {
		name: 'workspace',
		description: 'Workspace management',
		actions: runWorkspaceCommands
	},
	doc: {
		name: 'doc',
		description: 'Document management (create, read, update, delete, search, etc.)',
		actions: runDocCommands
	},
	tags: {
		name: 'tags',
		description: 'Tag management',
		actions: runTagsCommands
	},
	folder: {
		name: 'folder',
		description: 'Folder management',
		actions: runFolderCommands
	},
	collection: {
		name: 'collection',
		description: 'Collection management',
		actions: runCollectionCommands
	},
	file: {
		name: 'file',
		description: 'File attachment management',
		actions: runFileCommands
	},
	comment: {
		name: 'comment',
		description: 'Comment management (list, create, update, delete, resolve)',
		actions: runCommentCommands
	},
	database: {
		name: 'database',
		description: 'Database management (add and manage data tables in documents)',
		actions: runDatabaseCommands
	},
	journal: {
		name: 'journal',
		description: 'Journal management (create, list, append)',
		actions: runJournalCommands
	}
};

/* ============================================================================
 * Main help info
 * ============================================================================ */

/**
 * printMainHelp: Print main help info
 *
 * Description:
 * - Print all available modules
 * - Show usage examples
 */
function printMainHelp() {
	const lines = [
		`affine-cli ${CLI_VERSION} - Affine basic CLI tool`,
		'',
		'Usage:',
		'  affine-cli <module> <action> [options]  Run module command',
		'  affine-cli <module> --help         Show module help',
		'  affine-cli help [module]           Show help',
		'',
		'Global options:',
		'  --text                    Output text format (default JSON)',
		'',
		'Modules:'
	];

	for (const [name, module] of Object.entries(CLI_MODULES)) {
		lines.push(`  ${name.padEnd(14)} ${module.description}`);
	}

	lines.push('');
	lines.push('Examples:');
	lines.push('  affine-cli auth login');
	lines.push('  affine-cli auth status');
	lines.push('  affine-cli workspace list');
	lines.push('  affine-cli doc list --workspace <workspace-id>');
	lines.push('  affine-cli doc create --title "My Doc" --content "./content.md"');
	lines.push('  affine-cli tags list');
	lines.push('  affine-cli folder create --name "New Folder"');
	lines.push('  affine-cli collection list');
	lines.push('  affine-cli file upload --file "./image.png"');
	lines.push('  affine-cli comment list --doc-id <id>');
	lines.push('  affine-cli comment create --doc-id <id> --content "Comment content"');
	lines.push('  affine-cli database create --title "Task Table"');
	lines.push(
		'  affine-cli database create --title "Task Table" --columns "[{\"name\":\"Status\",\"type\":\"select\",\"options\":[\"In Progress\",\"Done\"]}]"'
	);
	lines.push('  affine-cli database create --title "Task Table" --data @data.json');
	lines.push('  affine-cli database list --doc-id <id>');
	lines.push('  affine-cli database columns --doc-id <id> --db-id <db-id>');
	lines.push('  affine-cli database import --doc-id <id> --db-id <db-id> --json @data.json');
	lines.push('  affine-cli database export --doc-id <id> --db-id <db-id>');
	lines.push('  affine-cli database delete --doc-id <id> --db-id <db-id>');
	lines.push('  affine-cli journal list');
	lines.push('  affine-cli journal create --date "2024-01-15" --content "./content.md"');
	lines.push('  affine-cli journal append --date "2024-01-15" --content "Today\'s summary..."');

	console.log(lines.join('\n'));
}

/* ============================================================================
 * CLI main entry
 * ============================================================================ */

import { CLI_VERSION } from './utils/version.js';

const BANNER_SKIP_MODULES = new Set(['auth', 'workspace']);

async function maybePrintWorkspaceBanner(command: string, moduleArgs: string[]): Promise<void> {
	if (getOutputFormat() !== 'text') return;
	if (BANNER_SKIP_MODULES.has(command)) return;
	if (moduleArgs.includes('--workspace')) return;

	try {
		const { defaultWorkspaceId } = loadConfig();
		if (!defaultWorkspaceId) return;
		// If the configured value is a name, we'd resolve it before display —
		// but resolveWorkspaceName takes a UUID. Skip the banner for non-UUID
		// configs to avoid double-resolving (the handler will resolve via getWorkspaceId).
		if (!isUuid(defaultWorkspaceId)) return;
		const name = await resolveWorkspaceName(defaultWorkspaceId);
		if (!name) return;
		console.error(`Workspace: ${name} (${defaultWorkspaceId.slice(0, 8)})`);
	} catch {
		// Banner is best-effort; never block the command.
	}
}

/**
 * runCli: CLI main entry function
 *
 * Description:
 * - Parse command-line arguments
 * - Find and execute corresponding module action
 * - Handle help and version info
 *
 * @param args - Command-line argument array
 * @returns Whether execution was successful
 *
 * Usage examples:
 * - runCli(['doc', 'list', '--workspace', 'xxx'])
 * - runCli(['--version'])
 */
export async function runCli(args: string[]): Promise<boolean> {
	// Parse global options
	const globalArgs = [...args];
	let command: string | undefined;
	let remainingArgs: string[] = [];

	// Extract and filter global options
	const filteredArgs = globalArgs.filter((arg) => {
		if (arg === '--text') {
			setOutputFormat('text');
			return false;
		}
		return true;
	});

	// Parse command and arguments
	if (filteredArgs.length > 0) {
		command = filteredArgs[0];
		remainingArgs = filteredArgs.slice(1);
	}

// Version info
	if (command === '--version' || command === '-v' || command === 'version') {
		console.log(CLI_VERSION);
		return true;
	}

	// Help info
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		if (remainingArgs.length > 0) {
			const target = remainingArgs[0];
			if (CLI_MODULES[target]) {
				console.log(generateHelp(CLI_MODULES[target]));
				return true;
			}
		}
		printMainHelp();
		return true;
	}

	// Check module
	const module = CLI_MODULES[command];
	if (module) {
		let [actionName, ...moduleArgs] = remainingArgs;

		// Check if actionName is --help or -h
		if (actionName === '--help' || actionName === '-h') {
			console.log(generateHelp(module));
			return true;
		}

		// No action or help requested
		if (
			!actionName ||
			actionName === 'help' ||
			moduleArgs.includes('--help') ||
			moduleArgs.includes('-h')
		) {
			console.log(generateHelp(module, actionName));
			return true;
		}

		// Find action
		const action = module.actions[actionName];
		if (!action) {
			console.error(`Unknown action: ${actionName}`);
			console.error(`Run 'affine-cli ${command} --help' for available actions`);
			return false;
		}

		await maybePrintWorkspaceBanner(command, moduleArgs);

		// Execute action
		try {
			const result = await action.handler(moduleArgs);
			outputResult(result, result.success ? 0 : 1);
			return result.success;
		} catch (err: any) {
			console.error(`Error: ${err.message}`);
			return false;
		}
	}

	console.error(`Unknown command: ${command}`);
	printMainHelp();
	return false;
}

/* ============================================================================
 * Entry point
 * ============================================================================ */

/**
 * CLI Entry point
 *
 * Description:
 * - Get command-line arguments from process.argv
 * - Execute CLI and exit process based on result
 * - Exit code 0 on success, 1 on failure
 */
const rawArgs = process.argv.slice(2);
const cliArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

import { closeWorkspaceSocket } from './utils/wsClient.js';

runCli(cliArgs)
	.then((success) => {
		closeWorkspaceSocket();
		process.exit(success ? 0 : 1);
	})
	.catch((err) => {
		console.error(`Fatal error: ${err.message}`);
		closeWorkspaceSocket();
		process.exit(1);
	});

// Export modules for external use
export { CLI_MODULES };
