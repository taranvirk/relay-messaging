import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthShell } from './AuthShell';

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, ...auth }) }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.login.mockResolvedValue({ id: 'alice' });
  auth.register.mockResolvedValue({ id: 'alice' });
});

function mount(mode: 'login' | 'register') {
  render(
    <MemoryRouter initialEntries={[`/${mode}`]}>
      <Routes>
        <Route path={`/${mode}`} element={<AuthShell mode={mode} />} />
        <Route path="/messages" element={<p>Inbox ready</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('submits credentials and opens the inbox after login', async () => {
  const user = userEvent.setup();
  mount('login');
  await user.type(screen.getByLabelText('Email'), 'alice@example.com');
  await user.type(screen.getByLabelText('Password'), 'StrongPass123');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Inbox ready');
  expect(auth.login).toHaveBeenCalledWith({
    email: 'alice@example.com',
    password: 'StrongPass123',
  });
});

it('submits all registration fields', async () => {
  mount('register');
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'StrongPass123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Inbox ready');
  expect(auth.register).toHaveBeenCalledWith({
    username: 'alice',
    displayName: 'Alice',
    email: 'alice@example.com',
    password: 'StrongPass123',
  });
});

it('shows a failed login without navigating away', async () => {
  auth.login.mockRejectedValue(new Error('Email or password is incorrect'));
  mount('login');
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe('Email or password is incorrect'),
  );
  expect(screen.queryByText('Inbox ready')).toBeNull();
});
