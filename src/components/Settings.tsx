import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Select } from './ui/select';
import { Label } from './ui/label';

type ThemeMode = 'system' | 'light' | 'dark';
export function Settings({ activeProject, themeMode, onThemeModeChange }: { activeProject?: AiddTrackedProject | null; themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void }) {
  return <div className="flex h-full flex-col overflow-hidden"><header className="flex h-16 shrink-0 items-center border-b px-6"><div><h1 className="text-xl font-semibold">Settings</h1><p className="text-sm text-muted-foreground">Application and project settings.</p></div></header><main className="min-h-0 flex-1 overflow-auto p-6"><div className="max-w-3xl space-y-4"><Card><CardHeader><CardTitle>Appearance</CardTitle><CardDescription>Use shadcn light/dark theme classes.</CardDescription></CardHeader><CardContent className="grid gap-2"><Label>Theme</Label><Select value={themeMode} onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></Select></CardContent></Card><Card><CardHeader><CardTitle>Active project</CardTitle><CardDescription>{activeProject?.path ?? 'No active project selected.'}</CardDescription></CardHeader><CardContent><div className="text-sm font-medium">{activeProject?.name ?? 'None'}</div></CardContent></Card></div></main></div>;
}
