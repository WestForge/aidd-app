import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface SettingsProps {
  activeProject?: AiddTrackedProject | null;
  themeMode: 'system' | 'light' | 'dark';
  onThemeModeChange: (mode: 'system' | 'light' | 'dark') => void;
}

export function Settings({ activeProject, themeMode, onThemeModeChange }: SettingsProps) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">App settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Settings are stored locally on this machine. Project workflow state stays in Markdown frontmatter.</p>
      </header>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose a theme or follow the operating system.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(['system', 'light', 'dark'] as const).map((mode) => (
              <Button key={mode} variant={themeMode === mode ? 'default' : 'outline'} onClick={() => onThemeModeChange(mode)}>
                {mode === 'system' ? 'Follow OS' : mode[0].toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current project</CardTitle>
            <CardDescription>The active AIDD workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {activeProject ? (
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{activeProject.name}</dd></div>
                <div className="grid gap-1"><dt className="text-muted-foreground">Path</dt><dd className="break-all rounded-md bg-muted p-2 font-mono text-xs">{activeProject.path}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Template</dt><dd><Badge variant="outline">{activeProject.templateId}@{activeProject.templateVersion}</Badge></dd></div>
              </dl>
            ) : <p className="text-sm text-muted-foreground">No active project selected.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Delivery planning vs standards</CardTitle>
            <CardDescription>Standards define quality expectations. Delivery planning turns capability/component/source context into a reviewable implementation plan.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Use Standards for languages, design principles, coding style, test expectations, and UI checks. Use Delivery Packages to configure the implementation strategy, breakdown, evidence, and AI review checks for a specific capability.
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
