require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const tokenManager = require('./tokenManager');

// Configuración
const PORT = parseInt(process.env.PORT) || 4001;

// Almacenar conexiones activas: token -> {ws, ip, channel, connectedAt}
const activeConnections = new Map();

// Almacenar pares de conexión que se han comunicado
// Formato: "token1:token2" (tokens ordenados alfabéticamente)
const connectionPairs = new Set();

// Almacenar canales públicos: channel -> [{token, publishedAt}, ...]
const publicChannels = new Map();
const MAX_CHANNEL_ENTRIES = 100;
const CHANNEL_ENTRY_EXPIRY_MS = 20 * 60 * 1000; // 20 minutos

// Función para ordenar tokens y crear clave de par
function createPairKey(token1, token2) {
    return token1 < token2 ? `${token1}:${token2}` : `${token2}:${token1}`;
}

// Agregar entrada a un canal público
function addToPublicChannel(channel, token) {
    if (!publicChannels.has(channel)) {
        publicChannels.set(channel, []);
    }
    
    const entries = publicChannels.get(channel);
    const now = Date.now();
    
    // Remover si ya existe para evitar duplicados
    const existingIndex = entries.findIndex(entry => entry.token === token);
    if (existingIndex !== -1) {
        entries.splice(existingIndex, 1);
    }
    
    // Agregar al final
    entries.push({ token, publishedAt: now });
    
    // Mantener solo los últimos MAX_CHANNEL_ENTRIES
    if (entries.length > MAX_CHANNEL_ENTRIES) {
        entries.shift(); // Remover el más antiguo
    }
}

// Obtener tokens no expirados de un canal
function getChannelTokens(channel) {
    if (!publicChannels.has(channel)) {
        return [];
    }
    
    const entries = publicChannels.get(channel);
    const now = Date.now();
    
    // Filtrar entradas expiradas
    const validEntries = entries.filter(entry => 
        now - entry.publishedAt < CHANNEL_ENTRY_EXPIRY_MS
    );
    
    // Actualizar el canal con solo entradas válidas
    publicChannels.set(channel, validEntries);
    
    return validEntries.map(entry => entry.token);
}

// Limpiar entradas expiradas de todos los canales
function cleanupExpiredChannelEntries() {
    const now = Date.now();
    let totalRemoved = 0;
    
    for (const [channel, entries] of publicChannels) {
        const validEntries = entries.filter(entry => 
            now - entry.publishedAt < CHANNEL_ENTRY_EXPIRY_MS
        );
        
        const removed = entries.length - validEntries.length;
        if (removed > 0) {
            totalRemoved += removed;
            publicChannels.set(channel, validEntries);
        }
        
        // Eliminar canal si está vacío
        if (validEntries.length === 0) {
            publicChannels.delete(channel);
        }
    }
    
    if (totalRemoved > 0) {
        console.log(`Limpieza de canales: ${totalRemoved} entradas expiradas removidas`);
    }
}

// Notificar a clientes pareados sobre desconexión
function notifyPairedClients(disconnectedToken) {
    const tokensToNotify = new Set();
    
    // Buscar todos los pares que incluyen el token desconectado
    for (const pairKey of connectionPairs) {
        const [token1, token2] = pairKey.split(':');
        if (token1 === disconnectedToken || token2 === disconnectedToken) {
            const otherToken = token1 === disconnectedToken ? token2 : token1;
            tokensToNotify.add(otherToken);
        }
    }
    
    // Enviar notificación a cada cliente pareado
    for (const token of tokensToNotify) {
        const conn = activeConnections.get(token);
        if (conn && conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(JSON.stringify({
                type: 'disconnected',
                token: disconnectedToken,
                timestamp: new Date().toISOString()
            }));
        }
        
        // Remover el par de connectionPairs
        const pairKey = createPairKey(disconnectedToken, token);
        connectionPairs.delete(pairKey);
    }
    
    return tokensToNotify.size;
}

// Crear servidor HTTP básico (solo para WebSocket upgrade)
const server = http.createServer((req, res) => {
    // Para cualquier ruta, responder 404 (no necesitamos endpoints HTTP)
    res.writeHead(404);
    res.end();
});

// Crear servidor WebSocket adjunto al servidor HTTP
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    // Obtener IP del cliente
    const clientIp = req.socket.remoteAddress || '0.0.0.0';
    
    // Asignar token corto al cliente
    const token = tokenManager.assignToken(ws, clientIp);
    
    // Almacenar la conexión
    activeConnections.set(token, {
        ws,
        ip: clientIp,
        channel: null,
        connectedAt: Date.now()
    });
    
    // Asociar el token con el WebSocket
    ws.token = token;
    
    // Enviar información al cliente
    ws.send(JSON.stringify({
        type: 'connected',
        token: token,
        timestamp: new Date().toISOString()
    }));
    
    console.log(`Cliente conectado - Token: ${token}, IP: ${clientIp}. Total activos: ${activeConnections.size}`);
    
    // Manejar mensajes recibidos
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // Actualizar actividad del token
            tokenManager.updateTokenActivity(token);
            
            // Manejar mensajes de tipo especial (publish, list)
            if (message.type === 'publish') {
                handlePublishMessage(ws, message);
                return;
            } else if (message.type === 'list') {
                handleListMessage(ws, message);
                return;
            }
            
            // Mensaje regular (to + message)
            if (!message.to || !message.message) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Formato de mensaje inválido. Debe contener "to" y "message" o "type" para operaciones especiales'
                }));
                return;
            }
            
            // Validar que 'to' sea un array
            const targetTokens = Array.isArray(message.to) ? message.to : [message.to];
            
            if (targetTokens.length === 0) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'El campo "to" debe contener al menos un token destino'
                }));
                return;
            }
            
            // Verificar que el remitente no se incluya a sí mismo
            if (targetTokens.includes(token)) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'No puedes enviarte mensajes a ti mismo'
                }));
                return;
            }
            
            // Enviar mensaje a cada destino
            let sentCount = 0;
            const failedTokens = [];
            
            for (const targetToken of targetTokens) {
                // Verificar que el token destino exista y esté conectado
                const targetConn = activeConnections.get(targetToken);
                if (!targetConn) {
                    failedTokens.push(targetToken);
                    continue;
                }
                
                // Enviar el mensaje al destinatario
                targetConn.ws.send(JSON.stringify({
                    type: 'message',
                    from: token,
                    message: message.message,
                    timestamp: new Date().toISOString()
                }));
                
                // Registrar el par de conexión
                const pairKey = createPairKey(token, targetToken);
                connectionPairs.add(pairKey);
                
                sentCount++;
            }
            
            // Confirmación al remitente
            const response = {
                type: 'message_sent',
                sent: sentCount,
                total: targetTokens.length,
                timestamp: new Date().toISOString()
            };
            
            if (failedTokens.length > 0) {
                response.failed = failedTokens;
            }
            
            ws.send(JSON.stringify(response));
            
            console.log(`Mensaje de ${token} a ${sentCount}/${targetTokens.length} destinos: "${message.message.substring(0, 50)}${message.message.length > 50 ? '...' : ''}"`);
            
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Error procesando el mensaje. Formato JSON inválido.'
            }));
        }
    });
    
    // Funciones auxiliares para manejar mensajes especiales
    function handlePublishMessage(ws, message) {
        const channel = message.channel;
        
        if (!channel || typeof channel !== 'string') {
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Nombre de canal requerido (string)'
            }));
            return;
        }
        
        // Actualizar canal del cliente
        const conn = activeConnections.get(token);
        if (conn) {
            conn.channel = channel;
        }
        
        // Agregar a la lista pública del canal
        addToPublicChannel(channel, token);
        
        ws.send(JSON.stringify({
            type: 'published',
            channel: channel,
            timestamp: new Date().toISOString()
        }));
        
        console.log(`Cliente ${token} publicado en canal: ${channel}`);
    }
    
    function handleListMessage(ws, message) {
        const channel = message.channel;
        
        if (!channel || typeof channel !== 'string') {
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Nombre de canal requerido (string)'
            }));
            return;
        }
        
        // Obtener tokens del canal (ya filtrados por expiración)
        const tokens = getChannelTokens(channel);
        
        ws.send(JSON.stringify({
            type: 'channel_list',
            channel: channel,
            tokens: tokens,
            count: tokens.length,
            maxEntries: MAX_CHANNEL_ENTRIES,
            timestamp: new Date().toISOString()
        }));
        
        console.log(`Cliente ${token} solicitó lista del canal ${channel}: ${tokens.length} tokens`);
    }
    
    // Manejar cierre de conexión
    ws.on('close', () => {
        if (token && activeConnections.has(token)) {
            // Notificar a clientes pareados
            const notifiedCount = notifyPairedClients(token);
            
            // Remover de activeConnections
            activeConnections.delete(token);
            
            // Liberar token inmediatamente
            tokenManager.releaseToken(token);
            
            // Remover de todos los canales públicos (se limpiará en la próxima limpieza)
            
            console.log(`Cliente desconectado - Token: ${token}. Notificados: ${notifiedCount} clientes. Total activos: ${activeConnections.size}`);
        }
    });
    
    // Manejar errores en la conexión
    ws.on('error', (error) => {
        console.error(`Error en WebSocket para token ${token}:`, error);
    });
});

// Iniciar limpieza periódica de entradas expiradas en canales
setInterval(() => {
    cleanupExpiredChannelEntries();
}, 60 * 1000); // Cada minuto

// Iniciar limpieza periódica de tokens inactivos (solo por seguridad)
tokenManager.startCleanupInterval(5); // Cada 5 minutos

// Iniciar servidor
const numericPort = Number(PORT);
server.listen(numericPort, () => {
    console.log(`=========================================`);
    console.log(`🚀 Servidor WebSocket proxy simplificado iniciado`);
    console.log(`📡 Puerto: ${numericPort}`);
    console.log(`🌐 URL: ws://localhost:${numericPort}/`);
    console.log(`📊 Total conexiones activas: 0`);
    console.log(`=========================================`);
    console.log(`⏰ ${new Date().toLocaleString()}`);
    console.log(`=========================================`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Error: El puerto ${numericPort} ya está en uso.`);
        console.error(`   Puedes cambiar el puerto en el archivo .env o liberar el puerto.`);
    } else {
        console.error(`Error al iniciar servidor:`, err);
    }
    process.exit(1);
});

// Manejo de cierre limpio
process.on('SIGINT', () => {
    console.log('\n=========================================');
    console.log('Recibida señal SIGINT (Ctrl+C)');
    console.log(`Cerrando ${activeConnections.size} conexiones activas...`);
    
    // Cerrar todas las conexiones activas
    for (const [token, conn] of activeConnections) {
        conn.ws.close();
    }
    
    console.log('Servidor cerrado correctamente');
    console.log('=========================================');
    process.exit(0);
});
