const vscode = require('vscode');
const todoManager = require('./todoManager');
const { loadLabelConfig } = require('./utils');

/**
 * Tree data provider for todos in sidebar
 */
class TodosTreeDataProvider {
    constructor(context, outputChannel) {
        this._context = context;
        this._outputChannel = outputChannel;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._selectedFilterLabels = new Set(); // Store selected filter labels
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
    
    getSelectedFilterLabels() {
        return Array.from(this._selectedFilterLabels);
    }
    
    toggleFilterLabel(label) {
        if (this._selectedFilterLabels.has(label)) {
            this._selectedFilterLabels.delete(label);
        } else {
            this._selectedFilterLabels.add(label);
        }
        this.refresh();
    }
    
    clearFilters() {
        this._selectedFilterLabels.clear();
        this.refresh();
    }

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        try {
            const todosData = todoManager.loadTodos();
            const todos = todosData.todos || [];
            
            if (!element) {
                // Root level - return filter section and section headers grouped by status
                const rootItems = [];
                
                // Add filter section if there are todos (exclude status:done since done todos are in separate view)
                if (todos.length > 0) {
                    // Get all used labels from active todos (excluding status:done)
                    const usedLabels = new Set();
                    todos.forEach(todo => {
                        if (todo.labels && todo.labels.length > 0) {
                            todo.labels.forEach(label => {
                                // Exclude status:done label from filter options (done todos are in separate view)
                                if (label !== 'status:done') {
                                    usedLabels.add(label);
                                }
                            });
                        }
                    });
                    
                    if (usedLabels.size > 0) {
                        rootItems.push(new FilterTreeItem(Array.from(usedLabels), this));
                    }
                }
                
                if (todos.length === 0) {
                    rootItems.push(new TodoTreeItem('No To-Dos yet. Click + to add one.', null, true));
                    return rootItems;
                }
                
                // Apply label filter if any labels are selected
                let filteredTodos = todos;
                if (this._selectedFilterLabels.size > 0) {
                    filteredTodos = todos.filter(todo => {
                        if (!todo.labels || todo.labels.length === 0) return false;
                        // Check if todo has at least one of the selected filter labels
                        return Array.from(this._selectedFilterLabels).some(filterLabel => 
                            todo.labels.includes(filterLabel)
                        );
                    });
                }
                
                if (filteredTodos.length === 0 && this._selectedFilterLabels.size > 0) {
                    rootItems.push(new TodoTreeItem('No todos match the selected filters.', null, true));
                    return rootItems;
                }
                
                // Get status labels from configuration
                const labelConfig = loadLabelConfig();
                const statusValues = labelConfig.categories.status?.values || [];
                
                // Filter out completed todos (they go in the separate "Completed" view)
                // Exclude todos with status:done label OR completed: true
                const activeTodos = filteredTodos.filter(todo => {
                    // Check if todo has status:done label
                    const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
                    if (statusLabel) {
                        const statusValue = statusLabel.split(':')[1];
                        if (statusValue === 'done') {
                            return false; // Exclude done todos
                        }
                    }
                    // Also exclude todos with completed: true (for backwards compatibility)
                    if (todo.completed === true) {
                        return false; // Exclude completed todos
                    }
                    return true; // Include active todos
                });
                
                // Group active todos by status
                const todosByStatus = {};
                const todosWithoutStatus = [];
                
                activeTodos.forEach(todo => {
                    // Find status label in todo's labels
                    const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
                    if (statusLabel) {
                        const statusValue = statusLabel.split(':')[1];
                        if (!todosByStatus[statusValue]) {
                            todosByStatus[statusValue] = [];
                        }
                        todosByStatus[statusValue].push(todo);
                    } else {
                        todosWithoutStatus.push(todo);
                    }
                });
                
                // Add sections for each status value in order, with "in-progress" first
                // Exclude "done" todos as they are shown in the separate "Completed" view
                // First, add "in-progress" if it exists
                if (todosByStatus['in-progress'] && todosByStatus['in-progress'].length > 0) {
                    const count = todosByStatus['in-progress'].length;
                    rootItems.push(new SectionTreeItem(
                        'In Progress',
                        count,
                        'in-progress'
                    ));
                }
                
                // Then add all other status values except "done" and "in-progress"
                statusValues.forEach(statusValue => {
                    if (statusValue === 'done' || statusValue === 'in-progress') {
                        // Skip done (shown in separate view) and in-progress (added first)
                        return;
                    }
                    if (todosByStatus[statusValue] && todosByStatus[statusValue].length > 0) {
                        const count = todosByStatus[statusValue].length;
                        rootItems.push(new SectionTreeItem(
                            statusValue.charAt(0).toUpperCase() + statusValue.slice(1).replace(/-/g, ' '),
                            count,
                            statusValue
                        ));
                    }
                });
                
                // Add "No Status" section for todos without status labels
                if (todosWithoutStatus.length > 0) {
                    rootItems.push(new SectionTreeItem('No Status', todosWithoutStatus.length, 'no-status'));
                }
                
                // Note: "Done" section is now shown in the separate "Completed" view
                
                return rootItems;
            } else if (element instanceof FilterTreeItem) {
                // Return filter label items, sorted by category and value
                const labels = element.getFilterLabels();
                const sortedLabels = labels.sort((a, b) => {
                    const [catA, valA] = a.split(':');
                    const [catB, valB] = b.split(':');
                    if (catA !== catB) {
                        return catA.localeCompare(catB);
                    }
                    return valA.localeCompare(valB);
                });
                
                return sortedLabels.map(label => {
                    const [category, value] = label.split(':');
                    const displayName = value || label;
                    const isSelected = this._selectedFilterLabels.has(label);
                    return new FilterLabelTreeItem(displayName, label, isSelected, this);
                });
            } else if (element instanceof SectionTreeItem) {
                // Return todos for this section (already filtered at root level)
                const todosData = todoManager.loadTodos();
                let todos = todosData.todos || [];
                
                // IMPORTANT: First filter out completed todos (they go in "Completed" view)
                todos = todos.filter(todo => {
                    // Exclude todos with status:done label
                    const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
                    if (statusLabel) {
                        const statusValue = statusLabel.split(':')[1];
                        if (statusValue === 'done') {
                            return false; // Exclude done todos
                        }
                    }
                    // Also exclude todos with completed: true
                    if (todo.completed === true) {
                        return false; // Exclude completed todos
                    }
                    return true; // Only include active todos
                });
                
                // Apply label filter if any labels are selected
                if (this._selectedFilterLabels.size > 0) {
                    todos = todos.filter(todo => {
                        if (!todo.labels || todo.labels.length === 0) return false;
                        // Check if todo has at least one of the selected filter labels
                        return Array.from(this._selectedFilterLabels).some(filterLabel => 
                            todo.labels.includes(filterLabel)
                        );
                    });
                }
                
                if (element.sectionType === 'no-status') {
                    // Return todos without status labels (exclude completed ones)
                    return todos
                        .filter(t => {
                            // Exclude completed todos
                            if (t.completed === true) return false;
                            const statusLabel = t.labels?.find(label => label.startsWith('status:'));
                            if (statusLabel) {
                                const statusValue = statusLabel.split(':')[1];
                                if (statusValue === 'done') return false;
                            }
                            return !t.labels || !t.labels.some(label => label.startsWith('status:'));
                        })
                        .map(todo => new TodoTreeItem(todo.title || todo.notes || 'Untitled', todo, false));
                } else {
                    // Return todos with the specific status (exclude completed ones)
                    return todos
                        .filter(t => {
                            // Exclude completed todos
                            if (t.completed === true) return false;
                            const statusLabel = t.labels?.find(label => label.startsWith('status:'));
                            if (statusLabel) {
                                const statusValue = statusLabel.split(':')[1];
                                // Exclude done status
                                if (statusValue === 'done') return false;
                                return statusValue === element.sectionType;
                            }
                            return false;
                        })
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
 * Tree item for filter section
 */
class FilterTreeItem extends vscode.TreeItem {
    constructor(usedLabels, dataProvider) {
        const filterCount = dataProvider.getSelectedFilterLabels().length;
        const label = filterCount > 0 
            ? `Filter Labels (${filterCount} selected)` 
            : 'Filter Labels';
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'filter';
        this.usedLabels = usedLabels;
        this.dataProvider = dataProvider;
        this.iconPath = new vscode.ThemeIcon('filter');
        this.tooltip = 'Click to expand and select labels to filter todos';
    }
    
    getFilterLabels() {
        return this.usedLabels;
    }
}

/**
 * Tree item for a filter label
 */
class FilterLabelTreeItem extends vscode.TreeItem {
    constructor(label, fullLabel, isSelected, dataProvider) {
        const [category, value] = fullLabel.split(':');
        const displayLabel = category ? `${category}: ${value}` : label;
        super(displayLabel, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'filterLabel';
        this.fullLabel = fullLabel;
        this.isSelected = isSelected;
        this.dataProvider = dataProvider;
        this.description = isSelected ? '✓' : '';
        this.iconPath = new vscode.ThemeIcon(isSelected ? 'check' : 'circle-outline');
        this.tooltip = `Click to ${isSelected ? 'deselect' : 'select'} this filter`;
        this.command = {
            command: 'workspaceTodos.toggleFilterLabel',
            title: 'Toggle Filter Label',
            arguments: [this]
        };
    }
}

/**
 * Tree item for section headers (Status-based sections)
 */
class SectionTreeItem extends vscode.TreeItem {
    constructor(label, count, sectionType) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.sectionType = sectionType;
        this.contextValue = 'section';
        this.description = `(${count})`;
        
        // Set icon based on status type
        let iconName = 'list-unordered';
        if (sectionType === 'done') {
            iconName = 'check';
        } else if (sectionType === 'in-progress') {
            iconName = 'sync';
        } else if (sectionType === 'blocked') {
            iconName = 'warning';
        } else if (sectionType === 'review') {
            iconName = 'eye';
        } else if (sectionType === 'planned') {
            iconName = 'calendar';
        } else if (sectionType === 'backlog') {
            iconName = 'archive';
        } else if (sectionType === 'no-status') {
            iconName = 'circle-outline';
        }
        
        this.iconPath = new vscode.ThemeIcon(iconName);
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
        
        // Add labels to tooltip
        if (todo.labels && todo.labels.length > 0) {
            tooltipParts.push(`Labels: ${todo.labels.join(', ')}`);
        }
        
        this.tooltip = tooltipParts.join('\n\n') || 'TODO';
        
        // Build description with files (no completion status or labels in description)
        const descParts = [];
        
        // Show assigned files count if any
        if (todo.files && todo.files.length > 0) {
            descParts.push(`${todo.files.length} file(s)`);
        }
        
        this.description = descParts.join(' • ') || '';
        
        // Set icon based on completion status (check icon for completed, circle for active)
        if (todo.completed) {
            this.iconPath = new vscode.ThemeIcon('check');
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
        
        // Make the item clickable to open editor
        this.command = {
            command: 'workspaceTodos.editTodo',
            title: 'Edit To-Do',
            arguments: [this]
        };
    }
}

/**
 * Tree data provider for completed todos only
 */
class CompletedTodosTreeDataProvider {
    constructor(context, outputChannel) {
        this._context = context;
        this._outputChannel = outputChannel;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._selectedFilterLabels = new Set(); // Store selected filter labels
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
    
    getSelectedFilterLabels() {
        return Array.from(this._selectedFilterLabels);
    }
    
    toggleFilterLabel(label) {
        if (this._selectedFilterLabels.has(label)) {
            this._selectedFilterLabels.delete(label);
        } else {
            this._selectedFilterLabels.add(label);
        }
        this.refresh();
    }
    
    clearFilters() {
        this._selectedFilterLabels.clear();
        this.refresh();
    }

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        try {
            const todosData = todoManager.loadTodos();
            const todos = todosData.todos || [];
            
            if (!element) {
                // Root level - return filter section and completed todos
                const rootItems = [];
                
                // Get all completed todos first
                let completedTodos = todos.filter(todo => {
                    // Check if todo has status:done label
                    const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
                    if (statusLabel) {
                        const statusValue = statusLabel.split(':')[1];
                        if (statusValue === 'done') {
                            return true;
                        }
                    }
                    // Also check if todo has completed: true (for backwards compatibility)
                    if (todo.completed === true) {
                        return true;
                    }
                    return false;
                });
                
                // Add filter section if there are completed todos
                if (completedTodos.length > 0) {
                    // Get all used labels from completed todos
                    const usedLabels = new Set();
                    completedTodos.forEach(todo => {
                        if (todo.labels && todo.labels.length > 0) {
                            todo.labels.forEach(label => usedLabels.add(label));
                        }
                    });
                    
                    if (usedLabels.size > 0) {
                        rootItems.push(new FilterTreeItem(Array.from(usedLabels), this));
                    }
                }
                
                // Apply label filter if any labels are selected
                if (this._selectedFilterLabels.size > 0) {
                    completedTodos = completedTodos.filter(todo => {
                        if (!todo.labels || todo.labels.length === 0) return false;
                        // Check if todo has at least one of the selected filter labels
                        return Array.from(this._selectedFilterLabels).some(filterLabel => 
                            todo.labels.includes(filterLabel)
                        );
                    });
                }
                
                if (completedTodos.length === 0) {
                    if (this._selectedFilterLabels.size > 0) {
                        rootItems.push(new TodoTreeItem('No completed todos match the selected filters.', null, true));
                    } else {
                        rootItems.push(new TodoTreeItem('No completed todos', null, true));
                    }
                    return rootItems;
                }
                
                // Return completed todos
                completedTodos.forEach(todo => {
                    rootItems.push(new TodoTreeItem(todo.title || todo.notes || 'Untitled', todo, false));
                });
                
                return rootItems;
            } else if (element instanceof FilterTreeItem) {
                // Return filter label items, sorted by category and value
                const labels = element.getFilterLabels();
                const sortedLabels = labels.sort((a, b) => {
                    const [catA, valA] = a.split(':');
                    const [catB, valB] = b.split(':');
                    if (catA !== catB) {
                        return catA.localeCompare(catB);
                    }
                    return valA.localeCompare(valB);
                });
                
                return sortedLabels.map(label => {
                    const [category, value] = label.split(':');
                    const displayName = value || label;
                    const isSelected = this._selectedFilterLabels.has(label);
                    return new FilterLabelTreeItem(displayName, label, isSelected, this);
                });
            }
            
            return [];
        } catch (error) {
            return [new TodoTreeItem('Error loading completed todos', null, true)];
        }
    }
}

module.exports = {
    TodosTreeDataProvider,
    CompletedTodosTreeDataProvider,
    SectionTreeItem,
    TodoTreeItem,
    FilterTreeItem,
    FilterLabelTreeItem
};
