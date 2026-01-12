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

/**
 * Validate hex color format
 * @param {string} color - The color string to validate
 * @returns {boolean} True if valid hex color
 */
function isValidHexColor(color) {
    if (!color || typeof color !== 'string') return false;
    // Remove # if present
    const hex = color.startsWith('#') ? color.substring(1) : color;
    // Check if it's 6 hex digits
    return /^[0-9A-Fa-f]{6}$/.test(hex);
}

/**
 * Get color for a specific label
 * @param {string} label - Label in format "category:value" (e.g., "priority:high")
 * @param {Object} labelConfig - Label configuration object
 * @returns {string|null} Hex color string or null if not found/invalid
 */
function getLabelColor(label, labelConfig) {
    if (!label || !labelConfig) return null;
    
    const [category, value] = label.split(':');
    if (!category || !value) return null;
    
    // Check in categories
    if (labelConfig.categories && labelConfig.categories[category]) {
        const categoryDef = labelConfig.categories[category];
        if (categoryDef.colors && categoryDef.colors[value]) {
            const color = categoryDef.colors[value];
            return isValidHexColor(color) ? (color.startsWith('#') ? color : `#${color}`) : null;
        }
    }
    
    // Check in custom categories
    if (labelConfig.custom && labelConfig.custom[category]) {
        const categoryDef = labelConfig.custom[category];
        if (categoryDef.colors && categoryDef.colors[value]) {
            const color = categoryDef.colors[value];
            return isValidHexColor(color) ? (color.startsWith('#') ? color : `#${color}`) : null;
        }
    }
    
    return null;
}

/**
 * Load and process label configuration from settings
 * @returns {Object} Processed label configuration with available categories and labels
 */
function loadLabelConfig() {
    const config = vscode.workspace.getConfiguration('workspaceTodos');
    const labelConfig = config.get('labels', {});
    
    const categories = labelConfig.categories || {};
    const custom = labelConfig.custom || {};
    const hiddenCategories = labelConfig.hiddenCategories || [];
    const hiddenLabels = labelConfig.hiddenLabels || [];
    
    // Merge categories and custom
    const allCategories = { ...categories, ...custom };
    
    // Filter out hidden categories
    const availableCategories = {};
    for (const [categoryName, categoryDef] of Object.entries(allCategories)) {
        if (hiddenCategories.includes(categoryName)) {
            continue;
        }
        
        const values = categoryDef.values || [];
        const colors = categoryDef.colors || {};
        
        // Filter out hidden labels
        const availableValues = values.filter(value => {
            const labelKey = `${categoryName}:${value}`;
            return !hiddenLabels.includes(labelKey);
        });
        
        if (availableValues.length > 0) {
            availableCategories[categoryName] = {
                values: availableValues,
                colors: colors
            };
        }
    }
    
    return {
        categories: availableCategories,
        hiddenCategories: hiddenCategories,
        hiddenLabels: hiddenLabels,
        custom: custom,
        getColor: (label) => getLabelColor(label, labelConfig)
    };
}

/**
 * Get all available labels organized by category
 * @returns {Object} Object with category names as keys and arrays of label objects as values
 */
function getAvailableLabels() {
    const config = loadLabelConfig();
    const result = {};
    
    for (const [categoryName, categoryDef] of Object.entries(config.categories)) {
        result[categoryName] = (categoryDef.values || []).map(value => ({
            value: value,
            label: `${categoryName}:${value}`,
            displayName: value,
            color: categoryDef.colors && categoryDef.colors[value] 
                ? (isValidHexColor(categoryDef.colors[value]) 
                    ? (categoryDef.colors[value].startsWith('#') ? categoryDef.colors[value] : `#${categoryDef.colors[value]}`)
                    : null)
                : null
        }));
    }
    
    return result;
}

module.exports = {
    getRelativeFilePath,
    escapeHtml,
    loadLabelConfig,
    getAvailableLabels,
    getLabelColor,
    isValidHexColor
};
