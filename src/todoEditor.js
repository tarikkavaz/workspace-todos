const vscode = require('vscode');
const path = require('path');
const todoManager = require('./todoManager');
const { escapeHtml } = require('./utils');

function createTodoWebviewPanel(context, todo, onSaveCallback, initialFiles = [], initialText = '') {
    // Use a mutable reference to the current todo so we can update it after creation
    let currentTodo = todo;
    
    // Set panel title based on todo
    let panelTitle = 'Create To-Do';
    if (currentTodo) {
        const todoTitle = currentTodo.title || currentTodo.notes || 'Untitled';
        panelTitle = todoTitle.length > 30 ? todoTitle.substring(0, 30) + '...' : todoTitle;
    }
    
    const panel = vscode.window.createWebviewPanel(
        'workspaceTodoEditor',
        panelTitle,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: false,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media'),
                vscode.Uri.joinPath(context.extensionUri, 'node_modules')
            ]
        }
    );

    panel.webview.html = getTodoEditorWebviewContent(panel.webview, context.extensionUri, currentTodo, initialFiles, initialText);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'save':
                    try {
                        if (currentTodo) {
                            // Update existing - keep panel open and refresh the todo data
                            const updatedTodo = todoManager.updateTodo(currentTodo.id, {
                                title: message.title || '',
                                notes: message.notes || '',
                                files: message.files || [],
                                subtasks: message.subtasks || []
                            });
                            // Update the current todo reference
                            currentTodo = updatedTodo;
                            vscode.window.showInformationMessage('To-Do updated successfully');
                            if (onSaveCallback) {
                                onSaveCallback();
                            }
                            // Update the panel title in case title changed
                            const newTitle = updatedTodo.title || updatedTodo.notes || 'Untitled';
                            panel.title = newTitle.length > 30 ? newTitle.substring(0, 30) + '...' : newTitle;
                            // Keep panel open - don't dispose
                        } else {
                            // Create new - keep panel open and switch to edit mode
                            const newTodo = todoManager.createTodo({
                                title: message.title || '',
                                notes: message.notes || '',
                                files: message.files || [],
                                subtasks: message.subtasks || []
                            });
                            // Update the current todo reference so future saves will update instead of create
                            currentTodo = newTodo;
                            vscode.window.showInformationMessage('To-Do created successfully');
                            if (onSaveCallback) {
                                onSaveCallback();
                            }
                            // Update panel to show the newly created todo in edit mode
                            const newTitle = newTodo.title || newTodo.notes || 'Untitled';
                            panel.title = newTitle.length > 30 ? newTitle.substring(0, 30) + '...' : newTitle;
                            // Reload webview content with the newly created todo
                            panel.webview.html = getTodoEditorWebviewContent(panel.webview, context.extensionUri, newTodo, [], '');
                            // Keep panel open - don't dispose
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Error saving TODO: ${error.message}`);
                    }
                    break;
                case 'cancel':
                    panel.dispose();
                    break;
                case 'autoSave':
                    try {
                        if (currentTodo) {
                            // Update existing - silent auto-save without notifications
                            const updatedTodo = todoManager.updateTodo(currentTodo.id, {
                                title: message.title || '',
                                notes: message.notes || '',
                                files: message.files || [],
                                subtasks: message.subtasks || []
                            });
                            // Update the current todo reference
                            currentTodo = updatedTodo;
                            if (onSaveCallback) {
                                onSaveCallback();
                            }
                            // Update the panel title in case title changed
                            const newTitle = updatedTodo.title || updatedTodo.notes || 'Untitled';
                            panel.title = newTitle.length > 30 ? newTitle.substring(0, 30) + '...' : newTitle;
                            // Send success response back to webview
                            panel.webview.postMessage({
                                command: 'autoSaveComplete',
                                success: true
                            });
                        }
                    } catch (error) {
                        // Send error response back to webview
                        panel.webview.postMessage({
                            command: 'autoSaveComplete',
                            success: false,
                            error: error.message
                        });
                    }
                    break;
                case 'addFile':
                    {
                        try {
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                            if (!workspaceFolder) {
                                vscode.window.showErrorMessage('No workspace folder found');
                                return;
                            }
                            
                            // Show file picker
                            const fileUris = await vscode.window.showOpenDialog({
                                canSelectFiles: true,
                                canSelectFolders: false,
                                canSelectMany: true,
                                openLabel: 'Select Files',
                                defaultUri: workspaceFolder.uri
                            });
                            
                            if (fileUris && fileUris.length > 0) {
                                // Convert all selected files to relative paths
                                const relativePaths = fileUris.map(uri => {
                                    return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                                });
                                
                                // Send all selected files back to webview
                                panel.webview.postMessage({
                                    command: 'filesAdded',
                                    files: relativePaths
                                });
                            }
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error selecting file: ${error.message}`);
                        }
                    }
                    break;
                case 'openFile':
                    {
                        try {
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                            if (!workspaceFolder) {
                                vscode.window.showErrorMessage('No workspace folder found');
                                return;
                            }
                            const filePath = path.join(workspaceFolder.uri.fsPath, message.file);
                            const document = await vscode.workspace.openTextDocument(filePath);
                            await vscode.window.showTextDocument(document);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error opening file: ${error.message}`);
                        }
                    }
                    break;
                case 'requestMarkComplete':
                    {
                        try {
                            const updatedTodo = todoManager.toggleComplete(message.id);
                            if (onSaveCallback) {
                                onSaveCallback();
                            }
                            vscode.window.showInformationMessage('To-Do marked as complete');
                            panel.dispose();
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error marking To-Do as complete: ${error.message}`);
                        }
                    }
                    break;
                case 'markCompleteFromEditor':
                    {
                        try {
                            console.log('[WorkspaceTodos Extension] markCompleteFromEditor received');
                            console.log('[WorkspaceTodos Extension] Full message:', JSON.stringify(message));
                            console.log('[WorkspaceTodos Extension] message.id:', message.id);
                            if (!message.id) {
                                console.error('[WorkspaceTodos Extension] No id in message!');
                                vscode.window.showErrorMessage('Error: No todo ID provided');
                                return;
                            }
                            const updatedTodo = todoManager.toggleComplete(message.id);
                            console.log('[WorkspaceTodos Extension] Todo toggled, new status:', updatedTodo ? updatedTodo.completed : 'null');
                            if (onSaveCallback) {
                                console.log('[WorkspaceTodos Extension] Calling onSaveCallback (refreshTree)');
                                onSaveCallback();
                            }
                            vscode.window.showInformationMessage('To-Do marked as complete');
                            panel.dispose();
                        } catch (error) {
                            console.error('[WorkspaceTodos Extension] Error marking To-Do as complete:', error);
                            console.error('[WorkspaceTodos Extension] Error stack:', error.stack);
                            vscode.window.showErrorMessage(`Error marking To-Do as complete: ${error.message}`);
                        }
                    }
                    break;
                case 'requestDelete':
                    {
                        try {
                            // Load todo to get title for confirmation
                            const todosData = todoManager.loadTodos();
                            const todos = todosData.todos || [];
                            const todo = todos.find(t => t.id === message.id);
                            
                            if (!todo) {
                                vscode.window.showErrorMessage('To-Do not found');
                                return;
                            }
                            
                            const displayText = todo.title || todo.notes || 'Untitled';
                            const shortText = displayText.length > 50 ? displayText.substring(0, 50) + '...' : displayText;
                            
                            vscode.window.showWarningMessage(
                                `Are you sure you want to delete "${shortText}"? This action cannot be undone.`,
                                'Delete',
                                'Cancel'
                            ).then(selection => {
                                if (selection === 'Delete') {
                                    try {
                                        todoManager.deleteTodo(message.id);
                                        if (onSaveCallback) {
                                            onSaveCallback();
                                        }
                                        vscode.window.showInformationMessage('To-Do deleted');
                                        panel.dispose();
                                    } catch (error) {
                                        vscode.window.showErrorMessage(`Error deleting To-Do: ${error.message}`);
                                    }
                                }
                            });
                        } catch (error) {
                            vscode.window.showErrorMessage(`Error: ${error.message}`);
                        }
                    }
                    break;
                case 'deleteFromEditor':
                    {
                        try {
                            console.log('[WorkspaceTodos Extension] deleteFromEditor received, id:', message.id);
                            todoManager.deleteTodo(message.id);
                            console.log('[WorkspaceTodos Extension] Todo deleted');
                            if (onSaveCallback) {
                                console.log('[WorkspaceTodos Extension] Calling onSaveCallback (refreshTree)');
                                onSaveCallback();
                            }
                            vscode.window.showInformationMessage('To-Do deleted');
                            panel.dispose();
                        } catch (error) {
                            console.error('[WorkspaceTodos Extension] Error deleting To-Do:', error);
                            vscode.window.showErrorMessage(`Error deleting To-Do: ${error.message}`);
                        }
                    }
                    break;
                default:
                    console.log('[WorkspaceTodos Extension] Received unknown message command:', message.command, 'Full message:', JSON.stringify(message));
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
}

/**
 * Get webview HTML content for TODO editor
 */
function getTodoEditorWebviewContent(webview, extensionUri, todo, initialFiles = [], initialText = '') {
    const title = todo ? (todo.title || '') : '';
    const notes = todo ? (todo.notes || '') : (initialText || '');
    const selectedFiles = todo ? (todo.files || []) : initialFiles;
    const subtasks = todo ? (todo.subtasks || []) : [];
    
    // Get Monaco editor URIs
    const monacoLoaderUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'monaco-editor', 'min', 'vs', 'loader.js')
    );
    const monacoBaseUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'monaco-editor', 'min', 'vs')
    );
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; img-src ${webview.cspSource} data:;">
    <title>${todo ? 'Edit' : 'Create'} To-Do</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }
        .form-group { 
            margin-bottom: 24px; 
        }
        .form-group-divider {
            border-top: 1px solid var(--vscode-panel-border);
            margin-top: 24px;
            padding-top: 24px;
        }
        .form-label {
            display: block;
            margin-bottom: 6px;
            font-size: 13px;
            font-weight: 600;
        }
        .form-input {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
        }
        .form-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        .monaco-editor-wrapper {
            width: 100%;
            position: relative;
            border: 1px solid var(--vscode-foreground);
            border-radius: 2px;
            background-color: var(--vscode-editor-background);
            box-sizing: border-box;
        }
        .monaco-editor-container {
            width: 100%;
            min-height: 200px;
            height: 200px;
            overflow: hidden;
            display: block;
            box-sizing: border-box;
        }
        .monaco-editor-resize-handle {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 4px;
            cursor: ns-resize;
            background-color: transparent;
            z-index: 10;
            transition: background-color 0.2s;
        }
        .monaco-editor-resize-handle:hover {
            background-color: var(--vscode-focusBorder);
        }
        .monaco-editor-resize-handle:active {
            background-color: var(--vscode-focusBorder);
        }
        .monaco-editor-resize-handle::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 40px;
            height: 3px;
            background-color: var(--vscode-panel-border);
            border-radius: 2px;
            opacity: 0.5;
        }
        .monaco-editor-resize-handle:hover::before,
        .monaco-editor-resize-handle:active::before {
            opacity: 1;
            background-color: var(--vscode-focusBorder);
        }
        .file-list-container {
            margin-top: 8px;
        }
        .file-list {
            list-style: none;
            padding: 0;
            margin: 8px 0 0 0;
        }
        .file-list-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 8px;
            margin-bottom: 4px;
            background-color: var(--vscode-list-inactiveSelectionBackground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            cursor: pointer;
        }
        .file-list-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .file-list-item-name {
            flex: 1;
            font-size: 12px;
            color: var(--vscode-textLink-foreground);
            word-break: break-all;
        }
        .file-list-item-name:hover {
            text-decoration: underline;
        }
        .file-list-item-remove {
            background: none;
            border: none;
            color: var(--vscode-errorForeground);
            cursor: pointer;
            padding: 2px 6px;
            font-size: 16px;
            line-height: 1;
            margin-left: 8px;
        }
        .file-list-item-remove:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
            border-radius: 2px;
        }
        .add-file-btn {
            margin-top: 8px;
        }
        .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 20px;
        }
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
            font-family: var(--vscode-font-family);
        }
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background-color: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-button-border);
        }
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        h1 {
            margin-bottom: 20px;
        }
        .editor-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .editor-header h1 {
            margin: 0;
            flex: 1;
        }
        .editor-header-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .auto-save-indicator {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 2px 8px;
            border-radius: 2px;
            transition: opacity 0.2s;
        }
        .auto-save-indicator.saving {
            color: var(--vscode-textLink-foreground);
        }
        .auto-save-indicator.saved {
            color: var(--vscode-descriptionForeground);
        }
        .auto-save-indicator.error {
            color: var(--vscode-errorForeground);
        }
        .editor-header-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .editor-header-left {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .form-actions-bottom {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 20px;
        }
        .btn-danger {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-errorForeground);
            border: 1px solid var(--vscode-errorForeground);
        }
        .btn-danger:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .btn-success {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-button-border);
        }
        .btn-success:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .subtasks-container {
            margin-top: 8px;
        }
        .subtask-input-group {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        .subtask-input-group input[type="text"] {
            flex: 1;
        }
        .subtasks-list {
            list-style: none;
            padding: 0;
            margin: 8px 0 0 0;
        }
        .subtask-item {
            display: flex;
            align-items: center;
            padding: 6px 8px;
            margin-bottom: 4px;
            background-color: var(--vscode-list-inactiveSelectionBackground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        .subtask-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .subtask-checkbox {
            margin-right: 8px;
            cursor: pointer;
        }
        .subtask-text {
            flex: 1;
            font-size: 13px;
            cursor: pointer;
        }
        .subtask-text.completed {
            text-decoration: line-through;
            opacity: 0.7;
        }
        .subtask-remove {
            background: none;
            border: none;
            color: var(--vscode-errorForeground);
            cursor: pointer;
            padding: 2px 6px;
            font-size: 16px;
            line-height: 1;
            margin-left: 8px;
        }
        .subtask-remove:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <div class="editor-header">
        <h1>${todo ? 'Edit' : 'Create'} To-Do</h1>
        <div class="editor-header-right">
            ${todo ? '<span class="auto-save-indicator" id="autoSaveIndicator"></span>' : ''}
            <div class="editor-header-left">
                ${todo ? '<button type="button" class="btn btn-success" id="markCompleteBtn">Mark as Complete</button>' : ''}
                <button type="button" class="btn btn-primary" id="saveBtn">Save</button>
            </div>
        </div>
    </div>
    <form id="todoForm">
        <div class="form-group">
            <label class="form-label" for="todoTitle">Title</label>
            <input type="text" class="form-input" id="todoTitle" value="${escapeHtml(title)}" required placeholder="Enter To-Do title">
        </div>
        <div class="form-group">
            <label class="form-label" for="todoNotes">Notes</label>
            <div class="monaco-editor-wrapper" id="notesEditorWrapper">
                <div class="monaco-editor-container" id="notesEditorContainer"></div>
                <div class="monaco-editor-resize-handle" id="notesEditorResizeHandle"></div>
            </div>
            <input type="hidden" id="todoNotes" value="${escapeHtml(notes)}">
        </div>
        <div class="form-group form-group-divider">
            <label class="form-label">Subtasks</label>
            <div class="subtask-input-group">
                <input type="text" class="form-input" id="newSubtaskInput" placeholder="Enter subtask...">
                <button type="button" class="btn btn-secondary" id="addSubtaskBtn">Add</button>
            </div>
            <div class="subtasks-container">
                <ul class="subtasks-list" id="subtasksList">
                    ${subtasks.length === 0 
                        ? '<li style="padding: 12px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No subtasks</li>'
                        : subtasks.map((subtask, index) => `
                            <li class="subtask-item" data-index="${index}">
                                <input type="checkbox" class="subtask-checkbox" ${subtask.completed ? 'checked' : ''} data-index="${index}">
                                <span class="subtask-text ${subtask.completed ? 'completed' : ''}">${escapeHtml(subtask.text || '')}</span>
                                <button type="button" class="subtask-remove" data-index="${index}" title="Remove subtask">×</button>
                            </li>
                        `).join('')
                    }
                </ul>
            </div>
        </div>
        <div class="form-group form-group-divider">
            <label class="form-label">Related Files</label>
            <button type="button" class="btn btn-secondary add-file-btn" id="addFileBtn">+ Add File</button>
            <div class="file-list-container">
                <ul class="file-list" id="fileList">
                    ${selectedFiles.length === 0 
                        ? '<li style="padding: 12px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No files assigned</li>'
                        : selectedFiles.map(file => `
                            <li class="file-list-item" data-file="${escapeHtml(file)}">
                                <span class="file-list-item-name">${escapeHtml(file)}</span>
                                <button type="button" class="file-list-item-remove" data-file="${escapeHtml(file)}" title="Remove file">×</button>
                            </li>
                        `).join('')
                    }
                </ul>
            </div>
        </div>
        ${todo ? '<div class="form-actions-bottom"><button type="button" class="btn btn-danger" id="deleteBtn">Delete</button></div>' : ''}
    </form>
    <script>
        const vscode = acquireVsCodeApi();
        let selectedFiles = ${JSON.stringify(selectedFiles)};
        let subtasks = ${JSON.stringify(subtasks)};
        let notesEditor = null;
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;
        const isEditMode = ${todo && todo.id ? 'true' : 'false'};
        const todoId = ${todo && todo.id ? JSON.stringify(todo.id) : null};
        const todoTitle = ${todo ? JSON.stringify(todo.title || todo.notes || 'Untitled') : null};
        
        // Auto-save state tracking
        let hasChanges = false;
        let saveInProgress = false;
        let lastSavedState = null;
        let debounceTimer = null;
        let periodicSaveInterval = null;
        const DEBOUNCE_DELAY = 2000; // 2 seconds
        const PERIODIC_SAVE_INTERVAL = 10000; // 10 seconds
        
        // Initialize last saved state
        if (isEditMode && todoId) {
            lastSavedState = JSON.stringify({
                title: document.getElementById('todoTitle').value.trim(),
                notes: document.getElementById('todoNotes').value.trim(),
                files: selectedFiles.slice().sort(),
                subtasks: JSON.parse(JSON.stringify(subtasks))
            });
        }
        
        // Load saved editor height from localStorage
        const STORAGE_KEY = 'workspaceTodos.editorHeight';
        const savedHeight = localStorage.getItem(STORAGE_KEY);
        const defaultHeight = savedHeight ? parseInt(savedHeight, 10) : 200;
        
        console.log('[WorkspaceTodos] Editor initialized. isEditMode:', isEditMode, 'todoId:', todoId, 'todoTitle:', todoTitle, 'typeof todoId:', typeof todoId);
        
        // Load Monaco Editor from local package
        (function() {
            const monacoLoaderUri = ${JSON.stringify(monacoLoaderUri.toString())};
            const monacoBaseUri = ${JSON.stringify(monacoBaseUri.toString())};
            
            const script = document.createElement('script');
            script.src = monacoLoaderUri;
            
            script.onerror = function(error) {
                console.error('[WorkspaceTodos] Monaco failed to load, using fallback textarea');
                const container = document.getElementById('notesEditorContainer');
                const wrapper = document.getElementById('notesEditorWrapper');
                const hiddenInput = document.getElementById('todoNotes');
                if (container && hiddenInput && wrapper) {
                    const textarea = document.createElement('textarea');
                    textarea.className = 'form-textarea';
                    textarea.id = 'todoNotesTextarea';
                    textarea.placeholder = 'Enter additional notes (optional)';
                    textarea.value = hiddenInput.value || '';
                    textarea.style.width = '100%';
                    textarea.style.minHeight = '200px';
                    textarea.style.height = defaultHeight + 'px';
                    textarea.style.padding = '8px';
                    textarea.style.backgroundColor = 'var(--vscode-input-background)';
                    textarea.style.color = 'var(--vscode-input-foreground)';
                    textarea.style.border = '1px solid var(--vscode-input-border)';
                    textarea.style.borderRadius = '2px';
                    textarea.style.fontFamily = 'var(--vscode-font-family)';
                    textarea.style.fontSize = '13px';
                    textarea.style.resize = 'vertical';
                    wrapper.replaceChild(textarea, container);
                    // Remove resize handle if Monaco fails
                    const resizeHandle = document.getElementById('notesEditorResizeHandle');
                    if (resizeHandle) {
                        resizeHandle.remove();
                    }
                    hiddenInput.value = textarea.value;
                    textarea.addEventListener('input', () => {
                        hiddenInput.value = textarea.value;
                        // Trigger auto-save on notes change
                        markChange();
                    });
                    // Save height when textarea is resized
                    textarea.addEventListener('mouseup', () => {
                        localStorage.setItem(STORAGE_KEY, textarea.offsetHeight.toString());
                    });
                }
            };
            
            script.onload = function() {
                require.config({ paths: { vs: monacoBaseUri } });
                require(['vs/editor/editor.main'], function () {
                    const container = document.getElementById('notesEditorContainer');
                    const wrapper = document.getElementById('notesEditorWrapper');
                    if (!container || !wrapper) return;
                    
                    // Set initial height from saved value
                    container.style.height = defaultHeight + 'px';
                    
                    const hiddenInput = document.getElementById('todoNotes');
                    const initialValue = hiddenInput ? (hiddenInput.value || '') : '';
                    
                    // Function to get CSS variable value with fallback
                    function getCSSVariable(name, fallback) {
                        const styles = getComputedStyle(document.body);
                        const value = styles.getPropertyValue(name).trim();
                        return value || fallback;
                    }
                    
                    // Function to convert hex/rgb color to hex format for Monaco
                    // Monaco Editor requires hex colors without alpha for token colors
                    function normalizeColor(color, allowAlpha) {
                        if (!color) return undefined;
                        // Remove whitespace
                        color = color.trim();
                        // If it's already a hex color
                        if (color.startsWith('#')) {
                            // Handle short hex (#fff -> #ffffff)
                            if (color.length === 4) {
                                return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
                            }
                            // Handle hex with alpha (#ffffffaa) - strip alpha if not allowed
                            if (color.length === 9 && !allowAlpha) {
                                return color.substring(0, 7);
                            }
                            return color;
                        }
                        // If it's rgb/rgba, convert to hex (strip alpha for token colors)
                        const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
                        if (rgbMatch) {
                            const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
                            const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
                            const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
                            return '#' + r + g + b;
                        }
                        // If it's a named color or other format, try to use it as-is
                        // but Monaco might reject it, so return undefined for safety
                        return undefined;
                    }
                    
                    // Create VS Code theme for Monaco Editor
                    function createVSCodeTheme() {
                        const styles = getComputedStyle(document.body);
                        const isDark = document.body.classList.contains('vscode-dark') || 
                                     document.body.classList.contains('vscode-high-contrast');
                        
                        // Get VS Code colors
                        // For editor colors, we can allow alpha in some cases (like backgrounds with transparency)
                        const editorBg = normalizeColor(getCSSVariable('--vscode-editor-background', isDark ? '#1e1e1e' : '#ffffff'), true);
                        const editorFg = normalizeColor(getCSSVariable('--vscode-editor-foreground', isDark ? '#d4d4d4' : '#000000'), false);
                        const selectionBg = normalizeColor(getCSSVariable('--vscode-editor-selectionBackground', isDark ? '#264f78' : '#add6ff'), true);
                        const selectionInactiveBg = normalizeColor(getCSSVariable('--vscode-editor-inactiveSelectionBackground', isDark ? '#3a3d41' : '#e5ebf1'), true);
                        const lineHighlightBg = normalizeColor(getCSSVariable('--vscode-editor-lineHighlightBackground', isDark ? '#2a2d2e' : '#f0f0f0'), true);
                        const lineNumberFg = normalizeColor(getCSSVariable('--vscode-editorLineNumber-foreground', isDark ? '#858585' : '#237893'), false);
                        const cursorColor = normalizeColor(getCSSVariable('--vscode-editorCursor-foreground') || editorFg, false);
                        const findMatchBg = normalizeColor(getCSSVariable('--vscode-editor-findMatchBackground', isDark ? '#515c6a' : '#a8ac94'), true);
                        const findMatchHighlightBg = normalizeColor(getCSSVariable('--vscode-editor-findMatchHighlightBackground', isDark ? '#ea5c0055' : '#ea5c0040'), true);
                        const hoverHighlightBg = normalizeColor(getCSSVariable('--vscode-editor-hoverHighlightBackground', isDark ? '#264f7840' : '#add6ff26'), true);
                        const wordHighlightBg = normalizeColor(getCSSVariable('--vscode-editor-wordHighlightBackground', isDark ? '#575757b8' : '#575757b8'), true);
                        const wordHighlightStrongBg = normalizeColor(getCSSVariable('--vscode-editor-wordHighlightStrongBackground', isDark ? '#004972b8' : '#0e639c50'), true);
                        const rangeHighlightBg = normalizeColor(getCSSVariable('--vscode-editor-rangeHighlightBackground', isDark ? '#ffffff0b' : '#fdff0033'), true);
                        const linkFg = normalizeColor(getCSSVariable('--vscode-textLink-foreground', isDark ? '#4ec9b0' : '#0066bf'), false);
                        const linkActiveFg = normalizeColor(getCSSVariable('--vscode-textLink-activeForeground', isDark ? '#4fc1ff' : '#005299'), false);
                        const errorFg = normalizeColor(getCSSVariable('--vscode-errorForeground', isDark ? '#f48771' : '#a1260d'), false);
                        const warningFg = normalizeColor(getCSSVariable('--vscode-warningForeground', isDark ? '#cca700' : '#bf8803'), false);
                        const infoFg = normalizeColor(getCSSVariable('--vscode-descriptionForeground', isDark ? '#cccccc' : '#6a737d'), false);
                        const borderColor = normalizeColor(getCSSVariable('--vscode-panel-border', isDark ? '#3c3c3c' : '#e8e8e8'), false);
                        const scrollbarShadow = normalizeColor(getCSSVariable('--vscode-scrollbar-shadow', isDark ? '#000000' : '#dddddd'), true);
                        const scrollbarSliderBg = normalizeColor(getCSSVariable('--vscode-scrollbarSlider-background', isDark ? '#79797966' : '#64646433'), true);
                        const scrollbarSliderHoverBg = normalizeColor(getCSSVariable('--vscode-scrollbarSlider-hoverBackground', isDark ? '#646464b3' : '#64646466'), true);
                        const scrollbarSliderActiveBg = normalizeColor(getCSSVariable('--vscode-scrollbarSlider-activeBackground', isDark ? '#bfbfbf66' : '#64646499'), true);
                        
                        // Token colors for markdown syntax highlighting
                        // Use normalizeColor without alpha for token colors (Monaco doesn't support alpha in tokens)
                        const commentFg = normalizeColor(getCSSVariable('--vscode-textBlockQuote-background', isDark ? '#6a9955' : '#6a737d'), false);
                        const stringFg = normalizeColor(getCSSVariable('--vscode-symbolIcon-stringForeground', isDark ? '#ce9178' : '#032f62'), false);
                        const keywordFg = normalizeColor(getCSSVariable('--vscode-symbolIcon-keywordForeground', isDark ? '#c586c0' : '#0033b3'), false);
                        const numberFg = normalizeColor(getCSSVariable('--vscode-symbolIcon-numberForeground', isDark ? '#b5cea8' : '#098658'), false);
                        
                        // Build rules array, filtering out undefined colors
                        const rules = [];
                        if (editorFg) rules.push({ token: '', foreground: editorFg, background: editorBg });
                        if (commentFg) rules.push({ token: 'comment', foreground: commentFg });
                        if (stringFg) rules.push({ token: 'string', foreground: stringFg });
                        if (keywordFg) rules.push({ token: 'keyword', foreground: keywordFg });
                        if (numberFg) rules.push({ token: 'number', foreground: numberFg });
                        if (editorFg) {
                            rules.push({ token: 'markup.heading', foreground: editorFg, fontStyle: 'bold' });
                            rules.push({ token: 'markup.bold', foreground: editorFg, fontStyle: 'bold' });
                            rules.push({ token: 'markup.italic', foreground: editorFg, fontStyle: 'italic' });
                            rules.push({ token: 'markup.strikethrough', foreground: editorFg, fontStyle: 'strikethrough' });
                            rules.push({ token: 'markup.list', foreground: editorFg });
                        }
                        if (stringFg) rules.push({ token: 'markup.code', foreground: stringFg });
                        if (linkFg) rules.push({ token: 'markup.link', foreground: linkFg });
                        
                        const theme = {
                            base: isDark ? 'vs-dark' : 'vs',
                            inherit: true,
                            rules: rules,
                            colors: (function() {
                                const colors = {};
                                // Only add colors that are defined (not undefined)
                                if (editorBg) colors['editor.background'] = editorBg;
                                if (editorFg) colors['editor.foreground'] = editorFg;
                                if (selectionBg) colors['editor.selectionBackground'] = selectionBg;
                                if (selectionInactiveBg) colors['editor.inactiveSelectionBackground'] = selectionInactiveBg;
                                if (lineHighlightBg) colors['editor.lineHighlightBackground'] = lineHighlightBg;
                                if (cursorColor) colors['editorCursor.foreground'] = cursorColor;
                                const whitespaceFg = normalizeColor(getCSSVariable('--vscode-editorWhitespace-foreground', isDark ? '#3b3a32' : '#bfcbd1'), false);
                                if (whitespaceFg) colors['editorWhitespace.foreground'] = whitespaceFg;
                                const indentGuideBg = normalizeColor(getCSSVariable('--vscode-editorIndentGuide-activeBackground', isDark ? '#707070' : '#d3d3d3'), false);
                                if (indentGuideBg) colors['editorIndentGuide.background'] = indentGuideBg;
                                const indentGuideActiveBg = normalizeColor(getCSSVariable('--vscode-editorIndentGuide-activeBackground', isDark ? '#c5c5c5' : '#939393'), false);
                                if (indentGuideActiveBg) colors['editorIndentGuide.activeBackground'] = indentGuideActiveBg;
                                if (lineNumberFg) colors['editorLineNumber.foreground'] = lineNumberFg;
                                const lineNumberActiveFg = normalizeColor(getCSSVariable('--vscode-editorLineNumber-activeForeground') || editorFg, false);
                                if (lineNumberActiveFg) colors['editorLineNumber.activeForeground'] = lineNumberActiveFg;
                                if (findMatchBg) colors['editor.findMatchBackground'] = findMatchBg;
                                if (findMatchHighlightBg) colors['editor.findMatchHighlightBackground'] = findMatchHighlightBg;
                                if (hoverHighlightBg) colors['editor.hoverHighlightBackground'] = hoverHighlightBg;
                                if (wordHighlightBg) colors['editor.wordHighlightBackground'] = wordHighlightBg;
                                if (wordHighlightStrongBg) colors['editor.wordHighlightStrongBackground'] = wordHighlightStrongBg;
                                if (rangeHighlightBg) colors['editor.rangeHighlightBackground'] = rangeHighlightBg;
                                const bracketMatchBg = normalizeColor(getCSSVariable('--vscode-editorBracketMatch-background', isDark ? '#0064001a' : '#0064001a'), true);
                                if (bracketMatchBg) colors['editorBracketMatch.background'] = bracketMatchBg;
                                const bracketMatchBorder = normalizeColor(getCSSVariable('--vscode-editorBracketMatch-border', isDark ? '#888888' : '#b9b9b9'), false);
                                if (bracketMatchBorder) colors['editorBracketMatch.border'] = bracketMatchBorder;
                                if (editorBg) colors['editorGutter.background'] = editorBg;
                                const gutterModifiedBg = normalizeColor(getCSSVariable('--vscode-editorGutter-modifiedBackground', isDark ? '#1b81a8' : '#2090d3'), false);
                                if (gutterModifiedBg) colors['editorGutter.modifiedBackground'] = gutterModifiedBg;
                                const gutterAddedBg = normalizeColor(getCSSVariable('--vscode-editorGutter-addedBackground', isDark ? '#487e02' : '#629755'), false);
                                if (gutterAddedBg) colors['editorGutter.addedBackground'] = gutterAddedBg;
                                const gutterDeletedBg = normalizeColor(getCSSVariable('--vscode-editorGutter-deletedBackground', isDark ? '#f14c4c' : '#c33'), false);
                                if (gutterDeletedBg) colors['editorGutter.deletedBackground'] = gutterDeletedBg;
                                if (scrollbarShadow) colors['scrollbar.shadow'] = scrollbarShadow;
                                if (scrollbarSliderBg) colors['scrollbarSlider.background'] = scrollbarSliderBg;
                                if (scrollbarSliderHoverBg) colors['scrollbarSlider.hoverBackground'] = scrollbarSliderHoverBg;
                                if (scrollbarSliderActiveBg) colors['scrollbarSlider.activeBackground'] = scrollbarSliderActiveBg;
                                const widgetBg = normalizeColor(getCSSVariable('--vscode-editorWidget-background', isDark ? '#252526' : '#f3f3f3'), true);
                                if (widgetBg) colors['editorWidget.background'] = widgetBg;
                                if (borderColor) colors['editorWidget.border'] = borderColor;
                                const suggestWidgetBg = normalizeColor(getCSSVariable('--vscode-editorSuggestWidget-background', isDark ? '#252526' : '#f3f3f3'), true);
                                if (suggestWidgetBg) colors['editorSuggestWidget.background'] = suggestWidgetBg;
                                if (borderColor) colors['editorSuggestWidget.border'] = borderColor;
                                if (editorFg) colors['editorSuggestWidget.foreground'] = editorFg;
                                const suggestSelectedBg = normalizeColor(getCSSVariable('--vscode-list-activeSelectionBackground', isDark ? '#094771' : '#0078d4'), true);
                                if (suggestSelectedBg) colors['editorSuggestWidget.selectedBackground'] = suggestSelectedBg;
                                const suggestHighlightFg = normalizeColor(getCSSVariable('--vscode-textLink-foreground') || linkFg, false);
                                if (suggestHighlightFg) colors['editorSuggestWidget.highlightForeground'] = suggestHighlightFg;
                                const peekViewBorder = normalizeColor(getCSSVariable('--vscode-peekView-border', isDark ? '#007acc' : '#007acc'), false);
                                if (peekViewBorder) colors['peekView.border'] = peekViewBorder;
                                const peekViewEditorBg = normalizeColor(getCSSVariable('--vscode-peekViewEditor-background', isDark ? '#001f33' : '#f2f8fc'), true);
                                if (peekViewEditorBg) colors['peekViewEditor.background'] = peekViewEditorBg;
                                const peekViewResultBg = normalizeColor(getCSSVariable('--vscode-peekViewResult-background', isDark ? '#252526' : '#f3f3f3'), true);
                                if (peekViewResultBg) colors['peekViewResult.background'] = peekViewResultBg;
                                if (suggestSelectedBg) colors['peekViewResult.selectionBackground'] = suggestSelectedBg;
                                const diffInsertedBg = normalizeColor(getCSSVariable('--vscode-diffEditor-insertedTextBackground', isDark ? '#9bb95533' : '#9bb9551a'), true);
                                if (diffInsertedBg) colors['diffEditor.insertedTextBackground'] = diffInsertedBg;
                                const diffRemovedBg = normalizeColor(getCSSVariable('--vscode-diffEditor-removedTextBackground', isDark ? '#ff000033' : '#ff00001a'), true);
                                if (diffRemovedBg) colors['diffEditor.removedTextBackground'] = diffRemovedBg;
                                const diffInsertedBorder = normalizeColor(getCSSVariable('--vscode-diffEditor-insertedTextBorder', isDark ? '#9bb955' : '#9bb955'), false);
                                if (diffInsertedBorder) colors['diffEditor.insertedTextBorder'] = diffInsertedBorder;
                                const diffRemovedBorder = normalizeColor(getCSSVariable('--vscode-diffEditor-removedTextBorder', isDark ? '#ff0000' : '#ff0000'), false);
                                if (diffRemovedBorder) colors['diffEditor.removedTextBorder'] = diffRemovedBorder;
                                return colors;
                            })()
                        };
                        
                        monaco.editor.defineTheme('vscode-theme', theme);
                    }
                    
                    // Create and apply VS Code theme
                    createVSCodeTheme();
                    
                    notesEditor = monaco.editor.create(container, {
                        value: initialValue,
                        language: 'markdown',
                        theme: 'vscode-theme',
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        lineNumbers: 'off',
                        wordWrap: 'on',
                        automaticLayout: true,
                        padding: { top: 8, bottom: 8 },
                        scrollbar: {
                            vertical: 'auto',
                            horizontal: 'auto'
                        },
                        contextmenu: true,
                        quickSuggestions: false,
                        suggestOnTriggerCharacters: false
                    });
                    
                    // Function to update theme when VS Code theme changes
                    function updateTheme() {
                        try {
                            createVSCodeTheme();
                            if (notesEditor) {
                                monaco.editor.setTheme('vscode-theme');
                            }
                        } catch (error) {
                            console.error('[WorkspaceTodos] Error updating theme:', error);
                        }
                    }
                    
                    // Watch for theme changes
                    // 1. Watch for body class changes (vscode-dark, vscode-light, etc.)
                    const bodyObserver = new MutationObserver(function(mutations) {
                        mutations.forEach(function(mutation) {
                            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                                updateTheme();
                            }
                        });
                    });
                    bodyObserver.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class']
                    });
                    
                    // 2. Periodically check if CSS variables have changed
                    // Store last known values to detect changes
                    let lastThemeValues = {
                        background: getCSSVariable('--vscode-editor-background'),
                        foreground: getCSSVariable('--vscode-editor-foreground'),
                        isDark: document.body.classList.contains('vscode-dark') || 
                                document.body.classList.contains('vscode-high-contrast')
                    };
                    
                    function checkThemeChanges() {
                        const currentBackground = getCSSVariable('--vscode-editor-background');
                        const currentForeground = getCSSVariable('--vscode-editor-foreground');
                        const currentIsDark = document.body.classList.contains('vscode-dark') || 
                                            document.body.classList.contains('vscode-high-contrast');
                        
                        if (currentBackground !== lastThemeValues.background ||
                            currentForeground !== lastThemeValues.foreground ||
                            currentIsDark !== lastThemeValues.isDark) {
                            lastThemeValues = {
                                background: currentBackground,
                                foreground: currentForeground,
                                isDark: currentIsDark
                            };
                            updateTheme();
                        }
                    }
                    
                    // Check for theme changes every 500ms
                    const themeCheckInterval = setInterval(checkThemeChanges, 500);
                    
                    // Clean up on page unload
                    window.addEventListener('beforeunload', function() {
                        bodyObserver.disconnect();
                        clearInterval(themeCheckInterval);
                    });
                    
                    notesEditor.onDidChangeModelContent(() => {
                        const value = notesEditor.getValue();
                        if (hiddenInput) {
                            hiddenInput.value = value;
                        }
                        // Trigger auto-save on notes change
                        markChange();
                    });
                    
                    // Initialize layout
                    setTimeout(() => {
                        if (notesEditor) {
                            notesEditor.layout();
                        }
                    }, 100);
                    
                    // Setup resize handle
                    const resizeHandle = document.getElementById('notesEditorResizeHandle');
                    if (resizeHandle) {
                        resizeHandle.addEventListener('mousedown', function(e) {
                            isResizing = true;
                            startY = e.clientY;
                            startHeight = container.offsetHeight;
                            e.preventDefault();
                            e.stopPropagation();
                            
                            document.addEventListener('mousemove', handleResize);
                            document.addEventListener('mouseup', stopResize);
                            
                            // Prevent text selection during resize
                            document.body.style.userSelect = 'none';
                            document.body.style.cursor = 'ns-resize';
                        });
                    }
                    
                    function handleResize(e) {
                        if (!isResizing) return;
                        
                        const deltaY = e.clientY - startY;
                        const newHeight = Math.max(200, startHeight + deltaY); // Min height 200px
                        
                        container.style.height = newHeight + 'px';
                        
                        // Update Monaco editor layout
                        if (notesEditor) {
                            notesEditor.layout();
                        }
                    }
                    
                    function stopResize() {
                        if (!isResizing) return;
                        
                        isResizing = false;
                        
                        // Save height to localStorage
                        const currentHeight = container.offsetHeight;
                        localStorage.setItem(STORAGE_KEY, currentHeight.toString());
                        
                        // Update Monaco editor layout one more time
                        if (notesEditor) {
                            notesEditor.layout();
                        }
                        
                        // Cleanup
                        document.removeEventListener('mousemove', handleResize);
                        document.removeEventListener('mouseup', stopResize);
                        document.body.style.userSelect = '';
                        document.body.style.cursor = '';
                    }
                });
            };
            
            document.head.appendChild(script);
        })();
        
        function renderFileList() {
            const fileList = document.getElementById('fileList');
            if (selectedFiles.length === 0) {
                fileList.innerHTML = '<li style="padding: 12px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No files assigned</li>';
            } else {
                fileList.innerHTML = selectedFiles.map(file => {
                    const escapedFile = file.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    return \`
                        <li class="file-list-item" data-file="\${escapedFile}">
                            <span class="file-list-item-name">\${escapedFile}</span>
                            <button type="button" class="file-list-item-remove" data-file="\${escapedFile}" title="Remove file">×</button>
                        </li>
                    \`;
                }).join('');
                
                // Attach click handlers for file items
                fileList.querySelectorAll('.file-list-item-name').forEach(item => {
                    item.addEventListener('click', (e) => {
                        const file = e.target.closest('.file-list-item').dataset.file;
                        vscode.postMessage({
                            command: 'openFile',
                            file: file
                        });
                    });
                });
                
                // Attach remove handlers
                fileList.querySelectorAll('.file-list-item-remove').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const file = btn.dataset.file;
                        selectedFiles = selectedFiles.filter(f => f !== file);
                        renderFileList();
                    });
                });
            }
        }
        
        document.getElementById('addFileBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'addFile' });
        });
        
        // Listen for file added message
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'fileAdded' && message.file) {
                // Single file (backward compatibility)
                if (!selectedFiles.includes(message.file)) {
                    selectedFiles.push(message.file);
                    renderFileList();
                }
            } else if (message.command === 'filesAdded' && message.files && Array.isArray(message.files)) {
                // Multiple files
                message.files.forEach(file => {
                    if (!selectedFiles.includes(file)) {
                        selectedFiles.push(file);
                    }
                });
                renderFileList();
            }
        });
        
        function renderSubtasks() {
            const subtasksList = document.getElementById('subtasksList');
            if (subtasks.length === 0) {
                subtasksList.innerHTML = '<li style="padding: 12px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No subtasks</li>';
            } else {
                subtasksList.innerHTML = subtasks.map((subtask, index) => {
                    const escapedText = (subtask.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    return \`
                        <li class="subtask-item" data-index="\${index}">
                            <input type="checkbox" class="subtask-checkbox" \${subtask.completed ? 'checked' : ''} data-index="\${index}">
                            <span class="subtask-text \${subtask.completed ? 'completed' : ''}">\${escapedText}</span>
                            <button type="button" class="subtask-remove" data-index="\${index}" title="Remove subtask">×</button>
                        </li>
                    \`;
                }).join('');
                
                // Attach checkbox handlers
                subtasksList.querySelectorAll('.subtask-checkbox').forEach(checkbox => {
                    checkbox.addEventListener('change', (e) => {
                        const index = parseInt(e.target.dataset.index);
                        subtasks[index].completed = e.target.checked;
                        renderSubtasks();
                    });
                });
                
                // Attach remove handlers
                subtasksList.querySelectorAll('.subtask-remove').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const index = parseInt(e.target.dataset.index);
                        subtasks.splice(index, 1);
                        renderSubtasks();
                    });
                });
            }
        }
        
        document.getElementById('addSubtaskBtn').addEventListener('click', () => {
            const input = document.getElementById('newSubtaskInput');
            const text = input.value.trim();
            if (text) {
                subtasks.push({ text: text, completed: false });
                input.value = '';
                renderSubtasks();
            }
        });
        
        document.getElementById('newSubtaskInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('addSubtaskBtn').click();
            }
        });
        
        // Initial render
        renderSubtasks();
        
        // Wrap renderFileList and renderSubtasks to track changes for auto-save
        const originalRenderFileList = renderFileList;
        renderFileList = function() {
            originalRenderFileList();
            markChange();
        };
        
        const originalRenderSubtasks = renderSubtasks;
        renderSubtasks = function() {
            originalRenderSubtasks();
            markChange();
        };
        
        // Auto-save functions
        function updateSaveIndicator(status) {
            const indicator = document.getElementById('autoSaveIndicator');
            if (!indicator) return;
            
            indicator.className = 'auto-save-indicator';
            switch (status) {
                case 'saving':
                    indicator.textContent = 'Saving...';
                    indicator.classList.add('saving');
                    break;
                case 'saved':
                    indicator.textContent = 'Saved';
                    indicator.classList.add('saved');
                    setTimeout(() => {
                        if (indicator && !hasChanges) {
                            indicator.textContent = '';
                            indicator.className = 'auto-save-indicator';
                        }
                    }, 2000);
                    break;
                case 'error':
                    indicator.textContent = 'Save failed';
                    indicator.classList.add('error');
                    setTimeout(() => {
                        if (indicator) {
                            indicator.textContent = '';
                            indicator.className = 'auto-save-indicator';
                        }
                    }, 3000);
                    break;
                default:
                    indicator.textContent = '';
                    indicator.className = 'auto-save-indicator';
            }
        }
        
        function getCurrentState() {
            const title = document.getElementById('todoTitle').value.trim();
            const notes = notesEditor ? notesEditor.getValue().trim() : document.getElementById('todoNotes').value.trim();
            return {
                title: title,
                notes: notes,
                files: selectedFiles.slice().sort(),
                subtasks: JSON.parse(JSON.stringify(subtasks))
            };
        }
        
        function hasStateChanged() {
            if (!isEditMode || !todoId) return false;
            const currentState = JSON.stringify(getCurrentState());
            return currentState !== lastSavedState;
        }
        
        function performAutoSave() {
            if (!isEditMode || !todoId || saveInProgress) {
                return;
            }
            
            if (!hasStateChanged()) {
                hasChanges = false;
                return;
            }
            
            saveInProgress = true;
            hasChanges = true;
            updateSaveIndicator('saving');
            
            const currentState = getCurrentState();
            vscode.postMessage({
                command: 'autoSave',
                id: todoId,
                title: currentState.title,
                notes: currentState.notes,
                files: currentState.files,
                subtasks: currentState.subtasks
            });
        }
        
        function markChange() {
            if (!isEditMode || !todoId) return;
            
            hasChanges = true;
            
            // Clear existing debounce timer
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            
            // Set new debounce timer
            debounceTimer = setTimeout(() => {
                performAutoSave();
            }, DEBOUNCE_DELAY);
        }
        
        function startPeriodicSave() {
            if (!isEditMode || !todoId) return;
            
            // Clear existing interval
            if (periodicSaveInterval) {
                clearInterval(periodicSaveInterval);
            }
            
            // Start periodic save
            periodicSaveInterval = setInterval(() => {
                if (hasChanges && !saveInProgress) {
                    performAutoSave();
                }
            }, PERIODIC_SAVE_INTERVAL);
        }
        
        function stopAutoSave() {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }
            if (periodicSaveInterval) {
                clearInterval(periodicSaveInterval);
                periodicSaveInterval = null;
            }
        }
        
        // Listen for auto-save completion
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'autoSaveComplete') {
                saveInProgress = false;
                if (message.success) {
                    const currentState = getCurrentState();
                    lastSavedState = JSON.stringify(currentState);
                    hasChanges = false;
                    updateSaveIndicator('saved');
                } else {
                    updateSaveIndicator('error');
                }
            }
        });
        
        // Start periodic save if in edit mode
        if (isEditMode && todoId) {
            startPeriodicSave();
        }
        
        function handleSave() {
            // Stop auto-save timers on manual save
            stopAutoSave();
            const title = document.getElementById('todoTitle').value.trim();
            const notes = notesEditor ? notesEditor.getValue().trim() : document.getElementById('todoNotes').value.trim();
            vscode.postMessage({
                command: 'save',
                title: title,
                notes: notes,
                files: selectedFiles,
                subtasks: subtasks
            });
            // Update last saved state after manual save
            if (isEditMode && todoId) {
                const currentState = getCurrentState();
                lastSavedState = JSON.stringify(currentState);
                hasChanges = false;
                updateSaveIndicator('');
            }
        }
        
        document.getElementById('todoForm').addEventListener('submit', (e) => {
            e.preventDefault();
            handleSave();
        });
        
        // Handle save button click (in header)
        document.getElementById('saveBtn').addEventListener('click', (e) => {
            e.preventDefault();
            handleSave();
        });
        
        // Add event listeners for auto-save
        // Title input
        const titleInput = document.getElementById('todoTitle');
        if (titleInput) {
            titleInput.addEventListener('input', markChange);
        }
        
        // Initialize header action buttons (only when editing)
        // Use a small delay to ensure DOM is fully ready
        setTimeout(function() {
            console.log('[WorkspaceTodos] Setting up header buttons. isEditMode:', isEditMode, 'todoId:', todoId, 'typeof todoId:', typeof todoId);
            
            if (isEditMode && todoId) {
                const markCompleteBtn = document.getElementById('markCompleteBtn');
                const deleteBtn = document.getElementById('deleteBtn');
                
                console.log('[WorkspaceTodos] Buttons found - markCompleteBtn:', !!markCompleteBtn, 'deleteBtn:', !!deleteBtn);
                
                if (markCompleteBtn) {
                    markCompleteBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[WorkspaceTodos] Mark complete clicked, todoId:', todoId);
                        // Send request to extension to show confirmation dialog
                        vscode.postMessage({
                            command: 'requestMarkComplete',
                            id: todoId
                        });
                        return false;
                    });
                    console.log('[WorkspaceTodos] Mark complete listener attached');
                } else {
                    console.warn('[WorkspaceTodos] markCompleteBtn not found in DOM');
                }
                
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[WorkspaceTodos] Delete clicked, todoId:', todoId);
                        // Send request to extension to show confirmation dialog
                        vscode.postMessage({
                            command: 'requestDelete',
                            id: todoId
                        });
                        return false;
                    });
                    console.log('[WorkspaceTodos] Delete listener attached');
                } else {
                    console.warn('[WorkspaceTodos] deleteBtn not found in DOM');
                }
            } else {
                console.log('[WorkspaceTodos] Not in edit mode or no todoId. isEditMode:', isEditMode, 'todoId:', todoId);
            }
        }, 100);
        
        // Initial render
        renderFileList();
    </script>
</body>
</html>`;
}

module.exports = {
    createTodoWebviewPanel,
    getTodoEditorWebviewContent
};
