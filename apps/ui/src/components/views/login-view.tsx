/**
 * Login View - Web mode authentication
 *
 * Uses a state machine for clear, maintainable flow:
 *
 * States:
 *   checking_server → server_error (after 5 retries)
 *   checking_server → awaiting_login (401/unauthenticated)
 *   checking_server → checking_setup (authenticated)
 *   awaiting_login → logging_in → login_error | checking_setup
 *   awaiting_login: mode sign-in or self-service register.
 *   checking_setup → redirecting
 */

import { useReducer, useEffect, useRef } from 'react';
import {
  login,
  registerWebUser,
  checkAuthStatus,
  getHttpApiClient,
  initApiKey,
} from '@/lib/http-api-client';
import { router } from '@/utils/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { User, Lock, AlertCircle, RefreshCw, ServerCrash } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/auth-store';
import { useSetupStore } from '@/store/setup-store';
import { getLocalUserCredentials, setLocalUserCredentials } from '@/lib/local-user-credentials';

/** Self-service registration: min length for username (trimmed) and password. */
const MIN_WEB_REGISTER_CREDENTIAL_LEN = 5;

// =============================================================================
// State Machine Types
// =============================================================================

type CredentialMode = 'signin' | 'register';

type State =
  | { phase: 'checking_server'; attempt: number }
  | { phase: 'server_error'; message: string }
  | {
      phase: 'awaiting_login';
      mode: CredentialMode;
      username: string;
      password: string;
      passwordConfirm: string;
      error: string | null;
    }
  | {
      phase: 'logging_in';
      mode: CredentialMode;
      username: string;
      password: string;
      passwordConfirm: string;
      error: null;
    }
  | { phase: 'checking_setup' }
  | { phase: 'redirecting'; to: string };

type Action =
  | { type: 'SERVER_CHECK_RETRY'; attempt: number }
  | { type: 'SERVER_ERROR'; message: string }
  | { type: 'AUTH_REQUIRED' }
  | { type: 'AUTH_VALID' }
  | { type: 'SET_MODE'; mode: CredentialMode }
  | { type: 'UPDATE_USERNAME'; value: string }
  | { type: 'UPDATE_PASSWORD'; value: string }
  | { type: 'UPDATE_PASSWORD_CONFIRM'; value: string }
  | { type: 'SET_LOGIN_ERROR'; message: string }
  | { type: 'SUBMIT_LOGIN' }
  | { type: 'LOGIN_ERROR'; message: string }
  | { type: 'REDIRECT'; to: string }
  | { type: 'RETRY_SERVER_CHECK' };

const initialState: State = { phase: 'checking_server', attempt: 1 };

// =============================================================================
// State Machine Reducer
// =============================================================================

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SERVER_CHECK_RETRY':
      return { phase: 'checking_server', attempt: action.attempt };

    case 'SERVER_ERROR':
      return { phase: 'server_error', message: action.message };

    case 'AUTH_REQUIRED': {
      const saved = getLocalUserCredentials();
      return {
        phase: 'awaiting_login',
        mode: 'signin',
        username: saved?.username ?? '',
        password: saved?.password ?? '',
        passwordConfirm: '',
        error: null,
      };
    }

    case 'AUTH_VALID':
      return { phase: 'checking_setup' };

    case 'SET_MODE':
      if (state.phase !== 'awaiting_login') return state;
      return {
        ...state,
        mode: action.mode,
        password: action.mode === 'signin' ? state.password : '',
        passwordConfirm: '',
        error: null,
      };

    case 'UPDATE_USERNAME':
      if (state.phase !== 'awaiting_login') return state;
      return { ...state, username: action.value };

    case 'UPDATE_PASSWORD':
      if (state.phase !== 'awaiting_login') return state;
      return { ...state, password: action.value };

    case 'UPDATE_PASSWORD_CONFIRM':
      if (state.phase !== 'awaiting_login') return state;
      return { ...state, passwordConfirm: action.value };

    case 'SET_LOGIN_ERROR':
      if (state.phase !== 'awaiting_login') return state;
      return { ...state, error: action.message };

    case 'SUBMIT_LOGIN':
      if (state.phase !== 'awaiting_login') return state;
      return {
        phase: 'logging_in',
        mode: state.mode,
        username: state.username,
        password: state.password,
        passwordConfirm: state.passwordConfirm,
        error: null,
      };

    case 'LOGIN_ERROR':
      if (state.phase !== 'logging_in') return state;
      return {
        phase: 'awaiting_login',
        mode: state.mode,
        username: state.username,
        password: state.password,
        passwordConfirm: state.passwordConfirm,
        error: action.message,
      };

    case 'REDIRECT':
      return { phase: 'redirecting', to: action.to };

    case 'RETRY_SERVER_CHECK':
      return { phase: 'checking_server', attempt: 1 };

    default:
      return state;
  }
}

// =============================================================================
// Constants
// =============================================================================

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 400;

// =============================================================================
// Imperative Flow Logic (runs once on mount)
// =============================================================================

/**
 * Check if server is reachable and if we have a valid session.
 */
async function checkServerAndSession(
  dispatch: React.Dispatch<Action>,
  setAuthState: (state: { isAuthenticated: boolean; authChecked: boolean }) => void,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Return early if the component has unmounted
    if (signal?.aborted) {
      return;
    }

    dispatch({ type: 'SERVER_CHECK_RETRY', attempt });

    try {
      const result = await checkAuthStatus({ credentialEntry: true });

      // Return early if the component has unmounted
      if (signal?.aborted) {
        return;
      }

      if (result.authenticated) {
        // Server is reachable and we're authenticated
        setAuthState({ isAuthenticated: true, authChecked: true });
        dispatch({ type: 'AUTH_VALID' });
        return;
      }

      dispatch({ type: 'AUTH_REQUIRED' });
      return;
    } catch (error: unknown) {
      // Network error - server is not reachable
      console.debug(`Server check attempt ${attempt}/${MAX_RETRIES} failed:`, error);

      if (attempt === MAX_RETRIES) {
        // Return early if the component has unmounted
        if (!signal?.aborted) {
          dispatch({
            type: 'SERVER_ERROR',
            message: 'Unable to connect to server. Please check that the server is running.',
          });
        }
        return;
      }

      // Exponential backoff before retry
      const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

async function checkSetupStatus(
  dispatch: React.Dispatch<Action>,
  signal?: AbortSignal
): Promise<void> {
  const httpClient = getHttpApiClient();

  try {
    const result = await httpClient.settings.getGlobal();

    // Return early if aborted
    if (signal?.aborted) {
      return;
    }

    if (result.success && result.settings) {
      // Check the setupComplete field from settings
      // This is set to true when user completes the setup wizard
      const setupComplete = (result.settings as { setupComplete?: boolean }).setupComplete === true;

      // IMPORTANT: Update the Zustand store BEFORE redirecting
      // Otherwise __root.tsx routing effect will override our redirect
      // because it reads setupComplete from the store (which defaults to false)
      useSetupStore.getState().setSetupComplete(setupComplete);

      dispatch({ type: 'REDIRECT', to: setupComplete ? '/' : '/setup' });
    } else {
      // No settings yet = first run = need setup
      useSetupStore.getState().setSetupComplete(false);
      dispatch({ type: 'REDIRECT', to: '/setup' });
    }
  } catch {
    // Return early if aborted
    if (signal?.aborted) {
      return;
    }
    // If we can't get settings, go to setup to be safe
    useSetupStore.getState().setSetupComplete(false);
    dispatch({ type: 'REDIRECT', to: '/setup' });
  }
}

async function performLogin(
  username: string,
  password: string,
  dispatch: React.Dispatch<Action>,
  setAuthState: (state: { isAuthenticated: boolean; authChecked: boolean }) => void
): Promise<void> {
  try {
    const result = await login({ username, password });

    if (result.success) {
      setLocalUserCredentials({ username: username.trim(), password });
      setAuthState({ isAuthenticated: true, authChecked: true });
      dispatch({ type: 'AUTH_VALID' });
    } else {
      dispatch({ type: 'LOGIN_ERROR', message: result.error || 'Login failed' });
    }
  } catch {
    dispatch({ type: 'LOGIN_ERROR', message: 'Failed to connect to server' });
  }
}

async function performRegister(
  username: string,
  password: string,
  dispatch: React.Dispatch<Action>,
  setAuthState: (state: { isAuthenticated: boolean; authChecked: boolean }) => void
): Promise<void> {
  try {
    const result = await registerWebUser({ username, password });

    if (result.success) {
      setLocalUserCredentials({ username: username.trim(), password: '' });
      setAuthState({ isAuthenticated: true, authChecked: true });
      dispatch({ type: 'AUTH_VALID' });
    } else {
      dispatch({ type: 'LOGIN_ERROR', message: result.error || 'Could not create account' });
    }
  } catch {
    dispatch({ type: 'LOGIN_ERROR', message: 'Failed to connect to server' });
  }
}

// =============================================================================
// Component
// =============================================================================

export function LoginView() {
  const setAuthState = useAuthStore((s) => s.setAuthState);
  const [state, dispatch] = useReducer(reducer, initialState);
  const retryControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    initApiKey().catch((error) => {
      console.warn('Failed to initialize API key:', error);
    });
  }, []);

  // Run initial server/session check on mount.
  // IMPORTANT: Do not "run once" via a ref guard here.
  // In React StrictMode (dev), effects mount -> cleanup -> mount.
  // If we abort in cleanup and also skip the second run, we'll get stuck forever on "Connecting...".
  useEffect(() => {
    const controller = new AbortController();
    checkServerAndSession(dispatch, setAuthState, controller.signal);

    return () => {
      controller.abort();
      retryControllerRef.current?.abort();
    };
  }, [setAuthState]);

  // When we enter checking_setup phase, check setup status
  useEffect(() => {
    if (state.phase === 'checking_setup') {
      const controller = new AbortController();
      checkSetupStatus(dispatch, controller.signal);

      return () => {
        controller.abort();
      };
    }
  }, [state.phase]);

  // When we enter redirecting phase, navigate
  useEffect(() => {
    if (state.phase === 'redirecting') {
      void router.navigate({ to: state.to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state.to only accessed when phase is redirecting
  }, [state.phase]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (state.phase !== 'awaiting_login') return;
    const { username, password, passwordConfirm, mode } = state;
    if (!username.trim()) return;

    if (mode === 'register' && password !== passwordConfirm) {
      dispatch({ type: 'SET_LOGIN_ERROR', message: 'Passwords do not match.' });
      return;
    }

    if (
      mode === 'register' &&
      (username.trim().length < MIN_WEB_REGISTER_CREDENTIAL_LEN ||
        password.length < MIN_WEB_REGISTER_CREDENTIAL_LEN)
    ) {
      dispatch({
        type: 'SET_LOGIN_ERROR',
        message: `Username and password must each be at least ${MIN_WEB_REGISTER_CREDENTIAL_LEN} characters.`,
      });
      return;
    }

    dispatch({ type: 'SUBMIT_LOGIN' });
    if (mode === 'register') {
      void performRegister(username, password, dispatch, setAuthState);
    } else {
      void performLogin(username, password, dispatch, setAuthState);
    }
  };

  // Handle retry button for server errors
  const handleRetry = () => {
    // Abort any previous retry request
    retryControllerRef.current?.abort();

    dispatch({ type: 'RETRY_SERVER_CHECK' });
    const controller = new AbortController();
    retryControllerRef.current = controller;
    checkServerAndSession(dispatch, setAuthState, controller.signal);
  };

  // =============================================================================
  // Render based on current state
  // =============================================================================

  // Checking server connectivity
  if (state.phase === 'checking_server') {
    return (
      <div className="flex min-h-full items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <Spinner size="xl" className="mx-auto" />
          <p className="text-sm text-muted-foreground">
            Connecting to server
            {state.attempt > 1 ? ` (attempt ${state.attempt}/${MAX_RETRIES})` : '...'}
          </p>
        </div>
      </div>
    );
  }

  // Server unreachable after retries
  if (state.phase === 'server_error') {
    return (
      <div className="flex min-h-full items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <ServerCrash className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Server Unavailable</h1>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </div>
          <Button onClick={handleRetry} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry Connection
          </Button>
        </div>
      </div>
    );
  }

  // Checking setup status after auth
  if (state.phase === 'checking_setup' || state.phase === 'redirecting') {
    return (
      <div className="flex min-h-full items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <Spinner size="xl" className="mx-auto" />
          <p className="text-sm text-muted-foreground">
            {state.phase === 'checking_setup' ? 'Loading settings...' : 'Redirecting...'}
          </p>
        </div>
      </div>
    );
  }

  const isLoggingIn = state.phase === 'logging_in';
  if (state.phase !== 'awaiting_login' && state.phase !== 'logging_in') {
    return null;
  }
  const { username, password, passwordConfirm, error, mode } = state;
  const isRegister = mode === 'register';
  const registerTooShort =
    isRegister &&
    (username.trim().length < MIN_WEB_REGISTER_CREDENTIAL_LEN ||
      password.length < MIN_WEB_REGISTER_CREDENTIAL_LEN);
  const submitDisabled =
    isLoggingIn ||
    !username.trim() ||
    (isRegister && (password !== passwordConfirm || registerTooShort));

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <User className="h-8 w-8 text-primary" />
          </div>
          <h1 className="mt-6 text-2xl font-bold tracking-tight">
            {isRegister ? 'Create your account' : 'Sign in'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isRegister
              ? `Choose a username and password (at least ${MIN_WEB_REGISTER_CREDENTIAL_LEN} characters each). You will be signed in after registration.`
              : 'Enter your username and password. Your last username is saved in this browser; passwords are not stored here.'}
          </p>
          <p className="mt-3 text-sm">
            {isRegister ? (
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => dispatch({ type: 'SET_MODE', mode: 'signin' })}
              >
                Already have an account? Sign in
              </button>
            ) : (
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => dispatch({ type: 'SET_MODE', mode: 'register' })}
              >
                Need an account? Register
              </button>
            )}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="login-username" className="text-sm font-medium">
              Username
            </label>
            <Input
              id="login-username"
              type="text"
              placeholder="Username"
              autoComplete="username"
              value={username}
              onChange={(e) => dispatch({ type: 'UPDATE_USERNAME', value: e.target.value })}
              disabled={isLoggingIn}
              autoFocus
              data-testid="login-username-input"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="login-password" className="text-sm font-medium flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              Password
            </label>
            <Input
              id="login-password"
              type="password"
              placeholder="Password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => dispatch({ type: 'UPDATE_PASSWORD', value: e.target.value })}
              disabled={isLoggingIn}
              className="font-mono"
              data-testid="login-password-input"
            />
          </div>

          {isRegister && (
            <div className="space-y-2">
              <label
                htmlFor="login-password-confirm"
                className="text-sm font-medium flex items-center gap-2"
              >
                <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                Confirm password
              </label>
              <Input
                id="login-password-confirm"
                type="password"
                placeholder="Re-enter password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) =>
                  dispatch({ type: 'UPDATE_PASSWORD_CONFIRM', value: e.target.value })
                }
                disabled={isLoggingIn}
                className="font-mono"
                data-testid="login-password-confirm-input"
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={submitDisabled}
            data-testid="login-submit-button"
          >
            {isLoggingIn ? (
              <>
                <Spinner size="sm" variant="foreground" className="mr-2" />
                {isRegister ? 'Creating account…' : 'Authenticating…'}
              </>
            ) : isRegister ? (
              'Create account & sign in'
            ) : (
              'Login'
            )}
          </Button>

          {!isRegister && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isLoggingIn}
              onClick={() => dispatch({ type: 'SET_MODE', mode: 'register' })}
              data-testid="login-register-toggle-button"
            >
              Create new account
            </Button>
          )}
        </form>

        <div className="rounded-lg border bg-muted/50 p-4 text-sm space-y-2 text-muted-foreground">
          <p className="font-medium text-foreground">Where accounts live</p>
          <p>
            Each account is a row in the server file{' '}
            <code className="text-xs bg-muted px-1 rounded">DATA_DIR/users.json</code> (bcrypt
            passwords). On AWS, mount{' '}
            <code className="text-xs bg-muted px-1 rounded">DATA_DIR</code> on durable storage (for
            example EFS) so new sign-ups survive redeploys. Operators can also add users with{' '}
            <code className="text-xs bg-muted px-1 rounded">npm run create-user</code> on the
            server.
          </p>
        </div>
      </div>
    </div>
  );
}
