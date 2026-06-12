import { useEffect, useState } from 'react';
import type { DeliveryBundle } from '../domain/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

function statusLabel(state: AiddGitProjectConnectionState) {
  switch (state) {
    case 'connected':
      return 'Remote configured';
    case 'local_ready':
      return 'Local Git ready';
    case 'remote_not_configured':
      return 'Remote not configured';
    case 'missing_identity':
      return 'Identity needed';
    case 'local_not_ready':
      return 'Local setup needed';
    case 'remote_mismatch':
      return 'Needs review';
    case 'needs_attention':
      return 'Needs attention';
    case 'error':
      return 'Error';
    default:
      return 'Not ready';
  }
}

function badgeVariant(state: AiddGitProjectConnectionState): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'connected') return 'default';
  if (state === 'local_ready' || state === 'remote_not_configured') return 'secondary';
  if (state === 'remote_mismatch' || state === 'needs_attention' || state === 'error' || state === 'missing_identity') return 'destructive';
  return 'outline';
}

function fallbackStatus(activeProject?: AiddTrackedProject | null): AiddGitProjectConnectionStatus {
  return {
    connected: false,
    state: activeProject?.path ? 'local_not_ready' : 'local_not_ready',
    branch: 'main',
    hasLocalRepository: false,
    message: activeProject?.path ? 'Local Git setup has not been checked yet.' : 'No active project selected.',
  };
}

export function Sync({ bundles, activeProject }: { bundles: DeliveryBundle[]; activeProject?: AiddTrackedProject | null }) {
  const localChanges = bundles.filter((bundle) => bundle.status !== 'accepted').length;
  const [status, setStatus] = useState<AiddGitProjectConnectionStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function refreshConnectionStatus() {
    if (!activeProject?.path) {
      setStatus(fallbackStatus(activeProject));
      return;
    }

    const nextStatus = await window.aidd.gitSync.getProjectConnectionStatus(activeProject.path);
    setStatus(nextStatus);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!activeProject?.path) {
        setStatus(fallbackStatus(activeProject));
        setMessage('');
        return;
      }

      try {
        const nextStatus = await window.aidd.gitSync.getProjectConnectionStatus(activeProject.path);
        if (!cancelled) {
          setStatus(nextStatus);
          setMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            connected: false,
            state: 'error',
            branch: 'main',
            hasLocalRepository: false,
            message: error instanceof Error ? error.message : 'Could not read Git setup status.',
          });
          setMessage(error instanceof Error ? error.message : 'Could not read Git setup status.');
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [activeProject?.path]);

  async function updateGitSetup() {
    if (!activeProject?.path) return;

    setBusy(true);
    setMessage('');

    try {
      const result = await window.aidd.gitSync.connectProject(activeProject.path);
      setStatus(result.status);
      setMessage(result.message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Could not update local Git setup.';
      setStatus({
        connected: false,
        state: 'error',
        branch: 'main',
        hasLocalRepository: false,
        message: errorMessage,
      });
      setMessage(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    setBusy(true);
    setMessage('');

    try {
      await refreshConnectionStatus();
      setMessage('Git setup status refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not refresh Git setup status.');
    } finally {
      setBusy(false);
    }
  }

  const currentStatus = status ?? fallbackStatus(activeProject);
  const canUpdate = Boolean(activeProject?.path) && !busy;

  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">Sync</p>
          <h1>Project Sync</h1>
          <p className="muted">AIDD owns local Git setup. Remote sync is optional.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!activeProject?.path || busy} onClick={checkStatus}>
            Check setup
          </Button>
          <Button disabled={!canUpdate} onClick={updateGitSetup}>
            {busy ? 'Working...' : 'Update Git setup'}
          </Button>
        </div>
      </header>

      <section className="grid gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Git setup</CardTitle>
                <CardDescription>
                  Create local Git setup first, then optionally connect a remote repository.
                </CardDescription>
              </div>
              <Badge variant={badgeVariant(currentStatus.state)}>{statusLabel(currentStatus.state)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">{currentStatus.message}</p>

            {message ? <div className="rounded-md border px-3 py-2 text-sm">{message}</div> : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Workspace</div>
                <div className="break-all text-sm">{activeProject?.path ?? 'No project selected'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Author</div>
                <div className="break-all text-sm">
                  {currentStatus.authorName && currentStatus.authorEmail ? `${currentStatus.authorName} <${currentStatus.authorEmail}>` : 'Not configured'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Branch</div>
                <div className="text-sm">main — managed by AIDD</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Local repository</div>
                <div className="text-sm">{currentStatus.hasLocalRepository ? 'Initialised' : 'Not initialised yet'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Repository URL</div>
                <div className="break-all text-sm">{currentStatus.repoUrl || 'Optional, not configured'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Remote URL</div>
                <div className="break-all text-sm">{currentStatus.remoteUrl ?? 'Not connected yet'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Last updated</div>
                <div className="text-sm">{currentStatus.lastConnectedAt ? new Date(currentStatus.lastConnectedAt).toLocaleString() : 'Never'}</div>
              </div>
            </div>

            {currentStatus.state === 'missing_identity' ? (
              <div className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                Set your AIDD author identity in Settings, then update Git setup.
              </div>
            ) : null}

            {currentStatus.state === 'local_ready' || currentStatus.state === 'remote_not_configured' ? (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-300">
                Local Git is ready. Remote sync is optional and can be added from Settings.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Local workflow changes</CardTitle>
            <CardDescription>Delivery items that are not accepted yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{localChanges}</div>
            <p className="text-sm text-muted-foreground">No Git commands are exposed to product owners.</p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
