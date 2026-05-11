/**
 * Auth routes - Login, logout, and status endpoints
 *
 * Security model:
 * - Web mode: Username/password validated against `DATA_DIR/users.json` (bcrypt); session cookie on success
 * - Optional X-API-Key on requests (Electron / automation) uses the server API key from env or `DATA_DIR/.api-key`
 *
 * The session cookie is:
 * - HTTP-only: JavaScript cannot read it (protects against XSS)
 * - SameSite=Strict: Only sent for same-site requests (protects against CSRF)
 *
 * Mounted at /api/auth in the main server (BEFORE auth middleware).
 */

import { Router } from 'express';
import type { Request } from 'express';
import {
  createSession,
  invalidateSession,
  getSessionCookieOptions,
  getSessionCookieName,
  isRequestAuthenticated,
  createWsConnectionToken,
  getAuthenticatedWebUser,
  getWebAuthSource,
} from '../../lib/auth.js';
import { verifyUserPassword, createUser } from '../../lib/users.js';

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_ATTEMPTS = 5; // Max 5 attempts per window

/** Minimum length for username and password on self-service web registration only. */
const MIN_WEB_REGISTER_CREDENTIAL_LEN = 5;

// Check if we're in test mode - disable rate limiting for E2E tests
const isTestMode = process.env.AUTOMAKER_MOCK_AGENT === 'true';

// In-memory rate limit tracking (resets on server restart)
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

// Clean up old rate limit entries periodically (every 5 minutes)
setInterval(
  () => {
    const now = Date.now();
    loginAttempts.forEach((data, ip) => {
      if (now - data.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
        loginAttempts.delete(ip);
      }
    });
  },
  5 * 60 * 1000
);

/**
 * Get client IP address from request
 * Handles X-Forwarded-For header for reverse proxy setups
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For can be a comma-separated list; take the first (original client)
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return forwardedIp.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Check if an IP is rate limited
 * Returns { limited: boolean, retryAfter?: number }
 */
function checkRateLimit(ip: string): { limited: boolean; retryAfter?: number } {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);

  if (!attempt) {
    return { limited: false };
  }

  // Check if window has expired
  if (now - attempt.windowStart > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { limited: false };
  }

  // Check if over limit
  if (attempt.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - attempt.windowStart)) / 1000);
    return { limited: true, retryAfter };
  }

  return { limited: false };
}

/**
 * Record a login attempt for rate limiting
 */
function recordLoginAttempt(ip: string): void {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);

  if (!attempt || now - attempt.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Start new window
    loginAttempts.set(ip, { count: 1, windowStart: now });
  } else {
    // Increment existing window
    attempt.count++;
  }
}

/**
 * Create auth routes
 *
 * @returns Express Router with auth endpoints
 */
export function createAuthRoutes(): Router {
  const router = Router();

  /**
   * GET /api/auth/status
   *
   * Returns whether the current request is authenticated.
   * Used by the UI to determine if login is needed.
   *
   * - AUTOMAKER_AUTO_LOGIN=true: auto-creates a session in non-production (dev convenience).
   * - AUTOMAKER_SKIP_WEB_AUTH=true: auto-creates a session even in production (trusted /
   *   single-tenant deploys only — anyone who can open the URL is treated as logged in).
   *
   * When the client sends X-Automaker-Credential-Entry: true, skip auto-minting so the
   * login page can stay unauthenticated after logout (otherwise every /status would
   * immediately issue a new session cookie).
   */
  router.get('/status', async (req, res) => {
    let authenticated = isRequestAuthenticated(req);

    const skipWebAuth = process.env.AUTOMAKER_SKIP_WEB_AUTH === 'true';
    const devAutoLogin =
      process.env.AUTOMAKER_AUTO_LOGIN === 'true' && process.env.NODE_ENV !== 'production';

    const credentialEntryHeader = req.headers['x-automaker-credential-entry'];
    const skipAutoMintForLoginPage =
      credentialEntryHeader === 'true' || credentialEntryHeader === '1';

    if (!authenticated && (skipWebAuth || devAutoLogin) && !skipAutoMintForLoginPage) {
      const sessionToken = await createSession();
      const cookieOptions = getSessionCookieOptions();
      const cookieName = getSessionCookieName();
      res.cookie(cookieName, sessionToken, cookieOptions);
      authenticated = true;
    }

    const user = authenticated ? getAuthenticatedWebUser(req) : null;
    const authSource = authenticated ? getWebAuthSource(req) : null;

    res.json({
      success: true,
      authenticated,
      required: true,
      registrationOpen: true,
      ...(user && authSource ? { user, authSource } : {}),
    });
  });

  /**
   * POST /api/auth/login
   *
   * Validates credentials and sets a session cookie.
   *
   * Body: `{ username: string, password: string }` — must match a user in `DATA_DIR/users.json`
   * (bcrypt password hashes). Create users with `npm run create-user` in `@automaker/server`.
   *
   * Rate limited to 5 attempts per minute per IP to prevent brute force attacks.
   */
  router.post('/login', async (req, res) => {
    const clientIp = getClientIp(req);

    // Skip rate limiting in test mode to allow parallel E2E tests
    if (!isTestMode) {
      // Check rate limit before processing
      const rateLimit = checkRateLimit(clientIp);
      if (rateLimit.limited) {
        res.status(429).json({
          success: false,
          error: 'Too many login attempts. Please try again later.',
          retryAfter: rateLimit.retryAfter,
        });
        return;
      }
    }

    const { username, password } = req.body as {
      username?: string;
      password?: string;
    };

    const usernameTrimmed = typeof username === 'string' ? username.trim() : '';
    const passwordStr = typeof password === 'string' ? password : '';

    // Record this attempt (only for actual validation attempts, skip in test mode)
    if (!isTestMode) {
      recordLoginAttempt(clientIp);
    }

    let sessionProfile: { webUserId?: string } | undefined;

    if (!usernameTrimmed || typeof password !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Username and password are required.',
      });
      return;
    }

    const fileUser = await verifyUserPassword(usernameTrimmed, passwordStr);
    if (!fileUser) {
      res.status(401).json({
        success: false,
        registrationOpen: true,
        error:
          'Invalid username or password. Use “Create new account” below to sign up, or ask an operator to run `npm run create-user` on the server.',
      });
      return;
    }
    sessionProfile = { webUserId: fileUser.id };

    // Create session and set cookie
    const sessionToken = await createSession(sessionProfile);
    const cookieOptions = getSessionCookieOptions();
    const cookieName = getSessionCookieName();

    res.cookie(cookieName, sessionToken, cookieOptions);
    res.json({
      success: true,
      message: 'Logged in successfully.',
      // Return token for explicit header-based auth (works around cross-origin cookie issues)
      token: sessionToken,
    });
  });

  /**
   * POST /api/auth/register
   *
   * Self-service account creation (writes `DATA_DIR/users.json`). Always enabled.
   * Username (trimmed) and password must each be at least 5 characters.
   * Rate limited like login. On success, sets session cookie (same as login).
   */
  router.post('/register', async (req, res) => {
    const clientIp = getClientIp(req);
    if (!isTestMode) {
      const rateLimit = checkRateLimit(clientIp);
      if (rateLimit.limited) {
        res.status(429).json({
          success: false,
          error: 'Too many attempts. Please try again later.',
          retryAfter: rateLimit.retryAfter,
        });
        return;
      }
    }

    const { username, password } = req.body as {
      username?: string;
      password?: string;
    };
    const usernameTrimmed = typeof username === 'string' ? username.trim() : '';
    const passwordStr = typeof password === 'string' ? password : '';

    if (!usernameTrimmed || typeof password !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Username and password are required.',
      });
      return;
    }

    if (
      usernameTrimmed.length < MIN_WEB_REGISTER_CREDENTIAL_LEN ||
      passwordStr.length < MIN_WEB_REGISTER_CREDENTIAL_LEN
    ) {
      res.status(400).json({
        success: false,
        error: `Username and password must each be at least ${MIN_WEB_REGISTER_CREDENTIAL_LEN} characters.`,
      });
      return;
    }

    if (!isTestMode) {
      recordLoginAttempt(clientIp);
    }

    try {
      const fileUser = await createUser(usernameTrimmed, passwordStr);
      const sessionToken = await createSession({ webUserId: fileUser.id });
      const cookieOptions = getSessionCookieOptions();
      const cookieName = getSessionCookieName();
      res.cookie(cookieName, sessionToken, cookieOptions);
      res.json({
        success: true,
        message: 'Account created.',
        token: sessionToken,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create account.';
      res.status(400).json({ success: false, error: message });
    }
  });

  /**
   * GET /api/auth/token
   *
   * Generates a short-lived WebSocket connection token if the user has a valid session.
   * This token is used for initial WebSocket handshake authentication and expires in 5 minutes.
   * The token is NOT the session cookie value - it's a separate, short-lived token.
   */
  router.get('/token', (req, res) => {
    // Validate the session is still valid (via cookie, API key, or session token header)
    if (!isRequestAuthenticated(req)) {
      res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
      return;
    }

    // Generate a new short-lived WebSocket connection token
    const wsToken = createWsConnectionToken();

    res.json({
      success: true,
      token: wsToken,
      expiresIn: 300, // 5 minutes in seconds
    });
  });

  /**
   * POST /api/auth/logout
   *
   * Clears the session cookie and invalidates the session.
   */
  router.post('/logout', async (req, res) => {
    const cookieName = getSessionCookieName();
    const sessionToken = req.cookies?.[cookieName] as string | undefined;

    if (sessionToken) {
      await invalidateSession(sessionToken);
    }

    // Clear the cookie by setting it to empty with immediate expiration
    // Using res.cookie() with maxAge: 0 is more reliable than clearCookie()
    // in cross-origin development environments
    res.cookie(cookieName, '', {
      ...getSessionCookieOptions(),
      maxAge: 0,
      expires: new Date(0),
    });

    res.json({
      success: true,
      message: 'Logged out successfully.',
    });
  });

  return router;
}
