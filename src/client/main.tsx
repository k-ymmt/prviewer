import '@primer/primitives/dist/css/primitives.css';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import '@git-diff-view/react/styles/diff-view-pure.css';
import 'github-markdown-css/github-markdown.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BaseStyles, ThemeProvider } from '@primer/react';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root not found');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider colorMode="auto" preventSSRMismatch>
        <BaseStyles>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </BaseStyles>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
