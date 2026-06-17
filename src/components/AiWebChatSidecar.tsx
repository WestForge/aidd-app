import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, ExternalLink, MessageSquare, PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Select } from './ui/select';

type AiWebProvider = 'chatgpt' | 'claude' | 'grok' | 'gemini';

const PROVIDERS: Array<{ id: AiWebProvider; label: string; description: string }> = [
  { id: 'chatgpt', label: 'ChatGPT', description: 'OpenAI web chat' },
  { id: 'claude', label: 'Claude', description: 'Anthropic web chat' },
  { id: 'grok', label: 'Grok', description: 'xAI web chat' },
  { id: 'gemini', label: 'Gemini', description: 'Google web chat' }
];

const OPEN_KEY = 'aidd.aiWebSidecar.open';
const PROVIDER_KEY = 'aidd.aiWebSidecar.provider';

function readLocalStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in unusual packaged/protocol states.
  }
}

function getStoredProvider(): AiWebProvider {
  const value = readLocalStorage(PROVIDER_KEY);
  return PROVIDERS.some((provider) => provider.id === value) ? value as AiWebProvider : 'chatgpt';
}

function canUseSidecar() {
  return Boolean(window.aidd?.aiSidecar);
}

export function AiWebChatSidecar({ open, provider, onOpenChange, onProviderChange }: {
  open: boolean;
  provider: AiWebProvider;
  onOpenChange: (open: boolean) => void;
  onProviderChange: (provider: AiWebProvider) => void;
}) {
  const [message, setMessage] = useState('');
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const providerInfo = useMemo(() => PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0], [provider]);
  const lastNavigatedProviderRef = useRef<AiWebProvider | null>(null);

  const syncBounds = useCallback(() => {
    if (!open || !viewportRef.current || !window.aidd?.aiSidecar?.setBounds) return;
    const rect = viewportRef.current.getBoundingClientRect();
    void window.aidd.aiSidecar.setBounds({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    });
  }, [open]);

  useEffect(() => {
    writeLocalStorage(OPEN_KEY, String(open));
    if (!window.aidd?.aiSidecar) return;

    if (open) {
      setMessage('');
      lastNavigatedProviderRef.current = provider;
      void window.aidd.aiSidecar.show({ provider }).catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Could not open the AI web chat sidecar.');
      });
      requestAnimationFrame(syncBounds);
      return;
    }

    void window.aidd.aiSidecar.hide();
  }, [open, provider, syncBounds]);

  useEffect(() => {
    writeLocalStorage(PROVIDER_KEY, provider);
    if (open && window.aidd?.aiSidecar && lastNavigatedProviderRef.current !== provider) {
      lastNavigatedProviderRef.current = provider;
      void window.aidd.aiSidecar.navigate({ provider }).catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Could not switch AI web chat provider.');
      });
    }
  }, [open, provider]);

  useEffect(() => {
    if (!open || !viewportRef.current) return undefined;

    const resizeObserver = new ResizeObserver(() => syncBounds());
    resizeObserver.observe(viewportRef.current);
    window.addEventListener('resize', syncBounds);
    requestAnimationFrame(syncBounds);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  }, [open, syncBounds]);

  useEffect(() => {
    return () => {
      if (window.aidd?.aiSidecar) {
        void window.aidd.aiSidecar.hide();
      }
    };
  }, []);

  const sidecarAvailable = canUseSidecar();

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="fixed bottom-20 right-5 z-40 shadow-lg"
        onClick={() => onOpenChange(true)}
        title="Open AI web chat sidecar"
      >
        <MessageSquare className="h-4 w-4" />
        AI chat
      </Button>
    );
  }

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l bg-card text-card-foreground shadow-xl">
      <header className="space-y-3 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">AI web chat</h2>
              <p className="truncate text-xs text-muted-foreground">{providerInfo.description}</p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} title="Hide AI chat">
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2">
          <Select
            value={provider}
            onChange={(event) => onProviderChange(event.target.value as AiWebProvider)}
            aria-label="AI web chat provider"
          >
            {PROVIDERS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </Select>
          <Button type="button" variant="outline" size="icon" onClick={() => void window.aidd.aiSidecar?.goBack()} title="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => void window.aidd.aiSidecar?.goForward()} title="Forward">
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => void window.aidd.aiSidecar?.reload()} title="Reload">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => void window.aidd.aiSidecar?.openExternal({ provider })} title="Open externally">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>

        {!sidecarAvailable && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            The Electron sidecar API is unavailable. Rebuild the preload and main process after applying this update.
          </div>
        )}
        {message && <div className="rounded-md border bg-background p-2 text-xs text-muted-foreground">{message}</div>}
      </header>

      <div ref={viewportRef} className="relative min-h-0 flex-1 bg-background">
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
          <div className="space-y-2">
            <PanelRightOpen className="mx-auto h-8 w-8 opacity-60" />
            <p>Loading {providerInfo.label} in a secure Electron sidecar...</p>
            <p className="text-xs">Sign in with your normal web account. No API key is required.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function useAiWebChatSidecarState() {
  const [open, setOpen] = useState(() => readLocalStorage(OPEN_KEY) === 'true');
  const [provider, setProvider] = useState<AiWebProvider>(() => getStoredProvider());

  return {
    open,
    provider,
    setOpen,
    setProvider
  };
}
