const vscode = require('vscode');
const todoManager = require('./todoManager');
const { getRelativeFilePath } = require('./utils');
const { createTodoWebviewPanel, getActivePanel, getPanelForTodo } = require('./todoEditor');
const { TodosTreeDataProvider } = require('./treeView');
const { SECRET_KEY, SECRET_TOKEN, getWorkspaceSecretKey, parseBoardId } = require('./trelloSync');

/**
 * Register all extension commands
 * @param {vscode.ExtensionContext} context - The extension context
 * @param {Function} refreshTree - Function to refresh the tree view
 * @param {vscode.OutputChannel} globalOutputChannel - Output channel for logging
 * @param {TodosTreeDataProvider} treeDataProvider - Tree data provider for filter commands
 */
function registerCommands(context, refreshTree, globalOutputChannel, treeDataProvider, completedTreeDataProvider, trelloSyncManager) {
    try {
        context.subscriptions.push(
            vscode.commands.registerCommand('workspaceTodos.refresh', refreshTree),
            vscode.commands.registerCommand('workspaceTodos.addTodo', () => {
                createTodoWebviewPanel(context, null, refreshTree);
            }),
            vscode.commands.registerCommand('workspaceTodos.editTodo', (item) => {
                try {
                    // Get todo ID from the item (could be in item.todoId or item.todo.id)
                    let todoId = null;
                    if (item && item.todoId) {
                        todoId = item.todoId;
                    } else if (item && item.todo && item.todo.id) {
                        todoId = item.todo.id;
                    } else if (item && item.id && !item.isEmpty) {
                        // If item.id exists and it's not an empty item, it might be the todo ID
                        todoId = item.id;
                    }
                    
                    if (!todoId) {
                        // Try to load from the tree item's stored todo
                        if (item && item.todo) {
                            createTodoWebviewPanel(context, item.todo, refreshTree);
                            return;
                        }
                        vscode.window.showErrorMessage('Invalid To-Do item selected');
                        return;
                    }
                    
                    // Load the todo from storage
                    const todosData = todoManager.loadTodos();
                    const todos = todosData.todos || [];
                    const todo = todos.find(t => t.id === todoId);
                    
                    if (!todo) {
                        vscode.window.showErrorMessage('To-Do not found');
                        return;
                    }
                    
                    // Check if this todo is already open in an editor
                    const existingPanel = getPanelForTodo(todo.id);
                    if (existingPanel) {
                        // Focus the existing panel instead of creating a new one
                        existingPanel.reveal();
                        return;
                    }
                    
                    // Create new panel if not already open
                    createTodoWebviewPanel(context, todo, refreshTree);
                } catch (error) {
                    vscode.window.showErrorMessage(`Error opening editor: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.openTodoById', (todoId) => {
                try {
                    if (!todoId) {
                        vscode.window.showErrorMessage('Invalid To-Do ID');
                        return;
                    }
                    const todosData = todoManager.loadTodos();
                    const todos = todosData.todos || [];
                    const todo = todos.find(t => t.id === todoId);
                    if (!todo) {
                        vscode.window.showErrorMessage('To-Do not found');
                        return;
                    }
                    const existingPanel = getPanelForTodo(todo.id);
                    if (existingPanel) {
                        existingPanel.reveal();
                        return;
                    }
                    createTodoWebviewPanel(context, todo, refreshTree);
                } catch (error) {
                    vscode.window.showErrorMessage(`Error opening To-Do: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.toggleTodo', (item) => {
                try {
                    let todoId = null;
                    if (item && item.todoId) {
                        todoId = item.todoId;
                    } else if (item && item.todo && item.todo.id) {
                        todoId = item.todo.id;
                    } else if (item && item.id) {
                        todoId = item.id;
                    }
                    
                    if (!todoId) {
                        vscode.window.showErrorMessage('Invalid To-Do item selected');
                        return;
                    }
                    
                    todoManager.toggleComplete(todoId);
                    refreshTree();
                } catch (error) {
                    vscode.window.showErrorMessage(`Error toggling To-Do: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.markUncomplete', (item) => {
                try {
                    let todoId = null;
                    if (item && item.todoId) {
                        todoId = item.todoId;
                    } else if (item && item.todo && item.todo.id) {
                        todoId = item.todo.id;
                    } else if (item && item.id) {
                        todoId = item.id;
                    }
                    
                    if (!todoId) {
                        vscode.window.showErrorMessage('Invalid To-Do item selected');
                        return;
                    }
                    
                    // Only mark as uncompleted if it's currently completed
                    const todosData = todoManager.loadTodos();
                    const todo = todosData.todos?.find(t => t.id === todoId);
                    if (todo && todo.completed) {
                        todoManager.toggleComplete(todoId);
                        refreshTree();
                        vscode.window.showInformationMessage('To-Do marked as incomplete');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error marking To-Do as incomplete: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.deleteTodo', (item) => {
                try {
                    let todoId = null;
                    if (item && item.todoId) {
                        todoId = item.todoId;
                    } else if (item && item.todo && item.todo.id) {
                        todoId = item.todo.id;
                    } else if (item && item.id) {
                        todoId = item.id;
                    }
                    
                    if (!todoId) {
                        vscode.window.showErrorMessage('Invalid To-Do item selected');
                        return;
                    }
                    
                    // Load todo to get title/notes for confirmation
                    const todosData = todoManager.loadTodos();
                    const todos = todosData.todos || [];
                    const todo = todos.find(t => t.id === todoId);
                    
                    if (!todo) {
                        vscode.window.showErrorMessage('To-Do not found');
                        return;
                    }
                    
                    const displayText = todo.title || todo.notes || 'Untitled';
                    vscode.window.showWarningMessage(
                        `Delete "${displayText.substring(0, 50)}${displayText.length > 50 ? '...' : ''}"?`,
                        'Delete'
                    ).then(selection => {
                        if (selection === 'Delete') {
                            try {
                                todoManager.deleteTodo(todoId);
                                refreshTree();
                                vscode.window.showInformationMessage('To-Do deleted');
                            } catch (error) {
                                vscode.window.showErrorMessage(`Error deleting To-Do: ${error.message}`);
                            }
                        }
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(`Error: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.addFileToTodo', async (uri, uris) => {
                try {
                    // Handle both single URI and array of URIs (when multiple files selected)
                    const targetUri = uris && uris.length > 0 ? uris[0] : uri;
                    if (!targetUri) {
                        vscode.window.showErrorMessage('No file selected');
                        return;
                    }
                    const filePath = await getRelativeFilePath(targetUri);
                    if (!filePath) return;
                    
                    // Load all todos
                    const todosData = todoManager.loadTodos();
                    const todos = todosData.todos || [];
                    
                    if (todos.length === 0) {
                        // No todos exist, create a new one
                        createTodoWebviewPanel(context, null, refreshTree, [filePath]);
                        return;
                    }
                    
                    // Show quick pick to select existing To-Do or create new
                    const items = [
                        {
                            label: '$(add) Create New To-Do',
                            description: 'Create a new To-Do with this file',
                            todoId: null
                        },
                        ...todos.map(todo => ({
                            label: `$(file) ${todo.title || todo.notes || 'Untitled'}`,
                            description: todo.completed ? 'Completed' : 'Active',
                            todoId: todo.id
                        }))
                    ];
                    
                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select a To-Do to add this file to, or create a new one'
                    });
                    
                    if (!selected) return;
                    
                    if (selected.todoId === null) {
                        // Create new TODO
                        createTodoWebviewPanel(context, null, refreshTree, [filePath]);
                    } else {
                        // Add file to existing TODO
                        const todo = todos.find(t => t.id === selected.todoId);
                        if (todo) {
                            const currentFiles = todo.files || [];
                            if (!currentFiles.includes(filePath)) {
                                todoManager.updateTodo(selected.todoId, {
                                    files: [...currentFiles, filePath]
                                });
                                refreshTree();
                                vscode.window.showInformationMessage(`File added to To-Do: ${todo.title || 'Untitled'}`);
                            } else {
                                vscode.window.showInformationMessage('File is already assigned to this To-Do');
                            }
                        }
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error adding file to To-Do: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.createTodoWithFile', async (uri, uris) => {
                try {
                    // Handle both single URI and array of URIs (when multiple files selected)
                    const targetUri = uris && uris.length > 0 ? uris[0] : uri;
                    if (!targetUri) {
                        vscode.window.showErrorMessage('No file selected');
                        return;
                    }
                    const filePath = await getRelativeFilePath(targetUri);
                    if (!filePath) return;
                    
                    createTodoWebviewPanel(context, null, refreshTree, [filePath]);
                } catch (error) {
                    vscode.window.showErrorMessage(`Error creating To-Do: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.addTextToTodo', async () => {
                try {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showErrorMessage('No active editor');
                        return;
                    }
                    
                    const selection = editor.selection;
                    if (selection.isEmpty) {
                        vscode.window.showErrorMessage('No text selected');
                        return;
                    }
                    
                    const selectedText = editor.document.getText(selection);
                    if (!selectedText.trim()) {
                        vscode.window.showErrorMessage('Selected text is empty');
                        return;
                    }
                    
                    // Get the file path and line number
                    const filePath = await getRelativeFilePath(editor.document.uri);
                    const fileArray = filePath ? [filePath] : [];
                    const startLine = selection.start.line + 1; // VS Code uses 0-based, we want 1-based
                    
                    // Format the text with file path, line number, and code block
                    const formattedText = filePath 
                        ? `// ${filePath} - Line ${startLine}\n\`\`\`\n${selectedText}\n\`\`\``
                        : `\`\`\`\n${selectedText}\n\`\`\``;
                    
                    // Load all todos
                    const todosData = todoManager.loadTodos();
                    const todos = todosData.todos || [];
                    
                    if (todos.length === 0) {
                        // No todos exist, create a new one
                        createTodoWebviewPanel(context, null, refreshTree, fileArray, formattedText);
                        return;
                    }
                    
                    // Show quick pick to select existing To-Do or create new
                    const items = [
                        {
                            label: '$(add) Create New To-Do',
                            description: 'Create a new To-Do with this text',
                            todoId: null
                        },
                        ...todos.map(todo => ({
                            label: `$(file) ${todo.title || todo.notes || 'Untitled'}`,
                            description: todo.completed ? 'Completed' : 'Active',
                            todoId: todo.id
                        }))
                    ];
                    
                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select a To-Do to add this text to, or create a new one'
                    });
                    
                    if (!selected) return;
                    
                    if (selected.todoId === null) {
                        // Create new To-Do
                        createTodoWebviewPanel(context, null, refreshTree, fileArray, formattedText);
                    } else {
                        // Add text to existing To-Do
                        const todo = todos.find(t => t.id === selected.todoId);
                        if (todo) {
                            const currentNotes = todo.notes || '';
                            const newNotes = currentNotes 
                                ? `${currentNotes}\n\n${formattedText}`
                                : formattedText;
                            
                            // Add file if not already in the list
                            const currentFiles = todo.files || [];
                            const updatedFiles = [...currentFiles];
                            if (filePath && !updatedFiles.includes(filePath)) {
                                updatedFiles.push(filePath);
                            }
                            
                            todoManager.updateTodo(selected.todoId, {
                                notes: newNotes,
                                files: updatedFiles
                            });
                            refreshTree();
                            vscode.window.showInformationMessage(`Text and file added to To-Do: ${todo.title || 'Untitled'}`);
                        }
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error adding text to To-Do: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.createTodoWithText', async () => {
                try {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showErrorMessage('No active editor');
                        return;
                    }
                    
                    const selection = editor.selection;
                    if (selection.isEmpty) {
                        vscode.window.showErrorMessage('No text selected');
                        return;
                    }
                    
                    const selectedText = editor.document.getText(selection);
                    if (!selectedText.trim()) {
                        vscode.window.showErrorMessage('Selected text is empty');
                        return;
                    }
                    
                    // Get the file path and line number
                    const filePath = await getRelativeFilePath(editor.document.uri);
                    const fileArray = filePath ? [filePath] : [];
                    const startLine = selection.start.line + 1; // VS Code uses 0-based, we want 1-based
                    
                    // Format the text with file path, line number, and code block
                    const formattedText = filePath 
                        ? `// ${filePath} - Line ${startLine}\n\`\`\`\n${selectedText}\n\`\`\``
                        : `\`\`\`\n${selectedText}\n\`\`\``;
                    
                    createTodoWebviewPanel(context, null, refreshTree, fileArray, formattedText);
                } catch (error) {
                    vscode.window.showErrorMessage(`Error creating To-Do: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.exportToMarkdown', async () => {
                try {
                    const result = todoManager.exportTodosToMarkdown();
                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `Exported ${result.totalTodos} To-Do's to ${result.path}`
                        );
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error exporting To-Do's: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.saveTodoFromEditor', () => {
                const activePanel = getActivePanel();
                if (activePanel) {
                    activePanel.webview.postMessage({ command: 'triggerSave' });
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.markCompleteFromEditor', () => {
                const activePanel = getActivePanel();
                if (activePanel) {
                    activePanel.webview.postMessage({ command: 'triggerMarkComplete' });
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.deleteTodoFromEditor', () => {
                const activePanel = getActivePanel();
                if (activePanel) {
                    activePanel.webview.postMessage({ command: 'triggerDelete' });
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.toggleFilterLabel', (item) => {
                try {
                    // Get the data provider from the filter item (works with both active and completed views)
                    const dataProvider = item?.dataProvider;
                    if (dataProvider && typeof dataProvider.toggleFilterLabel === 'function' && item?.fullLabel) {
                        dataProvider.toggleFilterLabel(item.fullLabel);
                    }
                } catch (error) {
                    globalOutputChannel.appendLine(`Error toggling filter label: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.clearFilters', (item) => {
                try {
                    // If item is provided, use its data provider, otherwise clear both
                    if (item?.dataProvider && typeof item.dataProvider.clearFilters === 'function') {
                        item.dataProvider.clearFilters();
                    } else {
                        // Clear filters in both providers if no specific item provided
                        if (treeDataProvider) treeDataProvider.clearFilters();
                        if (completedTreeDataProvider) completedTreeDataProvider.clearFilters();
                    }
                } catch (error) {
                    globalOutputChannel.appendLine(`Error clearing filters: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.trello.setCredentials', async () => {
                try {
                    const apiKey = await vscode.window.showInputBox({
                        prompt: 'Enter your Trello API key',
                        ignoreFocusOut: true
                    });
                    if (!apiKey) {
                        return;
                    }
                    const token = await vscode.window.showInputBox({
                        prompt: 'Enter your Trello token',
                        ignoreFocusOut: true,
                        password: true
                    });
                    if (!token) {
                        return;
                    }
                    await context.secrets.store(getWorkspaceSecretKey(SECRET_KEY), apiKey.trim());
                    await context.secrets.store(getWorkspaceSecretKey(SECRET_TOKEN), token.trim());
                    vscode.window.showInformationMessage('Trello credentials saved.');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to save Trello credentials: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.trello.clearCredentials', async () => {
                try {
                    await context.secrets.delete(getWorkspaceSecretKey(SECRET_KEY));
                    await context.secrets.delete(getWorkspaceSecretKey(SECRET_TOKEN));
                    await context.secrets.delete(SECRET_KEY);
                    await context.secrets.delete(SECRET_TOKEN);
                    vscode.window.showInformationMessage('Trello credentials cleared for this workspace.');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to clear Trello credentials: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.trello.syncNow', async () => {
                try {
                    if (!trelloSyncManager) {
                        vscode.window.showWarningMessage('Trello sync is not initialized.');
                        return;
                    }
                    await trelloSyncManager.syncNow('manual');
                } catch (error) {
                    vscode.window.showErrorMessage(`Trello sync failed: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.trello.openBoard', async () => {
                try {
                    const config = vscode.workspace.getConfiguration('workspaceTodos');
                    const boardSetting = config.get('trello.board', '');
                    if (!boardSetting) {
                        vscode.window.showWarningMessage('Trello board is not configured.');
                        return;
                    }
                    const boardId = parseBoardId(boardSetting);
                    const url = boardSetting.startsWith('http')
                        ? boardSetting
                        : `https://trello.com/b/${boardId}`;
                    vscode.env.openExternal(vscode.Uri.parse(url));
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to open Trello board: ${error.message}`);
                }
            }),
            vscode.commands.registerCommand('workspaceTodos.trello.pruneMissing', async () => {
                try {
                    if (!trelloSyncManager) {
                        vscode.window.showWarningMessage('Trello sync is not initialized.');
                        return;
                    }
                    await trelloSyncManager.pruneMissingCards('manual');
                } catch (error) {
                    vscode.window.showErrorMessage(`Trello prune failed: ${error.message}`);
                }
            })
        );
    } catch (cmdError) {
        // If command already exists, try to continue anyway
        if (!cmdError.message.includes('already exists')) {
            throw cmdError;
        }
    }
}

module.exports = {
    registerCommands
};
