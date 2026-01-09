const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const TODOS_FILE = '.vscode/todos.json';

/**
 * Get the path to the todos.json file
 */
function getTodosFilePath() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    return path.join(workspaceFolder.uri.fsPath, TODOS_FILE);
}

/**
 * Ensure the .vscode directory exists
 */
function ensureVscodeDir() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
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
        console.error('Error loading todos:', error);
        return { todos: [], error: error.message };
    }
}

/**
 * Save TODOs to the file
 */
function saveTodos(data) {
    try {
        ensureVscodeDir();
        const filePath = getTodosFilePath();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving todos:', error);
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
    todosData.todos[todoIndex].completed = !todosData.todos[todoIndex].completed;
    todosData.todos[todoIndex].updatedAt = new Date().toISOString();
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

module.exports = {
    loadTodos,
    saveTodos,
    createTodo,
    updateTodo,
    deleteTodo,
    toggleComplete,
    getWorkspaceFiles
};
