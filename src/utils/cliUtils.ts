/**
 * Module: cliUtils.ts
 * CLI utility functions module
 *
 * Description:
 * - Provides command-line argument parsing
 * - Generates help text and formats output
 * - Defines CLI-related types and interfaces
 *
 * Exported types:
 * - CommandResult: CLI command execution result
 * - CommandHandler: CLI command handler
 * - ArgDef: Argument definition
 * - CommandConfig: Command configuration
 * - CliAction: CLI action definition
 * - CliModule: CLI module definition
 *
 * Exported functions:
 * - parseArgs: Parse command-line arguments
 * - createCommandHandler: Create a command handler
 * - convertToCliAction: Convert to CLI action
 * - generateCommandMap: Generate command map
 * - formatOutput: Format output
 * - outputResult: Output result and exit
 * - generateHelp: Generate help text
 */

/**
 * CommandResult: CLI command execution result type
 *
 * @property success - Whether successful
 * @property output - Output text
 * @property error - Error message
 * @property data - Returned data
 */
export type CommandResult = {
	success: boolean;
	output?: string;
	error?: string;
	data?: any;
};

/**
 * CommandHandler: CLI command handler type
 *
 * @param args - Command-line argument array
 * @returns CommandResult
 */
export type CommandHandler = (args: string[]) => Promise<CommandResult>;

/**
 * ArgDef: Argument definition type
 *
 * @property name - Argument name
 * @property short - Short name (e.g. -w)
 * @property description - Argument description
 * @property required - Whether required
 * @property default - Default value
 * @property type - Argument type (string/number/boolean)
 * @property allowEmpty - Whether empty string values are allowed
 */
export type ArgDef = {
	name: string;
	short?: string;
	description: string;
	required?: boolean;
	default?: string;
	type: 'string' | 'number' | 'boolean';
	allowEmpty?: boolean; // Whether empty string values are allowed
};

/**
 * CommandConfig: Command configuration interface
 *
 * @property name - Command name
 * @property description - Command description
 * @property usage - Usage example
 * @property args - Argument definition array
 * @property handler - Command handler
 * @property paramsMapper - Argument mapping function (optional)
 */
export interface CommandConfig {
	name: string;
	description: string;
	usage: string;
	args: ArgDef[];
	handler: (params: any) => Promise<any>;
	paramsMapper?: (parsed: any) => any;
}

/**
 * CliAction: CLI action definition type
 *
 * @property name - Action name
 * @property description - Action description
 * @property usage - Usage example
 * @property handler - Command handler
 * @property args - Argument definition array (optional)
 */
export type CliAction = {
	name: string;
	description: string;
	usage: string;
	handler: CommandHandler;
	args?: ArgDef[];
};

/**
 * CliModule: CLI module definition type
 *
 * @property name - Module name
 * @property description - Module description
 * @property actions - Action map
 */
export type CliModule = {
	name: string;
	description: string;
	actions: Record<string, CliAction>;
};

/* ============================================================================
 * Global output format control
 * ============================================================================ */

/**
 * Global output format variable
 * Defaults to json output format
 */
let outputFormat: 'text' | 'json' = 'json';

/**
 * setOutputFormat: Set global output format
 *
 * @param format - Output format (text/json)
 */
export function setOutputFormat(format: 'text' | 'json'): void {
	outputFormat = format;
}

/**
 * getOutputFormat: Get global output format
 *
 * @returns Current output format
 */
export function getOutputFormat(): 'text' | 'json' {
	return outputFormat;
}

/**
 * parseArgs: Parse command-line arguments
 *
 * @param args - Raw argument array
 * @param argDefs - Argument definition array
 * @returns Object containing parsed (parsed args), positional (positional args), errors (error messages)
 *
 * Supported formats:
 * - --name value
 * - --name=value
 * - -n value (short name)
 * - --boolean (boolean true)
 * - --boolean false (explicit boolean)
 */
export function parseArgs(
	args: string[],
	argDefs: ArgDef[]
): {
	parsed: Record<string, any>;
	positional: string[];
	errors: string[];
} {
	const parsed: Record<string, any> = {};
	const errors: string[] = [];
	const positional: string[] = [];

	// Initialize default values
	for (const def of argDefs) {
		if (def.default !== undefined) {
			if (def.type === 'number') {
				parsed[def.name] = Number(def.default);
			} else {
				parsed[def.name] = def.default;
			}
		}
	}

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		// Help flag
		if (arg === '-h' || arg === '--help') {
			parsed['__help__'] = true;
			i++;
			continue;
		}

		// Positional argument
		if (!arg.startsWith('-')) {
			positional.push(arg);
			i++;
			continue;
		}

		// Parse named argument
		let argName = arg.replace(/^-+/, '');
		let value: string | undefined;

		// Handle --key=value format
		if (argName.includes('=')) {
			const parts = argName.split('=');
			argName = parts[0];
			value = parts.slice(1).join('=');
		}

		// Look up argument definition
		const def = argDefs.find((d) => d.name === argName || d.short === argName);
		if (!def) {
			errors.push(`Unknown option: ${arg}`);
			i++;
			continue;
		}

		// Boolean type
		if (def.type === 'boolean') {
			// Check if next argument is a boolean value (e.g. --resolved false)
			const nextArg = args[i + 1];
			if (nextArg !== undefined && (nextArg === 'false' || nextArg === 'true')) {
				parsed[def.name] = nextArg === 'true';
				i += 2;
				continue;
			}
			// Check if --key=value format is used
			if (value !== undefined) {
				parsed[def.name] = value === 'true';
				i++;
				continue;
			}
			// Default to true
			parsed[def.name] = true;
			i++;
			continue;
		}

		// Get value
		if (value === undefined) {
			i++;
			if (i >= args.length) {
				// If empty values are allowed, use empty string
				if (def.allowEmpty) {
					parsed[def.name] = '';
					continue;
				}
				errors.push(`Option missing value: ${arg}`);
				break;
			}
			// If next argument is a flag and empty values are allowed, use empty string
			if (def.allowEmpty && args[i].startsWith('-')) {
				parsed[def.name] = '';
				continue;
			}
			value = args[i];
		}

		// Type conversion
		if (def.type === 'number') {
			const num = Number(value);
			if (isNaN(num)) {
				errors.push(`Invalid number ${arg}: ${value}`);
				i++;
				continue;
			}
			parsed[def.name] = num;
		} else {
			parsed[def.name] = value;
		}

		i++;
	}

	// Check required arguments
	for (const def of argDefs) {
		if (def.required && parsed[def.name] === undefined && parsed[def.name] !== false) {
			errors.push(`Missing required option: --${def.name}`);
		}
	}

	return { parsed, positional, errors };
}

/**
 * createCommandHandler: Create a CLI command handler
 *
 * @param config - Command configuration object
 * @returns Command handler function
 *
 * Notes:
 * - Automatically parses arguments and checks required args
 * - On error, returns CommandResult with error
 * - On success, returns CommandResult with data
 */
export function createCommandHandler(config: CommandConfig): CommandHandler {
	return async (args: string[]): Promise<CommandResult> => {
		const { parsed, errors } = parseArgs(args, config.args);

		if (errors.length > 0) {
			return { success: false, error: errors.join('\n') };
		}

		try {
			const params = config.paramsMapper ? config.paramsMapper(parsed) : parsed;
			const result = await config.handler(params);

			return {
				success: true,
				data: result
			};
		} catch (error: any) {
			return { success: false, error: error.message };
		}
	};
}

/**
 * convertToCliAction: Convert command config to CLI action
 *
 * @param config - Command configuration object
 * @returns CLI action object
 */
export function convertToCliAction(config: CommandConfig): CliAction {
	return {
		name: config.name,
		description: config.description,
		usage: config.usage,
		args: config.args,
		handler: createCommandHandler(config)
	};
}

/**
 * generateCommandMap: Generate command map
 *
 * @param commands - Command config object map
 * @returns CLI action map
 */
export function generateCommandMap(
	commands: Record<string, CommandConfig>
): Record<string, CliAction> {
	return Object.fromEntries(
		Object.entries(commands).map(([key, config]) => [key, convertToCliAction(config)])
	);
}

/**
 * formatOutput: Format output
 *
 * @param data - Data to format
 * @param format - Output format (text/json), defaults to global setting or text
 * @returns Formatted string
 */
export function formatOutput(data: any, format?: 'text' | 'json'): string {
	const fmt = format || getOutputFormat();
	if (fmt === 'json') {
		return JSON.stringify(data, null, 2);
	}

	if (typeof data === 'string') {
		return data;
	}

	if (Array.isArray(data)) {
		if (data.length === 0) return '(empty)';
		const lines: string[] = [];
		data.forEach((item, idx) => {
			if (typeof item === 'object' && item !== null) {
				lines.push(`[${idx + 1}]`);
				lines.push(formatObject(item, 1));
				if (idx < data.length - 1) {
					lines.push('');
				}
			} else {
				lines.push(`[${idx + 1}]: ${item}`);
			}
		});
		return lines.join('\n');
	}

	if (typeof data === 'object' && data !== null) {
		return formatObject(data);
	}

	return String(data);
}

/**
 * formatObject: Format object as text
 *
 * @param obj - Object to format
 * @param indent - Indentation level
 * @param isLast - Whether this is the last element
 * @returns Formatted text
 */
function formatObject(obj: any, indent = 0): string {
	if (obj === null || obj === undefined) {
		return '(none)';
	}

	if (typeof obj !== 'object') {
		return String(obj);
	}

	const prefix = '  '.repeat(indent);
	const lines: string[] = [];

	if (Array.isArray(obj)) {
		if (obj.length === 0) {
			return '(empty)';
		}
		obj.forEach((item, idx) => {
			if (typeof item === 'object' && item !== null) {
				lines.push(`${prefix}[${idx + 1}]`);
				lines.push(formatObject(item, indent + 1));
				if (idx < obj.length - 1) {
					lines.push('');
				}
			} else {
				lines.push(`${prefix}[${idx + 1}]: ${item}`);
			}
		});
	} else {
		const entries = Object.entries(obj).filter(([, value]) => value !== null && value !== undefined);
		entries.forEach(([key, value]) => {
			if (typeof value === 'object' && value !== null) {
				if (Array.isArray(value)) {
					if (value.length === 0) {
						lines.push(`${prefix}${key}: (empty)`);
					} else {
						lines.push(`${prefix}${key}:`);
						lines.push(formatObject(value, indent + 1));
					}
				} else {
					lines.push(`${prefix}${key}:`);
					lines.push(formatObject(value, indent + 1));
				}
			} else {
				lines.push(`${prefix}${key}: ${value}`);
			}
		});
	}

	return lines.join('\n');
}

/**
 * outputResult: Output result and exit process
 *
 * @param result - CommandResult object
 * @param exitCode - Exit code, default 0
 * @param forceFormat - Force output format (optional, overrides global setting)
 *
 * Notes:
 * - Errors go to console.error
 * - On success, outputs JSON or text format based on global setting
 * - Exits process via process.exit
 */
export function outputResult(result: CommandResult, exitCode = 0, forceFormat?: 'text' | 'json'): void {
	const format = forceFormat || getOutputFormat();

	if (!result.success && result.error) {
		console.error(result.error);
	} else if (result.data !== undefined) {
		if (format === 'json') {
			console.log(JSON.stringify(result.data, null, 2));
		} else {
			console.log(formatOutput(result.data, 'text'));
		}
	} else if (result.output) {
		console.log(result.output);
	}

	process.exit(exitCode);
}

/**
 * generateHelp: Generate help text
 *
 * @param module - CLI module object
 * @param actionName - Optional action name
 * @returns Formatted help text
 *
 * If actionName is specified, returns detailed help for that action.
 * Otherwise returns the module's general help.
 */
export function generateHelp(module: CliModule, actionName?: string): string {
	const lines: string[] = [];

	if (actionName && module.actions[actionName]) {
		const action = module.actions[actionName];
		lines.push(`${module.name} ${action.name}`);
		lines.push('');
		lines.push(action.description);
		lines.push('');
		lines.push('Usage:');
		lines.push(`  affine-cli ${module.name} ${action.usage}`);
		lines.push('');

		if (action.args && action.args.length > 0) {
			lines.push('Options:');
			for (const arg of action.args) {
				const required = arg.required ? '(required)' : '(optional)';
				const short = arg.short ? `-${arg.short}, ` : '    ';
				const defaultVal = arg.default !== undefined ? ` [default: ${arg.default}]` : '';
				lines.push(
					`  ${short}--${arg.name} <value>  ${arg.description} ${required}${defaultVal}`
				);
			}
			lines.push('');
		}

		lines.push('Examples:');
		lines.push(`  affine-cli ${module.name} ${action.name} --help`);
	} else {
		lines.push(`${module.name} - ${module.description}`);
		lines.push('');
		lines.push('Usage:');
		lines.push(`  affine-cli ${module.name} <action> [options]`);
		lines.push('');
		lines.push('Actions:');

		for (const [name, action] of Object.entries(module.actions)) {
			lines.push(`  ${name.padEnd(16)} ${action.description}`);
		}
		lines.push('');
		lines.push(`Run 'affine-cli ${module.name} <action> --help' for details on a specific action`);
	}

	return lines.join('\n');
}
