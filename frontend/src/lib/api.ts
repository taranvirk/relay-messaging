import type { ApiError } from '../types';

const base = import.meta.env.VITE_API_URL ?? '';

export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      error: { code: 'REQUEST_FAILED', message: response.statusText },
    }))) as ApiError;
    throw new RequestError(response.status, body.error.code, body.error.message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
