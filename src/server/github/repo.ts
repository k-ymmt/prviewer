import { execFile } from 'node:child_process';
import { ghJson, type GhRunner } from '../gh.js';

export interface ResolvedRepo {
  owner: string;
  name: string;
  nameWithOwner: string;
  url: string;
}

export async function resolveRepo(gh: GhRunner): Promise<ResolvedRepo> {
  const data = await ghJson<{ owner: { login: string }; name: string; nameWithOwner: string; url: string }>(gh, [
    'repo',
    'view',
    '--json',
    'owner,name,nameWithOwner,url',
  ]);
  return { owner: data.owner.login, name: data.name, nameWithOwner: data.nameWithOwner, url: data.url };
}

export async function resolveViewerLogin(gh: GhRunner): Promise<string> {
  const data = await ghJson<{ login: string }>(gh, ['api', 'user']);
  return data.login;
}

/** Finds the git top-level directory for `cwd`. Falls back to `cwd` when not inside a repository. */
export function findGitRoot(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd }, (error, stdout) => {
      if (error) {
        resolve(cwd);
        return;
      }
      resolve(stdout.trim() || cwd);
    });
  });
}
