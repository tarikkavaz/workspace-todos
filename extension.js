const vscode = require('vscode');
const { TodosTreeDataProvider } = require('./src/treeView');
const { registerCommands } = require('./src/commands');

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
    
    // Register tree view provider for sidebar
    try {
        const treeDataProvider = new TodosTreeDataProvider(context, globalOutputChannel);
        const treeView = vscode.window.createTreeView('workspaceTodosView', {
            treeDataProvider: treeDataProvider,
            showCollapseAll: false
        });
        context.subscriptions.push(treeView);
        
        // Refresh tree when todos change
        const refreshTree = () => treeDataProvider.refresh();
        
        // Register all commands
        registerCommands(context, refreshTree, globalOutputChannel);
        
        vscode.window.showInformationMessage('Workspace Todos extension activated!');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to register Workspace Todos view: ${error.message}`);
        isActivated = false; // Reset on error
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
