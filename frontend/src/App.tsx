import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthShell } from './components/AuthShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SocketProvider } from './contexts/SocketContext';
import { MessagesPage } from './pages/MessagesPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';

const protectedPage = (
  <ProtectedRoute>
    <SocketProvider>
      <Outlet />
    </SocketProvider>
  </ProtectedRoute>
);

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<AuthShell mode="login" />} />
        <Route path="/register" element={<AuthShell mode="register" />} />
        <Route element={protectedPage}>
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:conversationId" element={<MessagesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/messages" replace />} />
        <Route path="*" element={<Navigate to="/messages" replace />} />
      </Routes>
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: { background: '#151e29', border: '1px solid #263140', color: '#e8eef4' },
        }}
      />
    </>
  );
}
