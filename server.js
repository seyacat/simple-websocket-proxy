require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const tokenManager = require('./tokenManager');

// Configuración
const PORT = parseInt(process.env.PORT) || 4001;

// Almacenar conexiones activas: token -> {ws, ip, uuid}
const activeConnections = new Map();

// Convertir IP a base64 sin padding (mantenido para compatibilidad)
function ipToBase64(ip) {
    return Buffer.from(ip).toString('base64').replace(/=/g, '');
}

// Crear servidor HTTP
const server = http.createServer((req, res) => {
    // Ruta de estado
    if (req.url === '/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            activeConnections: activeConnections.size,
            tokenStats: tokenManager.getStats(),
            activeTokens: tokenManager.getAllActiveTokens(),
            timestamp: new Date().toISOString()
        }));
        return;
    }
    
    // Ruta para ver tokens activos
    if (req.url === '/tokens' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            activeTokens: tokenManager.getAllActiveTokens(),
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

    // Parsear query string para obtener token
    const parsedUrl = url.parse(req.url, true);
    const query = parsedUrl.query;
    let token = query.token || null;

    let finalToken;
    let isReconnection = false;

    if (token) {
        // Validar el token proporcionado
        if (!tokenManager.isValidTokenForIp(token, clientIp)) {
            console.log(`Token inválido para IP ${clientIp}: ${token}`);
            ws.close();
            return;
        }
        
        // Verificar si el token ya está en uso (conexión activa)
        if (activeConnections.has(token)) {
            console.log(`Token ya en uso: ${token}`);
            ws.close();
            return;
        }
        
        finalToken = token;
        isReconnection = true;
        console.log(`Reconexión con token existente: ${finalToken}`);
        
        // Actualizar actividad del token
        tokenManager.updateTokenActivity(finalToken);
    } else {
        // Generar nuevo token
        // Primero necesitamos un UUID temporal para asignar el token
        const tempUuid = ipToBase64(clientIp) + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        finalToken = tokenManager.assignToken(tempUuid, clientIp);
        console.log(`Nuevo token generado: ${finalToken}`);
    }

    // Obtener información del token
    const tokenInfo = tokenManager.getTokenInfo(finalToken);
    if (!tokenInfo) {
        console.log(`Error: No se pudo obtener información del token ${finalToken}`);
        ws.close();
        return;
    }

    // Almacenar la conexión
    activeConnections.set(finalToken, {
        ws: ws,
        ip: clientIp,
        uuid: tokenInfo.uuid,
        token: finalToken
    });

    // Asociar el token con el WebSocket
    ws.token = finalToken;
    ws.uuid = tokenInfo.uuid;

    // Enviar el token al cliente
    ws.send(JSON.stringify({
        type: 'token_assigned',
        token: finalToken,
        isReconnection: isReconnection,
        message: isReconnection ? 'Reconexión exitosa' : 'Nueva conexión establecida'
    }));

    console.log(`Cliente conectado con token: ${finalToken}. Total activos: ${activeConnections.size}`);

    // Manejar mensajes recibidos
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // Actualizar actividad del token
            tokenManager.updateTokenActivity(finalToken);
            
            // Validar formato del mensaje
            if (!message.to || !message.message) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Formato de mensaje inválido. Debe contener "to" y "message"'
                }));
                return;
            }

            const targetToken = message.to;
            const senderToken = ws.token;

            // Buscar el WebSocket del destinatario
            const targetConn = activeConnections.get(targetToken);
            if (!targetConn) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: `Destinatario ${targetToken} no encontrado`
                }));
                return;
            }

            // Enviar el mensaje al destinatario
            targetConn.ws.send(JSON.stringify({
                type: 'message',
                from: senderToken,
                message: message.message,
                timestamp: new Date().toISOString()
            }));

            // Confirmación al remitente
            ws.send(JSON.stringify({
                type: 'message_sent',
                to: targetToken,
                timestamp: new Date().toISOString()
            }));

            console.log(`Mensaje de ${senderToken} a ${targetToken}: "${message.message.substring(0, 50)}${message.message.length > 50 ? '...' : ''}"`);

        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Error procesando el mensaje'
            }));
        }
    });

    // Manejar cierre de conexión
    ws.on('close', () => {
        const token = ws.token;
        if (token && activeConnections.has(token)) {
            activeConnections.delete(token);
            // Liberar el token (se marcará como liberado con timestamp)
            tokenManager.releaseToken(token);
            console.log(`Cliente desconectado: ${token}. Total activos: ${activeConnections.size}`);
        }
    });

    // Manejar errores en la conexión
    ws.on('error', (error) => {
        console.error(`Error en WebSocket para token ${ws.token}:`, error);
    });
});

// Iniciar servidor
const numericPort = Number(PORT);
server.listen(numericPort, () => {
    console.log(`=========================================`);
    console.log(`🚀 Servidor WebSocket proxy con tokens iniciado`);
    console.log(`📡 Puerto: ${numericPort}`);
    console.log(`🌐 URL: ws://localhost:${numericPort}/`);
    console.log(`🔗 Para reconectar: ws://localhost:${numericPort}/?token=TU_TOKEN`);
    console.log(`📊 Estado: http://localhost:${numericPort}/status`);
    console.log(`🔑 Tokens activos: http://localhost:${numericPort}/tokens`);
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
    for (const [token, conn] of activeConnections) {
        conn.ws.close();
    }
    
    console.log('Servidor cerrado correctamente');
    console.log('=========================================');
    process.exit(0);
});
