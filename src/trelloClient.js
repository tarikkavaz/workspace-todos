const https = require('https');

class TrelloClient {
    constructor({ apiKey, token, apiBaseUrl }) {
        this.apiKey = apiKey;
        this.token = token;
        this.baseUrl = apiBaseUrl ? apiBaseUrl.replace(/\/?$/, '/') : 'https://api.trello.com/1/';
    }

    async requestJson(method, path, query = {}, body = null) {
        const url = new URL(path, this.baseUrl);
        const params = new URLSearchParams({
            key: this.apiKey,
            token: this.token,
            ...query
        });
        url.search = params.toString();

        const payload = body ? JSON.stringify(body) : null;
        const options = {
            method,
            headers: {
                'Accept': 'application/json',
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(url, options, res => {
                let data = '';
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
                    if (!isSuccess) {
                        return reject(new Error(`Trello API error ${res.statusCode}: ${data}`));
                    }
                    if (!data) {
                        return resolve(null);
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse Trello response: ${error.message}`));
                    }
                });
            });

            req.on('error', reject);
            if (payload) {
                req.write(payload);
            }
            req.end();
        });
    }

    getMe() {
        return this.requestJson('GET', 'members/me', { fields: 'id,username,fullName' });
    }

    getMemberByUsername(username) {
        return this.requestJson('GET', `members/${encodeURIComponent(username)}`, { fields: 'id,username,fullName' });
    }

    getBoard(boardId) {
        return this.requestJson('GET', `boards/${encodeURIComponent(boardId)}`, { fields: 'id,name,closed,url' });
    }

    getBoardLists(boardId) {
        return this.requestJson('GET', `boards/${encodeURIComponent(boardId)}/lists`, { fields: 'id,name,closed' });
    }

    getBoardCards(boardId) {
        return this.requestJson('GET', `boards/${encodeURIComponent(boardId)}/cards`, {
            fields: 'id,name,desc,idList,idMembers,labels,dateLastActivity,closed,url'
        });
    }

    getBoardMembers(boardId) {
        return this.requestJson('GET', `boards/${encodeURIComponent(boardId)}/members`, { fields: 'id,username,fullName' });
    }

    getBoardLabels(boardId) {
        return this.requestJson('GET', `boards/${encodeURIComponent(boardId)}/labels`, { fields: 'id,name,color' });
    }

    createCard({ listId, name, desc = '', memberIds = [], labelIds = [] }) {
        return this.requestJson('POST', 'cards', {
            idList: listId,
            name,
            desc,
            idMembers: memberIds.join(','),
            idLabels: labelIds.join(',')
        });
    }

    updateCard(cardId, { name, desc, listId, memberIds, labelIds, closed } = {}) {
        const query = {};
        if (typeof name === 'string') query.name = name;
        if (typeof desc === 'string') query.desc = desc;
        if (typeof listId === 'string') query.idList = listId;
        if (Array.isArray(memberIds)) query.idMembers = memberIds.join(',');
        if (Array.isArray(labelIds)) query.idLabels = labelIds.join(',');
        if (typeof closed === 'boolean') query.closed = closed;
        return this.requestJson('PUT', `cards/${encodeURIComponent(cardId)}`, query);
    }
}

module.exports = {
    TrelloClient
};
