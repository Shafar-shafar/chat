const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище подключённых пользователей
const clients = new Map(); // ws -> { username, id }

// Системные сообщения (не шифруются, только уведомления)
function broadcastSystemMessage(text, excludeWs = null) {
    const systemMsg = JSON.stringify({
        type: 'system',
        text: text,
        timestamp: Date.now()
    });
    
    for (const [ws, _] of clients) {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(systemMsg);
        }
    }
}

// Рассылка всем (кроме отправителя) зашифрованного сообщения
function broadcastMessage(senderId, messageData, excludeWs = null) {
    const payload = JSON.stringify({
        type: 'message',
        ...messageData
    });
    
    for (const [ws, info] of clients) {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    }
}

wss.on('connection', (ws, req) => {
    console.log(`🟢 Новое подключение из ${req.socket.remoteAddress}`);
    let userId = null;
    let username = null;
    
    ws.on('message', async (data) => {
        try {
            const parsed = JSON.parse(data);
            
            // 1. Регистрация пользователя (выбор имени)
            if (parsed.type === 'register') {
                username = parsed.username.substring(0, 30); // ограничение длины
                userId = Date.now() + '-' + Math.random().toString(36);
                
                // Проверка уникальности имени (опционально, но можно)
                let nameExists = false;
                for (const [_, info] of clients) {
                    if (info.username === username) {
                        nameExists = true;
                        break;
                    }
                }
                
                if (nameExists) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        text: 'Имя уже занято, выберите другое'
                    }));
                    return;
                }
                
                clients.set(ws, { username, id: userId, joinedAt: Date.now() });
                
                // Отправляем подтверждение
                ws.send(JSON.stringify({
                    type: 'registered',
                    userId: userId,
                    username: username
                }));
                
                // Оповещаем всех о новом пользователе
                broadcastSystemMessage(`👤 ${username} присоединился к чату`, ws);
                
                // Отправляем новому пользователю список активных (опционально)
                const userList = Array.from(clients.values()).map(u => u.username);
                ws.send(JSON.stringify({
                    type: 'userlist',
                    users: userList
                }));
                
                console.log(`✅ Зарегистрирован: ${username} (${userId})`);
                return;
            }
            
            // 2. Обычное сообщение (уже зашифровано на клиенте)
            if (parsed.type === 'message') {
                const sender = clients.get(ws);
                if (!sender) {
                    ws.send(JSON.stringify({ type: 'error', text: 'Не зарегистрирован' }));
                    return;
                }
                
                broadcastMessage(sender.id, {
                    senderName: sender.username,
                    encryptedBody: parsed.encryptedBody,
                    timestamp: parsed.timestamp,
                    type: parsed.messageType || 'text',
                    encryptedAudioData: parsed.encryptedAudioData,
                    mimeType: parsed.mimeType
                }, ws);
                
                console.log(`📨 ${sender.username}: сообщение (${parsed.messageType || 'text'})`);
            }
            
            // 3. Пинг для поддержания соединения
            if (parsed.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
            
        } catch (err) {
            console.error('Ошибка обработки сообщения:', err);
            ws.send(JSON.stringify({ type: 'error', text: 'Неверный формат' }));
        }
    });
    
    ws.on('close', () => {
        if (username) {
            console.log(`🔴 ${username} покинул чат`);
            broadcastSystemMessage(`👋 ${username} покинул чат`);
        }
        clients.delete(ws);
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket ошибка:', err);
    });
});

// Раздача статики (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Все неизвестные маршруты отдаём index.html (для SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 Сервер запущен!
    📡 WebSocket: ws://localhost:${PORT}
    🌐 HTTP: http://localhost:${PORT}
    🔐 Готов к деплою на Railway
    `);
});