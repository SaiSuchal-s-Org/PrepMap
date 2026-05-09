import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dehydrate, hydrate } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Layout } from "@/components/layout";
import { getStoredUser } from "@/lib/auth";

import Login from "@/pages/login";
import ResetPassword from "@/pages/reset-password";
import FirstLoginSetup from "@/pages/first-login-setup";
import Home from "@/pages/home";
import Roadmap from "@/pages/roadmap";
import Subtopic from "@/pages/subtopic";
import Admin from "@/pages/admin";
import ConfigDetail from "@/pages/config-detail";

const QUERY_CACHE_STORAGE_KEY = "prepmap_react_query_cache_v1";
const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    }
  }
});

function restoreQueryCache() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as { timestamp?: number; state?: unknown };
    const timestamp = Number(parsed?.timestamp || 0);
    if (!timestamp || Date.now() - timestamp > QUERY_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
      return;
    }

    if (parsed?.state) {
      hydrate(queryClient, parsed.state as Parameters<typeof hydrate>[1]);
    }
  } catch {
    try {
      window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
    } catch {}
  }
}

function persistQueryCache() {
  if (typeof window === "undefined") return;
  try {
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) => query.state.status === "success",
    });
    window.localStorage.setItem(
      QUERY_CACHE_STORAGE_KEY,
      JSON.stringify({ timestamp: Date.now(), state }),
    );
  } catch {}
}

function isAdminSession(): boolean {
  const user = getStoredUser();
  return user?.role === "admin";
}

function isLearnerRole(role: string | undefined) {
  return role === "student" || role === "super_student";
}

function ProtectedRoute({ component: Component, requireRole }: { component: React.ComponentType; requireRole?: "admin" | "learner" }) {
  const user = getStoredUser();
  if (!user) return <Redirect to="/login" />;
  if (isLearnerRole(user.role) && user.onboardingRequired) {
    return <Redirect to="/first-login-setup" />;
  }
  const hasRequiredRole = !requireRole
    || (requireRole === "admin" && user.role === "admin")
    || (requireRole === "learner" && isLearnerRole(user.role));
  if (!hasRequiredRole) {
    return <Redirect to={user.role === "admin" ? "/admin" : "/home"} />;
  }
  return <Component />;
}

function RootRedirect() {
  const user = getStoredUser();
  if (!user) return <Redirect to="/login" />;
  if (isLearnerRole(user.role) && user.onboardingRequired) return <Redirect to="/first-login-setup" />;
  return <Redirect to={user.role === "admin" ? "/admin" : "/home"} />;
}

function ProtectedHome() { return <ProtectedRoute component={Home} requireRole="learner" />; }
function ProtectedRoadmap() { return <ProtectedRoute component={Roadmap} />; }
function ProtectedSubtopic() { return <ProtectedRoute component={Subtopic} />; }
function ProtectedAdmin() { return <ProtectedRoute component={Admin} requireRole="admin" />; }
function ProtectedConfigDetail() { return <ProtectedRoute component={ConfigDetail} requireRole="admin" />; }

function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/first-login-setup" component={FirstLoginSetup} />
        <Route path="/home" component={ProtectedHome} />
        <Route path="/roadmap" component={ProtectedRoadmap} />
        <Route path="/subtopic/:id" component={ProtectedSubtopic} />
        <Route path="/admin/config/:id" component={ProtectedConfigDetail} />
        <Route path="/admin" component={ProtectedAdmin} />
        <Route path="/" component={RootRedirect} />
        <Route>
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <h1 className="text-4xl font-display font-bold text-foreground mb-4">404</h1>
            <p className="text-muted-foreground mb-6">The page you're looking for doesn't exist.</p>
            <a href="/home" className="text-primary hover:underline font-medium">Return Home</a>
          </div>
        </Route>
      </Switch>
    </Layout>
  );
}

function App() {
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    if (isAdminSession()) {
      try {
        window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
      } catch {}
    } else {
      restoreQueryCache();
    }
    setCacheReady(true);

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (isAdminSession()) return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        persistQueryCache();
      }, 500);
    });

    const persistNow = () => {
      if (isAdminSession()) return;
      persistQueryCache();
    };
    window.addEventListener("beforeunload", persistNow);

    return () => {
      unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener("beforeunload", persistNow);
      if (!isAdminSession()) {
        persistQueryCache();
      }
    };
  }, []);

  if (!cacheReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
