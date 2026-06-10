declare module '@toast-ui/react-editor' {
  import * as React from 'react';

  export type EditorType = 'markdown' | 'wysiwyg';

  export type EditorProps = {
    initialValue?: string;
    initialEditType?: EditorType;
    previewStyle?: 'tab' | 'vertical';
    height?: string;
    theme?: 'dark' | 'light';
    usageStatistics?: boolean;
    toolbarItems?: unknown[];
    hideModeSwitch?: boolean;
    autofocus?: boolean;
    onChange?: () => void;
  };

  export class Editor extends React.Component<EditorProps> {
    getInstance(): {
      getMarkdown(): string;
      setMarkdown(markdown: string): void;
    };
  }
}
