import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import LoginPage from '@/pages/Login';
import PosPage from '@/pages/Pos';
import { useAuthStore } from '@/stores/authStore';

function Protected({ children }: { children: ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pos" element={<Protected><PosPage /></Protected>} />
      <Route path="*" element={<Navigate to="/pos" replace />} />
    </Routes>
  );
}
