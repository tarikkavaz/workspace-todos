const vscode = require('vscode');
const todoManager = require('./todoManager');

/**
 * Tree data provider for todos in sidebar
 */
class TodosTreeDataProvider {
    constructor(context, outputChannel) {
        this._context = context;
        this._outputChannel = outputChannel;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        try {
            const todosData = todoManager.loadTodos();
            const todos = todosData.todos || [];
            
            if (!element) {
                // Root level - return section headers
                if (todos.length === 0) {
                    return [new TodoTreeItem('No To-Dos yet. Click + to add one.', null, true)];
                }
                
                const incompleteTodos = todos.filter(t => !t.completed);
                const completedTodos = todos.filter(t => t.completed);
                
                const sections = [];
                
                // Add "Active Tasks" section
                if (incompleteTodos.length > 0) {
                    sections.push(new SectionTreeItem('Active To-Do\'s', incompleteTodos.length, 'active'));
                }
                
                // Add "Completed Tasks" section
                if (completedTodos.length > 0) {
                    sections.push(new SectionTreeItem('Completed To-Do\'s', completedTodos.length, 'completed'));
                }
                
                return sections;
            } else if (element instanceof SectionTreeItem) {
                // Return todos for this section
                const todosData = todoManager.loadTodos();
                const todos = todosData.todos || [];
                
                if (element.sectionType === 'active') {
                    return todos
                        .filter(t => !t.completed)
                        .map(todo => new TodoTreeItem(todo.title || todo.notes || 'Untitled', todo, false));
                } else if (element.sectionType === 'completed') {
                    return todos
                        .filter(t => t.completed)
                        .map(todo => new TodoTreeItem(todo.title || todo.notes || 'Untitled', todo, false));
                }
            }
            
            return [];
        } catch (error) {
            return [new TodoTreeItem('Error loading To-Dos', null, true)];
        }
    }
}

/**
 * Tree item for section headers (Active Tasks, Completed Tasks)
 */
class SectionTreeItem extends vscode.TreeItem {
    constructor(label, count, sectionType) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.sectionType = sectionType;
        this.contextValue = 'section';
        this.description = `(${count})`;
        this.iconPath = new vscode.ThemeIcon(sectionType === 'active' ? 'list-unordered' : 'checklist');
    }
}

/**
 * Tree item for a TODO
 */
class TodoTreeItem extends vscode.TreeItem {
    constructor(label, todo, isEmpty) {
        super(label, vscode.TreeItemCollapsibleState.None);
        
        if (isEmpty) {
            this.contextValue = 'empty';
            return;
        }
        
        // Store the full todo object and ID for command access
        this.todo = todo;
        this.todoId = todo.id; // Store ID separately for easier access
        this.contextValue = 'todo';
        // Show title in tooltip, with notes if available
        const tooltipParts = [];
        if (todo.title) tooltipParts.push(todo.title);
        if (todo.notes) tooltipParts.push(todo.notes);
        this.tooltip = tooltipParts.join('\n\n') || 'TODO';
        this.description = todo.completed ? '✓ Completed' : '';
        
        // Set icon based on completion status
        if (todo.completed) {
            this.iconPath = new vscode.ThemeIcon('check');
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
        
        // Show assigned files count if any
        if (todo.files && todo.files.length > 0) {
            this.description = `${todo.completed ? '✓ ' : ''}${todo.files.length} file(s)`;
        }
        
        // Make the item clickable to open editor
        this.command = {
            command: 'workspaceTodos.editTodo',
            title: 'Edit To-Do',
            arguments: [this]
        };
    }
}

module.exports = {
    TodosTreeDataProvider,
    SectionTreeItem,
    TodoTreeItem
};
