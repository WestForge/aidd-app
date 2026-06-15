import { useEffect, useMemo, useRef, useState } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import { cn } from "../lib/utils";

type MarkdownEditorProps = {
  value: string;
  onChange?: (markdown: string) => void;
  initialValue?: string;
  editorKey?: string;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
};

function createMarkdownPlugins(initialValue: string) {
  return [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    tablePlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        text: "Plain text",
        md: "Markdown",
        markdown: "Markdown",
        json: "JSON",
        js: "JavaScript",
        jsx: "JavaScript (React)",
        ts: "TypeScript",
        tsx: "TypeScript (React)",
        css: "CSS",
        html: "HTML",
        bash: "Bash",
        sh: "Shell",
        powershell: "PowerShell",
        ps1: "PowerShell",
        yaml: "YAML",
        yml: "YAML",
        toml: "TOML",
        xml: "XML",
        sql: "SQL",
      },
    }),
    markdownShortcutPlugin(),
    diffSourcePlugin({
      diffMarkdown: initialValue,
      viewMode: "rich-text",
      readOnlyDiff: true,
    }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper>
          <UndoRedo />
          <Separator />
          <BlockTypeSelect />
          <BoldItalicUnderlineToggles />
          <CodeToggle />
          <Separator />
          <ListsToggle />
          <CreateLink />
          <InsertTable />
          <InsertCodeBlock />
        </DiffSourceToggleWrapper>
      ),
    }),
  ];
}

export function MarkdownEditor({
  value,
  onChange,
  initialValue,
  editorKey,
  readOnly = false,
  placeholder = "Write Markdown...",
  className,
  contentClassName,
}: MarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastValueRef = useRef(value);
  const [parseError, setParseError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(initialValue ?? value);

  const plugins = useMemo(
    () => createMarkdownPlugins(baseline),
    [baseline],
  );

  useEffect(() => {
    setParseError(null);
    setBaseline(initialValue ?? value);
    lastValueRef.current = value;
  }, [editorKey, initialValue, value]);

  useEffect(() => {
    if (parseError) return;
    if (value === lastValueRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const currentMarkdown = editor.getMarkdown();
    if (currentMarkdown !== value) {
      editor.setMarkdown(value);
    }
    lastValueRef.current = value;
  }, [value, parseError]);

  if (parseError) {
    return (
      <div className={cn("flex h-full min-h-[320px] flex-col rounded-md border bg-card", className)}>
        <div className="shrink-0 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Rich editing is unavailable for this Markdown block, so AIDD is showing source mode. {parseError}
        </div>
        <textarea
          className={cn(
            "min-h-0 flex-1 resize-none bg-card px-3 py-2 font-mono text-sm leading-relaxed outline-none",
            contentClassName,
          )}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </div>
    );
  }

  return (
    <MDXEditor
      key={editorKey}
      ref={editorRef}
      markdown={value}
      readOnly={readOnly}
      placeholder={placeholder}
      className={cn("aidd-markdown-editor h-full min-h-[320px] rounded-md border bg-card", className)}
      contentEditableClassName={cn("aidd-markdown-content", contentClassName)}
      plugins={plugins}
      onChange={(markdown, initialMarkdownNormalize) => {
        lastValueRef.current = markdown;
        if (!initialMarkdownNormalize) onChange?.(markdown);
      }}
      onError={({ error }) => setParseError(error)}
    />
  );
}
