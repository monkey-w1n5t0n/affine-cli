/**
 * Module: misc.ts
 * General utility module
 *
 * Description:
 * - Provides random identifier generation
 * - Parses JSON content or file paths
 * - Other general utility functions
 *
 * Exported functions:
 * - generateId: Generate unique identifier
 * - parseJsonContent: Parse JSON or file path
 */

import { customAlphabet } from 'nanoid';
import * as fs from 'fs';

/**
 * Default alphabet: Affine-compatible character set
 */
const ALPHABET = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/**
 * Generate random identifier
 * Uses nanoid (secure, URL-friendly)
 *
 * @param length - Total ID length, default 24
 * @param prefix - Prefix (optional), if provided returns prefix-id format, id length = length - prefix.length - 1
 * @returns Unique identifier
 */
export function generateId(length: number = 24, prefix?: string): string {
	const idLength = prefix ? length - prefix.length - 1 : length;
	const id = customAlphabet(ALPHABET, idLength)();
	return prefix ? `${prefix}-${id}` : id;
}

/**
 * Parses JSON content or file paths
 * Supports raw JSON string or @file path format
 *
 * @param input - Input string, supports:
 *   - JSON string (e.g. '[{"a":1},{"b":2}]' or '{"data":[]}')
 *   - @file format (e.g. '@data.json' reads data.json file content)
 * @param options - Optional config
 *   - allowArray: Whether array format is allowed, default true
 *   - allowObject: Whether object format is allowed, default true
 *   - fieldName: Field name used in error messages, default 'content'
 * @returns Parsed data (can be array or object)
 * @throws Throws error when format is invalid
 */
export function parseJsonContent(
	input: string,
	options?: {
		allowArray?: boolean;
		allowObject?: boolean;
		fieldName?: string;
	}
): unknown {
	const { allowArray = true, allowObject = true, fieldName = 'content' } = options || {};

	if (!input || typeof input !== 'string') {
		throw new Error(`${fieldName} parameter cannot be empty`);
	}

	let jsonString: string;

	// Check if string is a valid file path format
	if (isFilePath(input)) {
		const filePath = input.slice(1);
		try {
			jsonString = fs.readFileSync(filePath, 'utf-8');
		} catch (err: any) {
			throw new Error(`Failed to read file: ${err.message}`);
		}
	} else {
		jsonString = input;
	}

	// Parse JSON
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonString);
	} catch (err: any) {
		throw new Error(`${fieldName} must be valid JSON format: ${err.message}`);
	}

	// Validate format
	if (allowArray && Array.isArray(parsed)) {
		return parsed;
	}

	if (allowObject && parsed !== null && typeof parsed === 'object') {
		return parsed;
	}

	// Invalid format
	const validTypes: string[] = [];
	if (allowArray) validTypes.push('array');
	if (allowObject) validTypes.push('object');

	throw new Error(`${fieldName} format is invalid, must be ${validTypes.join(' or ')}format`);
}

/**
 * Check if string is a valid file path format
 *
 * Validation rules:
 * - Must start with @
 * - Content after @ must not be empty
 * - Content after @ must be single-line (no newlines)
 * - Cannot start with special symbols like @# @? followed by special chars
 *
 * @param value - String to check
 * @returns true if valid file path format, false otherwise
 */
export function isFilePath(value: string): boolean {
	if (!value || typeof value !== 'string') {
		return false;
	}

	// Must start with @ and length > 1
	if (!value.startsWith('@') || value.length <= 1) {
		return false;
	}

	// Check for newlines, tabs, etc. (multiline is not a valid path)
	if (value.includes('\n') || value.includes('\r') || value.includes('\t')) {
		return false;
	}

	// Get content after @
	const pathPart = value.slice(1).trim();

	// Check if starts with special character (@# @? @! etc. are not valid paths)
	const firstChar = pathPart.charAt(0);
	if (/^[#?!\-*]/.test(firstChar)) {
		return false;
	}

	return true;
}
