const vscode = require('vscode');
const path = require('path');
const todoManager = require('./todoManager');
const { loadLabelConfig } = require('./utils');
const { getCredentials } = require('./trelloSync');

function isTrelloTodo(todo) {
    return !!todo?.trello?.cardId;
}

function getTrelloFilterConfig() {
    const config = vscode.workspace.getConfiguration('workspaceTodos');
    return {
        assignedOnly: config.get('trello.assignedOnly', true),
        assignedUsername: config.get('trello.assignedUsername', '')
    };
}

function shouldIncludeTrelloTodo(todo) {
    const { assignedOnly, assignedUsername } = getTrelloFilterConfig();
    if (!assignedOnly) return true;
    if (!assignedUsername) return false;
    const assignees = todo.trello?.assignees || [];
    return assignees.includes(assignedUsername);
}

function getTrelloIconPath(context) {
    return {
        light: vscode.Uri.file(path.join(context.extensionPath, 'media', 'trello-icon-light.svg')),
        dark: vscode.Uri.file(path.join(context.extensionPath, 'media', 'trello-icon-dark.svg'))
    };
}

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

    // Drag and Drop support
    get dragMimeTypes() {
        return ['application/vnd.code.tree.workspaceTodosView'];
    }

    get dropMimeTypes() {
        return ['application/vnd.code.tree.workspaceTodosView'];
    }

    async handleDrag(source, dataTransfer, token) {
        if (token.isCancellationRequested) {
            return;
        }


        // VS Code passes an array of selected items
        const sources = Array.isArray(source) ? source : [source];
        const draggedTodoIds = [];

        this._outputChannel.appendLine(`Drag: Source type - ${source?.constructor?.name || typeof source}, length: ${sources.length}`);

        for (let i = 0; i < sources.length; i++) {
            const item = sources[i];
            this._outputChannel.appendLine(`Drag: Item ${i} - type: ${item?.constructor?.name || typeof item}, has todoId: ${!!item?.todoId}, has todo: ${!!item?.todo}`);
            
            let draggedTodoId = null;
            if (item instanceof TodoTreeItem) {
                draggedTodoId = item.todoId;
                this._outputChannel.appendLine(`Drag: Item ${i} is TodoTreeItem with id: ${draggedTodoId}`);
            } else if (item && item.todoId) {
                draggedTodoId = item.todoId;
                this._outputChannel.appendLine(`Drag: Item ${i} has todoId: ${draggedTodoId}`);
            } else if (item && item.todo && item.todo.id) {
                draggedTodoId = item.todo.id;
                this._outputChannel.appendLine(`Drag: Item ${i} has todo.id: ${draggedTodoId}`);
            } else if (item && typeof item === 'object') {
                // Try to extract ID from any object properties
                this._outputChannel.appendLine(`Drag: Item ${i} keys: ${Object.keys(item || {}).join(', ')}`);
            }

            if (draggedTodoId) {
                draggedTodoIds.push(draggedTodoId);
            }
        }

        if (draggedTodoIds.length === 0) {
            this._outputChannel.appendLine(`Drag: No valid todo IDs found in source`);
            return;
        }

        // Serialize the dragged todo IDs
        const data = JSON.stringify(draggedTodoIds);
        this._outputChannel.appendLine(`Drag: Dragging todos ${draggedTodoIds.join(', ')}`);
        dataTransfer.set('application/vnd.code.tree.workspaceTodosView', new vscode.DataTransferItem(data));
    }

    async handleDrop(target, dataTransfer, token) {
        if (token.isCancellationRequested) {
            return;
        }

        try {
            this._outputChannel.appendLine(`Drop: Attempting drop`);
            const transferItem = dataTransfer.get('application/vnd.code.tree.workspaceTodosView');
            if (!transferItem) {
                this._outputChannel.appendLine(`Drop: No transfer item found`);
                return;
            }

            const draggedTodoIds = JSON.parse(await transferItem.asString());
            if (!Array.isArray(draggedTodoIds) || draggedTodoIds.length === 0) {
                return;
            }

            this._outputChannel.appendLine(`Drop: Received ${draggedTodoIds.length} todo(s)`);
            
            // Determine target section and index
            let targetSection = null;
            let targetIndex = 0;

            if (target instanceof SectionTreeItem) {
                // Dropping on a section header - add to end of that section
                targetSection = target.sectionType;
                const todosInSection = this._getTodosForSection(targetSection);
                targetIndex = todosInSection.length;
                this._outputChannel.appendLine(`Drop: Target is section ${targetSection} at index ${targetIndex}`);
            } else if (target instanceof TodoTreeItem && target.todoId) {
                // Dropping on a todo - insert before/after that todo
                const targetTodo = target.todo;
                targetSection = todoManager.getTodoSectionType(targetTodo);
                
                // Get all todos in the target section, sorted by order
                const todosInSection = this._getTodosForSection(targetSection);
                const targetTodoIndex = todosInSection.findIndex(t => t.id === targetTodo.id);
                
                if (targetTodoIndex >= 0) {
                    // Check if we're moving within the same section
                    const sourceSection = todoManager.getTodoSectionType(
                        todosInSection.find(t => draggedTodoIds.includes(t.id)) || 
                        todoManager.loadTodos().todos.find(t => draggedTodoIds.includes(t.id))
                    );
                    
                    if (sourceSection === targetSection) {
                        // Moving within same section - adjust index if dragging from before target
                        const draggedIndex = todosInSection.findIndex(t => draggedTodoIds.includes(t.id));
                        if (draggedIndex >= 0 && draggedIndex < targetTodoIndex) {
                            targetIndex = targetTodoIndex; // Insert after target (since we're removing from before)
                        } else {
                            targetIndex = targetTodoIndex; // Insert before target
                        }
                    } else {
                        targetIndex = targetTodoIndex; // Insert before target when moving between sections
                    }
                } else {
                    targetIndex = todosInSection.length; // Fallback to end
                }
            } else {
                // Invalid drop target
                return;
            }

            // Get source section for status update
            const todosData = todoManager.loadTodos();
            const firstDraggedTodo = todosData.todos.find(t => draggedTodoIds.includes(t.id));
            const sourceSection = firstDraggedTodo ? todoManager.getTodoSectionType(firstDraggedTodo) : null;

            // Perform the reorder
            todoManager.reorderTodos(draggedTodoIds, targetIndex, targetSection, sourceSection);

            // Refresh the tree
            this.refresh();
        } catch (error) {
            this._outputChannel.appendLine(`Error handling drop: ${error.message}`);
            vscode.window.showErrorMessage(`Error reordering todos: ${error.message}`);
        }
    }

    _getTodosForSection(sectionType) {
        const todosData = todoManager.loadTodos();
        let todos = todosData.todos || [];
        // Exclude Trello-synced todos from local view
        todos = todos.filter(todo => !isTrelloTodo(todo));

        // Filter out completed todos (they go in "Completed" view)
        todos = todos.filter(todo => {
            const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
            if (statusLabel) {
                const statusValue = statusLabel.split(':')[1];
                if (statusValue === 'done') {
                    return false;
                }
            }
            if (todo.completed === true) {
                return false;
            }
            return true;
        });

        // Apply label filter if any labels are selected
        if (this._selectedFilterLabels.size > 0) {
            todos = todos.filter(todo => {
                if (!todo.labels || todo.labels.length === 0) return false;
                return Array.from(this._selectedFilterLabels).some(filterLabel => 
                    todo.labels.includes(filterLabel)
                );
            });
        }

        // Filter by section type
        if (sectionType === 'no-status') {
            todos = todos.filter(t => {
                if (t.completed === true) return false;
                const statusLabel = t.labels?.find(label => label.startsWith('status:'));
                if (statusLabel) {
                    const statusValue = statusLabel.split(':')[1];
                    if (statusValue === 'done') return false;
                }
                return !t.labels || !t.labels.some(label => label.startsWith('status:'));
            });
        } else {
            todos = todos.filter(t => {
                if (t.completed === true) return false;
                const statusLabel = t.labels?.find(label => label.startsWith('status:'));
                if (statusLabel) {
                    const statusValue = statusLabel.split(':')[1];
                    if (statusValue === 'done') return false;
                    return statusValue === sectionType;
                }
                return false;
            });
        }

        // Sort by order
        return todos.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    getChildren(element) {
        try {
            const todosData = todoManager.loadTodos();
            const todos = todosData.todos || [];
            const localTodos = todos.filter(todo => !isTrelloTodo(todo));
            
            if (!element) {
                // Root level - return filter section and section headers grouped by status
                const rootItems = [];
                
                // Add filter section if there are todos (exclude status:done since done todos are in separate view)
                if (localTodos.length > 0) {
                    // Get all used labels from active todos (excluding status:done)
                    const usedLabels = new Set();
                    localTodos.forEach(todo => {
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
                
                if (localTodos.length === 0) {
                    rootItems.push(new TodoTreeItem('No To-Dos yet. Click + to add one.', null, true));
                    return rootItems;
                }
                
                // Apply label filter if any labels are selected
                let filteredTodos = localTodos;
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
                let todos = (todosData.todos || []).filter(todo => !isTrelloTodo(todo));
                
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
                    // Return todos without status labels (exclude completed ones), sorted by order
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
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
                        .map(todo => new TodoTreeItem(todo.title || todo.notes || 'Untitled', todo, false));
                } else {
                    // Return todos with the specific status (exclude completed ones), sorted by order
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
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
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
        
        // Set resourceUri to enable drag-and-drop functionality
        // Use a custom URI scheme to avoid file-specific styling (which causes gray text)
        // This enables drag-and-drop without triggering file colorization
        this.resourceUri = vscode.Uri.parse(`todo-item://${todo.id}`);
        
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

    // Drag and Drop support
    get dragMimeTypes() {
        return ['application/vnd.code.tree.workspaceTodosView'];
    }

    get dropMimeTypes() {
        return ['application/vnd.code.tree.workspaceTodosView'];
    }

    async handleDrag(source, dataTransfer, token) {
        if (token.isCancellationRequested) {
            return;
        }


        // VS Code passes an array of selected items
        const sources = Array.isArray(source) ? source : [source];
        const draggedTodoIds = [];

        for (const item of sources) {
            let draggedTodoId = null;
            if (item instanceof TodoTreeItem) {
                draggedTodoId = item.todoId;
            } else if (item && item.todoId) {
                draggedTodoId = item.todoId;
            } else if (item && item.todo && item.todo.id) {
                draggedTodoId = item.todo.id;
            }

            if (draggedTodoId) {
                draggedTodoIds.push(draggedTodoId);
            }
        }

        if (draggedTodoIds.length === 0) {
            this._outputChannel.appendLine(`Drag (Completed): Invalid source - ${source?.constructor?.name || typeof source}`);
            return;
        }

        // Serialize the dragged todo IDs
        const data = JSON.stringify(draggedTodoIds);
        this._outputChannel.appendLine(`Drag (Completed): Dragging todos ${draggedTodoIds.join(', ')}`);
        dataTransfer.set('application/vnd.code.tree.workspaceTodosCompletedView', new vscode.DataTransferItem(data));
    }

    async handleDrop(target, dataTransfer, token) {
        if (token.isCancellationRequested) {
            return;
        }

        try {
            const transferItem = dataTransfer.get('application/vnd.code.tree.workspaceTodosCompletedView');
            if (!transferItem) {
                return;
            }

            const draggedTodoIds = JSON.parse(await transferItem.asString());
            if (!Array.isArray(draggedTodoIds) || draggedTodoIds.length === 0) {
                return;
            }

            // In completed view, todos are at root level (no sections)
            // Determine target index
            let targetIndex = 0;

            if (target instanceof TodoTreeItem && target.todoId) {
                // Dropping on a todo - insert before that todo
                const todosData = todoManager.loadTodos();
                const completedTodos = this._getCompletedTodos().sort((a, b) => (a.order || 0) - (b.order || 0));
                const targetTodoIndex = completedTodos.findIndex(t => t.id === target.todoId);
                
                if (targetTodoIndex >= 0) {
                    // Check if we're moving within the same list
                    const draggedIndex = completedTodos.findIndex(t => draggedTodoIds.includes(t.id));
                    if (draggedIndex >= 0 && draggedIndex < targetTodoIndex) {
                        targetIndex = targetTodoIndex; // Insert after target (since we're removing from before)
                    } else {
                        targetIndex = targetTodoIndex; // Insert before target
                    }
                } else {
                    targetIndex = completedTodos.length; // Fallback to end
                }
            } else if (!target) {
                // Dropping at root level - add to end
                const completedTodos = this._getCompletedTodos();
                targetIndex = completedTodos.length;
            } else {
                // Invalid drop target (e.g., filter item)
                return;
            }

            // Get source section for status update (should be 'done' for completed todos)
            const todosData = todoManager.loadTodos();
            const firstDraggedTodo = todosData.todos.find(t => draggedTodoIds.includes(t.id));
            const sourceSection = firstDraggedTodo ? todoManager.getTodoSectionType(firstDraggedTodo) : 'done';

            // Perform the reorder (target section is 'done' for completed view)
            todoManager.reorderTodos(draggedTodoIds, targetIndex, 'done', sourceSection);

            // Refresh the tree
            this.refresh();
        } catch (error) {
            this._outputChannel.appendLine(`Error handling drop: ${error.message}`);
            vscode.window.showErrorMessage(`Error reordering todos: ${error.message}`);
        }
    }

    _getCompletedTodos() {
        const todosData = todoManager.loadTodos();
        const todos = todosData.todos || [];
        
        // Get all completed todos
        let completedTodos = todos.filter(todo => {
            const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
            if (statusLabel) {
                const statusValue = statusLabel.split(':')[1];
                if (statusValue === 'done') {
                    return true;
                }
            }
            if (todo.completed === true) {
                return true;
            }
            return false;
        });

        // Apply Trello assigned-only filter for Trello todos
        completedTodos = completedTodos.filter(todo => {
            return !isTrelloTodo(todo) || shouldIncludeTrelloTodo(todo);
        });

        // Apply label filter if any labels are selected
        if (this._selectedFilterLabels.size > 0) {
            completedTodos = completedTodos.filter(todo => {
                if (!todo.labels || todo.labels.length === 0) return false;
                return Array.from(this._selectedFilterLabels).some(filterLabel => 
                    todo.labels.includes(filterLabel)
                );
            });
        }

        return completedTodos;
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

                // Apply Trello assigned-only filter for Trello todos
                completedTodos = completedTodos.filter(todo => {
                    return !isTrelloTodo(todo) || shouldIncludeTrelloTodo(todo);
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
                
                // Return completed todos, sorted by order
                const trelloIcon = getTrelloIconPath(this._context);
                completedTodos
                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                    .forEach(todo => {
                        const item = new TodoTreeItem(todo.title || todo.notes || 'Untitled', todo, false);
                        if (isTrelloTodo(todo)) {
                            item.iconPath = trelloIcon;
                        }
                        rootItems.push(item);
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

/**
 * Tree data provider for Trello-synced todos only (active)
 */
class TrelloTodosTreeDataProvider {
    constructor(context, outputChannel) {
        this._context = context;
        this._outputChannel = outputChannel;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._selectedFilterLabels = new Set();
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

    // Drag and Drop support
    get dragMimeTypes() {
        return ['application/vnd.code.tree.workspaceTodosTrelloView'];
    }

    get dropMimeTypes() {
        return ['application/vnd.code.tree.workspaceTodosTrelloView'];
    }

    async handleDrag(source, dataTransfer, token) {
        if (token.isCancellationRequested) {
            return;
        }

        const sources = Array.isArray(source) ? source : [source];
        const draggedTodoIds = [];

        for (const item of sources) {
            let draggedTodoId = null;
            if (item instanceof TodoTreeItem) {
                draggedTodoId = item.todoId;
            } else if (item && item.todoId) {
                draggedTodoId = item.todoId;
            } else if (item && item.todo && item.todo.id) {
                draggedTodoId = item.todo.id;
            }

            if (draggedTodoId) {
                draggedTodoIds.push(draggedTodoId);
            }
        }

        if (draggedTodoIds.length === 0) {
            return;
        }

        const data = JSON.stringify(draggedTodoIds);
        dataTransfer.set('application/vnd.code.tree.workspaceTodosTrelloView', new vscode.DataTransferItem(data));
    }

    async handleDrop(target, dataTransfer, token) {
        if (token.isCancellationRequested) {
            return;
        }

        try {
            const transferItem = dataTransfer.get('application/vnd.code.tree.workspaceTodosTrelloView');
            if (!transferItem) {
                return;
            }

            const draggedTodoIds = JSON.parse(await transferItem.asString());
            if (!Array.isArray(draggedTodoIds) || draggedTodoIds.length === 0) {
                return;
            }

            let targetSection = null;
            let targetIndex = 0;

            if (target instanceof SectionTreeItem) {
                targetSection = target.sectionType;
                const todosInSection = this._getTodosForSection(targetSection);
                targetIndex = todosInSection.length;
            } else if (target instanceof TodoTreeItem && target.todoId) {
                const targetTodo = target.todo;
                targetSection = todoManager.getTodoSectionType(targetTodo);
                const todosInSection = this._getTodosForSection(targetSection);
                const targetTodoIndex = todosInSection.findIndex(t => t.id === targetTodo.id);
                targetIndex = targetTodoIndex >= 0 ? targetTodoIndex : todosInSection.length;
            } else {
                return;
            }

            const todosData = todoManager.loadTodos();
            const firstDraggedTodo = todosData.todos.find(t => draggedTodoIds.includes(t.id));
            const sourceSection = firstDraggedTodo ? todoManager.getTodoSectionType(firstDraggedTodo) : null;

            todoManager.reorderTodos(draggedTodoIds, targetIndex, targetSection, sourceSection);
            this.refresh();
        } catch (error) {
            this._outputChannel.appendLine(`Error handling Trello drop: ${error.message}`);
            vscode.window.showErrorMessage(`Error reordering Trello todos: ${error.message}`);
        }
    }

    _getTodosForSection(sectionType) {
        const todosData = todoManager.loadTodos();
        let todos = (todosData.todos || []).filter(todo => isTrelloTodo(todo) && shouldIncludeTrelloTodo(todo));

        // Filter out completed todos
        todos = todos.filter(todo => {
            const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
            if (statusLabel) {
                const statusValue = statusLabel.split(':')[1];
                if (statusValue === 'done') {
                    return false;
                }
            }
            if (todo.completed === true) {
                return false;
            }
            return true;
        });

        if (this._selectedFilterLabels.size > 0) {
            todos = todos.filter(todo => {
                if (!todo.labels || todo.labels.length === 0) return false;
                return Array.from(this._selectedFilterLabels).some(filterLabel =>
                    todo.labels.includes(filterLabel)
                );
            });
        }

        if (sectionType === 'no-status') {
            todos = todos.filter(t => {
                const statusLabel = t.labels?.find(label => label.startsWith('status:'));
                if (statusLabel) {
                    const statusValue = statusLabel.split(':')[1];
                    if (statusValue === 'done') return false;
                }
                return !t.labels || !t.labels.some(label => label.startsWith('status:'));
            });
        } else {
            todos = todos.filter(t => {
                const statusLabel = t.labels?.find(label => label.startsWith('status:'));
                if (statusLabel) {
                    const statusValue = statusLabel.split(':')[1];
                    if (statusValue === 'done') return false;
                    return statusValue === sectionType;
                }
                return false;
            });
        }

        return todos.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    async getChildren(element) {
        try {
            const config = vscode.workspace.getConfiguration('workspaceTodos');
            const trelloEnabled = config.get('trello.enabled', false);
            if (!trelloEnabled) {
                return [new TodoTreeItem('Trello sync is disabled. Enable it in settings.', null, true)];
            }

            const { apiKey, token } = await getCredentials(this._context);
            const credentialsMissing = !apiKey || !token;

            const todosData = todoManager.loadTodos();
            const trelloTodos = (todosData.todos || []).filter(todo => isTrelloTodo(todo) && shouldIncludeTrelloTodo(todo));

            if (!element) {
                const rootItems = [];

                if (credentialsMissing) {
                    rootItems.push(new InfoTreeItem(
                        'Trello credentials missing. Set credentials to sync.',
                        'workspaceTodos.trello.setCredentials',
                        'key'
                    ));
                    rootItems.push(new InfoTreeItem(
                        'Open Trello settings',
                        'workbench.action.openSettings',
                        'settings-gear',
                        ['workspaceTodos.trello']
                    ));
                    return rootItems;
                }

                if (trelloTodos.length > 0) {
                    const usedLabels = new Set();
                    trelloTodos.forEach(todo => {
                        if (todo.labels && todo.labels.length > 0) {
                            todo.labels.forEach(label => {
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

                if (trelloTodos.length === 0) {
                    rootItems.push(new InfoTreeItem(
                        'No Trello cards found. Try syncing or add cards on Trello.',
                        'workspaceTodos.trello.syncNow',
                        'sync'
                    ));
                    return rootItems;
                }

                let filteredTodos = trelloTodos;
                if (this._selectedFilterLabels.size > 0) {
                    filteredTodos = trelloTodos.filter(todo => {
                        if (!todo.labels || todo.labels.length === 0) return false;
                        return Array.from(this._selectedFilterLabels).some(filterLabel =>
                            todo.labels.includes(filterLabel)
                        );
                    });
                }

                if (filteredTodos.length === 0 && this._selectedFilterLabels.size > 0) {
                    rootItems.push(new TodoTreeItem('No Trello cards match the selected filters.', null, true));
                    return rootItems;
                }

                const labelConfig = loadLabelConfig();
                const statusValues = labelConfig.categories.status?.values || [];

                const activeTodos = filteredTodos.filter(todo => {
                    const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
                    if (statusLabel) {
                        const statusValue = statusLabel.split(':')[1];
                        if (statusValue === 'done') {
                            return false;
                        }
                    }
                    if (todo.completed === true) {
                        return false;
                    }
                    return true;
                });

                const todosByStatus = {};
                const todosWithoutStatus = [];

                activeTodos.forEach(todo => {
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

                if (todosByStatus['in-progress'] && todosByStatus['in-progress'].length > 0) {
                    rootItems.push(new SectionTreeItem('In Progress', todosByStatus['in-progress'].length, 'in-progress'));
                }

                statusValues.forEach(statusValue => {
                    if (statusValue === 'done' || statusValue === 'in-progress') {
                        return;
                    }
                    if (todosByStatus[statusValue] && todosByStatus[statusValue].length > 0) {
                        rootItems.push(new SectionTreeItem(
                            statusValue.charAt(0).toUpperCase() + statusValue.slice(1).replace(/-/g, ' '),
                            todosByStatus[statusValue].length,
                            statusValue
                        ));
                    }
                });

                if (todosWithoutStatus.length > 0) {
                    rootItems.push(new SectionTreeItem('No Status', todosWithoutStatus.length, 'no-status'));
                }

                return rootItems;
            } else if (element instanceof FilterTreeItem) {
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
                const todos = this._getTodosForSection(element.sectionType);
                return todos.map(todo => new TodoTreeItem(todo.title || todo.notes || 'Untitled', todo, false));
            }

            return [];
        } catch (error) {
            return [new TodoTreeItem('Error loading Trello cards', null, true)];
        }
    }
}

class InfoTreeItem extends vscode.TreeItem {
    constructor(label, commandId, icon, args = []) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'trelloInfo';
        this.iconPath = new vscode.ThemeIcon(icon);
        if (commandId) {
            this.command = {
                command: commandId,
                title: label,
                arguments: args
            };
        }
    }
}

module.exports = {
    TodosTreeDataProvider,
    CompletedTodosTreeDataProvider,
    TrelloTodosTreeDataProvider,
    SectionTreeItem,
    TodoTreeItem,
    FilterTreeItem,
    FilterLabelTreeItem
};
