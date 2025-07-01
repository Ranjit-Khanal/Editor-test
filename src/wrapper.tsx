import React, { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { MonacoLanguageClient } from 'monaco-languageclient';
import { initServices } from 'monaco-languageclient/vscode/services';
import { WebSocketMessageReader, WebSocketMessageWriter, toSocket } from 'vscode-ws-jsonrpc';
import { MessageTransports } from 'vscode-languageclient';
import { editor } from 'monaco-editor';
import { URI } from 'vscode-uri';

const LanguageServerEditor = () => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const languageClientRef = useRef<MonacoLanguageClient | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup language client on unmount
      languageClientRef.current?.stop();
    };
  }, []);

  const handleEditorDidMount = async (editor: editor.IStandaloneCodeEditor, monaco: any) => {
    editorRef.current = editor;
    
    // Initialize Monaco services
    await initServices({
      enableExtHostWorker: false,
      loadThemes: true
    });
    
    // Create the language client connection
    await createLanguageClient();
  };

  const createLanguageClient = async () => {
    // Create WebSocket connection to the language server
    const url = 'ws://localhost:3001/lsp';
    const webSocket = new WebSocket(url);
    
    webSocket.onopen = async () => {
      const socket = toSocket(webSocket);
      const reader = new WebSocketMessageReader(socket);
      const writer = new WebSocketMessageWriter(socket);
      
      const messageTransports: MessageTransports = {
        reader,
        writer
      };
      
      const languageClient = new MonacoLanguageClient({
        name: 'Language Client',
        clientOptions: {
          documentSelector: ['javascript', 'typescript'],
          workspaceFolder: {
            uri: URI.file('/home/ranjit/projects/lsp-test-frontend/workspace'),
            name: 'workspace',
            index: 0
          }
        },
        messageTransports
      });
      
      await languageClient.start();
      languageClientRef.current = languageClient;
      console.log('Language client started');
    };

    webSocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  };

  return (
    <Editor
      height="90vh"
      defaultLanguage="typescript"
      defaultValue="// Start typing here..."
      path="/home/ranjit/projects/lsp-test-frontend/workspace/test.ts"
      onMount={handleEditorDidMount}
      options={{
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 14,
        wordWrap: 'on',
      }}
    />
  );
};

export default LanguageServerEditor;