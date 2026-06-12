import { useEffect, useMemo, useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';

type ReviewVersion = 'local' | 'remote' | 'base';

interface GitReviewPanelProps {
  activeProject?: AiddTrackedProject | null;
}

function statusLabel(status: AiddGitReviewState['status']) {
  switch (status) {
    case 'pending':
      return 'Review needed';
    case 'partially_resolved':
      return 'Partially resolved';
    case 'ready_to_complete':
      return 'Ready to complete';
    case 'completed':
      return 'Completed';
    default:
      return 'No review needed';
  }
}

export function GitReviewPanel({ activeProject }: GitReviewPanelProps) {
  const [state, setState] = useState<AiddGitReviewState | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [version, setVersion] = useState<ReviewVersion>('local');
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadReviewState() {
    if (!activeProject?.path) {
      setState(null);
      setSelectedPath('');
      return;
    }

    const next = await window.aidd.gitSync.getReviewState(activeProject.path);
    setState(next);

    const firstUnresolved = next.files.find((file) => file.status !== 'resolved') ?? next.files[0];
    setSelectedPath((current) => current || firstUnresolved?.path || '');
  }

  useEffect(() => {
    loadReviewState().catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Could not load review state.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.path]);

  const selectedFile = useMemo(() => state?.files.find((file) => file.path === selectedPath), [state, selectedPath]);

  async function loadContent(nextVersion = version, nextPath = selectedPath) {
    if (!activeProject?.path || !state?.reviewId || !nextPath) return;

    setBusy(true);
    setMessage('');

    try {
      const nextContent = await window.aidd.gitSync.readReviewFile({
        projectPath: activeProject.path,
        reviewId: state.reviewId,
        filePath: nextPath,
        kind: nextVersion,
      });

      setContent(nextContent);
      setDraft(nextContent);
      setVersion(nextVersion);
    } catch (error) {
      setContent('');
      setDraft('');
      setMessage(error instanceof Error ? error.message : 'Could not read review file.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (state?.active && selectedPath) {
      loadContent('local', selectedPath).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.reviewId, selectedPath]);

  async function resolve(resolution: AiddGitReviewResolution) {
    if (!activeProject?.path || !state?.reviewId || !selectedPath) return;

    setBusy(true);
    setMessage('');

    try {
      const next = await window.aidd.gitSync.resolveReviewFile({
        projectPath: activeProject.path,
        reviewId: state.reviewId,
        filePath: selectedPath,
        resolution,
        combinedContent: resolution === 'use_combined_draft' ? draft : undefined,
      });

      setState(next);
      setMessage(next.message);

      const nextUnresolved = next.files.find((file) => file.status !== 'resolved');
      if (nextUnresolved) {
        setSelectedPath(nextUnresolved.path);
      }

      await loadReviewState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not resolve review file.');
    } finally {
      setBusy(false);
    }
  }

  async function completeReview() {
    if (!activeProject?.path || !state?.reviewId) return;

    setBusy(true);
    setMessage('');

    try {
      const next = await window.aidd.gitSync.completeReview(activeProject.path, state.reviewId);
      setState(next);
      setMessage(next.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not complete review.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelReview() {
    if (!activeProject?.path || !state?.reviewId) return;

    setBusy(true);
    setMessage('');

    try {
      const next = await window.aidd.gitSync.cancelReview(activeProject.path, state.reviewId);
      setState(next);
      setMessage(next.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel review.');
    } finally {
      setBusy(false);
    }
  }

  if (!activeProject?.path || !state?.active) {
    return null;
  }

  return (
    <Card className="border-yellow-500/40">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Review needed</CardTitle>
            <CardDescription>{state.message}</CardDescription>
          </div>
          <Badge variant="secondary">{statusLabel(state.status)}</Badge>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Files needing review</div>
          <div className="flex flex-wrap gap-2">
            {state.files.map((file) => (
              <Button
                key={file.path}
                type="button"
                variant={file.path === selectedPath ? 'default' : 'outline'}
                size="sm"
                disabled={busy}
                onClick={() => setSelectedPath(file.path)}
              >
                {file.status === 'resolved' ? '✓ ' : ''}
                {file.path}
              </Button>
            ))}
          </div>
        </div>

        {selectedFile ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{selectedFile.path}</div>
                <div className="text-xs text-muted-foreground">Choose which version should be applied to the project.</div>
              </div>

              <Select
                value={version}
                disabled={busy}
                onChange={(event) => loadContent(event.target.value as ReviewVersion)}
              >
                <option value="local">My version</option>
                <option value="remote">Shared version</option>
                <option value="base">Previous version</option>
              </Select>
            </div>

            <Textarea
              value={draft}
              disabled={busy || selectedFile.status === 'resolved'}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-[240px] font-mono text-xs"
              placeholder={content || 'No content available for this version.'}
            />

            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy || selectedFile.status === 'resolved'} onClick={() => resolve('keep_local')}>
                Keep my version
              </Button>
              <Button type="button" variant="outline" disabled={busy || selectedFile.status === 'resolved'} onClick={() => resolve('use_shared')}>
                Use shared version
              </Button>
              <Button type="button" variant="outline" disabled={busy || selectedFile.status === 'resolved'} onClick={() => resolve('use_combined_draft')}>
                Use edited draft
              </Button>
            </div>
          </div>
        ) : null}

        {message ? <div className="rounded-md border px-3 py-2 text-sm">{message}</div> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={cancelReview}>Cancel review</Button>
          <Button
            type="button"
            disabled={busy || state.files.some((file) => file.status !== 'resolved')}
            onClick={completeReview}
          >
            Complete review
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
