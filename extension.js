const vscode = require('vscode');
const { TodosTreeDataProvider, CompletedTodosTreeDataProvider, TrelloTodosTreeDataProvider } = require('./src/treeView');
const { registerCommands } = require('./src/commands');
const { createTodoWebviewPanel } = require('./src/todoEditor');
const todoManager = require('./src/todoManager');
const { createTrelloSyncManager, getCredentials } = require('./src/trelloSync');

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
        const trelloTreeDataProvider = new TrelloTodosTreeDataProvider(context, globalOutputChannel);
        
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

        const trelloTreeView = vscode.window.createTreeView('workspaceTodosTrelloView', {
            treeDataProvider: trelloTreeDataProvider,
            dragAndDropController: trelloTreeDataProvider,
            showCollapseAll: false
        });
        context.subscriptions.push(trelloTreeView);
        
        // Refresh both trees when todos change
        const refreshTree = () => {
            treeDataProvider.refresh();
            completedTreeDataProvider.refresh();
            trelloTreeDataProvider.refresh();
        };

        const trelloSyncManager = createTrelloSyncManager(context, globalOutputChannel, refreshTree);
        context.subscriptions.push({ dispose: () => trelloSyncManager.dispose() });
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('workspaceTodos.trello')) {
                    trelloSyncManager.syncNow('config-change');
                }
            })
        );
        
        // Register all commands (pass both providers for filter commands)
        registerCommands(context, refreshTree, globalOutputChannel, treeDataProvider, completedTreeDataProvider, trelloSyncManager);

        showTrelloSetupPrompt(context);
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

async function showTrelloSetupPrompt(context) {
    try {
        const config = vscode.workspace.getConfiguration('workspaceTodos');
        const trelloEnabled = config.get('trello.enabled', false);
        if (!trelloEnabled) {
            return;
        }

        const promptKey = 'trelloSetupPromptShown';
        const alreadyShown = context.workspaceState.get(promptKey, false);
        if (alreadyShown) {
            return;
        }

        const { apiKey, token } = await getCredentials(context);
        if (apiKey && token) {
            return;
        }

        const selection = await vscode.window.showInformationMessage(
            'Trello sync is enabled. Set credentials and configure your board to start syncing.',
            'Set Credentials',
            'Open Settings'
        );

        if (selection === 'Set Credentials') {
            vscode.commands.executeCommand('workspaceTodos.trello.setCredentials');
        } else if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'workspaceTodos.trello');
        }

        context.workspaceState.update(promptKey, true);
    } catch (error) {
        console.error('[WorkspaceTodos] Trello setup prompt failed:', error);
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
