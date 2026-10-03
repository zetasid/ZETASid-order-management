import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AppShell } from '@/components/app-shell';
import Dashboard from '@/pages/dashboard';
import Orders from '@/pages/orders';
import OrderDetail from '@/pages/order-detail';
import Settings from '@/pages/settings';
import Login from '@/pages/login';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
  useSearch,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={Login} />
        <Route>
          <Protected>
          <AppShell>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/orders" component={Orders} />
              <Route path="/orders/:orderId" component={OrderDetail} />
              <Route path="/settings" component={Settings} />
              <Route component={NotFound} />
            </Switch>
          </AppShell>
          </Protected>
        </Route>
      </Switch>
    </RoutedErrorBoundary>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  const search = useSearch();
  if (loading) return <p role="status" className="p-6 text-center">Memeriksa sesi…</p>;
  if (!user) return <Redirect to={`/login?next=${encodeURIComponent(location + (search ? `?${search}` : ''))}`} />;
  return children;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
          <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
