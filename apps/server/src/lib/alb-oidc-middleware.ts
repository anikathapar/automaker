/**
 * AWS ALB + Amazon Cognito (Authenticate-Cognito listener action).
 *
 * When enabled, verifies the JWT in `x-amzn-oidc-data` and mints an Automaker session
 * cookie bound to the Cognito `sub` (separate session per user, shared org deployment).
 *
 * Env (all required when AUTOMAKER_ALB_OIDC_ENABLED=true):
 * - AUTOMAKER_ALB_OIDC_ENABLED=true
 * - COGNITO_USER_POOL_ID   (e.g. us-east-1_xxxx)
 * - COGNITO_REGION         (e.g. us-east-1) — falls back to AWS_REGION
 * - COGNITO_APP_CLIENT_ID  (must match the Cognito app client used by the ALB; used as JWT `aud`)
 *
 * Do not enable on hosts reachable without the ALB unless you also validate network path;
 * clients could otherwise forge `x-amzn-oidc-data`. Prefer private subnets + only ALB → tasks.
 */

import type { Request, Response, NextFunction } from 'express';
import * as jose from 'jose';
import { createLogger } from '@automaker/utils';
import {
  createSession,
  getSessionCookieName,
  getSessionCookieOptions,
  validateSession,
} from './auth.js';

const logger = createLogger('AlbOidc');

function isEnvTrue(envVar: string | undefined): boolean {
  return envVar === 'true';
}

export async function verifyAlbOidcJwt(
  jwtCompact: string
): Promise<{ sub: string; email?: string } | null> {
  const poolId = process.env.COGNITO_USER_POOL_ID;
  const region = process.env.COGNITO_REGION || process.env.AWS_REGION;
  const clientId = process.env.COGNITO_APP_CLIENT_ID;
  if (!poolId || !region || !clientId) {
    return null;
  }

  const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
  const jwks = jose.createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  try {
    const { payload } = await jose.jwtVerify(jwtCompact, jwks, {
      issuer,
      audience: clientId,
    });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) return null;
    const email =
      typeof payload.email === 'string'
        ? payload.email
        : typeof (payload as { 'cognito:username'?: string })['cognito:username'] === 'string'
          ? (payload as { 'cognito:username': string })['cognito:username']
          : undefined;
    return { sub, email };
  } catch (e) {
    logger.debug('ALB OIDC JWT verification failed', e);
    return null;
  }
}

/**
 * If ALB forwarded a Cognito JWT and there is no valid Automaker session yet, verify JWT
 * and set an HTTP-only session cookie keyed to that Cognito user.
 */
export async function albOidcSessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!isEnvTrue(process.env.AUTOMAKER_ALB_OIDC_ENABLED)) {
    next();
    return;
  }

  const poolId = process.env.COGNITO_USER_POOL_ID;
  const region = process.env.COGNITO_REGION || process.env.AWS_REGION;
  const clientId = process.env.COGNITO_APP_CLIENT_ID;
  if (!poolId || !region || !clientId) {
    logger.warn(
      'AUTOMAKER_ALB_OIDC_ENABLED=true but COGNITO_USER_POOL_ID, COGNITO_REGION (or AWS_REGION), and COGNITO_APP_CLIENT_ID must be set.'
    );
    next();
    return;
  }

  const raw = req.headers['x-amzn-oidc-data'];
  const headerVal = Array.isArray(raw) ? raw[0] : raw;
  if (!headerVal || typeof headerVal !== 'string') {
    next();
    return;
  }

  const cookieName = getSessionCookieName();
  const existing = (req.cookies || {})[cookieName] as string | undefined;
  if (existing && validateSession(existing)) {
    next();
    return;
  }

  try {
    const user = await verifyAlbOidcJwt(headerVal);
    if (!user) {
      next();
      return;
    }
    req.automakerOidcUser = user;
    const token = await createSession({ oidcSub: user.sub, email: user.email });
    res.cookie(cookieName, token, getSessionCookieOptions());
  } catch (e) {
    logger.warn('ALB OIDC session middleware error', e);
  }
  next();
}
