import { useEffect, useRef, useState } from 'react';
import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import { cn } from '../../lib/utils';

type EditMode = 'wysiwyg' | 'markdown';

type AiddMarkdownEditorProps = {
  label?: string;
  hint?: string;
  value: string;
  onChange: (markdown: string) => void;
  minHeight?: number;
  height?: string;
  fill?: boolean;
  defaultMode?: EditMode;
  className?: string;
  readOnly?: boolean;
};

function resolveEditorTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function AiddMarkdownEditor({
  label,
  hint,
  value,
  onChange,
  minHeight = 260,
  height,
  fill = false,
  defaultMode = 'wysiwyg',
  className,
  readOnly = false
}: AiddMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const latestValueRef = useRef(value);
  const [mode, setMode] = useState<EditMode>(defaultMode);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => resolveEditorTheme());

  useEffect(() => {
    latestValueRef.current = value;
    const editor = editorRef.current;
    if (!editor) return;

    const current = editor.getMarkdown();
    if (value !== current) {
      editor.setMarkdown(value || '', false);
    }
  }, [value]);

  useEffect(() => {
    const updateTheme = () => setTheme(resolveEditorTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;

    hostRef.current.innerHTML = '';

    const editor = new Editor({
      el: hostRef.current,
      initialValue: latestValueRef.current || '',
      initialEditType: mode,
      previewStyle: 'vertical',
      height: fill ? '100%' : height ?? `${minHeight}px`,
      theme,
      usageStatistics: false,
      autofocus: false,
      hideModeSwitch: true,
      toolbarItems: readOnly
        ? []
        : [
            ['heading', 'bold', 'italic', 'strike'],
            ['hr', 'quote'],
            ['ul', 'ol', 'task'],
            ['link', 'code', 'codeblock']
          ],
      events: readOnly
        ? undefined
        : {
            change: () => {
              const markdown = editor.getMarkdown();
              latestValueRef.current = markdown;
              onChange(markdown);
            }
          }
    });

    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [mode, theme, minHeight, height, fill, readOnly, onChange]);

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fill && 'h-full', className)}>
      {(label || hint || !readOnly) && (
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            {label && <label className="text-sm font-medium text-foreground">{label}</label>}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          {!readOnly && (
            <div className="inline-flex rounded-md border bg-muted p-0.5" aria-label="Markdown editor mode">
              <button
                type="button"
                className={cn('rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground', mode === 'wysiwyg' && 'bg-background text-foreground shadow-sm')}
                onClick={() => setMode('wysiwyg')}
              >
                Visual
              </button>
              <button
                type="button"
                className={cn('rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground', mode === 'markdown' && 'bg-background text-foreground shadow-sm')}
                onClick={() => setMode('markdown')}
              >
                Markdown
              </button>
            </div>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
        <div ref={hostRef} className="h-full" />
      </div>
    </div>
  );
}
