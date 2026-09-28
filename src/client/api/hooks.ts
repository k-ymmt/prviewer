import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AskResultDto,
  ChangedFile,
  CodexScope,
  CodexSelection,
  CodexStreamEvent,
  CodexThread,
  CommitDetail,
  CommitSummary,
  CreateReviewCommentRequest,
  PRDetail,
  PRListResponse,
  PRPersistedState,
  RepoInfo,
  SubmitReviewRequest,
  ViewedState,
} from '../../shared/types';
import { viewedOps } from '../../shared/viewed';
import { api, subscribeCodexStream } from './client';

export const queryKeys = {
  repo: ['repo'] as const,
  prs: (q: string) => ['prs', q] as const,
  pr: (n: number) => ['pr', n] as const,
  commits: (n: number) => ['commits', n] as const,
  commit: (sha: string) => ['commit', sha] as const,
  files: (n: number) => ['files', n] as const,
  state: (n: number) => ['state', n] as const,
};

export function useRepo() {
  return useQuery({ queryKey: queryKeys.repo, queryFn: () => api.get<RepoInfo>('/api/repo'), staleTime: Infinity });
}

export function usePRList(query: string) {
  return useQuery({
    queryKey: queryKeys.prs(query),
    queryFn: () => api.get<PRListResponse>(`/api/prs?q=${encodeURIComponent(query)}`),
  });
}

export function usePR(number: number) {
  return useQuery({ queryKey: queryKeys.pr(number), queryFn: () => api.get<PRDetail>(`/api/prs/${number}`) });
}

export function useCommits(number: number) {
  return useQuery({ queryKey: queryKeys.commits(number), queryFn: () => api.get<CommitSummary[]>(`/api/prs/${number}/commits`) });
}

export function useCommit(number: number, sha: string | null) {
  return useQuery({
    queryKey: queryKeys.commit(sha ?? ''),
    queryFn: () => api.get<CommitDetail>(`/api/prs/${number}/commits/${sha}`),
    enabled: sha !== null,
    staleTime: Infinity,
  });
}

export function useFiles(number: number) {
  return useQuery({ queryKey: queryKeys.files(number), queryFn: () => api.get<ChangedFile[]>(`/api/prs/${number}/files`) });
}

export function usePRState(number: number) {
  return useQuery({
    queryKey: queryKeys.state(number),
    queryFn: () => api.get<PRPersistedState>(`/api/prs/${number}/state`),
    staleTime: Infinity,
  });
}

// ---- viewed mutations (optimistic) ----

function updateViewed(client: QueryClient, number: number, fn: (viewed: ViewedState) => ViewedState) {
  client.setQueryData<PRPersistedState>(queryKeys.state(number), (current) =>
    current ? { ...current, viewed: fn(current.viewed) } : current,
  );
}

function setViewed(client: QueryClient, number: number, viewed: ViewedState) {
  client.setQueryData<PRPersistedState>(queryKeys.state(number), (current) => (current ? { ...current, viewed } : current));
}

export function useSetCommitViewed(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { sha: string; viewed: boolean }) => api.put<ViewedState>(`/api/prs/${number}/viewed/commits`, vars),
    onMutate: (vars) => updateViewed(client, number, (v) => viewedOps.setCommitViewed(v, vars.sha, vars.viewed)),
    onSuccess: (viewed) => setViewed(client, number, viewed),
    onError: () => client.invalidateQueries({ queryKey: queryKeys.state(number) }),
  });
}

export function useSetCommitFileViewed(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { sha: string; path: string; viewed: boolean; allPaths: string[] }) =>
      api.put<ViewedState>(`/api/prs/${number}/viewed/commit-files`, { sha: vars.sha, path: vars.path, viewed: vars.viewed }),
    onMutate: (vars) =>
      updateViewed(client, number, (v) => viewedOps.setCommitFileViewed(v, vars.sha, vars.path, vars.viewed, vars.allPaths)),
    onSuccess: (viewed) => setViewed(client, number, viewed),
    onError: () => client.invalidateQueries({ queryKey: queryKeys.state(number) }),
  });
}

export function useSetFileViewed(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { path: string; blobSha: string; viewed: boolean }) =>
      api.put<ViewedState>(`/api/prs/${number}/viewed/files`, vars),
    onMutate: (vars) => updateViewed(client, number, (v) => viewedOps.setFileViewed(v, vars.path, vars.blobSha, vars.viewed)),
    onSuccess: (viewed) => setViewed(client, number, viewed),
    onError: () => client.invalidateQueries({ queryKey: queryKeys.state(number) }),
  });
}

// ---- GitHub write mutations ----

export function useCreateIssueComment(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post(`/api/prs/${number}/comments`, { body }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.pr(number) }),
  });
}

export function useCreateReviewComment(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateReviewCommentRequest) => api.post(`/api/prs/${number}/review-comments`, req),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.pr(number) }),
  });
}

export function useReplyReviewComment(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { inReplyTo: number; body: string }) => api.post(`/api/prs/${number}/review-comments/reply`, vars),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.pr(number) }),
  });
}

export function useSubmitReview(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: SubmitReviewRequest) => api.post(`/api/prs/${number}/reviews`, req),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.pr(number) }),
  });
}

// ---- codex ----

function upsertThread(client: QueryClient, number: number, thread: CodexThread) {
  client.setQueryData<PRPersistedState>(queryKeys.state(number), (current) => {
    if (!current) return current;
    const exists = current.codexThreads.some((t) => t.id === thread.id);
    return {
      ...current,
      codexThreads: exists
        ? current.codexThreads.map((t) => (t.id === thread.id ? thread : t))
        : [...current.codexThreads, thread],
    };
  });
}

function patchMessage(
  client: QueryClient,
  number: number,
  messageId: string,
  fn: (message: CodexThread['messages'][number]) => CodexThread['messages'][number],
) {
  client.setQueryData<PRPersistedState>(queryKeys.state(number), (current) => {
    if (!current) return current;
    return {
      ...current,
      codexThreads: current.codexThreads.map((t) =>
        t.messages.some((m) => m.id === messageId)
          ? { ...t, messages: t.messages.map((m) => (m.id === messageId ? fn(m) : m)) }
          : t,
      ),
    };
  });
}

export function useCreateCodexThread(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { scope: CodexScope; selection: CodexSelection; question: string }) =>
      api.post<AskResultDto>(`/api/prs/${number}/codex/threads`, vars),
    onSuccess: (result) => upsertThread(client, number, result.thread),
  });
}

export function useAskCodex(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { threadId: string; question: string }) =>
      api.post<AskResultDto>(`/api/prs/${number}/codex/threads/${vars.threadId}/messages`, { question: vars.question }),
    onSuccess: (result) => upsertThread(client, number, result.thread),
  });
}

export function useDeleteCodexThread(number: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => api.delete(`/api/prs/${number}/codex/threads/${threadId}`),
    onSuccess: (_, threadId) =>
      client.setQueryData<PRPersistedState>(queryKeys.state(number), (current) =>
        current ? { ...current, codexThreads: current.codexThreads.filter((t) => t.id !== threadId) } : current,
      ),
  });
}

/** Streams a codex message that is still being generated into the query cache. */
export function useCodexStream(number: number, messageId: string, active: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!active) return;
    const apply = (event: CodexStreamEvent) => {
      switch (event.type) {
        case 'delta':
          patchMessage(client, number, event.messageId, (m) => ({ ...m, text: m.text + event.delta }));
          break;
        case 'done':
          patchMessage(client, number, event.message.id, () => event.message);
          break;
        case 'error':
          patchMessage(client, number, event.messageId, (m) => ({ ...m, status: 'error', error: event.error }));
          break;
        case 'thread':
          upsertThread(client, number, event.thread);
          break;
      }
    };
    // Reset the text before replaying: the server sends the buffered text first.
    patchMessage(client, number, messageId, (m) => ({ ...m, text: '' }));
    const unsubscribe = subscribeCodexStream(number, messageId, apply, (reason) => {
      if (reason === 'connection-lost') {
        void client.invalidateQueries({ queryKey: queryKeys.state(number) });
      }
    });
    return unsubscribe;
  }, [active, client, messageId, number]);
}
