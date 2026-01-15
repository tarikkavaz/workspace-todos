# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.5

### Added
- **Default Status Setting**: New configuration option `workspaceTodos.defaultStatus` to set a default status for newly created To-Do's
  - When configured, new To-Do's automatically get the specified status label if none is selected
  - The default status is pre-selected in the editor when creating a new To-Do
  - Leave empty to keep the previous behavior (no status by default)
  - Example: Set to `"backlog"` to have all new To-Do's start in the Backlog section

## 1.0.4

### Added
- **Drag-and-Drop Sorting**: Reorder todos by dragging them in the sidebar
  - Drag todos within the same status section to reorder
  - Drag todos between different status sections to move and automatically update status
  - Sort order is persisted to `todos.json` and maintained across VS Code sessions
  - Works in both "To-do's" and "Completed" sections
  - Automatic status label updates when moving todos between sections
- **Order Persistence**: Todos now include an `order` field that preserves your custom sort order
  - Existing todos automatically get order values assigned on first load
  - New todos are added at the end of their section by default
- **Enhanced Markdown Export**: Export now respects sort order and groups by status
  - Active todos exported with status-based sections (### In Progress, ### Planned, etc.)
  - Todos maintain their custom order within each section
  - Completed todos section maintains sort order

### Changed
- **Markdown Export Format**: Improved structure with status-based grouping
  - Active tasks section now includes subsections for each status (In Progress, Planned, etc.)
  - Status labels excluded from individual todo labels in export (shown in section headers)
  - Export preserves the exact order you've set via drag-and-drop

## 1.0.3

### Added
- **Label System**: Comprehensive label system for organizing todos
  - Five default categories: Priority, Type, Quality/Concern Area, Status, and Scope
  - Custom categories support through settings
  - Ability to hide default categories or specific labels
  - Radio button selection (one value per category)
  - Labels displayed as badges in the editor and sidebar
- **Split Sidebar**: Resizable sidebar split into two sections
  - **To-do's** section: Active todos grouped by status (In Progress, Backlog, Planned, etc.)
  - **Completed** section: All completed/done todos in a separate resizable area
  - Independent filter systems for both sections
- **Filter System**: Label-based filtering in both sidebar sections
  - Filter todos by selecting labels from the filter panel
  - Visual indicators for selected filters
  - Clear filters option
  - Filter labels exclude "done" status from default view
- **Editor Persistence**: Open todo editors persist across workspace restarts
  - Editors automatically reopen when workspace is loaded
  - State is saved in workspace storage
- **Smart Editor Focus**: Clicking a todo in sidebar focuses existing editor instead of creating duplicate
  - Prevents multiple editors for the same todo
  - Automatically reveals and focuses the existing editor panel

### Changed
- **Label Selection UI**: Changed from checkboxes to radio buttons for one-per-category selection
  - Radio buttons grouped by category ensure only one selection per category
  - Status category appears first in dropdown and badge list
  - Clearer visual indication of single-selection behavior
- **Status Organization**: Sidebar organized by status labels instead of simple Active/Completed
  - "In Progress" section appears first
  - Other status sections follow (Backlog, Planned, etc.)
  - "No Status" section for todos without status labels
  - Completed todos moved to separate "Completed" section
- **Editor Tab Icon**: Todo editor tab shows checkmark icon instead of default
  - Light and dark theme variants for proper visibility
- **Sidebar Label Display**: Labels removed from next to title, only shown in tooltip
  - Cleaner sidebar appearance
  - File count and completion status shown as description
- **Uncomplete Behavior**: Marking as uncomplete now removes ALL status labels
  - Ensures "done" status is fully removed when uncompleting
  - Uncomplete and removing done status are now equivalent

### Fixed
- **Label Selection Bug**: Fixed issue where multiple labels could be selected per category
- **Sidebar Refresh**: Sidebar now automatically refreshes when labels are changed in editor
- **Monaco Editor**: Fixed template literal syntax issue in label selection code
- **Editor Icon**: Fixed editor tab icon not displaying (now uses light/dark theme variants)

## 1.0.2

### Added
- **Keyboard Shortcuts for To-Do Editor**: Configurable keyboard shortcuts for common editor actions
  - `Ctrl+S` / `Cmd+S`: Save the current To-Do (when editor is open)
  - `Ctrl+Enter` / `Cmd+Enter`: Mark To-Do as Complete/Uncompleted (when editor is open)
  - `Ctrl+Delete` / `Cmd+Delete`: Delete the current To-Do (when editor is open)
  - `Ctrl+Alt+N` / `Control+Cmd+N`: Create a new To-Do (available globally)
  - All shortcuts are user-configurable through VS Code's Keyboard Shortcuts UI
  - Shortcuts activate when the To-Do editor webview is active (except Create New To-Do)
- **Auto-Save Feature**: Saving of todo changes to prevent data loss
  - Changes are saved after 500ms of inactivity (debounced)
  - Periodic saves every 5 seconds ensure changes are preserved
  - Immediate save when switching to another file/tab
  - Visual indicator shows "Saving..." and "Saved" status in the editor header
  - Manual Save button remains available for explicit user control

### Changed
- **Completion Toggle in Editor**: Improved completion toggle functionality in the todo editor
  - Button text dynamically shows "Mark as Complete" or "Mark as Uncompleted" based on current status
  - Editor remains open after toggling completion status (no longer closes automatically)
  - Success messages accurately reflect whether a todo was completed or uncompleted
- **Editor State Persistence**: Improved editor state management when switching tabs
  - Editor refreshes with latest saved state when switching back to the todo editor
  - Webview context is preserved when hidden to ensure reliable message handling
  - Changes are saved before the editor is hidden to prevent data loss

## 1.0.1

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
