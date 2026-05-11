/**
 * Lazy router handle so route modules (e.g. __root) can navigate without importing
 * {@link ./router} at module load time. That import created a cycle:
 * routeTree.gen → __root → router → routeTree.gen → TDZ on `routeTree`.
 */
import type { RegisteredRouter } from '@tanstack/react-router';

let routerInstance: RegisteredRouter | null = null;

export function registerRouter(router: RegisteredRouter): void {
  routerInstance = router;
}

export function getRouter(): RegisteredRouter {
  if (!routerInstance) {
    throw new Error('Router has not been initialized yet');
  }
  return routerInstance;
}
