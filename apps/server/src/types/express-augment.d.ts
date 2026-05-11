import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `albOidcSessionMiddleware` when ALB forwards a valid Cognito JWT in `x-amzn-oidc-data`. */
    automakerOidcUser?: { sub: string; email?: string };
  }
}
