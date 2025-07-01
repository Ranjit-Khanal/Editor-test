import express from 'express';
import expressWs from 'express-ws';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create express app and configure WebSocket
const app = express();
expressWs(app);

// Store active language server processes
const activeServers = new Map();

function findTsServerPath() {
    try {
        // Try to find the server in node_modules
        const localTsServer = path.join(process.cwd(), 'node_modules', '.bin', 'typescript-language-server');
        if (fs.existsSync(localTsServer)) {
            return localTsServer;
        }

        // If not found in local node_modules, try global installation
        const globalTsServer = path.join(process.env.HOME, '.nvm', 'versions', 'node', process.version, 'bin', 'typescript-language-server');
        if (fs.existsSync(globalTsServer)) {
            return globalTsServer;
        }

        throw new Error('typescript-language-server not found. Please install it using: npm install typescript-language-server typescript');
    } catch (error) {
        console.error('Error finding typescript-language-server:', error);
        throw error;
    }
}

function setupWorkspace(workspacePath) {
    // Create a workspace directory if it doesn't exist
    const workspace = workspacePath || path.join(process.cwd(), 'workspace');
    if (!fs.existsSync(workspace)) {
        fs.mkdirSync(workspace, { recursive: true });
    }

    // Create a tsconfig.json if it doesn't exist
    const tsconfigPath = path.join(workspace, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
        fs.writeFileSync(tsconfigPath, JSON.stringify({
            compilerOptions: {
                target: "es2020",
                module: "commonjs",
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                forceConsistentCasingInFileNames: true,
                rootDir: ".",
                outDir: "./dist"
            },
            include: ["./**/*"],
            exclude: ["node_modules", "dist"]
        }, null, 2));
    }

    // Create test TypeScript files
    const test2Path = path.join(workspace, 'test2.ts');
    if (!fs.existsSync(test2Path)) {
        fs.writeFileSync(test2Path, `
export interface User {
    name: string;
    age: number;
}

export function greet(user: User): string {
    return \`Hello, \${user.name}!\`;
}

export const DEFAULT_USER: User = {
    name: "John",
    age: 30
};

export class UserService {
    static createUser(name: string, age: number): User {
        return { name, age };
    }
}
`);
    }

    const test1Path = path.join(workspace, 'test.ts');
    if (!fs.existsSync(test1Path)) {
        fs.writeFileSync(test1Path, `
// Try typing 'import {' here to test auto-completion
import { } from './test2';

// Try typing 'const user: ' to test type auto-completion
const user = {
    name: "Alice",
    age: 25
};

// Try typing 'console.log(gr' to test function auto-completion
console.log();
`);
    }

    return workspace;
}

function startLanguageServer(workspacePath) {
    try {
        const tsServerPath = findTsServerPath();
        console.log('Using TypeScript server at:', tsServerPath);

        const workspace = setupWorkspace(workspacePath);

        // Start the TypeScript Language Server
        const server = spawn(tsServerPath, [
            '--stdio'
        ], {
            cwd: workspace,
            env: {
                ...process.env,
                PATH: `${path.join(process.cwd(), 'node_modules', '.bin')}:${process.env.PATH}`
            }
        });

        console.log('[LSP Server] Started with PID:', server.pid);

        // Set up stdio handling
        server.stdin.setDefaultEncoding('utf8');
        server.stdout.setEncoding('utf8');
        server.stderr.setEncoding('utf8');

        // Log server errors for debugging
        server.stderr.on('data', (data) => {
            console.error(`[LSP Server Error] ${data}`);
        });

        server.on('error', (error) => {
            console.error('[LSP Server] Failed to start:', error);
        });

        server.on('exit', (code, signal) => {
            console.log(`[LSP Server] Process exited with code ${code} and signal ${signal}`);
        });

        return server;
    } catch (error) {
        console.error('Failed to start language server:', error);
        throw error;
    }
}

// Function to format LSP message with Content-Length header
function formatLSPMessage(message) {
    const content = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n${content}`;
}

// Function to parse LSP messages from buffer
function parseLSPMessages(buffer) {
    const messages = [];
    let offset = 0;

    while (offset < buffer.length) {
        const headerEnd = buffer.indexOf('\r\n\r\n', offset);
        if (headerEnd === -1) break;

        const headerStr = buffer.slice(offset, headerEnd).toString();
        const contentLengthMatch = headerStr.match(/Content-Length: (\d+)/);
        
        if (!contentLengthMatch) {
            offset = headerEnd + 4;
            continue;
        }

        const contentLength = parseInt(contentLengthMatch[1]);
        const contentStart = headerEnd + 4;
        const contentEnd = contentStart + contentLength;

        if (contentEnd > buffer.length) break;

        const messageStr = buffer.slice(contentStart, contentEnd).toString();
        try {
            const message = JSON.parse(messageStr);
            messages.push(message);
        } catch (e) {
            console.error('Failed to parse LSP message:', messageStr);
        }

        offset = contentEnd;
    }

    return { messages, remainingBuffer: buffer.slice(offset) };
}

// WebSocket endpoint for LSP communication
app.ws('/lsp', (ws, req) => {
    console.log('[WebSocket] Client connected');
    
    let lspServer;
    const clientId = Date.now().toString();
    const workspacePath = req.query.workspace;
    let lspBuffer = Buffer.alloc(0); // Initialize empty buffer

    try {
        // Start a new language server instance for this client
        lspServer = startLanguageServer(workspacePath);
        activeServers.set(clientId, lspServer);

        // Handle messages from the LSP server (with Content-Length headers)
        lspServer.stdout.on('data', (data) => {
            try {
                // Ensure data is a Buffer
                const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
                lspBuffer = Buffer.concat([lspBuffer, dataBuffer]);
                
                const { messages, remainingBuffer } = parseLSPMessages(lspBuffer);
                lspBuffer = remainingBuffer;

                messages.forEach(message => {
                    if (ws.readyState === ws.OPEN) {
                        // Add special logging for completion responses
                        if (message.method === 'textDocument/completion' || 
                            (message.id !== undefined && message.result && message.result.items)) {
                            const items = message.result?.items || [];
                            const totalItems = items.length;
                            
                            // Important symbols to track
                            const importantSymbols = ['DEFAULT_USER', 'greet', 'User', 'UserService'];
                            const foundSymbols = new Map();
                            
                            // Find all important symbols in the complete list
                            items.forEach((item, idx) => {
                                if (importantSymbols.includes(item.label)) {
                                    foundSymbols.set(item.label, {
                                        position: idx + 1,
                                        total: totalItems,
                                        kind: item.kind
                                    });
                                }
                            });
                            
                            console.log('\x1b[32m%s\x1b[0m', '💡 [Completion Response]');
                            console.log('\x1b[36m%s\x1b[0m', `Total suggestions: ${totalItems}`);
                            
                            // First show important symbols if found
                            if (foundSymbols.size > 0) {
                                console.log('\x1b[35m%s\x1b[0m', '🎯 Important Symbols Found:');
                                importantSymbols.forEach(symbol => {
                                    const info = foundSymbols.get(symbol);
                                    if (info) {
                                        const percentage = Math.round((info.position / info.total) * 100);
                                        let ranking;
                                        if (percentage <= 33) {
                                            ranking = '\x1b[32m[TOP]\x1b[0m';
                                        } else if (percentage <= 66) {
                                            ranking = '\x1b[33m[MID]\x1b[0m';
                                        } else {
                                            ranking = '\x1b[31m[BOTTOM]\x1b[0m';
                                        }
                                        console.log(`  ${info.position}/${info.total} ${ranking} ${symbol} [${info.kind}] (${percentage}%)`);
                                    }
                                });
                                console.log(''); // Empty line for separation
                            }
                            
                            // Then show first 15 items
                            const firstItems = items.slice(0, 15);
                            console.log('\x1b[33m%s\x1b[0m', 'First 15 suggestions:');
                            firstItems.forEach((item, index) => {
                                const position = index + 1;
                                const kind = item.kind ? `[${item.kind}]` : '';
                                const detail = item.detail ? ` - ${item.detail}` : '';
                                
                                // Highlight if it's an important symbol
                                const isImportant = importantSymbols.includes(item.label);
                                const label = isImportant ? `\x1b[1m\x1b[35m${item.label}\x1b[0m` : item.label;
                                
                                const percentage = Math.round((position / totalItems) * 100);
                                let ranking;
                                if (percentage <= 33) {
                                    ranking = '\x1b[32m[TOP]\x1b[0m';
                                } else if (percentage <= 66) {
                                    ranking = '\x1b[33m[MID]\x1b[0m';
                                } else {
                                    ranking = '\x1b[31m[BOTTOM]\x1b[0m';
                                }
                                
                                console.log(`  ${position}/${totalItems} ${ranking} ${label} ${kind}${detail}`);
                            });
                            
                            if (totalItems > 15) {
                                const remaining = totalItems - 15;
                                const remainingImportant = Array.from(foundSymbols.entries())
                                    .filter(([_, info]) => info.position > 15)
                                    .map(([symbol, info]) => `${symbol}(${info.position}/${totalItems})`);
                                
                                console.log('\x1b[90m%s\x1b[0m', `  ... and ${remaining} more items`);
                                if (remainingImportant.length > 0) {
                                    console.log('\x1b[35m%s\x1b[0m', `  Important symbols in remaining items: ${remainingImportant.join(', ')}`);
                                }
                            }
                        } else {
                            console.log('[LSP -> Client]', JSON.stringify(message));
                        }
                        ws.send(JSON.stringify(message));
                    }
                });
            } catch (error) {
                console.error('[LSP Server] Error processing data:', error);
                console.error('[LSP Server] Data type:', typeof data);
                console.error('[LSP Server] Data:', data);
            }
        });

        // Handle messages from the WebSocket client
        ws.on('message', (message) => {
            if (lspServer && lspServer.stdin.writable) {
                try {
                    const jsonMessage = JSON.parse(message.toString());
                    
                    // Add special logging for completion requests
                    if (jsonMessage.method === 'textDocument/completion') {
                        const position = jsonMessage.params?.position;
                        const uri = jsonMessage.params?.textDocument?.uri;
                        console.log('\x1b[31m%s\x1b[0m', '🔍 [Completion Request]');
                        console.log(`  URI: ${uri}`);
                        console.log(`  Position: Line ${position?.line}, Character ${position?.character}`);
                        if (jsonMessage.params?.context?.triggerKind) {
                            const triggerKind = jsonMessage.params.context.triggerKind;
                            const triggerChar = jsonMessage.params.context.triggerCharacter;
                            console.log(`  Trigger: ${triggerKind}${triggerChar ? ` ('${triggerChar}')` : ''}`);
                        }
                    } else {
                        console.log('[Client -> LSP]', JSON.stringify(jsonMessage));
                    }
                    
                    // Format message with Content-Length header for LSP server
                    const formattedMessage = formatLSPMessage(jsonMessage);
                    lspServer.stdin.write(formattedMessage, 'utf8');
                } catch (e) {
                    console.error('Failed to parse client message:', e);
                    console.error('Message was:', message.toString());
                }
            } else {
                console.error('[WebSocket] LSP server stdin not writable');
                ws.close();
            }
        });

        // Handle LSP server process exit
        lspServer.on('exit', (code, signal) => {
            console.log(`[LSP Server] Exited with code ${code}, signal ${signal}`);
            if (ws.readyState === ws.OPEN) {
                ws.close(1011, 'Language server process terminated');
            }
            activeServers.delete(clientId);
        });

        // Handle client disconnect
        ws.on('close', (code, reason) => {
            console.log(`[WebSocket] Client disconnected: ${code} ${reason}`);
            if (lspServer && !lspServer.killed) {
                console.log('[WebSocket] Killing LSP server process');
                lspServer.kill('SIGTERM');
                setTimeout(() => {
                    if (lspServer && !lspServer.killed) {
                        lspServer.kill('SIGKILL');
                    }
                }, 5000);
                activeServers.delete(clientId);
            }
        });

        // Handle WebSocket errors
        ws.on('error', (error) => {
            console.error('[WebSocket] Error:', error);
            if (lspServer && !lspServer.killed) {
                lspServer.kill('SIGTERM');
                activeServers.delete(clientId);
            }
        });

    } catch (error) {
        console.error('[WebSocket] Connection error:', error);
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32099,
                    message: 'Failed to start language server',
                    data: error.message
                }
            }));
            ws.close();
        }
    }
});

// Find an available port
function findAvailablePort(startPort) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                findAvailablePort(startPort + 1).then(resolve, reject);
            } else {
                reject(err);
            }
        });
        server.listen(startPort, () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

// Graceful shutdown handler
function handleShutdown() {
    console.log('Shutting down gracefully...');
    
    // Close all language servers
    for (const [clientId, server] of activeServers) {
        try {
            console.log(`Terminating LSP server ${clientId}`);
            server.kill('SIGTERM');
            activeServers.delete(clientId);
        } catch (error) {
            console.error(`Error closing language server ${clientId}:`, error);
        }
    }
    
    setTimeout(() => {
        process.exit(0);
    }, 1000);
}

// Register shutdown handlers
process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// Start the server
async function startServer() {
    try {
        const port = await findAvailablePort(3001);
        app.listen(port, () => {
            console.log(`LSP proxy server listening on http://localhost:${port}`);
            console.log('The server will automatically proxy all LSP messages between client and TypeScript Language Server');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();