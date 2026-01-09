const vscode = require('vscode');
const path = require('path');

/**
 * Get relative file path from URI
 * @param {vscode.Uri|string} uri - The file URI or path
 * @returns {Promise<string|null>} The relative file path or null if error
 */
async function getRelativeFilePath(uri) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return null;
    }
    
    let filePath;
    if (uri instanceof vscode.Uri) {
        filePath = uri.fsPath;
    } else if (typeof uri === 'string') {
        filePath = uri;
    } else {
        vscode.window.showErrorMessage('Invalid file URI');
        return null;
    }
    
    return path.relative(workspaceFolder.uri.fsPath, filePath);
}

/**
 * Escape HTML to prevent XSS (Node.js version)
 * @param {string} text - The text to escape
 * @returns {string} The escaped HTML string
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = {
    getRelativeFilePath,
    escapeHtml
};
