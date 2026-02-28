require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const url = require('url');

// Configuración
const PORT = parseInt(process.env.PORT) || 4001;

// Almacenar conexiones activas: uuid -> {ws, ip}
const activeConnections = new Map();

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

// Crear servidor HTTP
const server = http.createServer((req, res) => {
    // Ruta de estado
    if (req.url === '/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            activeConnections: activeConnections.size,
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

    if (uuid) {
        // Validar el UUID proporcionado
        if (!isValidUuidForIp(uuid, clientIp)) {
            console.log(`UUID inválido para IP ${clientIp}: ${uuid}`);
            ws.close();
            return;
        }
        // Verificar si el UUID ya está en uso
        if (activeConnections.has(uuid)) {
            console.log(`UUID ya en uso: ${uuid}`);
            ws.close();
            return;
        }
        finalUuid = uuid;
        console.log(`Reconexión con UUID existente: ${finalUuid}`);
    } else {
        // Generar nuevo UUID
        finalUuid = generateUuid(clientIp);
        console.log(`Nuevo UUID generado: ${finalUuid}`);
    }

    // Almacenar la conexión
    activeConnections.set(finalUuid, {
        ws: ws,
        ip: clientIp,
        ipBase64: ipToBase64(clientIp)
    });

    // Asociar el UUID con el WebSocket
    ws.uuid = finalUuid;

    // Enviar el UUID al cliente
    ws.send(JSON.stringify({
        type: 'uuid_assigned',
        uuid: finalUuid
    }));

    console.log(`Cliente conectado con UUID: ${finalUuid}. Total activos: ${activeConnections.size}`);

    // Manejar mensajes recibidos
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            // Validar formato del mensaje
            if (!message.to || !message.message) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Formato de mensaje inválido. Debe contener "to" y "message"'
                }));
                return;
            }

            const targetUuid = message.to;
            const senderUuid = ws.uuid;

            // Buscar el WebSocket del destinatario
            const targetConn = activeConnections.get(targetUuid);
            if (!targetConn) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: `Destinatario ${targetUuid} no encontrado`
                }));
                return;
            }

            // Enviar el mensaje al destinatario
            targetConn.ws.send(JSON.stringify({
                type: 'message',
                from: senderUuid,
                message: message.message,
                timestamp: new Date().toISOString()
            }));

            // Confirmación al remitente
            ws.send(JSON.stringify({
                type: 'message_sent',
                to: targetUuid,
                timestamp: new Date().toISOString()
            }));

            console.log(`📨 Mensaje de ${senderUuid} a ${targetUuid}: "${message.message.substring(0, 50)}${message.message.length > 50 ? '...' : ''}"`);

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
        const uuid = ws.uuid;
        if (uuid && activeConnections.has(uuid)) {
            activeConnections.delete(uuid);
            console.log(`Cliente desconectado: ${uuid}. Total activos: ${activeConnections.size}`);
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
    console.log(`🚀 Servidor WebSocket proxy iniciado`);
    console.log(`📡 Puerto: ${numericPort}`);
    console.log(`🌐 URL: ws://localhost:${numericPort}/`);
    console.log(`🔗 Para reconectar: ws://localhost:${numericPort}/?uuid=TU_UUID`);
    console.log(`📊 Estado: http://localhost:${numericPort}/status`);
    console.log(`=========================================`);
    console.log(`⏰ ${new Date().toLocaleString()}`);
    console.log(`=========================================`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Error: El puerto ${numericPort} ya está en uso.`);
        console.error(`   Puedes cambiar el puerto en el archivo .env o liberar el puerto.`);
        console.error(`   Para matar el proceso que usa el puerto ${numericPort}, ejecuta:`);
        console.error(`   sudo kill -9 $(sudo lsof -ti:${numericPort})`);
    } else {
        console.error(`❌ Error al iniciar servidor:`, err);
    }
    process.exit(1);
});

// Manejo de cierre limpio
process.on('SIGINT', () => {
    console.log('\n=========================================');
    console.log('🛑 Recibida señal SIGINT (Ctrl+C)');
    console.log(`📊 Cerrando ${activeConnections.size} conexiones activas...`);
    
    // Cerrar todas las conexiones activas
    for (const [uuid, conn] of activeConnections) {
        conn.ws.close();
    }
    
    console.log('👋 Servidor cerrado correctamente');
    console.log('=========================================');
    process.exit(0);
});
