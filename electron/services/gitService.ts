import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'node:fs';

export interface GitProjectStatus {
  branch?: string;
  changedFiles: string[];
}

export class GitService {
  constructor(private readonly dir: string) {}

  async init() {
    await git.init({ fs, dir: this.dir, defaultBranch: 'main' });
  }

  async status(): Promise<GitProjectStatus> {
    const matrix = await git.statusMatrix({ fs, dir: this.dir });
    const changedFiles = matrix
      .filter(([, head, workdir, stage]) => head !== workdir || workdir !== stage)
      .map(([filepath]) => filepath);

    let branch: string | undefined;
    try {
      branch = await git.currentBranch({ fs, dir: this.dir, fullname: false }) ?? undefined;
    } catch {
      branch = undefined;
    }

    return { branch, changedFiles };
  }

  async checkpoint(message: string, authorName: string, authorEmail: string) {
    await git.add({ fs, dir: this.dir, filepath: '.' });
    return git.commit({
      fs,
      dir: this.dir,
      message,
      author: { name: authorName, email: authorEmail }
    });
  }

  async clone(url: string, token?: string) {
    await git.clone({
      fs,
      http,
      dir: this.dir,
      url,
      singleBranch: true,
      depth: 10,
      onAuth: token ? () => ({ username: token, password: '' }) : undefined
    });
  }

  async push(remote = 'origin', ref = 'main', token?: string) {
    return git.push({
      fs,
      http,
      dir: this.dir,
      remote,
      ref,
      onAuth: token ? () => ({ username: token, password: '' }) : undefined
    });
  }

  async pull(authorName: string, authorEmail: string, token?: string) {
    return git.pull({
      fs,
      http,
      dir: this.dir,
      singleBranch: true,
      author: { name: authorName, email: authorEmail },
      onAuth: token ? () => ({ username: token, password: '' }) : undefined
    });
  }
}
