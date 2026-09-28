import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ActionList, ActionMenu, Button, Flash, IssueLabelToken, Spinner, TextInput } from '@primer/react';
import { SearchIcon } from '@primer/octicons-react';
import { usePRList } from '../api/hooks';
import { PRStateIcon, ReviewDecisionLabel, Time, UserAvatar } from '../components/common';

export const DEFAULT_QUERY = 'is:open review-requested:@me';

export const PRESETS: { label: string; query: string }[] = [
  { label: 'Awaiting my review', query: DEFAULT_QUERY },
  { label: 'Reviewed by me', query: 'is:open reviewed-by:@me' },
  { label: 'Created by me', query: 'is:open author:@me' },
  { label: 'Assigned to me', query: 'is:open assignee:@me' },
  { label: 'Mentioning me', query: 'is:open mentions:@me' },
  { label: 'All open', query: 'is:open' },
  { label: 'Everything', query: '' },
];

export function presetLabel(query: string): string {
  return PRESETS.find((p) => p.query === query)?.label ?? 'Custom filter';
}

export function PRListPage() {
  const [params, setParams] = useSearchParams();
  const query = params.has('q') ? (params.get('q') ?? '') : DEFAULT_QUERY;
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const list = usePRList(query);

  const apply = (next: string) => {
    setParams(next === DEFAULT_QUERY ? {} : { q: next });
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    apply(draft.trim());
  };

  return (
    <div className="page pr-list-page">
      <form className="pr-filter" onSubmit={onSubmit}>
        <ActionMenu>
          <ActionMenu.Button>{presetLabel(query)}</ActionMenu.Button>
          <ActionMenu.Overlay width="medium">
            <ActionList selectionVariant="single">
              {PRESETS.map((preset) => (
                <ActionList.Item key={preset.label} selected={preset.query === query} onSelect={() => apply(preset.query)}>
                  {preset.label}
                  <ActionList.Description variant="block">{preset.query || '(no filter)'}</ActionList.Description>
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
        <TextInput
          className="pr-filter-input"
          leadingVisual={SearchIcon}
          aria-label="Search pull requests"
          placeholder="GitHub search syntax, e.g. is:open label:bug author:octocat"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          block
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      {list.isPending && (
        <p className="page-message">
          <Spinner size="small" /> Loading pull requests…
        </p>
      )}
      {list.isError && <Flash variant="danger">{(list.error as Error).message}</Flash>}
      {list.data && list.data.items.length === 0 && <p className="page-message">No pull requests match this filter.</p>}
      {list.data && list.data.items.length > 0 && (
        <ul className="pr-list">
          {list.data.items.map((pr) => (
            <li key={pr.number} className="pr-list-row">
              <PRStateIcon state={pr.state} isDraft={pr.isDraft} />
              <div className="pr-list-main">
                <div className="pr-list-title-row">
                  <Link to={`/pr/${pr.number}`} className="pr-list-title">
                    {pr.title}
                  </Link>
                  {pr.labels.map((label) => (
                    <IssueLabelToken key={label.name} text={label.name} fillColor={`#${label.color}`} size="small" />
                  ))}
                </div>
                <div className="pr-list-meta muted">
                  #{pr.number} · {pr.author.login} · {pr.headRefName} → {pr.baseRefName} · updated <Time value={pr.updatedAt} />
                </div>
              </div>
              <div className="pr-list-side">
                <ReviewDecisionLabel decision={pr.reviewDecision} />
                <span className="pr-list-reviewers">
                  {pr.reviewRequests.map((r) => (
                    <UserAvatar key={r.login} user={r} size={20} />
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
