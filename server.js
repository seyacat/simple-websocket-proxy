require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const tokenManager = require('./tokenManager');

// Configuración
const PORT = parseInt(process.env.PORT) || 4001;

// Almacenar conexiones activas: uuid -> {ws, ip, shortToken, mode, subscribedTo, subscribers, visibility}
const activeConnections = new Map();

// Almacenar hosts públicos en orden FIFO (máximo 20)
const publicHosts = [];
const MAX_PUBLIC_HOSTS = 20;

// Convertir IP a base64 sin padding
function ipToBase64(ip) {
    return Buffer.from(ip).toString('base64').replace(/=/g, '');
}

// Generar un UUID único que comience con la IP en base64
function generateUuid(ip) {
    const ipBase64 = ipToBase64(ip);
    const uniquePart = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    return ipBase64 + '_' + uniquePart;
}

// Validar si un UUID es válido para una IP dada
function isValidUuidForIp(uuid, ip) {
    const ipBase64 = ipToBase64(ip);
    return uuid.startsWith(ipBase64 + '_');
}

// Helper functions para manejo de modos y suscripciones

// Obtener información de conexión por token corto
function getConnectionByShortToken(shortToken) {
    const uuid = tokenManager.getUuidByShortToken(shortToken);
    if (!uuid) return null;
    return activeConnections.get(uuid);
}

// Agregar host a la lista de hosts públicos (FIFO)
function addToPublicHosts(shortToken) {
    // Remover si ya existe para evitar duplicados
    const existingIndex = publicHosts.indexOf(shortToken);
    if (existingIndex !== -1) {
        publicHosts.splice(existingIndex, 1);
    }
    
    // Agregar al final
    publicHosts.push(shortToken);
    
    // Mantener solo los últimos MAX_PUBLIC_HOSTS
    if (publicHosts.length > MAX_PUBLIC_HOSTS) {
        publicHosts.shift(); // Remover el más antiguo
    }
}

// Remover host de la lista de hosts públicos
function removeFromPublicHosts(shortToken) {
    const index = publicHosts.indexOf(shortToken);
    if (index !== -1) {
        publicHosts.splice(index, 1);
    }
}

// Obtener lista de hosts públicos (últimos 20 en orden FIFO)
function getPublicHosts() {
    return [...publicHosts]; // Devolver copia
}

// Establecer modo de un cliente con visibilidad opcional
function setClientMode(uuid, mode, visibility = 'private') {
    const conn = activeConnections.get(uuid);
    if (!conn) return false;
    
    // Limpiar estado anterior según el modo actual
    if (conn.mode === 'guest' && conn.subscribedTo) {
        // Si era guest suscrito, desuscribirse del host
        unsubscribeGuest(uuid);
    } else if (conn.mode === 'host') {
        // Si era host, notificar a todos los subscribers que se desconectó
        notifyHostDisconnection(conn.shortToken);
        conn.subscribers.clear();
        
        // Remover de la lista de hosts públicos si estaba
        removeFromPublicHosts(conn.shortToken);
    }
    
    // Establecer nuevo modo
    conn.mode = mode;
    
    // Establecer visibilidad si es host
    if (mode === 'host') {
        conn.visibility = visibility;
        conn.subscribedTo = null; // Hosts no están suscritos a nadie
        
        // Si es público, agregar a la lista
        if (visibility === 'public') {
            addToPublicHosts(conn.shortToken);
        }
    } else {
        conn.visibility = null;
        // Limpiar estado relacionado con el modo anterior
        if (mode === 'guest') {
            conn.subscribers.clear(); // Guests no tienen subscribers
        }
    }
    
    return true;
}

// Suscribir un guest a un host
function subscribeGuestToHost(guestUuid, hostShortToken) {
    const guestConn = activeConnections.get(guestUuid);
    if (!guestConn || guestConn.mode !== 'guest') {
        return { success: false, error: 'Cliente no está en modo guest' };
    }
    
    const hostConn = getConnectionByShortToken(hostShortToken);
    if (!hostConn || hostConn.mode !== 'host') {
        return { success: false, error: 'Host no encontrado o no está en modo host' };
    }
    
    // Desuscribirse del host anterior si está suscrito a otro
    if (guestConn.subscribedTo && guestConn.subscribedTo !== hostShortToken) {
        unsubscribeGuest(guestUuid);
    }
    
    // Si ya está suscrito a este host, no hacer nada
    if (guestConn.subscribedTo === hostShortToken) {
        return { success: true, alreadySubscribed: true };
    }
    
    // Establecer suscripción
    guestConn.subscribedTo = hostShortToken;
    hostConn.subscribers.add(guestConn.shortToken);
    
    return { success: true };
}

// Desuscribir un guest
function unsubscribeGuest(guestUuid) {
    const guestConn = activeConnections.get(guestUuid);
    if (!guestConn || !guestConn.subscribedTo) return false;
    
    const hostShortToken = guestConn.subscribedTo;
    const hostConn = getConnectionByShortToken(hostShortToken);
    
    if (hostConn) {
        hostConn.subscribers.delete(guestConn.shortToken);
    }
    
    guestConn.subscribedTo = null;
    return true;
}

// Notificar a todos los guests que su host se desconectó
function notifyHostDisconnection(hostShortToken) {
    const hostConn = getConnectionByShortToken(hostShortToken);
    if (!hostConn) return;
    
    for (const guestToken of hostConn.subscribers) {
        const guestUuid = tokenManager.getUuidByShortToken(guestToken);
        if (!guestUuid) continue;
        
        const guestConn = activeConnections.get(guestUuid);
        if (guestConn) {
            guestConn.subscribedTo = null;
            guestConn.ws.send(JSON.stringify({
                type: 'host_disconnected',
                host: hostShortToken,
                message: 'El host se ha desconectado',
                timestamp: new Date().toISOString()
            }));
        }
    }
    
    hostConn.subscribers.clear();
}

// Enviar broadcast a todos los subscribers de un host
function broadcastToSubscribers(hostShortToken, message, senderShortToken) {
    const hostConn = getConnectionByShortToken(hostShortToken);
    if (!hostConn) return 0;
    
    let sentCount = 0;
    for (const guestToken of hostConn.subscribers) {
        const guestUuid = tokenManager.getUuidByShortToken(guestToken);
        if (!guestUuid) continue;
        
        const guestConn = activeConnections.get(guestUuid);
        if (guestConn && guestConn.ws.readyState === 1) { // WebSocket.OPEN === 1
            guestConn.ws.send(JSON.stringify({
                type: 'broadcast_message',
                from: senderShortToken,
                message: message,
                timestamp: new Date().toISOString()
            }));
            sentCount++;
        }
    }
    
    return sentCount;
}

// Crear servidor HTTP
const server = http.createServer((req, res) => {
    // Ruta de estado
    if (req.url === '/status' && req.method === 'GET') {
        // Calcular estadísticas de modos y suscripciones
        let hostCount = 0;
        let guestCount = 0;
        let noModeCount = 0;
        let totalSubscriptions = 0;
        let publicHostCount = 0;
        const hostsWithSubscribers = [];
        const publicHostsInfo = [];
        
        for (const [uuid, conn] of activeConnections) {
            if (conn.mode === 'host') {
                hostCount++;
                const subscriberCount = conn.subscribers.size;
                totalSubscriptions += subscriberCount;
                
                // Contar hosts públicos
                if (conn.visibility === 'public') {
                    publicHostCount++;
                    publicHostsInfo.push({
                        shortToken: conn.shortToken,
                        subscribersCount: subscriberCount,
                        visibility: conn.visibility
                    });
                }
                
                if (subscriberCount > 0) {
                    hostsWithSubscribers.push({
                        shortToken: conn.shortToken,
                        subscribers: Array.from(conn.subscribers),
                        subscriberCount: subscriberCount,
                        visibility: conn.visibility || 'private'
                    });
                }
            } else if (conn.mode === 'guest') {
                guestCount++;
                if (conn.subscribedTo) {
                    totalSubscriptions++;
                }
            } else {
                noModeCount++;
            }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            activeConnections: activeConnections.size,
            tokenStats: tokenManager.getStats(),
            activeShortTokens: tokenManager.getAllActiveShortTokens(),
            modeStats: {
                hosts: hostCount,
                guests: guestCount,
                noMode: noModeCount,
                totalSubscriptions: totalSubscriptions,
                publicHosts: publicHostCount,
                hostsWithSubscribers: hostsWithSubscribers,
                publicHostsList: publicHostsInfo
            },
            publicHostsFifo: getPublicHosts(),
            timestamp: new Date().toISOString()
        }));
        return;
    }
    
    // Ruta para ver tokens cortos activos
    if (req.url === '/tokens' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            activeShortTokens: tokenManager.getAllActiveShortTokens(),
            stats: tokenManager.getStats(),
            timestamp: new Date().toISOString()
        }));
        return;
    }
    
    // Para cualquier otra ruta, responder 404
    res.writeHead(404);
    res.end();
});

// Crear servidor WebSocket adjunto al servidor HTTP
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    // Obtener IP del cliente
    const clientIp = req.socket.remoteAddress || '0.0.0.0';
    console.log(`Nueva conexión desde IP: ${clientIp}`);

    // Parsear query string para obtener uuid
    const parsedUrl = url.parse(req.url, true);
    const query = parsedUrl.query;
    let uuid = query.uuid || null;

    let finalUuid;
    let isReconnection = false;

    if (uuid) {
        // Validar el UUID proporcionado
        if (!isValidUuidForIp(uuid, clientIp)) {
            console.log(`UUID inválido para IP ${clientIp}: ${uuid}`);
            ws.close();
            return;
        }
        
        // Verificar si el UUID ya está en uso (conexión activa)
        if (activeConnections.has(uuid)) {
            console.log(`UUID ya en uso: ${uuid}`);
            ws.close();
            return;
        }
        
        finalUuid = uuid;
        isReconnection = true;
        console.log(`Reconexión con UUID existente: ${finalUuid}`);
    } else {
        // Generar nuevo UUID
        finalUuid = generateUuid(clientIp);
        console.log(`Nuevo UUID generado: ${finalUuid}`);
    }

    // Asignar o recuperar token corto
    let shortToken;
    if (isReconnection) {
        // Para reconexión, obtener el token corto existente
        shortToken = tokenManager.getShortTokenByUuid(finalUuid);
        if (!shortToken) {
            // Si no hay token corto existente, asignar uno nuevo
            console.log(`No se encontró token corto para UUID: ${finalUuid}, asignando nuevo token`);
            shortToken = tokenManager.assignShortToken(finalUuid, clientIp);
            console.log(`Nuevo token corto asignado para reconexión: ${shortToken}`);
        } else {
            // Actualizar actividad del token corto existente
            tokenManager.updateShortTokenActivity(shortToken);
        }
    } else {
        // Para nueva conexión, asignar nuevo token corto
        shortToken = tokenManager.assignShortToken(finalUuid, clientIp);
        console.log(`Nuevo token corto asignado: ${shortToken}`);
    }

    // Almacenar la conexión
    activeConnections.set(finalUuid, {
        ws: ws,
        ip: clientIp,
        shortToken: shortToken,
        uuid: finalUuid,
        mode: null, // 'host', 'guest', o null
        subscribedTo: null, // para guests: token corto del host al que están suscritos
        subscribers: new Set(), // para hosts: conjunto de tokens cortos de guests suscritos
        visibility: null // 'public' o 'private' para hosts, null para guests
    });

    // Asociar el UUID y token corto con el WebSocket
    ws.uuid = finalUuid;
    ws.shortToken = shortToken;

    // Enviar información al cliente
    ws.send(JSON.stringify({
        type: 'connection_established',
        uuid: finalUuid,
        shortToken: shortToken,
        isReconnection: isReconnection,
        message: isReconnection ? 'Reconexión exitosa' : 'Nueva conexión establecida'
    }));

    console.log(`Cliente conectado - UUID: ${finalUuid}, Token corto: ${shortToken}. Total activos: ${activeConnections.size}`);

    // Manejar mensajes recibidos
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // Actualizar actividad del token corto
            tokenManager.updateShortTokenActivity(shortToken);
            
            // Manejar mensajes de tipo especial (set_mode, subscribe, unsubscribe, list_public_hosts)
            if (message.type === 'set_mode') {
                handleSetModeMessage(ws, message);
                return;
            } else if (message.type === 'subscribe') {
                handleSubscribeMessage(ws, message);
                return;
            } else if (message.type === 'unsubscribe') {
                handleUnsubscribeMessage(ws);
                return;
            } else if (message.type === 'list_public_hosts') {
                handleListPublicHostsMessage(ws);
                return;
            }
            
            // Mensaje regular (to + message)
            if (!message.to || !message.message) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Formato de mensaje inválido. Debe contener "to" y "message"'
                }));
                return;
            }

            const targetShortToken = message.to;
            const senderShortToken = ws.shortToken;
            const senderUuid = ws.uuid;
            const senderConn = activeConnections.get(senderUuid);

            // Verificar si es un broadcast (host enviando a su propio token)
            if (targetShortToken === senderShortToken && senderConn && senderConn.mode === 'host') {
                // Es un broadcast del host a sus subscribers
                const sentCount = broadcastToSubscribers(senderShortToken, message.message, senderShortToken);
                
                // Confirmación al host
                ws.send(JSON.stringify({
                    type: 'broadcast_sent',
                    to: 'all_subscribers',
                    subscribersCount: sentCount,
                    timestamp: new Date().toISOString()
                }));
                
                console.log(`Broadcast de ${senderShortToken} a ${sentCount} subscribers: "${message.message.substring(0, 50)}${message.message.length > 50 ? '...' : ''}"`);
                return;
            }

            // Mensaje directo normal
            // Obtener UUID del destinatario a partir del token corto
            const targetUuid = tokenManager.getUuidByShortToken(targetShortToken);
            if (!targetUuid) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: `Destinatario ${targetShortToken} no encontrado`
                }));
                return;
            }

            // Buscar el WebSocket del destinatario
            const targetConn = activeConnections.get(targetUuid);
            if (!targetConn) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: `Destinatario ${targetShortToken} no está conectado`
                }));
                return;
            }

            // Enviar el mensaje al destinatario
            targetConn.ws.send(JSON.stringify({
                type: 'message',
                from: senderShortToken,
                message: message.message,
                timestamp: new Date().toISOString()
            }));

            // Confirmación al remitente
            ws.send(JSON.stringify({
                type: 'message_sent',
                to: targetShortToken,
                timestamp: new Date().toISOString()
            }));

            console.log(`Mensaje de ${senderShortToken} a ${targetShortToken}: "${message.message.substring(0, 50)}${message.message.length > 50 ? '...' : ''}"`);

        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Error procesando el mensaje'
            }));
        }
    });
    
    // Funciones auxiliares para manejar mensajes especiales
    function handleSetModeMessage(ws, message) {
        const uuid = ws.uuid;
        const mode = message.mode;
        
        if (mode !== 'host' && mode !== 'guest') {
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Modo inválido. Debe ser "host" o "guest"'
            }));
            return;
        }
        
        // Obtener visibilidad (solo aplica para hosts, por defecto 'private')
        let visibility = message.visibility;
        if (mode === 'host') {
            if (visibility !== 'public' && visibility !== 'private') {
                visibility = 'private'; // Valor por defecto
            }
        } else {
            visibility = null; // Guests no tienen visibilidad
        }
        
        const success = setClientMode(uuid, mode, visibility);
        if (success) {
            const response = {
                type: 'mode_set',
                mode: mode,
                message: `Modo cambiado a ${mode}`,
                timestamp: new Date().toISOString()
            };
            
            // Incluir visibilidad en la respuesta si es host
            if (mode === 'host') {
                response.visibility = visibility;
                response.message = `Modo cambiado a ${mode} (${visibility})`;
            }
            
            ws.send(JSON.stringify(response));
            console.log(`Cliente ${ws.shortToken} cambió a modo ${mode}${mode === 'host' ? ` (${visibility})` : ''}`);
        } else {
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Error al cambiar el modo'
            }));
        }
    }
    
    function handleSubscribeMessage(ws, message) {
        const uuid = ws.uuid;
        const hostShortToken = message.to;
        
        if (!hostShortToken) {
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Token corto del host requerido'
            }));
            return;
        }
        
        const result = subscribeGuestToHost(uuid, hostShortToken);
        if (result.success) {
            const conn = activeConnections.get(uuid);
            ws.send(JSON.stringify({
                type: 'subscribed',
                to: hostShortToken,
                message: result.alreadySubscribed ? 'Ya estabas suscrito a este host' : 'Suscripción exitosa',
                timestamp: new Date().toISOString()
            }));
            
            // Notificar al host sobre el nuevo subscriber
            const hostConn = getConnectionByShortToken(hostShortToken);
            if (hostConn) {
                hostConn.ws.send(JSON.stringify({
                    type: 'new_subscriber',
                    guest: conn.shortToken,
                    subscribersCount: hostConn.subscribers.size,
                    timestamp: new Date().toISOString()
                }));
            }
            
            console.log(`Guest ${conn.shortToken} suscrito a host ${hostShortToken}`);
        } else {
            ws.send(JSON.stringify({
                type: 'error',
                error: result.error || 'Error en la suscripción'
            }));
        }
    }
    
    function handleUnsubscribeMessage(ws) {
        const uuid = ws.uuid;
        const conn = activeConnections.get(uuid);
        
        if (!conn || !conn.subscribedTo) {
            ws.send(JSON.stringify({
                type: 'error',
                error: 'No estás suscrito a ningún host'
            }));
            return;
        }
        
        const hostShortToken = conn.subscribedTo;
        const success = unsubscribeGuest(uuid);
        
        if (success) {
            ws.send(JSON.stringify({
                type: 'unsubscribed',
                from: hostShortToken,
                message: 'Suscripción cancelada',
                timestamp: new Date().toISOString()
            }));
            
            // Notificar al host sobre la desuscripción
            const hostConn = getConnectionByShortToken(hostShortToken);
            if (hostConn) {
                hostConn.ws.send(JSON.stringify({
                    type: 'subscriber_left',
                    guest: conn.shortToken,
                    subscribersCount: hostConn.subscribers.size,
                    timestamp: new Date().toISOString()
                }));
            }
            
            console.log(`Guest ${conn.shortToken} desuscrito de host ${hostShortToken}`);
        } else {
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Error al cancelar la suscripción'
            }));
        }
    }
    
    function handleListPublicHostsMessage(ws) {
        const publicHostsList = getPublicHosts();
        
        // Obtener información adicional de cada host público
        const hostsInfo = [];
        for (const shortToken of publicHostsList) {
            const hostConn = getConnectionByShortToken(shortToken);
            if (hostConn && hostConn.mode === 'host') {
                hostsInfo.push({
                    shortToken: shortToken,
                    subscribersCount: hostConn.subscribers.size,
                    visibility: hostConn.visibility || 'private'
                });
            }
        }
        
        ws.send(JSON.stringify({
            type: 'public_hosts_list',
            hosts: hostsInfo,
            count: hostsInfo.length,
            maxPublicHosts: MAX_PUBLIC_HOSTS,
            timestamp: new Date().toISOString()
        }));
        
        console.log(`Cliente ${ws.shortToken} solicitó lista de hosts públicos (${hostsInfo.length} hosts)`);
    }

    // Manejar cierre de conexión
    ws.on('close', () => {
        const uuid = ws.uuid;
        if (uuid && activeConnections.has(uuid)) {
            const conn = activeConnections.get(uuid);
            
            // Limpiar suscripciones antes de eliminar la conexión
            if (conn.mode === 'guest' && conn.subscribedTo) {
                // Guest desconectado: remover del host
                const hostConn = getConnectionByShortToken(conn.subscribedTo);
                if (hostConn) {
                    hostConn.subscribers.delete(conn.shortToken);
                    // Notificar al host sobre la desconexión del guest
                    hostConn.ws.send(JSON.stringify({
                        type: 'subscriber_disconnected',
                        guest: conn.shortToken,
                        subscribersCount: hostConn.subscribers.size,
                        timestamp: new Date().toISOString()
                    }));
                }
            } else if (conn.mode === 'host') {
                // Host desconectado: notificar a todos los subscribers
                notifyHostDisconnection(conn.shortToken);
                
                // Remover de la lista de hosts públicos si estaba
                removeFromPublicHosts(conn.shortToken);
            }
            
            activeConnections.delete(uuid);
            // NO liberar el token corto inmediatamente - se liberará después de 10 minutos de inactividad
            // El tokenManager se encargará de limpiar tokens inactivos
            console.log(`Cliente desconectado - UUID: ${uuid}, Token corto: ${ws.shortToken}, Modo: ${conn.mode || 'none'}. Total activos: ${activeConnections.size}`);
        }
    });

    // Manejar errores en la conexión
    ws.on('error', (error) => {
        console.error(`Error en WebSocket para UUID ${ws.uuid}:`, error);
    });
});

// Iniciar servidor
const numericPort = Number(PORT);
server.listen(numericPort, () => {
    console.log(`=========================================`);
    console.log(`🚀 Servidor WebSocket proxy con tokens cortos iniciado`);
    console.log(`📡 Puerto: ${numericPort}`);
    console.log(`🌐 URL: ws://localhost:${numericPort}/`);
    console.log(`🔗 Para reconectar: ws://localhost:${numericPort}/?uuid=TU_UUID`);
    console.log(`📊 Estado: http://localhost:${numericPort}/status`);
    console.log(`🔑 Tokens cortos activos: http://localhost:${numericPort}/tokens`);
    console.log(`=========================================`);
    console.log(`⏰ ${new Date().toLocaleString()}`);
    console.log(`=========================================`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Error: El puerto ${numericPort} ya está en uso.`);
        console.error(`   Puedes cambiar el puerto en el archivo .env o liberar el puerto.`);
        console.error(`   Para matar el proceso que usa el puerto ${numericPort}, ejecuta:`);
        console.error(`   sudo kill -9 $(sudo lsof -ti:${numericPort})`);
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
    for (const [uuid, conn] of activeConnections) {
        conn.ws.close();
    }
    
    console.log('Servidor cerrado correctamente');
    console.log('=========================================');
    process.exit(0);
});
