import { Link, Route, Routes } from 'react-router';
import { Header } from '@primer/react';
import { GitPullRequestIcon, RepoIcon } from '@primer/octicons-react';
import { useRepo } from './api/hooks';
import { UserAvatar } from './components/common';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommitsTab } from './pages/CommitsTab';
import { ConversationTab } from './pages/ConversationTab';
import { FilesTab } from './pages/FilesTab';
import { PRListPage } from './pages/PRListPage';
import { PRPage } from './pages/PRPage';

function AppHeader() {
  const repo = useRepo();
  return (
    <Header className="app-header">
      <Header.Item>
        <Header.Link as={Link} to="/" className="app-brand">
          <GitPullRequestIcon size={20} />
          <span>prviewer</span>
        </Header.Link>
      </Header.Item>
      {repo.data && (
        <Header.Item>
          <Header.Link href={repo.data.url} target="_blank" rel="noreferrer">
            <RepoIcon />
            <span className="app-repo-name">{repo.data.nameWithOwner}</span>
          </Header.Link>
        </Header.Item>
      )}
      <Header.Item full />
      {repo.data && (
        <Header.Item>
          <span className="app-viewer">
            <UserAvatar user={{ login: repo.data.viewerLogin, avatarUrl: '' }} size={20} />
            {repo.data.viewerLogin}
          </span>
        </Header.Item>
      )}
    </Header>
  );
}

export function App() {
  return (
    <div className="app">
      <AppHeader />
      <main className="app-main">
        <ErrorBoundary label="This page">
          <Routes>
            <Route path="/" element={<PRListPage />} />
            <Route path="/pr/:number" element={<PRPage />}>
              <Route index element={<ConversationTab />} />
              <Route path="commits" element={<CommitsTab />} />
              <Route path="commits/:sha" element={<CommitsTab />} />
              <Route path="files" element={<FilesTab />} />
            </Route>
            <Route path="*" element={<p className="page-message">Not found.</p>} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
