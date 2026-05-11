import { createRouter, createBrowserHistory } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { registerRouter } from './router-access';

const history = createBrowserHistory();

export const router = createRouter({
  routeTree,
  defaultPendingMinMs: 0,
  history,
});

registerRouter(router);

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
