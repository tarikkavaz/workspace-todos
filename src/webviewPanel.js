const vscode = require('vscode');
const path = require('path');
const todoManager = require('./todoManager');
const { getWebviewContent } = require('./webviewContent');

/**
 * Create a new webview panel
 * @param {vscode.ExtensionContext} context - The extension context
 * @param {Function} onPanelDispose - Callback when panel is disposed
 * @returns {vscode.WebviewPanel} The created webview panel
 */
function createWebviewPanel(context, onPanelDispose) {
    const panel = vscode.window.createWebviewPanel(
        'workspaceTodos',
        'Workspace Todos',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media')
            ]
        }
    );

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'loadTodos':
                    {
                        const todosData = todoManager.loadTodos();
                        panel.webview.postMessage({
                            command: 'todosLoaded',
                            todos: todosData.todos || [],
                            error: todosData.error
                        });
                    }
                    break;

                case 'getWorkspaceFiles':
                    {
                        try {
                            const files = todoManager.getWorkspaceFiles();
                            panel.webview.postMessage({
                                command: 'workspaceFilesLoaded',
                                files: files
                            });
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error loading workspace files: ${error.message}`);
                        }
                    }
                    break;

                case 'createTodo':
                    {
                        try {
                            const newTodo = todoManager.createTodo(message.data);
                            panel.webview.postMessage({
                                command: 'todoCreated',
                                todo: newTodo
                            });
                            vscode.window.showInformationMessage('To-Do created successfully');
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error creating To-Do: ${error.message}`);
                        }
                    }
                    break;

                case 'updateTodo':
                    {
                        try {
                            const updatedTodo = todoManager.updateTodo(message.id, message.data);
                            panel.webview.postMessage({
                                command: 'todoUpdated',
                                todo: updatedTodo
                            });
                            vscode.window.showInformationMessage('To-Do updated successfully');
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error updating To-Do: ${error.message}`);
                        }
                    }
                    break;

                case 'deleteTodo':
                    {
                        try {
                            todoManager.deleteTodo(message.id);
                            panel.webview.postMessage({
                                command: 'todoDeleted',
                                id: message.id
                            });
                            vscode.window.showInformationMessage('To-Do deleted successfully');
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error deleting To-Do: ${error.message}`);
                        }
                    }
                    break;

                case 'toggleComplete':
                    {
                        try {
                            const updatedTodo = todoManager.toggleComplete(message.id);
                            panel.webview.postMessage({
                                command: 'todoToggled',
                                todo: updatedTodo
                            });
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error toggling To-Do: ${error.message}`);
                        }
                    }
                    break;

                case 'openFile':
                    {
                        try {
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                            if (!workspaceFolder) {
                                vscode.window.showErrorMessage('No workspace folder found');
                                return;
                            }
                            const filePath = path.join(workspaceFolder.uri.fsPath, message.file);
                            const document = await vscode.workspace.openTextDocument(filePath);
                            await vscode.window.showTextDocument(document);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error opening file: ${error.message}`);
                        }
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    // Handle panel disposal
    panel.onDidDispose(
        () => {
            if (onPanelDispose) {
                onPanelDispose();
            }
        },
        null,
        context.subscriptions
    );

    // Load initial todos
    const todosData = todoManager.loadTodos();
    panel.webview.postMessage({
        command: 'todosLoaded',
        todos: todosData.todos || [],
        error: todosData.error
    });

    return panel;
}

module.exports = {
    createWebviewPanel
};
