import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/layout/Shell';
import Dashboard from '@/pages/Dashboard';
import ProjectWorkspace from '@/pages/ProjectWorkspace';
import PresetsBrowser from '@/pages/PresetsBrowser';
import GenresBrowser from '@/pages/GenresBrowser';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function AppRouter() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/project/:id" component={ProjectWorkspace} />
        <Route path="/presets" component={PresetsBrowser} />
        <Route path="/genres" component={GenresBrowser} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
