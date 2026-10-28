import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { App } from './App';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      }),
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

it('renders the sign-in flow', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    document.body.contains(await screen.findByRole('heading', { name: 'Sign in to Relay' })),
  ).toBe(true);
  expect(document.body.contains(screen.getByLabelText('Email'))).toBe(true);
});
