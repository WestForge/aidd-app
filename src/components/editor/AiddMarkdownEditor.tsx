import { useEffect, useRef, useState } from 'react';
import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import { Button } from '../ui/button';
import { Label } from '../ui/label';

type EditMode = 'wysiwyg' | 'markdown';

type AiddMarkdownEditorProps = {
  label?: string;
  hint?: string;
  value: string;
  onChange: (markdown: string) => void;
  minHeight?: number;
  readOnly?: boolean;
};

function resolveEditorTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function AiddMarkdownEditor({ label, hint, value, onChange, minHeight = 360, readOnly = false }: AiddMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const latestValueRef = useRef(value);
  const [mode, setMode] = useState<EditMode>('wysiwyg');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => resolveEditorTheme());

  useEffect(() => {
    latestValueRef.current = value;
    const editor = editorRef.current;
    if (!editor) return;
    if (value !== editor.getMarkdown()) editor.setMarkdown(value || '', false);
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
      height: `${minHeight}px`,
      theme,
      usageStatistics: false,
      autofocus: false,
      hideModeSwitch: true,
      toolbarItems: readOnly ? [] : [['heading', 'bold', 'italic', 'strike'], ['hr', 'quote'], ['ul', 'ol', 'task'], ['link', 'code', 'codeblock']],
      events: readOnly ? undefined : { change: () => { const markdown = editor.getMarkdown(); latestValueRef.current = markdown; onChange(markdown); } }
    });
    editorRef.current = editor;
    return () => { editor.destroy(); editorRef.current = null; };
  }, [mode, theme, minHeight, readOnly, onChange]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {(label || hint || !readOnly) && <div className="flex shrink-0 items-start justify-between gap-3">
        <div>{label && <Label>{label}</Label>}{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
        {!readOnly && <div className="flex rounded-md border bg-muted p-1"><Button type="button" variant={mode === 'wysiwyg' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('wysiwyg')}>Visual</Button><Button type="button" variant={mode === 'markdown' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('markdown')}>Markdown</Button></div>}
      </div>}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
        <div ref={hostRef} />
      </div>
    </div>
  );
}
