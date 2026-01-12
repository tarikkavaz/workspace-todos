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
        return JSON.parse(content);
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
    const newTodo = {
        id: generateId(),
        title: data.title || '',
        notes: data.notes || '',
        files: data.files || [],
        subtasks: data.subtasks || [],
        labels: data.labels || [],
        completed: false,
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
        const todos = todosData.todos || [];

        if (!todos || todos.length === 0) {
            throw new Error('No todos found to export');
        }

        // Get export path
        const exportDir = getMarkdownExportDirectory();
        const markdownFilePath = path.join(workspaceFolder.uri.fsPath, exportDir, 'todos.md');

        // Generate markdown content
        let markdown = '# To-Do List\n\n';
        markdown += `*Generated on ${new Date().toLocaleString()}*\n\n`;

        // Separate completed and uncompleted todos
        const uncompletedTodos = todos.filter(t => !t.completed);
        const completedTodos = todos.filter(t => t.completed);

        // Add uncompleted todos section
        if (uncompletedTodos.length > 0) {
            markdown += '## Active Tasks\n\n';
            uncompletedTodos.forEach(todo => {
                markdown += `- [ ] ${escapeMarkdown(todo.title || todo.notes || 'Untitled')}\n`;
                
                // Add notes if present and different from title
                if (todo.notes && todo.notes.trim() && todo.title && todo.notes !== todo.title) {
                    markdown += `  ${todo.notes.split('\n').join('\n  ')}\n`;
                } else if (todo.notes && todo.notes.trim() && !todo.title) {
                    // If no title, the notes are already in the checkbox line
                }
                
                // Add subtasks if present
                if (todo.subtasks && todo.subtasks.length > 0) {
                    todo.subtasks.forEach(subtask => {
                        const subtaskStatus = subtask.completed ? 'x' : ' ';
                        markdown += `  - [${subtaskStatus}] ${escapeMarkdown(subtask.text || 'Untitled subtask')}\n`;
                    });
                }
                
                // Add labels if present
                if (todo.labels && todo.labels.length > 0) {
                    markdown += `  *Labels*: ${todo.labels.join(', ')}\n`;
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

        // Add completed todos section
        if (completedTodos.length > 0) {
            markdown += '## Completed Tasks\n\n';
            completedTodos.forEach(todo => {
                markdown += `- [x] ${escapeMarkdown(todo.title || todo.notes || 'Untitled')}\n`;
                
                // Add notes if present and different from title
                if (todo.notes && todo.notes.trim() && todo.title && todo.notes !== todo.title) {
                    markdown += `  ${todo.notes.split('\n').join('\n  ')}\n`;
                }
                
                // Add subtasks if present
                if (todo.subtasks && todo.subtasks.length > 0) {
                    todo.subtasks.forEach(subtask => {
                        const subtaskStatus = subtask.completed ? 'x' : ' ';
                        markdown += `  - [${subtaskStatus}] ${escapeMarkdown(subtask.text || 'Untitled subtask')}\n`;
                    });
                }
                
                // Add labels if present
                if (todo.labels && todo.labels.length > 0) {
                    markdown += `  *Labels*: ${todo.labels.join(', ')}\n`;
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
    exportTodosToMarkdown
};
