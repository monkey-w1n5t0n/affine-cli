/**
 * Module: auth.ts
 * Authentication utility module
 *
 * Description:
 * - Provides basic utility functions for user login and authentication
 * - Login with email/password to obtain auth cookie
 * - Handles cookie extraction and validation
 *
 * Exported functions:
 * - loginWithPassword: Login with email and password
 */

import { fetch } from 'undici';

/**
 * Request timeout (ms)
 */
const AUTH_FETCH_TIMEOUT_MS = 30_000;

/* ============================================================================
 * Helper functions
 * ============================================================================ */

/**
 * Extract cookie pairs
 *
 * Extract key-value pairs from Set-Cookie header array, combine into cookie string
 *
 * @param setCookies - Set-Cookie header array
 * @returns Formatted cookie string (e.g. "token1=xxx; token2=yyy")
 *
 * @example
 * const cookies = ['session=abc123; Path=/', 'user=john; Path=/'];
 * extractCookiePairs(cookies); // "session=abc123; user=john"
 */
function extractCookiePairs(setCookies: string[]): string {
	const pairs: string[] = [];
	for (const sc of setCookies) {
		const first = sc.split(';')[0];
		if (first) pairs.push(first.trim());
	}
	return pairs.join('; ');
}

/**
 * Check for CR/LF characters (prevent header injection)
 *
 * @param value - Value to check
 * @param label - Label name (for error messages)
 * @throws Throws error if value contains CR/LF characters
 */
function assertNoCRLF(value: string, label: string): void {
	if (/[\r\n]/.test(value)) {
		throw new Error(`${label} contains illegal CR/LF characters`);
	}
}

/* ============================================================================
 * Public interface
 * ============================================================================ */

/**
 * Login with email and password
 *
 * Send login request to Affine server, obtain auth cookie
 *
 * @param baseUrl - Affine server base URL
 * @param email - User email
 * @param password - User password
 * @returns Login result object { cookieHeader }
 * @throws Login failure, request timeout, no cookie received
 *
 * @example
 * const { cookieHeader } = await loginWithPassword('https://app.affine.pro', 'user@example.com', 'password');
 */
export async function loginWithPassword(
	baseUrl: string,
	email: string,
	password: string
): Promise<{ cookieHeader: string }> {
	const url = `${baseUrl.replace(/\/$/, '')}/api/auth/sign-in`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
	let res;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
			signal: controller.signal
		});
	} catch (err: any) {
		if (err.name === 'AbortError')
			throw new Error(`Login request timeout (${AUTH_FETCH_TIMEOUT_MS / 1000}s)`);
		throw err;
	} finally {
		clearTimeout(timer);
	}

	if (!res.ok) {
		const raw = await res.text().catch(() => '');
		const sanitized = raw
			.replace(/<[^>]*>/g, '')
			.replace(/\s+/g, ' ')
			.trim();
		const truncated = sanitized.length > 200 ? sanitized.slice(0, 200) + '...' : sanitized;
		throw new Error(`Login failed: ${res.status} ${truncated}`);
	}

	const anyHeaders = res.headers as any;
	let setCookies: string[] = [];
	if (typeof anyHeaders.getSetCookie === 'function') {
		setCookies = anyHeaders.getSetCookie();
	} else {
		const sc = res.headers.get('set-cookie');
		if (sc) setCookies = [sc];
	}

	if (!setCookies.length) {
		throw new Error('Login succeeded but no Set-Cookie received');
	}

	const cookieHeader = extractCookiePairs(setCookies);
	assertNoCRLF(cookieHeader, 'Cookie header from sign-in');
	return { cookieHeader };
}
