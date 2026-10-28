import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { AuthShell } from '../components/AuthShell';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { replaceWithLogin } from '../lib/navigation';

vi.mock('../lib/navigation', () => ({ replaceWithLogin: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function Session() {
  const { user, loading } = useAuth();
  return <p>{loading ? 'Connecting' : (user?.displayName ?? 'Signed out')}</p>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Session />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

it('recovers the initial session after a transient service outage', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'SESSION_STORE_UNAVAILABLE', message: 'Try again' } }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'alice', displayName: 'Alice' } })),
      ),
  );
  mount();
  await screen.findByText('Alice', {}, { timeout: 2000 });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not retry an invalid session', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'Sign in' } }), {
        status: 401,
      }),
    ),
  );
  mount();
  await screen.findByText('Signed out');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('clears a cached identity when its session is revoked or expires', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'Sign in' } }), {
        status: 401,
      }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  client.setQueryData(['me'], { user: { id: 'alice', displayName: 'Alice' } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Session />
      </AuthProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText('Alice')).toBeTruthy();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['me'] });
  });
  await screen.findByText('Signed out');
});

function mountSignedInApp(client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/messages']}>
        <AuthProvider>
          <Routes>
            <Route
              path="/messages"
              element={
                <ProtectedRoute>
                  <AppNav />
                  <p>Private messages</p>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<AuthShell mode="login" />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it.each([204, 401])(
  'signs out without a reload and removes private cached data (HTTP %s)',
  async (status) => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    client.setQueryData(['me'], {
      user: { id: 'alice', username: 'alice', displayName: 'Alice', avatarUrl: null },
    });
    client.setQueryData(['messages', 'private-room'], { messages: ['Private content'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path === '/api/auth/logout'
          ? new Response(null, { status })
          : new Response(JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'Sign in' } }), {
              status: 401,
            }),
      ),
    );
    mountSignedInApp(client);
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('heading', { name: 'Sign in to Relay' });
    expect(screen.queryByText('Private messages')).toBeNull();
    expect(client.getQueryData(['messages', 'private-room'])).toBeUndefined();
    expect(replaceWithLogin).toHaveBeenCalledOnce();
  },
);

it('does not restore the old user when a pre-logout session request finishes late', async () => {
  const user = userEvent.setup();
  const identity = {
    user: { id: 'alice', username: 'alice', displayName: 'Alice', avatarUrl: null },
  };
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  client.setQueryData(['me'], identity);
  let finishSession!: (response: Response) => void;
  const sessionResponse = new Promise<Response>((resolve) => {
    finishSession = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) =>
      path === '/api/auth/logout'
        ? Promise.resolve(new Response(null, { status: 204 }))
        : sessionResponse,
    ),
  );
  mountSignedInApp(client);
  let refresh!: Promise<void>;
  act(() => {
    refresh = client.invalidateQueries({ queryKey: ['me'] });
  });
  await user.click(screen.getByRole('button', { name: 'Log out' }));
  await screen.findByRole('heading', { name: 'Sign in to Relay' });
  await act(async () => {
    finishSession(new Response(JSON.stringify(identity)));
    await refresh;
  });
  expect(screen.getByRole('heading', { name: 'Sign in to Relay' })).toBeTruthy();
  expect(client.getQueryData(['me'])).toEqual({ user: null });
});
