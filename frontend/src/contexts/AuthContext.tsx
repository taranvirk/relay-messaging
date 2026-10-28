import { createContext, useContext, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, RequestError } from '../lib/api';
import type { User } from '../types';

type Credentials = { email: string; password: string };
type Registration = Credentials & { username: string; displayName: string };
type AuthValue = {
  user: User | null;
  loading: boolean;
  login: (input: Credentials) => Promise<User>;
  register: (input: Registration) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => api<{ user: User | null }>('/api/auth/me', { signal }),
    retry: (failures, error) =>
      failures < 3 && !(error instanceof RequestError && error.status < 500),
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 3000),
    // A transient initial /me failure must not strand a still-valid cookie on
    // the login page. Invalid credentials do not get background retries.
    refetchInterval: (query) =>
      query.state.status === 'error' &&
      !(query.state.error instanceof RequestError && query.state.error.status < 500)
        ? 3000
        : false,
    staleTime: 60_000,
  });
  const loginMutation = useMutation({
    mutationFn: (input: Credentials) =>
      api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  });
  const registerMutation = useMutation({
    mutationFn: (input: Registration) =>
      api<{ user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  });

  async function settle(promise: Promise<{ user: User }>) {
    const result = await promise;
    queryClient.setQueryData(['me'], result);
    return result.user;
  }

  const sessionInvalid = me.error instanceof RequestError && [401, 403].includes(me.error.status);

  return (
    <AuthContext.Provider
      value={{
        user: sessionInvalid ? null : (me.data?.user ?? null),
        loading: me.isLoading,
        login: (input) => settle(loginMutation.mutateAsync(input)),
        register: (input) => settle(registerMutation.mutateAsync(input)),
        logout: async () => {
          try {
            await api('/api/auth/logout', { method: 'POST' });
          } catch (error) {
            if (!(error instanceof RequestError && error.status === 401)) throw error;
          }
          // Removing an observed query leaves its last result in the mounted
          // observer. Publish the signed-out identity before discarding private
          // caches, and cancel requests that could restore the previous user.
          await queryClient.cancelQueries();
          queryClient.setQueryData(['me'], { user: null });
          queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
          queryClient.getMutationCache().clear();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
