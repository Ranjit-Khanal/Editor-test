import '@codingame/monaco-vscode-python-default-extension';
import type { WrapperConfig } from 'monaco-editor-wrapper';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import { configureDefaultWorkerFactory } from 'monaco-editor-wrapper/workers/workerLoaders';
import * as vscode from 'vscode';

const wrapperConfig: WrapperConfig = {
  $type: 'extended',
  editorAppConfig: {
    codeResources: {
      modified: {
        uri: '/workspace/hello.py',
        text: 'print("Hello, World!")'
      }
    },
    monacoWorkerFactory: configureDefaultWorkerFactory,
    editorOptions: {
      automaticLayout: true,
      theme: 'vs-dark',
      language: 'python',
      readOnly: false
    }
  }
};

export default function MonacoEditor() {
  return (
    <MonacoEditorReactComp
      wrapperConfig={wrapperConfig}
      style={{ height: '40vh' }}
      onLoad={wrapper => {
        // Focus the editor after startup to ensure keyboard input works
        wrapper.getEditor()?.focus();
        vscode.workspace.getConfiguration().update('workbench.colorTheme', 'Default Dark Modern', true);
        // Debug: log all keydown events
        document.addEventListener('keydown', (e) => {
          console.log('Key pressed:', e.key);
        }, true);
      }}
    />
  );
}