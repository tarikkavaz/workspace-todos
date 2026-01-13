const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Get the configured todos directory path, defaulting to '.vscode'
 */
function getTodosDirectory() {
    const config = vscode.workspace.getConfiguration('workspaceTodos');
    let directory = config.get('todosDirectory', '.vscode');
    if (!directory || directory.trim() === '') {
        directory = '.vscode';
    }
    // Normalize the path - remove leading/trailing slashes but preserve internal path structure
    directory = directory.trim().replace(/^[\/\\]+|[\/\\]+$/g, '').replace(/\\/g, '/');
    return directory || '.vscode';
}

/**
 * Get the path to the todos.json file
 */
function getTodosFilePath() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    const todosDir = getTodosDirectory();
    const todosFilePath = path.join(todosDir, 'todos.json');
    return path.join(workspaceFolder.uri.fsPath, todosFilePath);
}

/**
 * Ensure the todos directory exists
 */
function ensureTodosDirectory() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    const todosDir = getTodosDirectory();
    const fullPath = path.join(workspaceFolder.uri.fsPath, todosDir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
}

/**
 * Get the section type for a todo (status value or 'no-status' or 'done')
 */
function getTodoSectionType(todo) {
    if (todo.completed === true) {
        return 'done';
    }
    const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
    if (statusLabel) {
        const statusValue = statusLabel.split(':')[1];
        if (statusValue === 'done') {
            return 'done';
        }
        return statusValue;
    }
    return 'no-status';
}

/**
 * Load all TODOs from the file
 */
function loadTodos() {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { todos: [], error: 'No workspace folder open. Please open a folder to use Workspace Todos.' };
        }
        const filePath = getTodosFilePath();
        if (!fs.existsSync(filePath)) {
            return { todos: [] };
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        
        // Migration: Assign order to todos that don't have it
        let needsSave = false;
        if (data.todos && Array.isArray(data.todos)) {
            // Group todos by section to assign order within each section
            const todosBySection = {};
            data.todos.forEach((todo, index) => {
                const sectionType = getTodoSectionType(todo);
                if (!todosBySection[sectionType]) {
                    todosBySection[sectionType] = [];
                }
                todosBySection[sectionType].push({ todo, originalIndex: index });
            });
            
            // Assign order values: preserve existing order if present, otherwise use index
            Object.keys(todosBySection).forEach(sectionType => {
                const sectionTodos = todosBySection[sectionType];
                sectionTodos.forEach(({ todo, originalIndex }) => {
                    if (typeof todo.order !== 'number') {
                        // Assign order based on original index + section offset
                        // Use a base of section index * 10000 to keep sections separate
                        const sectionIndex = Object.keys(todosBySection).indexOf(sectionType);
                        todo.order = sectionIndex * 10000 + originalIndex;
                        needsSave = true;
                    }
                });
            });
            
            if (needsSave) {
                saveTodos(data);
            }
        }
        
        return data;
    } catch (error) {
        return { todos: [], error: error.message };
    }
}

/**
 * Save TODOs to the file
 */
function saveTodos(data) {
    try {
        ensureTodosDirectory();
        const filePath = getTodosFilePath();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        throw error;
    }
}

/**
 * Create a new TODO
 */
function createTodo(data) {
    const todosData = loadTodos();
    
    // Determine section for new todo to assign appropriate order
    const sectionType = data.labels?.find(label => label.startsWith('status:')) 
        ? data.labels.find(label => label.startsWith('status:')).split(':')[1]
        : 'no-status';
    
    // Get max order in this section to append at the end
    const todosInSection = todosData.todos.filter(t => {
        const tSection = getTodoSectionType(t);
        return tSection === sectionType;
    });
    const maxOrder = todosInSection.length > 0 
        ? Math.max(...todosInSection.map(t => t.order || 0))
        : (Object.keys(['backlog', 'planned', 'in-progress', 'blocked', 'review', 'done', 'no-status']).indexOf(sectionType) * 10000) - 1;
    
    const newTodo = {
        id: generateId(),
        title: data.title || '',
        notes: data.notes || '',
        files: data.files || [],
        subtasks: data.subtasks || [],
        labels: data.labels || [],
        completed: false,
        order: maxOrder + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    todosData.todos.push(newTodo);
    saveTodos(todosData);
    return newTodo;
}

/**
 * Update an existing TODO
 */
function updateTodo(id, data) {
    const todosData = loadTodos();
    const todoIndex = todosData.todos.findIndex(t => t.id === id);
    if (todoIndex === -1) {
        throw new Error(`TODO with id ${id} not found`);
    }
    const todo = todosData.todos[todoIndex];
    todosData.todos[todoIndex] = {
        ...todo,
        ...data,
        id: todo.id, // Preserve ID
        createdAt: todo.createdAt, // Preserve creation date
        order: data.order !== undefined ? data.order : todo.order, // Preserve order unless explicitly updated
        updatedAt: new Date().toISOString()
    };
    saveTodos(todosData);
    return todosData.todos[todoIndex];
}

/**
 * Delete a TODO
 */
function deleteTodo(id) {
    const todosData = loadTodos();
    const initialLength = todosData.todos.length;
    todosData.todos = todosData.todos.filter(t => t.id !== id);
    if (todosData.todos.length === initialLength) {
        throw new Error(`TODO with id ${id} not found`);
    }
    saveTodos(todosData);
    return true;
}

/**
 * Toggle completion status of a TODO
 */
function toggleComplete(id) {
    const todosData = loadTodos();
    const todoIndex = todosData.todos.findIndex(t => t.id === id);
    if (todoIndex === -1) {
        throw new Error(`TODO with id ${id} not found`);
    }
    const todo = todosData.todos[todoIndex];
    todo.completed = !todo.completed;
    todo.updatedAt = new Date().toISOString();
    
    // Always add/replace status:done when marking complete
    if (todo.completed) {
        if (!todo.labels) {
            todo.labels = [];
        }
        // Remove any existing status label
        todo.labels = todo.labels.filter(label => !label.startsWith('status:'));
        // Add status:done
        todo.labels.push('status:done');
    } else {
        // When uncompleting, remove ALL status labels (including status:done)
        if (todo.labels) {
            todo.labels = todo.labels.filter(label => !label.startsWith('status:'));
        }
    }
    
    saveTodos(todosData);
    return todosData.todos[todoIndex];
}

/**
 * Generate a unique ID for a TODO
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Get workspace files for file assignment
 */
function getWorkspaceFiles() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return [];
    }
    
    const files = [];
    const workspacePath = workspaceFolder.uri.fsPath;
    
    function walkDir(dir, relativePath = '') {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relPath = path.join(relativePath, entry.name);
                
                // Skip .vscode, node_modules, .git, and other common ignored directories
                if (entry.name.startsWith('.') && entry.name !== '.vscode') {
                    continue;
                }
                if (entry.name === 'node_modules' || entry.name === '.git') {
                    continue;
                }
                
                if (entry.isDirectory()) {
                    walkDir(fullPath, relPath);
                } else if (entry.isFile()) {
                    files.push(relPath);
                }
            }
        } catch (error) {
            // Ignore permission errors
        }
    }
    
    walkDir(workspacePath);
    return files.sort();
}

/**
 * Get the configured markdown export directory path, defaulting to '.vscode'
 */
function getMarkdownExportDirectory() {
    const config = vscode.workspace.getConfiguration('workspaceTodos');
    let directory = config.get('markdownExportPath', '.vscode');
    if (!directory || directory.trim() === '') {
        directory = '.vscode';
    }
    // Normalize the path - remove leading/trailing slashes but preserve internal path structure
    directory = directory.trim().replace(/^[\/\\]+|[\/\\]+$/g, '').replace(/\\/g, '/');
    return directory || '.vscode';
}

/**
 * Ensure the markdown export directory exists
 */
function ensureMarkdownExportDirectory() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    const exportDir = getMarkdownExportDirectory();
    const fullPath = path.join(workspaceFolder.uri.fsPath, exportDir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
}

/**
 * Export all todos to markdown format
 * Format: - [ ] for uncompleted, - [x] for completed
 * Groups active todos by status sections and preserves order
 */
function exportTodosToMarkdown() {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        // Ensure export directory exists
        ensureMarkdownExportDirectory();

        // Load all todos
        const todosData = loadTodos();
        let todos = todosData.todos || [];

        if (!todos || todos.length === 0) {
            throw new Error('No todos found to export');
        }

        // Sort todos by order field to preserve drag-and-drop order
        todos = todos.sort((a, b) => (a.order || 0) - (b.order || 0));

        // Get export path
        const exportDir = getMarkdownExportDirectory();
        const markdownFilePath = path.join(workspaceFolder.uri.fsPath, exportDir, 'todos.md');

        // Generate markdown content
        let markdown = '# To-Do List\n\n';
        markdown += `*Generated on ${new Date().toLocaleString()}*\n\n`;

        // Separate completed and uncompleted todos
        const uncompletedTodos = todos.filter(t => {
            // Exclude todos with status:done or completed: true
            if (t.completed === true) return false;
            const statusLabel = t.labels?.find(label => label.startsWith('status:'));
            if (statusLabel) {
                const statusValue = statusLabel.split(':')[1];
                if (statusValue === 'done') return false;
            }
            return true;
        });
        const completedTodos = todos.filter(t => {
            if (t.completed === true) return true;
            const statusLabel = t.labels?.find(label => label.startsWith('status:'));
            if (statusLabel) {
                const statusValue = statusLabel.split(':')[1];
                if (statusValue === 'done') return true;
            }
            return false;
        });

        // Helper function to format labels with backticks
        const formatLabels = (labels) => {
            return labels.map(label => {
                const [key, ...valueParts] = label.split(':');
                const value = valueParts.join(':'); // Handle values that contain colons
                return `${key}:\`${value}\``;
            }).join(', ');
        };

        // Add uncompleted todos section with status grouping
        if (uncompletedTodos.length > 0) {
            markdown += '## Active Tasks\n\n';

            // Load label config to get status values
            const { loadLabelConfig } = require('./utils');
            const labelConfig = loadLabelConfig();
            const statusValues = labelConfig.categories.status?.values || [];

            // Group todos by status
            const todosByStatus = {};
            const todosWithoutStatus = [];

            uncompletedTodos.forEach(todo => {
                const statusLabel = todo.labels?.find(label => label.startsWith('status:'));
                if (statusLabel) {
                    const statusValue = statusLabel.split(':')[1];
                    if (statusValue !== 'done') {
                        if (!todosByStatus[statusValue]) {
                            todosByStatus[statusValue] = [];
                        }
                        todosByStatus[statusValue].push(todo);
                    }
                } else {
                    todosWithoutStatus.push(todo);
                }
            });

            // Helper function to render a todo
            const renderTodo = (todo) => {
                let todoMarkdown = `- [ ] ${escapeMarkdown(todo.title || todo.notes || 'Untitled')}\n`;
                
                // Add notes if present and different from title
                if (todo.notes && todo.notes.trim() && todo.title && todo.notes !== todo.title) {
                    const notesLines = todo.notes.split('\n');
                    const firstLine = notesLines[0];
                    const remainingLines = notesLines.slice(1);
                    todoMarkdown += `  - ${firstLine}`;
                    if (remainingLines.length > 0) {
                        todoMarkdown += '\n' + remainingLines.map(line => `    ${line}`).join('\n');
                    }
                    todoMarkdown += '\n';
                } else if (todo.notes && todo.notes.trim() && !todo.title) {
                    // If no title, the notes are already in the checkbox line
                }
                
                // Add subtasks if present
                if (todo.subtasks && todo.subtasks.length > 0) {
                    todo.subtasks.forEach(subtask => {
                        const subtaskStatus = subtask.completed ? 'x' : ' ';
                        todoMarkdown += `  - [${subtaskStatus}] ${escapeMarkdown(subtask.text || 'Untitled subtask')}\n`;
                    });
                }
                
                // Add labels if present (excluding status label as it's shown in section header)
                const nonStatusLabels = todo.labels?.filter(label => !label.startsWith('status:')) || [];
                if (nonStatusLabels.length > 0) {
                    todoMarkdown += `  - *Labels*: ${formatLabels(nonStatusLabels)}\n`;
                }
                
                // Add related files if present
                if (todo.files && todo.files.length > 0) {
                    todoMarkdown += `  *Related Files*:\n`;
                    todo.files.forEach(file => {
                        todoMarkdown += `  ${file}\n`;
                    });
                }
                
                todoMarkdown += '\n';
                return todoMarkdown;
            };

            // Add "In Progress" section first if it exists
            if (todosByStatus['in-progress'] && todosByStatus['in-progress'].length > 0) {
                markdown += '### In Progress\n\n';
                todosByStatus['in-progress'].forEach(todo => {
                    markdown += renderTodo(todo);
                });
            }

            // Add other status sections (excluding 'done' and 'in-progress')
            statusValues.forEach(statusValue => {
                if (statusValue === 'done' || statusValue === 'in-progress') {
                    return; // Skip done (in completed section) and in-progress (already added)
                }
                if (todosByStatus[statusValue] && todosByStatus[statusValue].length > 0) {
                    const sectionTitle = statusValue.charAt(0).toUpperCase() + statusValue.slice(1).replace(/-/g, ' ');
                    markdown += `### ${sectionTitle}\n\n`;
                    todosByStatus[statusValue].forEach(todo => {
                        markdown += renderTodo(todo);
                    });
                }
            });

            // Add "No Status" section if there are todos without status
            if (todosWithoutStatus.length > 0) {
                markdown += '### No Status\n\n';
                todosWithoutStatus.forEach(todo => {
                    markdown += renderTodo(todo);
                });
            }
        }

        // Add completed todos section (sorted by order)
        if (completedTodos.length > 0) {
            markdown += '## Completed Tasks\n\n';
            completedTodos.forEach(todo => {
                markdown += `- [x] ${escapeMarkdown(todo.title || todo.notes || 'Untitled')}\n`;
                
                // Add notes if present and different from title
                if (todo.notes && todo.notes.trim() && todo.title && todo.notes !== todo.title) {
                    const notesLines = todo.notes.split('\n');
                    const firstLine = notesLines[0];
                    const remainingLines = notesLines.slice(1);
                    markdown += `  - ${firstLine}`;
                    if (remainingLines.length > 0) {
                        markdown += '\n' + remainingLines.map(line => `    ${line}`).join('\n');
                    }
                    markdown += '\n';
                }
                
                // Add subtasks if present
                if (todo.subtasks && todo.subtasks.length > 0) {
                    todo.subtasks.forEach(subtask => {
                        const subtaskStatus = subtask.completed ? 'x' : ' ';
                        markdown += `  - [${subtaskStatus}] ${escapeMarkdown(subtask.text || 'Untitled subtask')}\n`;
                    });
                }
                
                // Add labels if present (excluding status:done as it's implied)
                const nonStatusLabels = todo.labels?.filter(label => label !== 'status:done') || [];
                if (nonStatusLabels.length > 0) {
                    markdown += `  - *Labels*: ${formatLabels(nonStatusLabels)}\n`;
                }
                
                // Add related files if present
                if (todo.files && todo.files.length > 0) {
                    markdown += `  *Related Files*:\n`;
                    todo.files.forEach(file => {
                        markdown += `  ${file}\n`;
                    });
                }
                
                markdown += '\n';
            });
        }

        // Write to file
        fs.writeFileSync(markdownFilePath, markdown, 'utf8');

        return {
            success: true,
            path: path.join(exportDir, 'todos.md'),
            totalTodos: todos.length,
            completed: completedTodos.length,
            uncompleted: uncompletedTodos.length
        };
    } catch (error) {
        throw error;
    }
}

/**
 * Get todos by section type
 */
function getTodosBySection(sectionType) {
    const todosData = loadTodos();
    const todos = todosData.todos || [];
    return todos.filter(todo => getTodoSectionType(todo) === sectionType);
}

/**
 * Reorder todos within a section or move between sections
 * @param {string[]} todoIds - Array of todo IDs to reorder
 * @param {number} targetIndex - Target index within the section
 * @param {string} targetSection - Target section type (status value, 'no-status', or 'done')
 * @param {string} sourceSection - Source section type (if moving between sections)
 */
function reorderTodos(todoIds, targetIndex, targetSection, sourceSection = null) {
    const todosData = loadTodos();
    const todos = todosData.todos || [];
    
    // Get the todos being moved
    const todosToMove = todoIds.map(id => todos.find(t => t.id === id)).filter(Boolean);
    if (todosToMove.length === 0) {
        return;
    }
    
    // Remove todos from their current positions
    todosData.todos = todos.filter(t => !todoIds.includes(t.id));
    
    // Get todos in target section (excluding the ones being moved)
    const targetSectionTodos = todosData.todos
        .filter(t => getTodoSectionType(t) === targetSection)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    
    // Update status labels if moving between sections
    if (sourceSection && sourceSection !== targetSection) {
        todosToMove.forEach(todo => {
            // Remove old status label
            if (todo.labels) {
                todo.labels = todo.labels.filter(label => !label.startsWith('status:'));
            } else {
                todo.labels = [];
            }
            
            // Add new status label (unless target is 'no-status')
            if (targetSection !== 'no-status' && targetSection !== 'done') {
                todo.labels.push(`status:${targetSection}`);
            }
            
            // Handle 'done' section specially
            if (targetSection === 'done') {
                todo.completed = true;
                if (!todo.labels.includes('status:done')) {
                    todo.labels.push('status:done');
                }
            } else if (sourceSection === 'done') {
                // Moving out of done section
                todo.completed = false;
            }
            
            todo.updatedAt = new Date().toISOString();
        });
    }
    
    // Calculate new order values
    // Insert moved todos at targetIndex
    const beforeTodos = targetSectionTodos.slice(0, targetIndex);
    const afterTodos = targetSectionTodos.slice(targetIndex);
    
    // Assign order values: use section base + sequential index
    const sectionBase = ['backlog', 'planned', 'in-progress', 'blocked', 'review', 'no-status', 'done'].indexOf(targetSection) * 10000;
    if (sectionBase < 0) {
        // Unknown section, use a default
        const defaultBase = 100000;
        beforeTodos.forEach((todo, idx) => {
            todo.order = defaultBase + idx;
        });
        todosToMove.forEach((todo, idx) => {
            todo.order = defaultBase + beforeTodos.length + idx;
        });
        afterTodos.forEach((todo, idx) => {
            todo.order = defaultBase + beforeTodos.length + todosToMove.length + idx;
        });
    } else {
        beforeTodos.forEach((todo, idx) => {
            todo.order = sectionBase + idx;
        });
        todosToMove.forEach((todo, idx) => {
            todo.order = sectionBase + beforeTodos.length + idx;
        });
        afterTodos.forEach((todo, idx) => {
            todo.order = sectionBase + beforeTodos.length + todosToMove.length + idx;
        });
    }
    
    // Reconstruct the todos array with new order
    const otherTodos = todosData.todos.filter(t => getTodoSectionType(t) !== targetSection);
    const newTargetSectionTodos = [...beforeTodos, ...todosToMove, ...afterTodos];
    
    // Combine all todos and sort by order
    todosData.todos = [...otherTodos, ...newTargetSectionTodos].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    saveTodos(todosData);
    return todosData.todos;
}

/**
 * Escape markdown special characters for checkbox line (only escape what breaks the format)
 * This is used only for the title in checkbox format: - [ ] title
 */
function escapeMarkdown(text) {
    if (!text) return '';
    // For checkbox line, replace newlines with spaces and escape brackets that would break the format
    return text
        .replace(/\n/g, ' ') // Replace newlines with spaces for single line display
        .replace(/\[/g, '\\[') // Escape opening bracket to prevent breaking checkbox format
        .replace(/\]/g, '\\]'); // Escape closing bracket to prevent breaking checkbox format
}

module.exports = {
    loadTodos,
    saveTodos,
    createTodo,
    updateTodo,
    deleteTodo,
    toggleComplete,
    getWorkspaceFiles,
    exportTodosToMarkdown,
    getTodoSectionType,
    getTodosBySection,
    reorderTodos
};
