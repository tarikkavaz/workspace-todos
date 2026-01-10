# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-01-10

### Added
- **Monaco Editor Integration**: Added script to copy Monaco Editor files during build process
  - Created `scripts/copy-monaco.js` to handle Monaco Editor file copying
  - Added `copy-monaco` npm script
  - Added postinstall and prepackage hooks to automatically copy Monaco files
- **Export to Markdown Feature**: Added comprehensive markdown export functionality
  - New command `workspaceTodos.exportToMarkdown` to export todos to markdown format
  - Configuration option `workspaceTodos.markdownExportPath` for custom export directory (default: `.vscode`)
  - Export creates `todos.md` file with formatted todo list including related files
  - Markdown export button added to view title menu
- **Custom Todos Directory Configuration**: Added support for configurable todos storage location
  - New configuration option `workspaceTodos.todosDirectory` to specify where `todos.json` is saved (default: `.vscode`)
  - Refactored `todoManager.js` to support dynamic directory paths

### Changed
- **Version Update**: Bumped version to 1.0.1 in `package.json`
- **UI Improvements**: Adjusted font size in todo editor webview for improved consistency
- **Markdown Export Format**: Refactored markdown export to list related files individually for better readability
- **Export Filename**: Changed markdown export filename from `todo.md` to `todos.md` for consistency
- **Activation Process**: Removed activation message from extension startup to streamline the process

### Updated
- Updated `.gitignore` to include Monaco Editor files and other build artifacts
- Updated paths in `todoEditor.js` to reflect new file structure with Monaco Editor

### Technical Details
- Added `monaco-editor` as a dependency (version ^0.45.0)
- Enhanced `todoManager.js` with markdown export functionality (152+ lines added/modified)
- Improved error handling and directory creation for export functionality
