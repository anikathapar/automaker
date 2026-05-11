/**
 * Authentication middleware for API security
 *
 * Supports two authentication methods:
 * 1. Header-based (X-API-Key) - Used by Electron mode
 * 2. Cookie-based (HTTP-only session cookie) - Used by web mode
 *
 * Auto-generates an API key on first run if none is configured.
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';
import * as secureFs from './secure-fs.js';
import { createLogger } from '@automaker/utils';

const logger = createLogger('Auth');

const DATA_DIR = process.env.DATA_DIR || './data';
const API_KEY_FILE = path.join(DATA_DIR, '.api-key');
const SESSIONS_FILE = path.join(DATA_DIR, '.sessions');
const SESSION_COOKIE_NAME = 'automaker_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const WS_TOKEN_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes for WebSocket connection tokens

/**
 * Check if an environment variable is set to 'true'
 */
function isEnvTrue(envVar: string | undefined): boolean {
  return envVar === 'true';
}

/** Persisted web session; optional Cognito identity when created via ALB OIDC */
export interface SessionRecord {
  createdAt: number;
  expiresAt: number;
  oidcSub?: string;
  email?: string;
  /** Stable id from `users.json` (password login) or OIDC subject mapping */
  webUserId?: string;
}

// Session store - persisted to file for survival across server restarts
const validSessions = new Map<string, SessionRecord>();

// Short-lived WebSocket connection tokens (in-memory only, not persisted)
const wsConnectionTokens = new Map<string, { createdAt: number; expiresAt: number }>();

// Clean up expired WebSocket tokens periodically
setInterval(() => {
  const now = Date.now();
  wsConnectionTokens.forEach((data, token) => {
    if (data.expiresAt <= now) {
      wsConnectionTokens.delete(token);
    }
  });
}, 60 * 1000); // Clean up every minute

/**
 * Load sessions from file on startup
 */
function loadSessions(): void {
  try {
    if (secureFs.existsSync(SESSIONS_FILE)) {
      const data = secureFs.readFileSync(SESSIONS_FILE, 'utf-8') as string;
      const sessions = JSON.parse(data) as Array<[string, SessionRecord]>;
      const now = Date.now();
      let loadedCount = 0;
      let expiredCount = 0;

      for (const [token, session] of sessions) {
        // Only load non-expired sessions
        if (session.expiresAt > now) {
          validSessions.set(token, session);
          loadedCount++;
        } else {
          expiredCount++;
        }
      }

      if (loadedCount > 0 || expiredCount > 0) {
        logger.info(`Loaded ${loadedCount} sessions (${expiredCount} expired)`);
      }
    }
  } catch (error) {
    logger.warn('Error loading sessions:', error);
  }
}

/**
 * Save sessions to file (async)
 */
async function saveSessions(): Promise<void> {
  try {
    await secureFs.mkdir(path.dirname(SESSIONS_FILE), { recursive: true });
    const sessions = Array.from(validSessions.entries());
    await secureFs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (error) {
    logger.error('Failed to save sessions:', error);
  }
}

// Load existing sessions on startup
loadSessions();

/**
 * Ensure an API key exists - either from env var, file, or generate new one.
 * This provides CSRF protection by requiring a secret key for all API requests.
 */
function ensureApiKey(): string {
  // First check environment variable (Electron passes it this way)
  if (process.env.AUTOMAKER_API_KEY) {
    logger.info('Using API key from environment variable');
    return process.env.AUTOMAKER_API_KEY;
  }

  // Try to read from file
  try {
    if (secureFs.existsSync(API_KEY_FILE)) {
      const key = (secureFs.readFileSync(API_KEY_FILE, 'utf-8') as string).trim();
      if (key) {
        logger.info('Loaded API key from file');
        return key;
      }
    }
  } catch (error) {
    logger.warn('Error reading API key file:', error);
  }

  // Generate new key
  const newKey = crypto.randomUUID();
  try {
    secureFs.mkdirSync(path.dirname(API_KEY_FILE), { recursive: true });
    secureFs.writeFileSync(API_KEY_FILE, newKey, { encoding: 'utf-8', mode: 0o600 });
    logger.info('Generated new API key');
  } catch (error) {
    logger.error('Failed to save API key:', error);
  }
  return newKey;
}

// API key - always generated/loaded on startup for CSRF protection
const API_KEY = ensureApiKey();

// Width for log box content (excluding borders)
const BOX_CONTENT_WIDTH = 67;

// Print API key to console for web mode users (unless suppressed for production logging)
if (!isEnvTrue(process.env.AUTOMAKER_HIDE_API_KEY)) {
  const autoLoginEnabled = isEnvTrue(process.env.AUTOMAKER_AUTO_LOGIN);
  const skipWebAuth = isEnvTrue(process.env.AUTOMAKER_SKIP_WEB_AUTH);
  const autoLoginStatus = skipWebAuth
    ? 'N/A (AUTOMAKER_SKIP_WEB_AUTH — no web login)'
    : autoLoginEnabled
      ? 'enabled in dev (AUTOMAKER_AUTO_LOGIN)'
      : 'disabled';

  // Build box lines with exact padding
  const header = '🔐 Web sign-in & API request key'.padEnd(BOX_CONTENT_WIDTH);
  const line1 = skipWebAuth
    ? 'Web login skipped — anyone who can open this URL gets a session.'.padEnd(BOX_CONTENT_WIDTH)
    : 'Browser login: DATA_DIR/users.json — npm run create-user (@automaker/server).'.padEnd(
        BOX_CONTENT_WIDTH
      );
  const line2 = API_KEY.padEnd(BOX_CONTENT_WIDTH);
  const line3 = skipWebAuth
    ? 'Optional X-API-Key for programmatic access (no session).'.padEnd(BOX_CONTENT_WIDTH)
    : 'Optional X-API-Key header; the web UI uses a session cookie after login.'.padEnd(
        BOX_CONTENT_WIDTH
      );
  const line4 = `Web auto-login: ${autoLoginStatus}`.padEnd(BOX_CONTENT_WIDTH);
  const tipHeader = '💡 Tips'.padEnd(BOX_CONTENT_WIDTH);
  const line5 = 'Set AUTOMAKER_API_KEY env var to use a fixed key'.padEnd(BOX_CONTENT_WIDTH);
  const line6 = 'Trusted hosting: AUTOMAKER_SKIP_WEB_AUTH=true (see CLAUDE.md)'.padEnd(
    BOX_CONTENT_WIDTH
  );

  logger.info(`
╔═════════════════════════════════════════════════════════════════════╗
║  ${header}║
╠═════════════════════════════════════════════════════════════════════╣
║                                                                     ║
║  ${line1}║
║                                                                     ║
║  ${line2}║
║                                                                     ║
║  ${line3}║
║                                                                     ║
║  ${line4}║
║                                                                     ║
╠═════════════════════════════════════════════════════════════════════╣
║  ${tipHeader}║
╠═════════════════════════════════════════════════════════════════════╣
║  ${line5}║
║  ${line6}║
╚═════════════════════════════════════════════════════════════════════╝
`);
} else {
  logger.info('API key banner hidden (AUTOMAKER_HIDE_API_KEY=true)');
}

/**
 * Generate a cryptographically secure session token
 */
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new session and return the token
 */
export async function createSession(profile?: {
  oidcSub?: string;
  email?: string;
  webUserId?: string;
}): Promise<string> {
  const token = generateSessionToken();
  const now = Date.now();
  const record: SessionRecord = {
    createdAt: now,
    expiresAt: now + SESSION_MAX_AGE_MS,
  };
  if (profile?.oidcSub) {
    record.oidcSub = profile.oidcSub;
    if (profile.email) {
      record.email = profile.email;
    }
  }
  if (profile?.webUserId) {
    record.webUserId = profile.webUserId;
  }
  validSessions.set(token, record);
  await saveSessions(); // Persist to file
  return token;
}

/**
 * Validate a session token
 * Note: This returns synchronously but triggers async persistence if session expired
 */
export function validateSession(token: string): boolean {
  const session = validSessions.get(token);
  if (!session) return false;

  if (Date.now() > session.expiresAt) {
    validSessions.delete(token);
    // Fire-and-forget: persist removal asynchronously
    saveSessions().catch((err) => logger.error('Error saving sessions:', err));
    return false;
  }

  return true;
}

/**
 * Invalidate a session token
 */
export async function invalidateSession(token: string): Promise<void> {
  validSessions.delete(token);
  await saveSessions(); // Persist removal
}

/**
 * Create a short-lived WebSocket connection token
 * Used for initial WebSocket handshake authentication
 */
export function createWsConnectionToken(): string {
  const token = generateSessionToken();
  const now = Date.now();
  wsConnectionTokens.set(token, {
    createdAt: now,
    expiresAt: now + WS_TOKEN_MAX_AGE_MS,
  });
  return token;
}

/**
 * Validate a WebSocket connection token
 * These tokens are single-use and short-lived (5 minutes)
 * Token is invalidated immediately after first successful use
 */
export function validateWsConnectionToken(token: string): boolean {
  const tokenData = wsConnectionTokens.get(token);
  if (!tokenData) return false;

  // Always delete the token (single-use)
  wsConnectionTokens.delete(token);

  // Check if expired
  if (Date.now() > tokenData.expiresAt) {
    return false;
  }

  return true;
}

/**
 * Validate the API key using timing-safe comparison
 * Prevents timing attacks that could leak information about the key
 */
export function validateApiKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;

  // Both buffers must be the same length for timingSafeEqual
  const keyBuffer = Buffer.from(key);
  const apiKeyBuffer = Buffer.from(API_KEY);

  // If lengths differ, compare against a dummy to maintain constant time
  if (keyBuffer.length !== apiKeyBuffer.length) {
    crypto.timingSafeEqual(apiKeyBuffer, apiKeyBuffer);
    return false;
  }

  return crypto.timingSafeEqual(keyBuffer, apiKeyBuffer);
}

/**
 * Get session cookie options
 */
export function getSessionCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true, // JavaScript cannot access this cookie
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'lax', // Sent for same-site requests and top-level navigations, but not cross-origin fetch/XHR
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  };
}

/**
 * Get the session cookie name
 */
export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

/**
 * Authentication result type
 */
type AuthResult =
  | { authenticated: true }
  | { authenticated: false; errorType: 'invalid_api_key' | 'invalid_session' | 'no_auth' };

/** Minimal request shape for auth checks (Express `Request` satisfies this). */
export type AuthRequestLike = Pick<Request, 'headers' | 'query' | 'cookies'> & {
  automakerOidcUser?: { sub: string; email?: string };
};

/**
 * Cognito-backed user for this request, if the session was created via ALB OIDC.
 * API-key-only sessions return null (still authenticated, but no SSO identity).
 */
export function getAuthenticatedWebUser(
  req: AuthRequestLike
): { sub: string; email?: string } | null {
  const oidc = req.automakerOidcUser;
  if (oidc?.sub) {
    return { sub: oidc.sub, email: oidc.email };
  }
  const cookies = req.cookies as Record<string, string | undefined>;
  const token = cookies?.[SESSION_COOKIE_NAME];
  if (!token || !validateSession(token)) {
    return null;
  }
  const rec = validSessions.get(token);
  if (rec?.oidcSub) {
    return { sub: rec.oidcSub, email: rec.email };
  }
  if (rec?.webUserId) {
    return { sub: rec.webUserId };
  }
  return null;
}

/**
 * Stable id for per-user data paths: Cognito `sub` from this request, else from session
 * (`webUserId` from `users.json` login or `oidcSub` from ALB-minted session).
 */
export function getWebUserId(req: AuthRequestLike): string | null {
  if (req.automakerOidcUser?.sub) {
    return req.automakerOidcUser.sub;
  }
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token || !validateSession(token)) {
    return null;
  }
  const rec = validSessions.get(token);
  return rec?.webUserId ?? rec?.oidcSub ?? null;
}

export type WebAuthSource = 'alb_oidc' | 'web_user';

/**
 * How the browser session was tied to a person (for `/api/auth/status` metadata).
 */
export function getWebAuthSource(req: AuthRequestLike): WebAuthSource | null {
  if (req.automakerOidcUser?.sub) {
    return 'alb_oidc';
  }
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token || !validateSession(token)) {
    return null;
  }
  const rec = validSessions.get(token);
  if (rec?.oidcSub) {
    return 'alb_oidc';
  }
  if (rec?.webUserId) {
    return 'web_user';
  }
  return null;
}

/**
 * Core authentication check - shared between middleware and status check
 * Extracts auth credentials from various sources and validates them
 */
function checkAuthentication(req: AuthRequestLike): AuthResult {
  if (req.automakerOidcUser?.sub) {
    return { authenticated: true };
  }

  const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
  const query = (req.query ?? {}) as Record<string, string | undefined>;
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;

  // Check for API key in header (Electron mode)
  const headerKey = headers['x-api-key'] as string | undefined;
  if (headerKey) {
    if (validateApiKey(headerKey)) {
      return { authenticated: true };
    }
    return { authenticated: false, errorType: 'invalid_api_key' };
  }

  // Check for session token in header (web mode with explicit token)
  const sessionTokenHeader = headers['x-session-token'] as string | undefined;
  if (sessionTokenHeader) {
    if (validateSession(sessionTokenHeader)) {
      return { authenticated: true };
    }
    return { authenticated: false, errorType: 'invalid_session' };
  }

  // Check for API key in query parameter (fallback)
  const queryKey = query.apiKey;
  if (queryKey) {
    if (validateApiKey(queryKey)) {
      return { authenticated: true };
    }
    return { authenticated: false, errorType: 'invalid_api_key' };
  }

  // Check for session token in query parameter (web mode - needed for image loads)
  const queryToken = query.token;
  if (queryToken) {
    if (validateSession(queryToken)) {
      return { authenticated: true };
    }
    return { authenticated: false, errorType: 'invalid_session' };
  }

  // Check for session cookie (web mode)
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (sessionToken && validateSession(sessionToken)) {
    return { authenticated: true };
  }

  return { authenticated: false, errorType: 'no_auth' };
}

/**
 * Authentication middleware
 *
 * Accepts either:
 * 1. X-API-Key header (for Electron mode)
 * 2. X-Session-Token header (for web mode with explicit token)
 * 3. apiKey query parameter (fallback for Electron, cases where headers can't be set)
 * 4. token query parameter (fallback for web mode, needed for image loads via CSS/img tags)
 * 5. Session cookie (for web mode)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow disabling auth for local/trusted networks
  if (isEnvTrue(process.env.AUTOMAKER_DISABLE_AUTH)) {
    next();
    return;
  }

  const result = checkAuthentication(req);

  if (result.authenticated) {
    next();
    return;
  }

  // Return appropriate error based on what failed
  switch (result.errorType) {
    case 'invalid_api_key':
      res.status(403).json({
        success: false,
        error: 'Invalid API key.',
      });
      break;
    case 'invalid_session':
      res.status(403).json({
        success: false,
        error: 'Invalid or expired session token.',
      });
      break;
    case 'no_auth':
    default:
      res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
  }
}

/**
 * Check if authentication is enabled (always true now)
 */
export function isAuthEnabled(): boolean {
  return true;
}

/**
 * Get authentication status for health endpoint
 */
export function getAuthStatus(): { enabled: boolean; method: string } {
  const disabled = isEnvTrue(process.env.AUTOMAKER_DISABLE_AUTH);
  return {
    enabled: !disabled,
    method: disabled ? 'disabled' : 'api_key_or_session',
  };
}

/**
 * Check if a request is authenticated (for status endpoint)
 */
export function isRequestAuthenticated(req: Request): boolean {
  if (isEnvTrue(process.env.AUTOMAKER_DISABLE_AUTH)) return true;
  const result = checkAuthentication(req);
  return result.authenticated;
}

/**
 * Check if raw credentials are authenticated
 * Used for WebSocket authentication where we don't have Express request objects
 */
export function checkRawAuthentication(
  headers: Record<string, string | string[] | undefined>,
  query: Record<string, string | undefined>,
  cookies: Record<string, string | undefined>
): boolean {
  if (isEnvTrue(process.env.AUTOMAKER_DISABLE_AUTH)) return true;
  return checkAuthentication({ headers, query, cookies }).authenticated;
}
