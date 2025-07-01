# Monaco Editor React Integration with LSP

This project implements a Monaco Editor integration in React with Language Server Protocol (LSP) support.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Start the LSP server:
```bash
node src/server/server.js
```

3. Start the development server:
```bash
npm run dev
```

## Project Structure

- `src/monacoeditor.tsx` - Monaco editor core implementation
- `src/wrapper.tsx` - Higher-level editor wrapper with additional functionality
- `src/server/` - LSP server implementation
- `src/App.tsx` - Main application component

## Development Setup

This project is built with:
- React + TypeScript
- Vite for build tooling
- Monaco Editor for code editing
- Language Server Protocol (LSP) for advanced language features
