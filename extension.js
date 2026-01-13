const vscode = require('vscode');
const { TodosTreeDataProvider, CompletedTodosTreeDataProvider } = require('./src/treeView');
const { registerCommands } = require('./src/commands');
const { createTodoWebviewPanel } = require('./src/todoEditor');
const todoManager = require('./src/todoManager');

// Global state variables
let currentPanel = undefined;
let globalOutputChannel = undefined;
let isActivated = false;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Prevent duplicate activation
    if (isActivated) {
        return;
    }
    isActivated = true;
    
    globalOutputChannel = vscode.window.createOutputChannel('Workspace Todos');
    
    // Restore open todo editors immediately, before sidebar initialization
    const tempRefreshTree = () => {}; // Temporary function, will be replaced
    restoreOpenTodos(context, tempRefreshTree);
    
    // Register tree view providers for sidebar (split view: active and completed)
    try {
        const treeDataProvider = new TodosTreeDataProvider(context, globalOutputChannel);
        const completedTreeDataProvider = new CompletedTodosTreeDataProvider(context, globalOutputChannel);
        
        const treeView = vscode.window.createTreeView('workspaceTodosView', {
            treeDataProvider: treeDataProvider,
            dragAndDropController: treeDataProvider,
            showCollapseAll: false
        });
        context.subscriptions.push(treeView);
        
        const completedTreeView = vscode.window.createTreeView('workspaceTodosCompletedView', {
            treeDataProvider: completedTreeDataProvider,
            dragAndDropController: completedTreeDataProvider,
            showCollapseAll: false
        });
        context.subscriptions.push(completedTreeView);
        
        // Refresh both trees when todos change
        const refreshTree = () => {
            treeDataProvider.refresh();
            completedTreeDataProvider.refresh();
        };
        
        // Register all commands (pass both providers for filter commands)
        registerCommands(context, refreshTree, globalOutputChannel, treeDataProvider, completedTreeDataProvider);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to register Workspace Todos view: ${error.message}`);
        isActivated = false; // Reset on error
    }
}

/**
 * Restore open todo editors from workspace state
 */
function restoreOpenTodos(context, refreshTree) {
    // Restore immediately without waiting for sidebar activation
    try {
        const openTodoIds = context.workspaceState.get('openTodos', []);
        if (openTodoIds.length === 0) {
            return;
        }
        
        // Load all todos
        const todosData = todoManager.loadTodos();
        const todos = todosData.todos || [];
        
        // Restore each open todo
        openTodoIds.forEach(todoId => {
            const todo = todos.find(t => t.id === todoId);
            if (todo) {
                // Restore the panel
                createTodoWebviewPanel(context, todo, refreshTree);
            }
        });
    } catch (error) {
        console.error('[WorkspaceTodos] Error restoring open todos:', error);
        // Clear invalid state
        context.workspaceState.update('openTodos', []);
    }
}

function deactivate() {
    if (currentPanel) {
        currentPanel.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};
