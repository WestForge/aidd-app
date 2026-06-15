import { useEffect, useMemo, useRef, useState } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  ListsToggle,
  MDXEditor,
  NestedLexicalEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  directivesPlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type DirectiveDescriptor,
  type DirectiveEditorProps,
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

type AiddCommentKind = "change-request" | "question" | "clarification" | "risk" | "todo" | "ai-instruction";
type AiddCommentStatus = "open" | "addressed" | "resolved" | "rejected";

type PendingAiddComment = {
  open: boolean;
  selectionMarkdown: string;
  kind: AiddCommentKind;
  body: string;
};

const AIDD_COMMENT_KINDS: Array<{ value: AiddCommentKind; label: string }> = [
  { value: "change-request", label: "Change request" },
  { value: "question", label: "Question" },
  { value: "clarification", label: "Clarification" },
  { value: "risk", label: "Risk" },
  { value: "todo", label: "TODO" },
  { value: "ai-instruction", label: "AI instruction" },
];

const AIDD_COMMENT_STATUSES: Array<{ value: AiddCommentStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "addressed", label: "Addressed" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
];

function labelForKind(kind: string | undefined) {
  return AIDD_COMMENT_KINDS.find((item) => item.value === kind)?.label ?? "Comment";
}

function labelForStatus(status: string | undefined) {
  return AIDD_COMMENT_STATUSES.find((item) => item.value === status)?.label ?? "Open";
}

function escapeDirectiveAttribute(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function createAiddCommentId() {
  return `aidd-cmt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createAiddCommentMarkdown(kind: AiddCommentKind, body: string, hasSelection: boolean) {
  const id = createAiddCommentId();
  const createdAt = new Date().toISOString();
  const target = hasSelection ? "selected-block" : "cursor-block";
  const request = body.trim() || "Describe the requested change, question, clarification, risk, TODO, or AI instruction.";

  const attrs = [
    ["id", id],
    ["status", "open"],
    ["kind", kind],
    ["target", target],
    ["createdBy", "human"],
    ["createdAt", createdAt],
  ]
    .map(([key, value]) => `${key}="${escapeDirectiveAttribute(value)}"`)
    .join(" ");

  return `:::aidd-comment{${attrs}}\n**Request**\n\n${request}\n:::`;
}

function insertCommentAfterSelection(markdown: string, selectionMarkdown: string, commentMarkdown: string) {
  const candidates = Array.from(new Set([selectionMarkdown, selectionMarkdown.trim()].filter(Boolean)));

  for (const candidate of candidates) {
    const index = markdown.indexOf(candidate);
    if (index === -1) continue;

    const before = markdown.slice(0, index);
    const selected = markdown.slice(index, index + candidate.length).replace(/\s+$/u, "");
    const after = markdown.slice(index + candidate.length).replace(/^\n+/u, "");
    const suffix = after.length > 0 ? `\n\n${after}` : "";

    return `${before}${selected}\n\n${commentMarkdown}${suffix}`;
  }

  return null;
}

function updateDirectiveAttributes(mdastNode: any, updates: Record<string, string | undefined>) {
  const attributes: Record<string, string> = { ...(mdastNode.attributes ?? {}) };

  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === "undefined") {
      delete attributes[key];
    } else {
      attributes[key] = value;
    }
  }

  return {
    ...mdastNode,
    attributes,
  };
}

function AiddCommentDirectiveEditor({ mdastNode, lexicalNode, parentEditor }: DirectiveEditorProps<any>) {
  const attributes = (mdastNode.attributes ?? {}) as Record<string, string>;
  const status = attributes.status || "open";
  const kind = attributes.kind || "comment";
  const id = attributes.id || "aidd-comment";
  const createdAt = attributes.createdAt;
  const addressedAt = attributes.addressedAt;
  const resolvedAt = attributes.resolvedAt;
  const rejectedAt = attributes.rejectedAt;
  const collapsed = attributes.collapsed === "true";

  const updateAttributes = (updates: Record<string, string | undefined>) => {
    parentEditor.update(() => {
      lexicalNode.setMdastNode(updateDirectiveAttributes(mdastNode, updates));
    });
  };

  const toggleCollapsed = () => {
    updateAttributes({ collapsed: collapsed ? undefined : "true" });
  };

  const deleteComment = () => {
    const confirmed = window.confirm("Delete this AIDD comment? This removes the comment block from the Markdown file.");
    if (!confirmed) return;

    parentEditor.update(() => {
      lexicalNode.remove();
    });
  };

  const setStatus = (nextStatus: AiddCommentStatus) => {
    const now = new Date().toISOString();
    const timestampUpdate: Record<string, string> = {};
    if (nextStatus === "addressed") timestampUpdate.addressedAt = now;
    if (nextStatus === "resolved") timestampUpdate.resolvedAt = now;
    if (nextStatus === "rejected") timestampUpdate.rejectedAt = now;
    updateAttributes({ status: nextStatus, ...timestampUpdate });
  };

  return (
    <div className={cn("aidd-comment-card", `aidd-comment-card--${status}`)} data-aidd-comment-id={id}>
      <div className="aidd-comment-card__header" contentEditable={false}>
        <div>
          <div className="aidd-comment-card__eyebrow">AIDD comment</div>
          <div className="aidd-comment-card__title">
            <span className="aidd-comment-card__status">{labelForStatus(status)}</span>
            <span aria-hidden="true">·</span>
            <span>{labelForKind(kind)}</span>
          </div>
        </div>
        <div className="aidd-comment-card__actions" aria-label="AIDD comment lifecycle controls">
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setStatus("open")}>Open</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setStatus("addressed")}>Addressed</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setStatus("resolved")}>Resolve</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setStatus("rejected")}>Reject</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={toggleCollapsed}>
            {collapsed ? "Expand" : "Collapse"}
          </button>
          <button type="button" className="aidd-comment-card__delete" onMouseDown={(event) => event.preventDefault()} onClick={deleteComment}>
            Delete
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="aidd-comment-card__body">
          <NestedLexicalEditor<any>
            block
            getContent={(node) => (node.children ?? []) as any}
            getUpdatedMdastNode={(node, children) => ({ ...node, children }) as any}
            contentEditableProps={{ className: "aidd-comment-card__editable" }}
          />
        </div>
      )}

      <div className="aidd-comment-card__meta" contentEditable={false}>
        <span>{id}</span>
        {createdAt ? <span>Created {createdAt}</span> : null}
        {addressedAt ? <span>Addressed {addressedAt}</span> : null}
        {resolvedAt ? <span>Resolved {resolvedAt}</span> : null}
        {rejectedAt ? <span>Rejected {rejectedAt}</span> : null}
      </div>
    </div>
  );
}

const AiddCommentDirectiveDescriptor: DirectiveDescriptor<any> = {
  name: "AIDD comment",
  type: "containerDirective",
  hasChildren: true,
  attributes: ["id", "status", "kind", "target", "createdBy", "createdAt", "addressedAt", "resolvedAt", "rejectedAt", "collapsed"],
  testNode: (node) => node.type === "containerDirective" && node.name === "aidd-comment",
  Editor: AiddCommentDirectiveEditor,
};

function AddAiddCommentButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="aidd-comment-toolbar-button"
      disabled={disabled}
      title="Add an AIDD comment below the selected block or current cursor"
      onClick={onClick}
    >
      Comment
    </button>
  );
}

function createMarkdownPlugins(initialValue: string, onAddAiddComment: () => void, readOnly: boolean) {
  return [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    tablePlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    directivesPlugin({
      directiveDescriptors: [AiddCommentDirectiveDescriptor],
      escapeUnknownTextDirectives: true,
    }),
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
          <Separator />
          <AddAiddCommentButton disabled={readOnly} onClick={onAddAiddComment} />
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
  const [pendingComment, setPendingComment] = useState<PendingAiddComment>({
    open: false,
    selectionMarkdown: "",
    kind: "change-request",
    body: "",
  });

  const openAiddCommentDialog = () => {
    const selectedMarkdown = editorRef.current?.getSelectionMarkdown() ?? "";
    setPendingComment({
      open: true,
      selectionMarkdown: selectedMarkdown.trim(),
      kind: "change-request",
      body: "",
    });
  };

  const plugins = useMemo(
    () => createMarkdownPlugins(baseline, openAiddCommentDialog, readOnly),
    [baseline, readOnly],
  );

  const closeAiddCommentDialog = () => {
    setPendingComment((current) => ({ ...current, open: false, body: "" }));
  };

  const insertAiddComment = () => {
    const editor = editorRef.current;
    if (!editor || readOnly) return;

    const commentMarkdown = createAiddCommentMarkdown(
      pendingComment.kind,
      pendingComment.body,
      pendingComment.selectionMarkdown.length > 0,
    );

    const currentMarkdown = editor.getMarkdown();
    const nextMarkdown = pendingComment.selectionMarkdown
      ? insertCommentAfterSelection(currentMarkdown, pendingComment.selectionMarkdown, commentMarkdown)
      : null;

    if (nextMarkdown) {
      editor.setMarkdown(nextMarkdown);
      lastValueRef.current = nextMarkdown;
      onChange?.(nextMarkdown);
    } else {
      editor.focus(() => {
        editor.insertMarkdown(`\n\n${commentMarkdown}\n\n`);
        const updatedMarkdown = editor.getMarkdown();
        lastValueRef.current = updatedMarkdown;
        onChange?.(updatedMarkdown);
      });
    }

    closeAiddCommentDialog();
  };

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
      <div className={cn("flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-card", className)}>
        <div className="shrink-0 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Rich editing is unavailable for this Markdown block, so AIDD is showing source mode. {parseError}
        </div>
        <textarea
          className={cn(
            "min-h-0 flex-1 resize-none overflow-auto bg-card px-3 py-2 font-mono text-sm leading-relaxed outline-none",
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
    <div className={cn("relative flex h-full min-h-0 flex-1", className)}>
      <MDXEditor
        key={editorKey}
        ref={editorRef}
        markdown={value}
        readOnly={readOnly}
        placeholder={placeholder}
        className={cn("aidd-markdown-editor h-full min-h-0 flex-1 rounded-md border bg-card", className)}
        contentEditableClassName={cn("aidd-markdown-content", contentClassName)}
        plugins={plugins}
        onChange={(markdown, initialMarkdownNormalize) => {
          lastValueRef.current = markdown;
          if (!initialMarkdownNormalize) onChange?.(markdown);
        }}
        onError={({ error }) => setParseError(error)}
      />

      {pendingComment.open ? (
        <div className="aidd-comment-dialog-backdrop" role="presentation">
          <div className="aidd-comment-dialog" role="dialog" aria-modal="true" aria-labelledby="aidd-comment-dialog-title">
            <div className="aidd-comment-dialog__header">
              <div>
                <h3 id="aidd-comment-dialog-title">Add AIDD comment</h3>
                <p>
                  {pendingComment.selectionMarkdown
                    ? "The comment will be inserted below the selected markdown block."
                    : "The comment will be inserted at the current cursor as its own block."}
                </p>
              </div>
              <button type="button" className="aidd-comment-dialog__close" onClick={closeAiddCommentDialog} aria-label="Close comment dialog">
                ×
              </button>
            </div>

            <label className="aidd-comment-dialog__field">
              <span>Comment type</span>
              <select
                value={pendingComment.kind}
                onChange={(event) => setPendingComment((current) => ({ ...current, kind: event.target.value as AiddCommentKind }))}
              >
                {AIDD_COMMENT_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>

            <label className="aidd-comment-dialog__field">
              <span>Request for AI / reviewer</span>
              <textarea
                value={pendingComment.body}
                placeholder="Explain what needs to be changed, answered, checked, or resolved."
                onChange={(event) => setPendingComment((current) => ({ ...current, body: event.target.value }))}
                autoFocus
              />
            </label>

            <div className="aidd-comment-dialog__footer">
              <button type="button" className="aidd-comment-dialog__secondary" onClick={closeAiddCommentDialog}>Cancel</button>
              <button type="button" className="aidd-comment-dialog__primary" onClick={insertAiddComment}>Insert comment</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
