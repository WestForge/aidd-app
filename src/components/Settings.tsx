import { useEffect, useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Label } from './ui/label';

type ThemeMode = 'system' | 'light' | 'dark';
type GitSyncMessageTone = 'success' | 'warning' | 'error' | null;

type GitSyncFormState = {
  provider: AiddGitProvider;
  repoUrl: string;
  token: string;
  hasToken: boolean;
};

type IdentityFormState = {
  authorName: string;
  authorEmail: string;
  source: AiddGitIdentity['source'];
};

const emptyGitSyncForm: GitSyncFormState = {
  provider: 'github',
  repoUrl: '',
  token: '',
  hasToken: false
};

const emptyIdentityForm: IdentityFormState = {
  authorName: '',
  authorEmail: '',
  source: 'none'
};

function toneForConnectionResult(result: AiddGitSyncTestResult): Exclude<GitSyncMessageTone, null> {
  if (result.code === 'EMPTY_REPOSITORY' || result.code === 'BRANCH_NOT_FOUND') {
    return 'warning';
  }

  return result.ok ? 'success' : 'error';
}

export function Settings({ activeProject, themeMode, onThemeModeChange }: { activeProject?: AiddTrackedProject | null; themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void }) {
  const [identity, setIdentity] = useState<IdentityFormState>(emptyIdentityForm);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityMessage, setIdentityMessage] = useState('');
  const [identityOk, setIdentityOk] = useState<boolean | null>(null);

  const [gitSync, setGitSync] = useState<GitSyncFormState>(emptyGitSyncForm);
  const [gitSyncBusy, setGitSyncBusy] = useState(false);
  const [gitSyncMessage, setGitSyncMessage] = useState<string>('');
  const [gitSyncTone, setGitSyncTone] = useState<GitSyncMessageTone>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadIdentity() {
      const loaded = await window.aidd.gitIdentity.read();
      if (cancelled) return;

      if (loaded) {
        setIdentity(loaded);
      } else {
        setIdentity(emptyIdentityForm);
      }
    }

    loadIdentity().catch((error) => {
      if (cancelled) return;
      setIdentityMessage(error instanceof Error ? error.message : 'Could not load AIDD identity.');
      setIdentityOk(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

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

      setGitSync({
        provider: settings.provider,
        repoUrl: settings.repoUrl,
        token: '',
        hasToken: settings.hasToken
      });
      setGitSyncMessage('');
      setGitSyncTone(null);
    }

    loadGitSyncSettings().catch((error) => {
      if (cancelled) return;
      setGitSyncMessage(error instanceof Error ? error.message : 'Could not load repository sync settings.');
      setGitSyncTone('error');
    });

    return () => {
      cancelled = true;
    };
  }, [activeProject?.path]);

  async function saveIdentity() {
    setIdentityBusy(true);
    setIdentityMessage('');
    setIdentityOk(null);

    try {
      const saved = await window.aidd.gitIdentity.save({
        authorName: identity.authorName,
        authorEmail: identity.authorEmail
      });

      setIdentity(saved);
      setIdentityMessage('AIDD author identity saved.');
      setIdentityOk(true);
    } catch (error) {
      setIdentityMessage(error instanceof Error ? error.message : 'Could not save AIDD author identity.');
      setIdentityOk(false);
    } finally {
      setIdentityBusy(false);
    }
  }

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
        token: gitSync.token || undefined
      });

      setGitSync({
        provider: saved.provider,
        repoUrl: saved.repoUrl,
        token: '',
        hasToken: saved.hasToken
      });

      const setupResult = await window.aidd.gitSync.connectProject(activeProject.path);

      if (!setupResult.ok) {
        setGitSyncMessage(`Repository settings saved, but local Git setup needs attention: ${setupResult.message}`);
        setGitSyncTone('error');
        return;
      }

      setGitSyncMessage(setupResult.message);
      setGitSyncTone('success');
    } catch (error) {
      setGitSyncMessage(error instanceof Error ? error.message : 'Could not save repository sync settings.');
      setGitSyncTone('error');
    } finally {
      setGitSyncBusy(false);
    }
  }

  async function testGitSyncConnection() {
    if (!activeProject?.path) return;

    if (!gitSync.repoUrl.trim()) {
      setGitSyncMessage('Enter a repository URL before testing the remote connection.');
      setGitSyncTone('warning');
      return;
    }

    setGitSyncBusy(true);
    setGitSyncMessage('');
    setGitSyncTone(null);

    try {
      const result = await window.aidd.gitSync.testConnection({
        projectPath: activeProject.path,
        provider: gitSync.provider,
        repoUrl: gitSync.repoUrl,
        token: gitSync.token || undefined
      });

      setGitSyncMessage(result.message);
      setGitSyncTone(toneForConnectionResult(result));
    } catch (error) {
      setGitSyncMessage(error instanceof Error ? error.message : 'Could not test repository connection.');
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
      setGitSync(settings ? { provider: settings.provider, repoUrl: settings.repoUrl, token: '', hasToken: false } : { ...gitSync, token: '', hasToken: false });
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
  const identityMessageClass = identityOk === false ? 'rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive' : 'rounded-md border px-3 py-2 text-sm';
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
              <CardTitle>AIDD author identity</CardTitle>
              <CardDescription>
                Used for local Git history across AIDD projects. AIDD writes this into each project locally instead of changing your machine-wide Git config.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="identity-author-name">Author name</Label>
                  <Input
                    id="identity-author-name"
                    value={identity.authorName}
                    disabled={identityBusy}
                    onChange={(event) => setIdentity((current) => ({ ...current, authorName: event.target.value }))}
                    placeholder="Your name"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="identity-author-email">Author email</Label>
                  <Input
                    id="identity-author-email"
                    value={identity.authorEmail}
                    disabled={identityBusy}
                    onChange={(event) => setIdentity((current) => ({ ...current, authorEmail: event.target.value }))}
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {identity.source === 'git-global' ? 'Prefilled from your global Git config.' : identity.source === 'saved' ? 'Saved in AIDD app settings.' : 'Set this before creating or repairing project Git setup.'}
                </p>
                <Button type="button" disabled={identityBusy || !identity.authorName.trim() || !identity.authorEmail.trim()} onClick={saveIdentity}>
                  {identityBusy ? 'Saving...' : 'Save identity'}
                </Button>
              </div>

              {identityMessage ? <div className={identityMessageClass}>{identityMessage}</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Repository sync</CardTitle>
                  <CardDescription>Optional remote repository settings. Local Git works without a remote.</CardDescription>
                </div>
                {gitSync.hasToken ? <Badge variant="secondary">Token saved</Badge> : <Badge variant="outline">No token</Badge>}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {!activeProject?.path ? <p className="text-sm text-muted-foreground">Select an active project before configuring repository sync.</p> : null}

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
                  <Label>Branch</Label>
                  <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">main — managed by AIDD</div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="git-repo-url">Repository URL</Label>
                <Input
                  id="git-repo-url"
                  value={gitSync.repoUrl}
                  disabled={gitSyncDisabled}
                  onChange={(event) => setGitSync((current) => ({ ...current, repoUrl: event.target.value }))}
                  placeholder="Optional, for example https://gitlab.example.com/group/repo.git"
                />
                <p className="text-xs text-muted-foreground">Leave blank to use local Git only. HTTPS URLs are supported in this phase.</p>
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

              {gitSyncMessage ? <div className={gitSyncMessageClass}>{gitSyncMessage}</div> : null}

              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={gitSyncDisabled} onClick={saveGitSyncSettings}>
                  {gitSyncBusy ? 'Working...' : 'Save and update Git setup'}
                </Button>
                <Button type="button" variant="outline" disabled={gitSyncDisabled || !gitSync.repoUrl.trim()} onClick={testGitSyncConnection}>Test connection</Button>
                <Button type="button" variant="outline" disabled={gitSyncDisabled || !gitSync.hasToken} onClick={clearGitSyncToken}>Clear token</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
