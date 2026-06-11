import { useEffect, useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Label } from './ui/label';

type ThemeMode = 'system' | 'light' | 'dark';

type GitSyncFormState = {
  provider: AiddGitProvider;
  repoUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  token: string;
  hasToken: boolean;
};

type GitSyncMessageTone = 'success' | 'warning' | 'error' | null;

const emptyGitSyncForm: GitSyncFormState = {
  provider: 'github',
  repoUrl: '',
  branch: 'main',
  authorName: '',
  authorEmail: '',
  token: '',
  hasToken: false
};

function gitSyncToneForResult(result: AiddGitSyncTestResult): Exclude<GitSyncMessageTone, null> {
  if (result.code === 'EMPTY_REPOSITORY' || result.code === 'BRANCH_NOT_FOUND') {
    return 'warning';
  }

  return result.ok ? 'success' : 'error';
}

export function Settings({ activeProject, themeMode, onThemeModeChange }: { activeProject?: AiddTrackedProject | null; themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void }) {
  const [gitSync, setGitSync] = useState<GitSyncFormState>(emptyGitSyncForm);
  const [gitSyncBusy, setGitSyncBusy] = useState(false);
  const [gitSyncMessage, setGitSyncMessage] = useState<string>('');
  const [gitSyncTone, setGitSyncTone] = useState<GitSyncMessageTone>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadGitSyncSettings() {
      if (!activeProject?.path) {
        setGitSync(emptyGitSyncForm);
        setGitSyncMessage('');
        setGitSyncTone(null);
        return;
      }

      const settings = await window.aidd.gitSync.readSettings(activeProject.path);
      if (cancelled) return;

      if (!settings) {
        setGitSync(emptyGitSyncForm);
        setGitSyncMessage('');
        setGitSyncTone(null);
        return;
      }

      setGitSync({ ...settings, token: '' });
      setGitSyncMessage('');
      setGitSyncTone(null);
    }

    loadGitSyncSettings().catch((error) => {
      if (cancelled) return;
      setGitSyncMessage(error instanceof Error ? error.message : 'Could not load Git Sync settings.');
      setGitSyncTone('error');
    });

    return () => {
      cancelled = true;
    };
  }, [activeProject?.path]);

  async function saveGitSyncSettings() {
    if (!activeProject?.path) return;
    setGitSyncBusy(true);
    setGitSyncMessage('');
    setGitSyncTone(null);

    try {
      const saved = await window.aidd.gitSync.saveSettings({
        projectPath: activeProject.path,
        provider: gitSync.provider,
        repoUrl: gitSync.repoUrl,
        branch: gitSync.branch,
        authorName: gitSync.authorName,
        authorEmail: gitSync.authorEmail,
        token: gitSync.token || undefined
      });

      setGitSync({ ...saved, token: '' });
      setGitSyncMessage('Git Sync settings saved.');
      setGitSyncTone('success');
    } catch (error) {
      setGitSyncMessage(error instanceof Error ? error.message : 'Could not save Git Sync settings.');
      setGitSyncTone('error');
    } finally {
      setGitSyncBusy(false);
    }
  }

  async function testGitSyncConnection() {
    if (!activeProject?.path) return;
    setGitSyncBusy(true);
    setGitSyncMessage('');
    setGitSyncTone(null);

    try {
      const result = await window.aidd.gitSync.testConnection({
        projectPath: activeProject.path,
        provider: gitSync.provider,
        repoUrl: gitSync.repoUrl,
        branch: gitSync.branch,
        token: gitSync.token || undefined
      });

      setGitSyncMessage(result.message);
      setGitSyncTone(gitSyncToneForResult(result));
    } catch (error) {
      setGitSyncMessage(error instanceof Error ? error.message : 'Could not test Git Sync connection.');
      setGitSyncTone('error');
    } finally {
      setGitSyncBusy(false);
    }
  }

  async function clearGitSyncToken() {
    if (!activeProject?.path) return;
    setGitSyncBusy(true);
    setGitSyncMessage('');
    setGitSyncTone(null);

    try {
      const settings = await window.aidd.gitSync.clearToken(activeProject.path);
      setGitSync(settings ? { ...settings, token: '' } : { ...gitSync, token: '', hasToken: false });
      setGitSyncMessage('Saved token cleared.');
      setGitSyncTone('success');
    } catch (error) {
      setGitSyncMessage(error instanceof Error ? error.message : 'Could not clear the saved token.');
      setGitSyncTone('error');
    } finally {
      setGitSyncBusy(false);
    }
  }

  const gitSyncDisabled = !activeProject?.path || gitSyncBusy;
  const gitSyncMessageClass =
    gitSyncTone === 'error'
      ? 'rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive'
      : gitSyncTone === 'warning'
        ? 'rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-300'
        : 'rounded-md border px-3 py-2 text-sm';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center border-b px-6">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Application and project settings.</p>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="max-w-3xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Use shadcn light/dark theme classes.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Label>Theme</Label>
              <Select value={themeMode} onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}>
                <option value="system">Follow system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active project</CardTitle>
              <CardDescription>{activeProject?.path ?? 'No active project selected.'}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-medium">{activeProject?.name ?? 'None'}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Git Sync</CardTitle>
                  <CardDescription>Connect this project to GitHub or GitLab without exposing Git workflow details.</CardDescription>
                </div>
                {gitSync.hasToken ? <Badge variant="secondary">Token saved</Badge> : <Badge variant="outline">No token</Badge>}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {!activeProject?.path ? <p className="text-sm text-muted-foreground">Select an active project before configuring Git Sync.</p> : null}

              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="git-provider">Provider</Label>
                  <Select
                    id="git-provider"
                    value={gitSync.provider}
                    disabled={gitSyncDisabled}
                    onChange={(event) => setGitSync((current) => ({ ...current, provider: event.target.value as AiddGitProvider }))}
                  >
                    <option value="github">GitHub</option>
                    <option value="gitlab">GitLab</option>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="git-branch">Default branch</Label>
                  <Input
                    id="git-branch"
                    value={gitSync.branch}
                    disabled={gitSyncDisabled}
                    onChange={(event) => setGitSync((current) => ({ ...current, branch: event.target.value }))}
                    placeholder="main"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="git-repo-url">Repository URL</Label>
                <Input
                  id="git-repo-url"
                  value={gitSync.repoUrl}
                  disabled={gitSyncDisabled}
                  onChange={(event) => setGitSync((current) => ({ ...current, repoUrl: event.target.value }))}
                  placeholder="https://github.com/org/repo.git"
                />
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="git-author-name">Author name</Label>
                  <Input
                    id="git-author-name"
                    value={gitSync.authorName}
                    disabled={gitSyncDisabled}
                    onChange={(event) => setGitSync((current) => ({ ...current, authorName: event.target.value }))}
                    placeholder="Francis"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="git-author-email">Author email</Label>
                  <Input
                    id="git-author-email"
                    value={gitSync.authorEmail}
                    disabled={gitSyncDisabled}
                    onChange={(event) => setGitSync((current) => ({ ...current, authorEmail: event.target.value }))}
                    placeholder="francis@example.com"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="git-token">Access token</Label>
                <Input
                  id="git-token"
                  type="password"
                  value={gitSync.token}
                  disabled={gitSyncDisabled}
                  onChange={(event) => setGitSync((current) => ({ ...current, token: event.target.value }))}
                  placeholder={gitSync.hasToken ? 'Leave blank to keep saved token' : 'Paste a GitHub or GitLab access token'}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">The token is stored using OS credential storage and is never written to the project workspace.</p>
              </div>

              {gitSyncMessage ? (
                <div className={gitSyncMessageClass}>
                  {gitSyncMessage}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={gitSyncDisabled} onClick={testGitSyncConnection}>Test connection</Button>
                <Button type="button" variant="secondary" disabled={gitSyncDisabled} onClick={saveGitSyncSettings}>Save settings</Button>
                <Button type="button" variant="outline" disabled={gitSyncDisabled || !gitSync.hasToken} onClick={clearGitSyncToken}>Clear token</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
