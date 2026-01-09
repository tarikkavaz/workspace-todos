const vscode = require('vscode');
const path = require('path');

/**
 * Get the webview HTML content
 */
function getWebviewContent(webview, extensionUri) {
    const editIconUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'edit-icon.svg')
    );
    const completeIconUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'complete-icon.svg')
    );
    const deleteIconUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'delete-icon.svg')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;">
    <title>Workspace Todos</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 16px;
        }

        .btn {
            padding: 6px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
            font-family: var(--vscode-font-family);
        }

        .btn:hover {
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

        .todos-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .todo-item {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .todo-item.completed {
            opacity: 0.6;
        }

        .todo-item.completed .todo-notes {
            text-decoration: line-through;
        }

        .todo-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .todo-notes {
            flex: 1;
            word-wrap: break-word;
            line-height: 1.5;
        }

        .todo-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .action-btn {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-icon-foreground);
            border-radius: 2px;
        }

        .action-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }

        .action-btn svg {
            width: 16px;
            height: 16px;
        }

        .todo-files {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .todo-files-title {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }

        .todo-file {
            font-size: 12px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            padding: 2px 0;
        }

        .todo-file:hover {
            text-decoration: underline;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }

        .modal.active {
            display: flex;
        }

        .modal-content {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 20px;
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }

        .modal-header h2 {
            font-size: 18px;
        }

        .close-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .close-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
            border-radius: 2px;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .form-label {
            display: block;
            margin-bottom: 6px;
            font-size: 13px;
            color: var(--vscode-foreground);
        }

        .form-input,
        .form-textarea {
            width: 100%;
            padding: 6px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
        }

        .form-textarea {
            min-height: 80px;
            resize: vertical;
        }

        .form-input:focus,
        .form-textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .file-selector {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            padding: 8px;
            background-color: var(--vscode-input-background);
        }

        .file-checkbox {
            display: flex;
            align-items: center;
            padding: 4px 0;
        }

        .file-checkbox input {
            margin-right: 8px;
        }

        .file-checkbox label {
            font-size: 12px;
            cursor: pointer;
            flex: 1;
        }

        .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Workspace Todos</h1>
        <button class="btn" id="createBtn">Create TODO</button>
    </div>

    <div class="todos-container" id="todosContainer">
        <div class="empty-state">No TODOs yet. Click "Create TODO" to get started.</div>
    </div>

    <div class="modal" id="todoModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="modalTitle">Create TODO</h2>
                <button class="close-btn" id="closeModal">&times;</button>
            </div>
            <form id="todoForm">
                <input type="hidden" id="todoId" />
                <div class="form-group">
                    <label class="form-label" for="todoNotes">Notes</label>
                    <textarea class="form-textarea" id="todoNotes" required></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Related Files</label>
                    <div class="file-selector" id="fileSelector">
                        <div style="text-align: center; padding: 20px; color: var(--vscode-descriptionForeground);">
                            Loading files...
                        </div>
                    </div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">Cancel</button>
                    <button type="submit" class="btn" id="saveBtn">Save</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let todos = [];
        let workspaceFiles = [];
        let editingTodoId = null;

        // Load initial data
        vscode.postMessage({ command: 'loadTodos' });
        vscode.postMessage({ command: 'getWorkspaceFiles' });

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'todosLoaded':
                    todos = message.todos || [];
                    if (message.error) {
                        renderError(message.error);
                    } else {
                        renderTodos();
                    }
                    break;
                case 'workspaceFilesLoaded':
                    workspaceFiles = message.files || [];
                    renderFileSelector();
                    break;
                case 'todoCreated':
                case 'todoUpdated':
                case 'todoDeleted':
                case 'todoToggled':
                    // Reload todos after any mutation
                    vscode.postMessage({ command: 'loadTodos' });
                    break;
            }
        });

        // Create TODO button
        document.getElementById('createBtn').addEventListener('click', () => {
            editingTodoId = null;
            document.getElementById('todoId').value = '';
            document.getElementById('todoNotes').value = '';
            document.getElementById('modalTitle').textContent = 'Create TODO';
            document.getElementById('todoModal').classList.add('active');
            vscode.postMessage({ command: 'getWorkspaceFiles' });
        });

        // Close modal
        document.getElementById('closeModal').addEventListener('click', closeModal);
        document.getElementById('cancelBtn').addEventListener('click', closeModal);

        function closeModal() {
            document.getElementById('todoModal').classList.remove('active');
            editingTodoId = null;
        }

        // Form submission
        document.getElementById('todoForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const notes = document.getElementById('todoNotes').value.trim();
            const selectedFiles = Array.from(document.querySelectorAll('#fileSelector input[type="checkbox"]:checked'))
                .map(cb => cb.value);

            if (editingTodoId) {
                vscode.postMessage({
                    command: 'updateTodo',
                    id: editingTodoId,
                    data: { notes, files: selectedFiles }
                });
            } else {
                vscode.postMessage({
                    command: 'createTodo',
                    data: { notes, files: selectedFiles }
                });
            }
            closeModal();
        });

        // Render error message
        function renderError(errorMessage) {
            const container = document.getElementById('todosContainer');
            container.innerHTML = \`<div class="empty-state" style="color: var(--vscode-errorForeground);">\${escapeHtml(errorMessage)}</div>\`;
        }

        // Render todos
        function renderTodos() {
            const container = document.getElementById('todosContainer');
            if (todos.length === 0) {
                container.innerHTML = '<div class="empty-state">No TODOs yet. Click "Create TODO" to get started.</div>';
                return;
            }

            container.innerHTML = todos.map(todo => {
                const filesHtml = todo.files && todo.files.length > 0
                    ? \`<div class="todo-files">
                        <div class="todo-files-title">Related Files:</div>
                        \${todo.files.map(file => 
                            \`<div class="todo-file" data-file="\${file}">\${file}</div>\`
                        ).join('')}
                    </div>\`
                    : '';

                return \`
                    <div class="todo-item \${todo.completed ? 'completed' : ''}">
                        <div class="todo-header">
                            <div class="todo-notes">\${escapeHtml(todo.notes)}</div>
                            <div class="todo-actions">
                                <button class="action-btn" title="\${todo.completed ? 'Mark as incomplete' : 'Mark as complete'}" data-action="toggle" data-id="\${todo.id}">
                                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                </button>
                                <button class="action-btn" title="Edit" data-action="edit" data-id="\${todo.id}">
                                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M11.5 2.5L13.5 4.5L5.5 12.5H3.5V10.5L11.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                </button>
                                <button class="action-btn" title="Delete" data-action="delete" data-id="\${todo.id}">
                                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        \${filesHtml}
                    </div>
                \`;
            }).join('');

            // Attach event listeners
            container.querySelectorAll('[data-action="toggle"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    vscode.postMessage({
                        command: 'toggleComplete',
                        id: btn.dataset.id
                    });
                });
            });

            container.querySelectorAll('[data-action="edit"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const todo = todos.find(t => t.id === btn.dataset.id);
                    if (todo) {
                        editingTodoId = todo.id;
                        document.getElementById('todoId').value = todo.id;
                        document.getElementById('todoNotes').value = todo.notes;
                        document.getElementById('modalTitle').textContent = 'Edit TODO';
                        document.getElementById('todoModal').classList.add('active');
                        vscode.postMessage({ command: 'getWorkspaceFiles' });
                        // Wait a bit for files to load, then check the boxes
                        setTimeout(() => {
                            todo.files.forEach(file => {
                                const checkbox = document.querySelector(\`#fileSelector input[value="\${file}"]\`);
                                if (checkbox) checkbox.checked = true;
                            });
                        }, 100);
                    }
                });
            });

            container.querySelectorAll('[data-action="delete"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to delete this TODO?')) {
                        vscode.postMessage({
                            command: 'deleteTodo',
                            id: btn.dataset.id
                        });
                    }
                });
            });

            // File click handlers
            container.querySelectorAll('.todo-file').forEach(fileEl => {
                fileEl.addEventListener('click', () => {
                    vscode.postMessage({
                        command: 'openFile',
                        file: fileEl.dataset.file
                    });
                });
            });
        }

        // Render file selector
        function renderFileSelector() {
            const container = document.getElementById('fileSelector');
            if (workspaceFiles.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--vscode-descriptionForeground);">No files found in workspace.</div>';
                return;
            }

            container.innerHTML = workspaceFiles.map(file => \`
                <div class="file-checkbox">
                    <input type="checkbox" id="file-\${file.replace(/[^a-zA-Z0-9]/g, '-')}" value="\${escapeHtml(file)}">
                    <label for="file-\${file.replace(/[^a-zA-Z0-9]/g, '-')}">\${escapeHtml(file)}</label>
                </div>
            \`).join('');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
}

module.exports = {
    getWebviewContent
};
