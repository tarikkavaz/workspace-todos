const vscode = require('vscode');
const path = require('path');
const todoManager = require('./todoManager');
const { TrelloClient } = require('./trelloClient');

const SECRET_KEY = 'workspaceTodos.trello.apiKey';
const SECRET_TOKEN = 'workspaceTodos.trello.token';

function getWorkspaceSecretSuffix() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return 'global';
    }
    return Buffer.from(workspaceFolder.uri.fsPath).toString('base64');
}

function getWorkspaceSecretKey(baseKey) {
    return `${baseKey}:${getWorkspaceSecretSuffix()}`;
}

function getTrelloConfig() {
    const config = vscode.workspace.getConfiguration('workspaceTodos');
    return {
        enabled: config.get('trello.enabled', false),
        board: config.get('trello.board', ''),
        listMapping: config.get('trello.listMapping', {}),
        labelMapping: config.get('trello.labelMapping', {}),
        assignedUsername: config.get('trello.assignedUsername', ''),
        assignedOnly: config.get('trello.assignedOnly', true),
        syncIntervalMinutes: config.get('trello.syncIntervalMinutes', 0),
        syncLocalTodos: config.get('trello.syncLocalTodos', false)
    };
}

function parseBoardId(boardSetting) {
    if (!boardSetting) return '';
    const trimmed = boardSetting.trim();
    if (trimmed.startsWith('http')) {
        const match = trimmed.match(/trello\.com\/b\/([a-zA-Z0-9]+)/);
        return match ? match[1] : '';
    }
    return trimmed;
}

async function getCredentials(context) {
    const workspaceApiKey = await context.secrets.get(getWorkspaceSecretKey(SECRET_KEY));
    const workspaceToken = await context.secrets.get(getWorkspaceSecretKey(SECRET_TOKEN));

    if (workspaceApiKey || workspaceToken) {
        return { apiKey: workspaceApiKey, token: workspaceToken };
    }

    const apiKey = await context.secrets.get(SECRET_KEY);
    const token = await context.secrets.get(SECRET_TOKEN);
    return { apiKey, token };
}

function getStatusFromLabels(labels) {
    if (!Array.isArray(labels)) return null;
    const statusLabel = labels.find(label => label.startsWith('status:'));
    return statusLabel ? statusLabel.split(':')[1] : null;
}

function ensureStatusLabel(labels, statusValue) {
    const filtered = (labels || []).filter(label => !label.startsWith('status:'));
    if (statusValue) {
        filtered.push(`status:${statusValue}`);
    }
    return filtered;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getNextOrder(todos, sectionType) {
    const todosInSection = todos.filter(todo => todoManager.getTodoSectionType(todo) === sectionType);
    const maxOrder = todosInSection.length > 0
        ? Math.max(...todosInSection.map(todo => todo.order || 0))
        : 0;
    return maxOrder + 1;
}

function normalizeKey(value) {
    return String(value || '').trim().toLowerCase();
}

function buildListMappings(lists, listMapping) {
    const listToStatus = {};
    const mappingEntries = Object.entries(listMapping || {});
    const mappingLookup = {};
    mappingEntries.forEach(([key, value]) => {
        mappingLookup[normalizeKey(key)] = value;
    });

    lists.forEach(list => {
        const direct = mappingLookup[normalizeKey(list.id)] || mappingLookup[normalizeKey(list.name)];
        if (direct) {
            listToStatus[list.id] = direct;
        } else if (normalizeKey(list.name)) {
            listToStatus[list.id] = listToStatus[list.id] || normalizeKey(list.name).replace(/\s+/g, '-');
        }
    });

    return listToStatus;
}

function getListIdForStatus(lists, listToStatus, statusValue) {
    if (!statusValue) return lists[0]?.id || null;
    const normalizedStatus = normalizeKey(statusValue);

    for (const [listId, status] of Object.entries(listToStatus)) {
        if (normalizeKey(status) === normalizedStatus) {
            return listId;
        }
    }

    const fallback = lists.find(list => normalizeKey(list.name).replace(/\s+/g, '-') === normalizedStatus);
    return fallback ? fallback.id : (lists[0]?.id || null);
}

function mapTrelloLabelsToTodo(labels, labelMapping) {
    if (!Array.isArray(labels)) return [];
    const mapping = labelMapping || {};
    return labels
        .map(label => mapping[label.name])
        .filter(Boolean);
}

function buildReverseLabelMapping(labelMapping) {
    const reverse = {};
    Object.entries(labelMapping || {}).forEach(([trelloLabel, todoLabel]) => {
        if (!reverse[todoLabel]) {
            reverse[todoLabel] = trelloLabel;
        }
    });
    return reverse;
}

function filterAssignedOnly(todos, assignedUsername) {
    if (!assignedUsername) return todos;
    return todos.filter(todo => {
        const assignees = todo.trello?.assignees || [];
        return assignees.includes(assignedUsername);
    });
}

function createTrelloSyncManager(context, outputChannel, refreshTree) {
    let isSyncing = false;
    let suppressFileEvents = false;
    let autoSyncTimer = null;
    let debounceTimer = null;
    let fileWatcher = null;

    async function syncNow(reason = 'manual') {
        if (isSyncing) {
            outputChannel.appendLine(`[Trello] Sync skipped (already in progress).`);
            return;
        }

        const config = getTrelloConfig();
        if (!config.enabled) {
            return;
        }

        const boardId = parseBoardId(config.board);
        if (!boardId) {
            vscode.window.showWarningMessage('Trello board is not configured.');
            return;
        }

        const { apiKey, token } = await getCredentials(context);
        if (!apiKey || !token) {
            vscode.window.showWarningMessage('Trello credentials are missing. Use "Trello: Set Credentials".');
            return;
        }

        isSyncing = true;
        outputChannel.appendLine(`[Trello] Sync started (${reason}).`);

        try {
            const client = new TrelloClient({ apiKey, token });
            const [lists, cards, members, labels] = await Promise.all([
                client.getBoardLists(boardId),
                client.getBoardCards(boardId),
                client.getBoardMembers(boardId),
                client.getBoardLabels(boardId)
            ]);

            const openLists = lists.filter(list => !list.closed);
            const listToStatus = buildListMappings(openLists, config.listMapping);
            const memberIdToUsername = {};
            const usernameToMemberId = {};
            members.forEach(member => {
                memberIdToUsername[member.id] = member.username;
                usernameToMemberId[member.username] = member.id;
            });

            const labelNameToId = {};
            labels.forEach(label => {
                if (label.name) {
                    labelNameToId[label.name] = label.id;
                }
            });

            const data = todoManager.loadTodos();
            if (data.error) {
                throw new Error(data.error);
            }

            const todos = data.todos || [];
            const trelloTodosById = new Map();
            todos.forEach(todo => {
                if (todo.trello?.cardId) {
                    trelloTodosById.set(todo.trello.cardId, todo);
                }
            });

            const reverseLabelMapping = buildReverseLabelMapping(config.labelMapping);
            const nowIso = new Date().toISOString();
            let didChangeLocal = false;
            const updatedTodos = [...todos];
            const updatedTodoIds = new Set();
            const excludedCardIds = new Set();

            const cardsById = new Map(cards.map(card => [card.id, card]));

            for (const card of cards) {
                const existingTodo = trelloTodosById.get(card.id);
                const statusValue = listToStatus[card.idList] || null;
                const mappedLabels = mapTrelloLabelsToTodo(card.labels, config.labelMapping);
                const cardAssignees = (card.idMembers || []).map(id => memberIdToUsername[id]).filter(Boolean);
                const cardUpdatedAt = new Date(card.dateLastActivity || 0).getTime();

                const desiredLabels = ensureStatusLabel(mappedLabels, statusValue || (card.closed ? 'done' : null));
                const completed = card.closed || desiredLabels.includes('status:done');

                const shouldIncludeCard = !config.assignedOnly
                    || !config.assignedUsername
                    || cardAssignees.includes(config.assignedUsername);
                if (!shouldIncludeCard) {
                    excludedCardIds.add(card.id);
                    continue;
                }

                if (!existingTodo) {
                    const sectionType = completed ? 'done' : (statusValue || 'no-status');
                    const newTodo = {
                        id: generateId(),
                        title: card.name || '',
                        notes: card.desc || '',
                        files: [],
                        subtasks: [],
                        labels: desiredLabels,
                        completed,
                        order: getNextOrder(updatedTodos, sectionType),
                        createdAt: nowIso,
                        updatedAt: nowIso,
                        trello: {
                            cardId: card.id,
                            listId: card.idList,
                            boardId,
                            cardUrl: card.url,
                            assignees: cardAssignees,
                            lastSyncedAt: nowIso
                        }
                    };
                    updatedTodos.push(newTodo);
                    updatedTodoIds.add(newTodo.id);
                    didChangeLocal = true;
                    continue;
                }

                const lastSyncedAt = existingTodo.trello?.lastSyncedAt;
                const lastSyncedTime = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
                const localUpdated = new Date(existingTodo.updatedAt || 0).getTime();

                const localChanged = localUpdated > lastSyncedTime;
                const cardChanged = cardUpdatedAt > lastSyncedTime;

                if (cardChanged && (!localChanged || cardUpdatedAt >= localUpdated)) {
                    existingTodo.title = card.name || '';
                    existingTodo.notes = card.desc || '';
                    existingTodo.labels = desiredLabels;
                    existingTodo.completed = completed;
                    existingTodo.updatedAt = nowIso;
                    existingTodo.trello = {
                        ...(existingTodo.trello || {}),
                        cardId: card.id,
                        listId: card.idList,
                        boardId,
                        cardUrl: card.url,
                        assignees: cardAssignees,
                        lastSyncedAt: nowIso
                    };
                    updatedTodoIds.add(existingTodo.id);
                    didChangeLocal = true;
                } else if ((existingTodo.trello?.assignees || []).join(',') !== cardAssignees.join(',')) {
                    existingTodo.trello = {
                        ...(existingTodo.trello || {}),
                        assignees: cardAssignees
                    };
                    didChangeLocal = true;
                }
            }

            for (const todo of updatedTodos) {
                if (!todo.trello?.cardId) {
                    continue;
                }
                if (!cardsById.has(todo.trello.cardId)) {
                    outputChannel.appendLine(`[Trello] Card not found for todo ${todo.id}.`);
                }
            }

            let filteredTodos = updatedTodos;
            if (config.assignedOnly && config.assignedUsername) {
                filteredTodos = updatedTodos.filter(todo => {
                    if (!todo.trello?.cardId) {
                        return true;
                    }
                    if (todo.trello.boardId && todo.trello.boardId !== boardId) {
                        return true;
                    }
                    return !excludedCardIds.has(todo.trello.cardId);
                });
                if (filteredTodos.length !== updatedTodos.length) {
                    didChangeLocal = true;
                }
            }

            for (const todo of filteredTodos) {
                const hasTrello = !!todo.trello?.cardId;
                const card = hasTrello ? cardsById.get(todo.trello.cardId) : null;
                const lastSyncedAt = todo.trello?.lastSyncedAt;
                const lastSyncedTime = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
                const localUpdated = new Date(todo.updatedAt || 0).getTime();
                const cardUpdatedAt = card ? new Date(card.dateLastActivity || 0).getTime() : 0;

                if (hasTrello && card) {
                    const localChanged = localUpdated > lastSyncedTime;
                    const cardChanged = cardUpdatedAt > lastSyncedTime;

                    if (localChanged && cardChanged) {
                        outputChannel.appendLine(`[Trello] Conflict on todo ${todo.id}. Using most recent update.`);
                    }

                    if (localChanged && (!cardChanged || localUpdated > cardUpdatedAt)) {
                        const statusValue = getStatusFromLabels(todo.labels);
                        const listId = getListIdForStatus(openLists, listToStatus, statusValue);
                        const nonStatusLabels = (todo.labels || []).filter(label => !label.startsWith('status:'));
                        const labelNames = nonStatusLabels
                            .map(label => reverseLabelMapping[label])
                            .filter(Boolean);
                        const labelIds = labelNames.map(name => labelNameToId[name]).filter(Boolean);
                        const assigneeUsernames = todo.trello?.assignees || [];
                        const memberIds = assigneeUsernames.map(name => usernameToMemberId[name]).filter(Boolean);

                        await client.updateCard(card.id, {
                            name: todo.title || 'Untitled',
                            desc: todo.notes || '',
                            listId,
                            memberIds: assigneeUsernames.length ? memberIds : undefined,
                            labelIds: labelIds.length ? labelIds : undefined
                        });

                        todo.trello = {
                            ...(todo.trello || {}),
                            listId: listId || card.idList,
                            lastSyncedAt: nowIso
                        };
                        didChangeLocal = true;
                        updatedTodoIds.add(todo.id);
                    }
                }

                if (!hasTrello && config.syncLocalTodos) {
                    const statusValue = getStatusFromLabels(todo.labels);
                    const listId = getListIdForStatus(openLists, listToStatus, statusValue);
                    if (!listId) {
                        continue;
                    }

                    const nonStatusLabels = (todo.labels || []).filter(label => !label.startsWith('status:'));
                    const labelNames = nonStatusLabels
                        .map(label => reverseLabelMapping[label])
                        .filter(Boolean);
                    const labelIds = labelNames.map(name => labelNameToId[name]).filter(Boolean);
                    const memberIds = config.assignedUsername
                        ? [usernameToMemberId[config.assignedUsername]].filter(Boolean)
                        : [];

                    const createdCard = await client.createCard({
                        listId,
                        name: todo.title || 'Untitled',
                        desc: todo.notes || '',
                        memberIds,
                        labelIds
                    });

                    todo.trello = {
                        cardId: createdCard.id,
                        listId: createdCard.idList,
                        boardId,
                        cardUrl: createdCard.url,
                        assignees: config.assignedUsername ? [config.assignedUsername] : [],
                        lastSyncedAt: nowIso
                    };
                    didChangeLocal = true;
                    updatedTodoIds.add(todo.id);
                }
            }

            if (didChangeLocal) {
                suppressFileEvents = true;
                todoManager.saveTodos({ ...data, todos: filteredTodos });
                suppressFileEvents = false;
                refreshTree();
            }

            outputChannel.appendLine(`[Trello] Sync complete.`);
        } catch (error) {
            outputChannel.appendLine(`[Trello] Sync failed: ${error.message}`);
            vscode.window.showWarningMessage(`Trello sync failed: ${error.message}`);
        } finally {
            isSyncing = false;
        }
    }

    async function pruneMissingCards(reason = 'prune') {
        if (isSyncing) {
            outputChannel.appendLine(`[Trello] Prune skipped (sync in progress).`);
            return;
        }

        const config = getTrelloConfig();
        if (!config.enabled) {
            return;
        }

        const boardId = parseBoardId(config.board);
        if (!boardId) {
            vscode.window.showWarningMessage('Trello board is not configured.');
            return;
        }

        const { apiKey, token } = await getCredentials(context);
        if (!apiKey || !token) {
            vscode.window.showWarningMessage('Trello credentials are missing. Use "Trello: Set Credentials".');
            return;
        }

        isSyncing = true;
        outputChannel.appendLine(`[Trello] Prune started (${reason}).`);

        try {
            const client = new TrelloClient({ apiKey, token });
            const cards = await client.getBoardCards(boardId);
            const cardIds = new Set(cards.map(card => card.id));

            const data = todoManager.loadTodos();
            if (data.error) {
                throw new Error(data.error);
            }

            const todos = data.todos || [];
            const remaining = todos.filter(todo => {
                if (!todo.trello?.cardId) {
                    return true;
                }
                if (todo.trello.boardId && todo.trello.boardId !== boardId) {
                    return true;
                }
                return cardIds.has(todo.trello.cardId);
            });

            if (remaining.length !== todos.length) {
                suppressFileEvents = true;
                todoManager.saveTodos({ ...data, todos: remaining });
                suppressFileEvents = false;
                refreshTree();
            }

            outputChannel.appendLine(`[Trello] Prune complete. Removed ${todos.length - remaining.length} items.`);
        } catch (error) {
            outputChannel.appendLine(`[Trello] Prune failed: ${error.message}`);
            vscode.window.showWarningMessage(`Trello prune failed: ${error.message}`);
        } finally {
            isSyncing = false;
        }
    }

    function scheduleSync(reason = 'file-change') {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => syncNow(reason), 800);
    }

    function startAutoSync() {
        const config = getTrelloConfig();
        const intervalMinutes = config.syncIntervalMinutes || 0;
        if (intervalMinutes > 0) {
            autoSyncTimer = setInterval(() => syncNow('interval'), intervalMinutes * 60 * 1000);
        }
    }

    function setupFileWatcher() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        const config = vscode.workspace.getConfiguration('workspaceTodos');
        const todosDir = config.get('todosDirectory', '.vscode');
        const pattern = new vscode.RelativePattern(workspaceFolder, path.join(todosDir, 'todos.json'));
        fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        const onChange = () => {
            if (suppressFileEvents) {
                return;
            }
            const trelloConfig = getTrelloConfig();
            if (trelloConfig.enabled) {
                scheduleSync('local-change');
            }
        };

        fileWatcher.onDidChange(onChange, null, context.subscriptions);
        fileWatcher.onDidCreate(onChange, null, context.subscriptions);
        fileWatcher.onDidDelete(onChange, null, context.subscriptions);
        context.subscriptions.push(fileWatcher);
    }

    function dispose() {
        if (autoSyncTimer) {
            clearInterval(autoSyncTimer);
        }
        if (fileWatcher) {
            fileWatcher.dispose();
        }
    }

    setupFileWatcher();
    startAutoSync();

    return {
        syncNow,
        pruneMissingCards,
        dispose,
        filterAssignedOnly
    };
}

module.exports = {
    createTrelloSyncManager,
    getCredentials,
    getTrelloConfig,
    parseBoardId,
    SECRET_KEY,
    SECRET_TOKEN,
    getWorkspaceSecretKey
};
