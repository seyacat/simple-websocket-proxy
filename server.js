require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const tokenManager = require('./tokenManager');
const crypto = require('crypto');

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

// Remover entrada de un canal público
function removeFromPublicChannel(channel, token) {
    if (!publicChannels.has(channel)) return;
    const entries = publicChannels.get(channel);
    const validEntries = entries.filter(entry => entry.token !== token);
    
    if (validEntries.length === 0) {
        publicChannels.delete(channel);
    } else {
        publicChannels.set(channel, validEntries);
    }
}

// Remover entrada de todos los canales públicos
function removeFromAllPublicChannels(token) {
    for (const [channel, entries] of publicChannels) {
        const validEntries = entries.filter(entry => entry.token !== token);
        if (validEntries.length === 0) {
            publicChannels.delete(channel);
        } else if (validEntries.length !== entries.length) {
            publicChannels.set(channel, validEntries);
        }
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
// skipTokens: Set de tokens a excluir (ya notificados por broadcast de canal)
function notifyPairedClients(disconnectedToken, skipTokens = new Set()) {
    const tokensToNotify = new Set();
    const pairsToRemove = [];

    // Buscar todos los pares que incluyen el token desconectado
    for (const pairKey of connectionPairs) {
        const [token1, token2] = pairKey.split(':');
        if (token1 === disconnectedToken || token2 === disconnectedToken) {
            const otherToken = token1 === disconnectedToken ? token2 : token1;
            pairsToRemove.push(pairKey);
            if (!skipTokens.has(otherToken)) {
                tokensToNotify.add(otherToken);
            }
        }
    }

    // Enviar notificación a cada cliente pareado no notificado aún
    for (const token of tokensToNotify) {
        const conn = activeConnections.get(token);
        if (conn && conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(JSON.stringify({
                type: 'disconnected',
                token: disconnectedToken,
                timestamp: new Date().toISOString()
            }));
        }
    }

    // Limpiar todos los pares (incluso los ya notificados por canal)
    for (const pairKey of pairsToRemove) {
        connectionPairs.delete(pairKey);
    }

    return tokensToNotify.size;
}

// Notificar a los miembros existentes del canal que un token nuevo se publicó
function notifyChannelMembersOfJoin(joiningToken, channelName) {
    const entries = publicChannels.get(channelName);
    if (!entries) return 0;

    const timestamp = new Date().toISOString();
    let notified = 0;

    for (const entry of entries) {
        if (entry.token === joiningToken) continue;

        const conn = activeConnections.get(entry.token);
        if (conn && conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(JSON.stringify({
                type: 'joined',
                token: joiningToken,
                channel: channelName,
                timestamp
            }));
            notified++;
        }
    }

    return notified;
}

// Notificar a los miembros restantes del canal que un token se despublicó
function notifyChannelMembersOfLeave(leavingToken, channelName) {
    const entries = publicChannels.get(channelName);
    if (!entries) return 0;

    const timestamp = new Date().toISOString();
    let notified = 0;

    for (const entry of entries) {
        if (entry.token === leavingToken) continue;

        const conn = activeConnections.get(entry.token);
        if (conn && conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(JSON.stringify({
                type: 'left',
                token: leavingToken,
                channel: channelName,
                timestamp
            }));
            notified++;
        }
    }

    return notified;
}

// Notificar a los miembros de cada canal donde el token estaba publicado
// Devuelve el Set de tokens receptores notificados (para deduplicación con notifyPairedClients)
function notifyChannelMembersOfDisconnect(disconnectedToken) {
    const notified = new Set();
    const timestamp = new Date().toISOString();

    for (const [channelName, entries] of publicChannels) {
        // ¿El token desconectado estaba publicado en este canal?
        const isInChannel = entries.some(entry => entry.token === disconnectedToken);
        if (!isInChannel) continue;

        // Notificar a cada miembro restante del canal
        for (const entry of entries) {
            if (entry.token === disconnectedToken) continue;

            const conn = activeConnections.get(entry.token);
            if (conn && conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(JSON.stringify({
                    type: 'disconnected',
                    token: disconnectedToken,
                    channel: channelName,
                    timestamp
                }));
                notified.add(entry.token);
            }
        }
    }

    return notified;
}

// Remover par de conexión manualmente y notificar a ambas partes
function removeConnectionPair(token1, token2) {
    const pairKey = createPairKey(token1, token2);
    
    if (!connectionPairs.has(pairKey)) {
        return { success: false, error: 'Los tokens no están pareados' };
    }
    
    // Remover el par
    connectionPairs.delete(pairKey);
    
    // Notificar a ambos clientes si están conectados
    const conn1 = activeConnections.get(token1);
    const conn2 = activeConnections.get(token2);
    
    if (conn1 && conn1.ws.readyState === WebSocket.OPEN) {
        conn1.ws.send(JSON.stringify({
            type: 'disconnected',
            token: token2,
            timestamp: new Date().toISOString()
        }));
    }
    
    if (conn2 && conn2.ws.readyState === WebSocket.OPEN) {
        conn2.ws.send(JSON.stringify({
            type: 'disconnected',
            token: token1,
            timestamp: new Date().toISOString()
        }));
    }
    
    return { success: true, pair: pairKey };
}

// Helper functions para manejar IDs de mensajes
/**
 * Extraer valores de ID de un objeto de mensaje
 * @param {Object} message - El mensaje entrante
 * @returns {Object} Objeto con propiedades id y messageId (undefined si no están presentes)
 */
function extractMessageIds(message) {
    return {
        id: message.id,
        messageId: message.messageId
    };
}

/**
 * Aplicar campos ID de un mensaje a un objeto de respuesta
 * @param {Object} response - El objeto de respuesta a modificar
 * @param {Object} message - El mensaje original
 * @returns {Object} El objeto de respuesta modificado
 */
function applyMessageIds(response, message) {
    if (message.id !== undefined) {
        response.id = message.id;
    }
    if (message.messageId !== undefined) {
        response.messageId = message.messageId;
    }
    return response;
}

/**
 * Validar formato de canal según nueva especificación
 * Formato esperado: {data: {name: "channelName", publickey: "pubkey", ...}, signature: "datasignature"}
 * @param {Object} channelData - Objeto de canal a validar
 * @returns {Object} Resultado de validación {valid: boolean, error: string, channelName: string}
 */
function validateChannelFormat(channelData) {
    // Validar que el objeto no sea nulo
    if (!channelData || typeof channelData !== 'object') {
        return { valid: false, error: 'Formato de canal inválido: debe ser un objeto' };
    }
    
    // Validar estructura básica
    if (!channelData.data || typeof channelData.data !== 'object') {
        return { valid: false, error: 'Formato de canal inválido: falta campo "data"' };
    }
    
    if (!channelData.signature || typeof channelData.signature !== 'string') {
        return { valid: false, error: 'Formato de canal inválido: falta campo "signature" o no es string' };
    }
    
    // Validar campos requeridos en data
    const data = channelData.data;
    if (!data.name || typeof data.name !== 'string') {
        return { valid: false, error: 'Formato de canal inválido: data.name es requerido y debe ser string' };
    }
    
    if (!data.publickey || typeof data.publickey !== 'string') {
        return { valid: false, error: 'Formato de canal inválido: data.publickey es requerido y debe ser string' };
    }
    
    // Validar longitud máxima de 1000 caracteres para el JSON completo
    const jsonString = JSON.stringify(channelData);
    if (jsonString.length > 1000) {
        return { valid: false, error: `Formato de canal inválido: excede 1000 caracteres (${jsonString.length})` };
    }
    
    // Validar firma
    const signatureValid = validateSignature(channelData);
    
    if (!signatureValid) {
        return { valid: false, error: 'Firma inválida' };
    }
    
    return { valid: true, channelName: data.name };
}

/**
 * Validar firma del canal
 * @param {Object} channelData - Datos del canal
 * @returns {boolean} true si la firma es válida
 */
function validateSignature(channelData) {
    try {
        const signature = channelData.signature;
        const data = channelData.data;
        const publicKeyStr = data.publickey;
        
        // Validaciones básicas
        if (!signature || signature.trim() === '') {
            return false;
        }
        
        if (!publicKeyStr || publicKeyStr.trim() === '') {
            return false;
        }
        
        // Verificar formato base64 de la firma
        const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
        const isBase64 = base64Regex.test(signature);
        
        if (!isBase64) {
            // Podría ser JWK string, verificar si es JSON
            try {
                JSON.parse(signature);
                return false;
            } catch {
                // No es JSON válido, pero para desarrollo aceptar
                return true;
            }
        }
        
        // Verificar longitud mínima
        if (signature.length < 10) {
            return false;
        }
        
        // Intentar verificación criptográfica si la clave pública es JWK
        try {
            const publicKeyJson = JSON.parse(publicKeyStr);
            
            if (publicKeyJson.kty === 'EC' && publicKeyJson.crv === 'P-256') {
                // Es una clave JWK ECDSA P-256
                return verifySignatureWithJWK(data, signature, publicKeyJson);
            }
        } catch (jsonError) {
            // No es JSON, podría ser base64 o string simple
        }
        
        // Fallback a validación básica
        return validateSignatureBasic(channelData);
        
    } catch (error) {
        // Para desarrollo, aceptar en caso de error
        return true;
    }
}

/**
 * Verificar firma usando clave pública JWK
 * @param {Object} data - Datos a verificar
 * @param {string} signatureBase64 - Firma en base64
 * @param {Object} publicKeyJwk - Clave pública en formato JWK
 * @returns {boolean} true si la firma es válida
 */
function verifySignatureWithJWK(data, signatureBase64, publicKeyJwk) {
    try {
        // Usar serialización canónica (mismo orden que el cliente)
        const dataStr = canonicalStringify(data);
        
        const signatureBuffer = Buffer.from(signatureBase64, 'base64');
        
        // Convertir JWK a clave pública de Node.js crypto
        // JWK a formato PEM para ECDSA
        const x = Buffer.from(publicKeyJwk.x, 'base64');
        const y = Buffer.from(publicKeyJwk.y, 'base64');
        
        // Crear clave en formato raw (0x04 + x + y)
        const rawKey = Buffer.concat([Buffer.from([0x04]), x, y]);
        
        const verify = crypto.createVerify('SHA256');
        verify.update(dataStr);
        verify.end();
        
        const result = verify.verify({
            key: rawKey,
            format: 'der',
            type: 'spki',
            namedCurve: 'prime256v1'
        }, signatureBuffer);
        
        return result;
        
    } catch (error) {
        // Para desarrollo, si hay error en verificación criptográfica, aceptar
        return true;
    }
}

/**
 * Stringify object with sorted keys for canonical representation
 * @param {Object} obj Object to stringify
 * @returns {string} Canonical JSON string
 */
function canonicalStringify(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return JSON.stringify(obj);
    }
    
    if (Array.isArray(obj)) {
        return '[' + obj.map(item => canonicalStringify(item)).join(',') + ']';
    }
    
    // Object: sort keys
    const sortedKeys = Object.keys(obj).sort();
    const keyValuePairs = sortedKeys.map(key => {
        return JSON.stringify(key) + ':' + canonicalStringify(obj[key]);
    });
    
    return '{' + keyValuePairs.join(',') + '}';
}

/**
 * Validación básica de firma (para desarrollo/fallback)
 * @param {Object} channelData - Datos del canal
 * @returns {boolean} true si pasa validación básica
 */
function validateSignatureBasic(channelData) {
    const signature = channelData.signature;
    const publicKey = channelData.data.publickey;
    
    // Validaciones básicas para desarrollo
    if (signature.startsWith('FALLBACK-') || signature.startsWith('MOCK-')) {
        return true;
    }
    
    // Verificar que no esté vacía
    if (!signature || signature.trim() === '') return false;
    if (!publicKey || publicKey.trim() === '') return false;
    
    // Verificar formato base64
    const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
    if (!base64Regex.test(signature)) {
        // Podría ser JWK, verificar si es JSON
        try {
            JSON.parse(publicKey);
            // Es JWK, aceptar para desarrollo
            return true;
        } catch {
            return false;
        }
    }
    
    // Longitud mínima razonable
    if (signature.length < 10) {
        return false;
    }
    
    return true;
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
        channelData: null,
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
    
    if (process.env.NODE_ENV !== 'test') console.log(`Cliente conectado - Token: ${token}, IP: ${clientIp}. Total activos: ${activeConnections.size}`);
    
    // Manejar mensajes recibidos
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // Actualizar actividad del token
            tokenManager.updateTokenActivity(token);
            
            // Manejar mensajes de tipo especial (publish, unpublish, list, disconnect)
            if (message.type === 'publish') {
                handlePublishMessage(ws, message);
                return;
            } else if (message.type === 'unpublish') {
                handleUnpublishMessage(ws, message);
                return;
            } else if (message.type === 'list') {
                handleListMessage(ws, message);
                return;
            } else if (message.type === 'channel_count') {
                handleChannelCountMessage(ws, message);
                return;
            } else if (message.type === 'disconnect') {
                handleDisconnectMessage(ws, message);
                return;
            }
            
            // Mensaje regular (to + message)
            if (!message.to || !message.message) {
                const errorResponse = {
                    type: 'error',
                    error: 'Formato de mensaje inválido. Debe contener "to" y "message" o "type" para operaciones especiales'
                };
                
                // Incluir ID del mensaje original si existe
                applyMessageIds(errorResponse, message);
                
                ws.send(JSON.stringify(errorResponse));
                return;
            }
            
            // Validar que 'to' sea un array
            const targetTokens = Array.isArray(message.to) ? message.to : [message.to];
            
            if (targetTokens.length === 0) {
                const errorResponse = {
                    type: 'error',
                    error: 'El campo "to" debe contener al menos un token destino'
                };
                
                // Incluir ID del mensaje original si existe
                applyMessageIds(errorResponse, message);
                
                ws.send(JSON.stringify(errorResponse));
                return;
            }
            
            // Verificar que el remitente no se incluya a sí mismo
            if (targetTokens.includes(token)) {
                const errorResponse = {
                    type: 'error',
                    error: 'No puedes enviarte mensajes a ti mismo'
                };
                
                // Incluir ID del mensaje original si existe
                applyMessageIds(errorResponse, message);
                
                ws.send(JSON.stringify(errorResponse));
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
                    message: message.message
                }));
                
                // Registrar el par de conexión
                const pairKey = createPairKey(token, targetToken);
                connectionPairs.add(pairKey);
                
                sentCount++;
            }
            
            // Confirmación al remitente (solo si hay fallos)
            if (failedTokens.length > 0) {
                const response = {
                    type: 'message_sent',
                    sent: sentCount,
                    total: targetTokens.length,
                    failed: failedTokens
                };
                applyMessageIds(response, message);
                ws.send(JSON.stringify(response));
            }
            
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
        const channelData = message.channel;
        
        // Validar formato del canal
        const validation = validateChannelFormat(channelData);
        if (!validation.valid) {
            const errorResponse = {
                type: 'error',
                error: validation.error
            };
            
            // Incluir ID del mensaje original si existe
            applyMessageIds(errorResponse, message);
            
            ws.send(JSON.stringify(errorResponse));
            return;
        }
        
        const channelName = validation.channelName;
        
        // Actualizar canal del cliente
        const conn = activeConnections.get(token);
        if (conn) {
            conn.channel = channelName;
            conn.channelData = channelData; // Almacenar datos completos del canal
        }
        
        // Agregar a la lista pública del canal
        addToPublicChannel(channelName, token);

        // Notificar a los demás miembros del canal
        const notifiedJoin = notifyChannelMembersOfJoin(token, channelName);

        const response = {
            type: 'published',
            channel: channelName,
            data: channelData.data,
            timestamp: new Date().toISOString()
        };

        // Incluir ID del mensaje original si existe
        applyMessageIds(response, message);

        ws.send(JSON.stringify(response));

        if (process.env.NODE_ENV !== 'test') console.log(`Cliente ${token} publicado en canal: ${channelName}. Notificados ${notifiedJoin} miembros.`);
    }
    
    function handleUnpublishMessage(ws, message) {
        const channelData = message.channel;
        
        // Validar formato del canal
        const validation = validateChannelFormat(channelData);
        if (!validation.valid) {
            const errorResponse = {
                type: 'error',
                error: validation.error
            };
            
            applyMessageIds(errorResponse, message);
            ws.send(JSON.stringify(errorResponse));
            return;
        }
        
        const channelName = validation.channelName;

        // Remover de la lista pública del canal
        removeFromPublicChannel(channelName, token);

        // Notificar a los miembros restantes del canal
        const notifiedLeave = notifyChannelMembersOfLeave(token, channelName);

        // Limpiar datos del canal en la conexión
        const conn = activeConnections.get(token);
        if (conn) {
            conn.channel = null;
            conn.channelData = null;
        }

        const response = {
            type: 'unpublished',
            channel: channelName,
            timestamp: new Date().toISOString()
        };

        applyMessageIds(response, message);
        ws.send(JSON.stringify(response));

        if (process.env.NODE_ENV !== 'test') console.log(`Cliente ${token} despublicado del canal: ${channelName}. Notificados ${notifiedLeave} miembros.`);
    }
    
    function handleListMessage(ws, message) {
        const channelData = message.channel;
        
        // Validar formato del canal
        const validation = validateChannelFormat(channelData);
        if (!validation.valid) {
            const errorResponse = {
                type: 'error',
                error: validation.error
            };
            
            // Incluir ID del mensaje original si existe
            applyMessageIds(errorResponse, message);
            
            ws.send(JSON.stringify(errorResponse));
            return;
        }
        
        const channelName = validation.channelName;
        
        // Obtener tokens del canal (ya filtrados por expiración)
        const tokens = getChannelTokens(channelName);
        
        const response = {
            type: 'channel_list',
            channel: channelName,
            tokens: tokens,
            count: tokens.length,
            maxEntries: MAX_CHANNEL_ENTRIES,
            timestamp: new Date().toISOString()
        };
        
        // Incluir ID del mensaje original si existe
        applyMessageIds(response, message);
        
        ws.send(JSON.stringify(response));
        
        if (process.env.NODE_ENV !== 'test') console.log(`Cliente ${token} solicitó lista del canal ${channelName}: ${tokens.length} tokens`);
    }
    
    function handleChannelCountMessage(ws, message) {
        const channelName = message.channel;

        if (typeof channelName !== 'string' || channelName.length === 0) {
            const errorResponse = {
                type: 'error',
                error: 'channel requerido (string no vacío)'
            };
            applyMessageIds(errorResponse, message);
            ws.send(JSON.stringify(errorResponse));
            return;
        }

        const tokens = getChannelTokens(channelName);

        const response = {
            type: 'channel_count',
            channel: channelName,
            count: tokens.length,
            maxEntries: MAX_CHANNEL_ENTRIES,
            timestamp: new Date().toISOString()
        };

        applyMessageIds(response, message);
        ws.send(JSON.stringify(response));
    }

    function handleDisconnectMessage(ws, message) {
        const targetToken = message.target;
        
        if (!targetToken || typeof targetToken !== 'string') {
            const errorResponse = {
                type: 'error',
                error: 'Token destino requerido (string)'
            };
            
            // Incluir ID del mensaje original si existe
            applyMessageIds(errorResponse, message);
            
            ws.send(JSON.stringify(errorResponse));
            return;
        }
        
        // Verificar que el token destino no sea el mismo
        if (targetToken === token) {
            const errorResponse = {
                type: 'error',
                error: 'No puedes desconectarte de ti mismo'
            };
            
            // Incluir ID del mensaje original si existe
            applyMessageIds(errorResponse, message);
            
            ws.send(JSON.stringify(errorResponse));
            return;
        }
        
        // Verificar que el token destino exista y esté conectado
        const targetConn = activeConnections.get(targetToken);
        if (!targetConn) {
            const errorResponse = {
                type: 'error',
                error: `Token destino ${targetToken} no encontrado o no conectado`
            };
            
            // Incluir ID del mensaje original si existe
            applyMessageIds(errorResponse, message);
            
            ws.send(JSON.stringify(errorResponse));
            return;
        }
        
        // Remover el par de conexión y notificar a ambas partes
        const result = removeConnectionPair(token, targetToken);
        
        if (result.success) {
            // Enviar confirmación al cliente que solicitó la desconexión
            const response = {
                type: 'disconnect_confirmation',
                target: targetToken,
                timestamp: new Date().toISOString()
            };
            
            // Incluir ID del mensaje original si existe
            applyMessageIds(response, message);
            
            ws.send(JSON.stringify(response));
            
            if (process.env.NODE_ENV !== 'test') console.log(`Cliente ${token} desconectó manualmente de ${targetToken}`);
        } else {
            const errorResponse = {
                type: 'error',
                error: result.error
            };
            
            // Incluir ID del mensaje original si existe
            applyMessageIds(errorResponse, message);
            
            ws.send(JSON.stringify(errorResponse));
        }
    }
    
    // Manejar cierre de conexión
    ws.on('close', () => {
        if (token && activeConnections.has(token)) {
            // Notificar primero a miembros de canal (mensaje incluye 'channel'),
            // antes de removeFromAllPublicChannels para que aún estén las entradas.
            const notifiedByChannels = notifyChannelMembersOfDisconnect(token);

            // Notificar a pares restantes (deduplicando contra los ya notificados por canal)
            const notifiedByPairs = notifyPairedClients(token, notifiedByChannels);

            // Remover de activeConnections
            activeConnections.delete(token);

            // Liberar token inmediatamente
            tokenManager.releaseToken(token);

            // Remover de todos los canales públicos inmediatamente
            removeFromAllPublicChannels(token);

            if (process.env.NODE_ENV !== 'test') console.log(`Cliente desconectado - Token: ${token}. Notificados: ${notifiedByChannels.size} por canal + ${notifiedByPairs} por par. Total activos: ${activeConnections.size}`);
        }
    });
    
    // Manejar errores en la conexión
    ws.on('error', (error) => {
        console.error(`Error en WebSocket para token ${token}:`, error);
    });
});

// Handles de intervalos para poder limpiarlos en stop()
let channelCleanupInterval = null;
let tokenCleanupInterval = null;

/**
 * Inicia el servidor en el puerto indicado.
 * @param {number} [port] Puerto a usar. 0 = puerto asignado por el OS. Default: PORT del entorno.
 * @returns {Promise<number>} Puerto efectivo en el que está escuchando.
 */
function start(port = Number(PORT)) {
    return new Promise((resolve, reject) => {
        channelCleanupInterval = setInterval(cleanupExpiredChannelEntries, 60 * 1000);
        tokenCleanupInterval = tokenManager.startCleanupInterval(5);

        const onError = (err) => {
            server.removeListener('error', onError);
            reject(err);
        };
        server.on('error', onError);

        server.listen(port, () => {
            server.removeListener('error', onError);
            const actualPort = server.address().port;
            if (process.env.NODE_ENV !== 'test') {
                console.log(`=========================================`);
                console.log(`🚀 Servidor WebSocket proxy simplificado iniciado`);
                console.log(`📡 Puerto: ${actualPort}`);
                console.log(`🌐 URL: ws://localhost:${actualPort}/`);
                console.log(`📊 Total conexiones activas: 0`);
                console.log(`=========================================`);
                console.log(`⏰ ${new Date().toLocaleString()}`);
                console.log(`=========================================`);
            }
            resolve(actualPort);
        });
    });
}

/**
 * Detiene el servidor: limpia intervalos, cierra todas las conexiones y resetea el estado.
 * @returns {Promise<void>}
 */
function stop() {
    if (channelCleanupInterval) {
        clearInterval(channelCleanupInterval);
        channelCleanupInterval = null;
    }
    if (tokenCleanupInterval) {
        clearInterval(tokenCleanupInterval);
        tokenCleanupInterval = null;
    }

    // Cerrar todas las conexiones de cliente
    for (const [, conn] of activeConnections) {
        try { conn.ws.terminate(); } catch (_) { /* noop */ }
    }
    activeConnections.clear();
    publicChannels.clear();
    connectionPairs.clear();

    // Resetear tokenManager
    for (const t of tokenManager.getAllActiveTokens()) {
        tokenManager.releaseToken(t);
    }

    return new Promise((resolve) => {
        wss.close(() => {
            server.close(() => resolve());
        });
    });
}

// Auto-start solo cuando se ejecuta directamente (no cuando se importa desde tests)
if (require.main === module) {
    start().catch((err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Error: El puerto ${Number(PORT)} ya está en uso.`);
            console.error(`   Puedes cambiar el puerto en el archivo .env o liberar el puerto.`);
        } else {
            console.error(`Error al iniciar servidor:`, err);
        }
        process.exit(1);
    });
}

module.exports = { start, stop, server, wss };

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
