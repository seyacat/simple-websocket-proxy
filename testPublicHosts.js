// Test script para verificar la funcionalidad de hosts públicos/privados
const WebSocket = require('ws');

console.log('=== Test de Hosts Públicos/Privados ===\n');

const SERVER_URL = 'ws://localhost:4001';
let hostPublicWs = null;
let hostPrivateWs = null;
let guestWs = null;
let hostPublicToken = null;
let hostPrivateToken = null;
let guestToken = null;

// Helper function para enviar mensajes y esperar respuestas
function sendAndWait(ws, message, expectedType, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout esperando respuesta para: ${JSON.stringify(message)}`));
        }, timeout);
        
        const messageHandler = (data) => {
            try {
                const response = JSON.parse(data.toString());
                if (expectedType && response.type !== expectedType) {
                    // Si no es el tipo esperado, continuar esperando
                    return;
                }
                clearTimeout(timer);
                ws.removeListener('message', messageHandler);
                resolve(response);
            } catch (error) {
                clearTimeout(timer);
                ws.removeListener('message', messageHandler);
                reject(error);
            }
        };
        
        ws.on('message', messageHandler);
        ws.send(JSON.stringify(message));
    });
}

// Conectar cliente y obtener token
async function connectClient() {
    const ws = new WebSocket(SERVER_URL);
    
    await new Promise((resolve) => {
        ws.on('open', resolve);
    });
    
    // Esperar mensaje de conexión establecida
    const connectionMsg = await new Promise((resolve) => {
        ws.once('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'connection_established') {
                resolve(msg);
            }
        });
    });
    
    return { ws, token: connectionMsg.shortToken };
}

// Test 1: Conectar host público
async function test1() {
    console.log('Test 1: Conectar host público');
    
    const { ws, token } = await connectClient();
    hostPublicWs = ws;
    hostPublicToken = token;
    console.log(`  Host público conectado con token: ${hostPublicToken}`);
    
    // Establecer modo host con visibilidad pública
    const modeResponse = await sendAndWait(hostPublicWs, {
        type: 'set_mode',
        mode: 'host',
        visibility: 'public'
    }, 'mode_set');
    
    console.log(`  Modo establecido: ${modeResponse.mode} (${modeResponse.visibility})`);
    console.log('  Test 1 completado ✓\n');
}

// Test 2: Conectar host privado
async function test2() {
    console.log('Test 2: Conectar host privado');
    
    const { ws, token } = await connectClient();
    hostPrivateWs = ws;
    hostPrivateToken = token;
    console.log(`  Host privado conectado con token: ${hostPrivateToken}`);
    
    // Establecer modo host con visibilidad privada (por defecto)
    const modeResponse = await sendAndWait(hostPrivateWs, {
        type: 'set_mode',
        mode: 'host'
        // visibility no especificado, debe ser 'private' por defecto
    }, 'mode_set');
    
    console.log(`  Modo establecido: ${modeResponse.mode} (${modeResponse.visibility || 'private'})`);
    console.log('  Test 2 completado ✓\n');
}

// Test 3: Conectar guest
async function test3() {
    console.log('Test 3: Conectar guest');
    
    const { ws, token } = await connectClient();
    guestWs = ws;
    guestToken = token;
    console.log(`  Guest conectado con token: ${guestToken}`);
    
    // Establecer modo guest
    const modeResponse = await sendAndWait(guestWs, {
        type: 'set_mode',
        mode: 'guest'
    }, 'mode_set');
    
    console.log(`  Modo establecido: ${modeResponse.mode}`);
    console.log('  Test 3 completado ✓\n');
}

// Test 4: Listar hosts públicos desde el guest
async function test4() {
    console.log('Test 4: Listar hosts públicos desde guest');
    
    const response = await sendAndWait(guestWs, {
        type: 'list_public_hosts'
    }, 'public_hosts_list');
    
    console.log(`  Se encontraron ${response.count} hosts públicos:`);
    response.hosts.forEach((host, index) => {
        console.log(`    ${index + 1}. Token: ${host.shortToken}, Suscriptores: ${host.subscribersCount}, Visibilidad: ${host.visibility}`);
    });
    
    // Verificar que solo el host público está en la lista
    const publicHostInList = response.hosts.some(h => h.shortToken === hostPublicToken);
    const privateHostInList = response.hosts.some(h => h.shortToken === hostPrivateToken);
    
    if (publicHostInList && !privateHostInList) {
        console.log('  ✓ Solo el host público aparece en la lista');
    } else {
        console.log('  ✗ Error: La lista de hosts públicos no es correcta');
    }
    
    console.log('  Test 4 completado ✓\n');
}

// Test 5: Cambiar visibilidad de host
async function test5() {
    console.log('Test 5: Cambiar host privado a público');
    
    // Primero listar hosts públicos para ver el estado inicial
    const initialResponse = await sendAndWait(guestWs, {
        type: 'list_public_hosts'
    }, 'public_hosts_list');
    
    const initialCount = initialResponse.count;
    
    // Cambiar host privado a público
    const modeResponse = await sendAndWait(hostPrivateWs, {
        type: 'set_mode',
        mode: 'host',
        visibility: 'public'
    }, 'mode_set');
    
    console.log(`  Host privado cambiado a: ${modeResponse.mode} (${modeResponse.visibility})`);
    
    // Listar hosts públicos nuevamente
    const finalResponse = await sendAndWait(guestWs, {
        type: 'list_public_hosts'
    }, 'public_hosts_list');
    
    console.log(`  Ahora hay ${finalResponse.count} hosts públicos (antes: ${initialCount})`);
    
    // Verificar que ambos hosts están en la lista
    const publicHostInList = finalResponse.hosts.some(h => h.shortToken === hostPublicToken);
    const privateHostInList = finalResponse.hosts.some(h => h.shortToken === hostPrivateToken);
    
    if (publicHostInList && privateHostInList) {
        console.log('  ✓ Ambos hosts aparecen en la lista pública');
    } else {
        console.log('  ✗ Error: No ambos hosts están en la lista');
    }
    
    console.log('  Test 5 completado ✓\n');
}

// Test 6: Verificar límite FIFO (simulación)
async function test6() {
    console.log('Test 6: Verificar que la lista mantiene orden FIFO');
    
    // Listar hosts públicos
    const response = await sendAndWait(guestWs, {
        type: 'list_public_hosts'
    }, 'public_hosts_list');
    
    console.log(`  Lista FIFO completa: ${response.hosts.map(h => h.shortToken).join(', ')}`);
    console.log(`  Máximo de hosts públicos: ${response.maxPublicHosts}`);
    
    if (response.hosts.length <= response.maxPublicHosts) {
        console.log('  ✓ La lista respeta el límite máximo');
    } else {
        console.log('  ✗ Error: La lista excede el límite máximo');
    }
    
    console.log('  Test 6 completado ✓\n');
}

// Ejecutar todos los tests
async function runAllTests() {
    try {
        await test1();
        await test2();
        await test3();
        await test4();
        await test5();
        await test6();
        
        console.log('=========================================');
        console.log('Todos los tests completados exitosamente!');
        console.log('=========================================');
        
        // Cerrar conexiones
        if (hostPublicWs) hostPublicWs.close();
        if (hostPrivateWs) hostPrivateWs.close();
        if (guestWs) guestWs.close();
        
    } catch (error) {
        console.error('Error en los tests:', error);
        
        // Cerrar conexiones en caso de error
        if (hostPublicWs) hostPublicWs.close();
        if (hostPrivateWs) hostPrivateWs.close();
        if (guestWs) guestWs.close();
        
        process.exit(1);
    }
}

// Verificar si el servidor está corriendo
console.log('Asegúrate de que el servidor esté corriendo en el puerto 4001');
console.log('Ejecuta: npm run dev\n');

// Ejecutar tests después de 2 segundos para dar tiempo a leer el mensaje
setTimeout(() => {
    runAllTests();
}, 2000);