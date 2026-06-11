import { useEffect, useState } from 'react';
import { FileText, FolderOpen, GripVertical, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface DragFileState {
  filePath: string;
  fileName: string;
}

export function DragTest() {
  const [file, setFile] = useState<DragFileState | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const prepareFile = async () => {
    setPreparing(true);
    setMessage(null);
    try {
      const prepared = await window.aidd.prepareNativeDragTestFile();
      setFile(prepared);
      setMessage('Test file is ready. Drag the tile into Explorer, Chrome, or ChatGPT.');
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'Could not prepare the drag test file.');
    } finally {
      setPreparing(false);
    }
  };

  useEffect(() => {
    prepareFile();
  }, []);

  return (
    <main className="flex h-screen min-h-0 w-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b px-5 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Native file drag test</h1>
            <Badge variant="secondary">Electron</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Use this isolated screen to prove whether Electron can drag a real Markdown file into Explorer or a browser upload area.</p>
        </div>
        <Button variant="outline" onClick={prepareFile} disabled={preparing}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {preparing ? 'Preparing...' : 'Refresh test file'}
        </Button>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-4 overflow-hidden p-5">
        <Card className="flex min-h-0 flex-col">
          <CardHeader>
            <CardTitle>Drag-out behaviour</CardTitle>
            <CardDescription>
              This tile starts Electron native file drag-out. If it works, dropping it should behave like dragging a file from Windows Explorer.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 items-center justify-center">
            <div
              draggable={Boolean(file?.filePath)}
              onDragStart={(event) => {
                if (!file?.filePath) {
                  event.preventDefault();
                  setMessage('The test file is still being prepared. Try again in a moment.');
                  return;
                }
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('text/plain', file.filePath);
                event.preventDefault();
                window.aidd.startFileDrag(file.filePath);
              }}
              className="flex h-44 w-44 cursor-grab select-none flex-col items-center justify-center gap-3 rounded-lg border bg-card p-4 text-center shadow-sm active:cursor-grabbing"
              title={file?.filePath ?? 'Test file is not ready yet'}
            >
              <div className="relative flex h-16 w-16 items-center justify-center rounded-lg border bg-muted">
                <FileText className="pointer-events-none h-8 w-8" />
                <GripVertical className="pointer-events-none absolute -right-2 -top-2 h-5 w-5 rounded-full border bg-background p-0.5 text-muted-foreground" />
              </div>
              <div className="pointer-events-none">
                <div className="text-sm font-medium">{file?.fileName ?? 'Preparing...'}</div>
                <div className="mt-1 text-xs text-muted-foreground">Drag this tile out</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <aside className="flex min-h-0 flex-col gap-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test steps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <ol className="list-decimal space-y-2 pl-4">
                <li>Drag the file tile into Windows Explorer.</li>
                <li>Drag the file tile into Chrome's file upload target.</li>
                <li>Drag the file tile into ChatGPT's upload area.</li>
              </ol>
              <p>If these do not accept the drop, the OS file payload is still not being created correctly.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fallback</CardTitle>
              <CardDescription>Open the generated file in Explorer and drag it from there.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" disabled={!file?.filePath} onClick={() => file?.filePath && window.aidd.showItemInFolder(file.filePath)}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Open file location
              </Button>
            </CardContent>
          </Card>

          {message && (
            <Alert>
              <AlertTitle>Drag test</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
        </aside>
      </section>
    </main>
  );
}
