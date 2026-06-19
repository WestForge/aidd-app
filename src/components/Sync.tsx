import { useEffect, useState } from 'react';
import type { DeliveryBundle } from '../domain/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { GitReviewPanel } from './GitReviewPanel';
import { statusPillClass, statusSurfaceClass } from '../lib/statusTheme';

function setupStatusLabel(state: AiddGitProjectConnectionState) {
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

function syncStatusLabel(state: AiddGitSyncStatusState) {
  switch (state) {
    case 'synced':
      return 'Synced';
    case 'up_to_date':
      return 'Up to date';
    case 'local_changes':
      return 'Changes ready';
    case 'remote_updates_available':
      return 'Updates available';
    case 'ready_to_publish_first_version':
      return 'Ready to publish';
    case 'review_needed':
      return 'Review needed';
    case 'syncing':
      return 'Syncing';
    case 'error':
      return 'Error';
    default:
      return 'Not connected';
  }
}

function setupBadgeVariant(state: AiddGitProjectConnectionState): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'connected') return 'default';
  if (state === 'local_ready' || state === 'remote_not_configured') return 'secondary';
  if (state === 'remote_mismatch' || state === 'needs_attention' || state === 'error' || state === 'missing_identity') return 'destructive';
  return 'outline';
}

function syncBadgeVariant(state: AiddGitSyncStatusState): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'synced' || state === 'up_to_date') return 'default';
  if (state === 'local_changes' || state === 'remote_updates_available' || state === 'ready_to_publish_first_version') return 'secondary';
  if (state === 'review_needed' || state === 'error') return 'destructive';
  return 'outline';
}

function fallbackSetupStatus(activeProject?: AiddTrackedProject | null): AiddGitProjectConnectionStatus {
  return {
    connected: false,
    state: 'local_not_ready',
    branch: 'main',
    hasLocalRepository: false,
    message: activeProject?.path ? 'Local Git setup has not been checked yet.' : 'No active project selected.',
  };
}

function fallbackSyncStatus(activeProject?: AiddTrackedProject | null): AiddGitSyncStatus {
  return {
    state: activeProject?.path ? 'not_connected' : 'not_connected',
    message: activeProject?.path ? 'Sync status has not been checked yet.' : 'No active project selected.',
  };
}

export function Sync({ bundles, activeProject }: { bundles: DeliveryBundle[]; activeProject?: AiddTrackedProject | null }) {
  const localChanges = bundles.filter((bundle) => bundle.status !== 'accepted').length;
  const [setupStatus, setSetupStatus] = useState<AiddGitProjectConnectionStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<AiddGitSyncStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busyAction, setBusyAction] = useState<'setup' | 'check' | 'sync' | null>(null);

  async function refreshAll() {
    if (!activeProject?.path) {
      setSetupStatus(fallbackSetupStatus(activeProject));
      setSyncStatus(fallbackSyncStatus(activeProject));
      return;
    }

    const [nextSetupStatus, nextSyncStatus] = await Promise.all([
      window.aidd.gitSync.getProjectConnectionStatus(activeProject.path),
      window.aidd.gitSync.getSyncStatus(activeProject.path),
    ]);

    setSetupStatus(nextSetupStatus);
    setSyncStatus(nextSyncStatus);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!activeProject?.path) {
        setSetupStatus(fallbackSetupStatus(activeProject));
        setSyncStatus(fallbackSyncStatus(activeProject));
        setMessage('');
        return;
      }

      try {
        const [nextSetupStatus, nextSyncStatus] = await Promise.all([
          window.aidd.gitSync.getProjectConnectionStatus(activeProject.path),
          window.aidd.gitSync.getSyncStatus(activeProject.path),
        ]);

        if (!cancelled) {
          setSetupStatus(nextSetupStatus);
          setSyncStatus(nextSyncStatus);
          setMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          const errorMessage = error instanceof Error ? error.message : 'Could not read sync status.';
          setSetupStatus({
            connected: false,
            state: 'error',
            branch: 'main',
            hasLocalRepository: false,
            message: errorMessage,
          });
          setSyncStatus({ state: 'error', message: errorMessage });
          setMessage(errorMessage);
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

    setBusyAction('setup');
    setMessage('');

    try {
      const result = await window.aidd.gitSync.connectProject(activeProject.path);
      setSetupStatus(result.status);
      setMessage(result.message);
      await refreshAll();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Could not update local Git setup.';
      setSetupStatus({
        connected: false,
        state: 'error',
        branch: 'main',
        hasLocalRepository: false,
        message: errorMessage,
      });
      setMessage(errorMessage);
    } finally {
      setBusyAction(null);
    }
  }

  async function checkForUpdates() {
    if (!activeProject?.path) return;

    setBusyAction('check');
    setMessage('');

    try {
      const result = await window.aidd.gitSync.checkForUpdates(activeProject.path);
      setSyncStatus(result.status);
      setMessage(result.message);
      await refreshAll();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Could not check for shared updates.';
      setSyncStatus({ state: 'error', message: errorMessage });
      setMessage(errorMessage);
    } finally {
      setBusyAction(null);
    }
  }

  async function syncProject() {
    if (!activeProject?.path) return;

    setBusyAction('sync');
    setMessage('');
    setSyncStatus({ state: 'syncing', message: 'Syncing project...' });

    try {
      const result = await window.aidd.gitSync.syncProject(activeProject.path);
      setSyncStatus(result.status);
      setMessage(result.message);
      await refreshAll();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Could not sync project.';
      setSyncStatus({ state: 'error', message: errorMessage });
      setMessage(errorMessage);
    } finally {
      setBusyAction(null);
    }
  }

  const currentSetupStatus = setupStatus ?? fallbackSetupStatus(activeProject);
  const currentSyncStatus = syncStatus ?? fallbackSyncStatus(activeProject);
  const busy = busyAction !== null;
  const canUpdate = Boolean(activeProject?.path) && !busy;
  const canSync = Boolean(activeProject?.path) && currentSetupStatus.connected && !busy;

  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">Sync</p>
          <h1>Project Sync</h1>
          <p className="muted">Save and share project updates without exposing Git commands.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!activeProject?.path || busy} onClick={updateGitSetup}>
            {busyAction === 'setup' ? 'Working...' : 'Update Git setup'}
          </Button>
          <Button variant="outline" disabled={!canSync} onClick={checkForUpdates}>
            {busyAction === 'check' ? 'Checking...' : 'Check for updates'}
          </Button>
          <Button disabled={!canSync} onClick={syncProject}>
            {busyAction === 'sync' ? 'Syncing...' : 'Sync project'}
          </Button>
        </div>
      </header>

      <section className="grid gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Sync status</CardTitle>
                <CardDescription>Checkpoint local changes and share them with the configured repository.</CardDescription>
              </div>
              <Badge variant={syncBadgeVariant(currentSyncStatus.state)} className={statusPillClass(currentSyncStatus.state)}>{syncStatusLabel(currentSyncStatus.state)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">{currentSyncStatus.message}</p>

            {message ? <div className={statusSurfaceClass(currentSyncStatus.state, "rounded-md border px-3 py-2 text-sm")}>{message}</div> : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Last sync</div>
                <div className="text-sm">{currentSyncStatus.lastSyncAt ? new Date(currentSyncStatus.lastSyncAt).toLocaleString() : 'Never'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Last checkpoint</div>
                <div className="break-all text-sm">{currentSyncStatus.lastCheckpointLabel || 'None yet'}</div>
              </div>
            </div>

            {currentSyncStatus.state === 'review_needed' ? (
              <div className={statusSurfaceClass("review-needed", "rounded-md border px-3 py-2 text-sm text-warning")}>
                Sync stopped before making a destructive change. Review handling will be added in the conflict-safe collaboration phase.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Git setup</CardTitle>
                <CardDescription>Local Git is mandatory. Remote repository sync is optional.</CardDescription>
              </div>
              <Badge variant={setupBadgeVariant(currentSetupStatus.state)} className={statusPillClass(currentSetupStatus.state)}>{setupStatusLabel(currentSetupStatus.state)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">{currentSetupStatus.message}</p>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Workspace</div>
                <div className="break-all text-sm">{activeProject?.path ?? 'No project selected'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Author</div>
                <div className="break-all text-sm">
                  {currentSetupStatus.authorName && currentSetupStatus.authorEmail ? `${currentSetupStatus.authorName} <${currentSetupStatus.authorEmail}>` : 'Not configured'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Branch</div>
                <div className="text-sm">main — managed by AIDD</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Local repository</div>
                <div className="text-sm">{currentSetupStatus.hasLocalRepository ? 'Initialised' : 'Not initialised yet'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Repository URL</div>
                <div className="break-all text-sm">{currentSetupStatus.repoUrl || 'Optional, not configured'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Remote URL</div>
                <div className="break-all text-sm">{currentSetupStatus.remoteUrl ?? 'Not connected yet'}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <GitReviewPanel activeProject={activeProject} />

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
