import { useEffect, useRef, useState } from 'react';
import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';

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
  const mode = document.documentElement.dataset.themeMode ?? 'system';
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function AiddMarkdownEditor({ label, hint, value, onChange, minHeight = 260, readOnly = false }: AiddMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const latestValueRef = useRef(value);
  const [mode, setMode] = useState<EditMode>('wysiwyg');
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
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', updateTheme);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', updateTheme);
    };
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

    if (readOnly) {
      hostRef.current.classList.add('editor-readonly');
    } else {
      hostRef.current.classList.remove('editor-readonly');
    }

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [mode, theme, minHeight, readOnly, onChange]);

  return (
    <div className="aiddMarkdownEditor">
      {(label || hint) && (
        <div className="editorLabelRow">
          <div>
            {label && <label className="fieldLabel editorFieldLabel">{label}</label>}
            {hint && <p className="fieldHint editorHint">{hint}</p>}
          </div>
          {!readOnly && (
            <div className="editorModeToggle" aria-label="Markdown editor mode">
              <button type="button" className={mode === 'wysiwyg' ? 'active' : ''} onClick={() => setMode('wysiwyg')}>Visual</button>
              <button type="button" className={mode === 'markdown' ? 'active' : ''} onClick={() => setMode('markdown')}>Markdown</button>
            </div>
          )}
        </div>
      )}
      <div className="editorShell">
        <div ref={hostRef} />
      </div>
    </div>
  );
}
