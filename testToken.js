// Test script para verificar el sistema de tokens
const tokenManager = require('./tokenManager');

console.log('=== Test del Sistema de Tokens ===\n');

// Test 1: Generar tokens únicos
console.log('Test 1: Generar tokens únicos');
const tokens = new Set();
for (let i = 0; i < 10; i++) {
    const token = tokenManager.generateUniqueToken();
    tokens.add(token);
    console.log(`  Token ${i + 1}: ${token} (longitud: ${token.length})`);
}
console.log(`  Tokens únicos generados: ${tokens.size}/10\n`);

// Test 2: Verificar formato de tokens
console.log('Test 2: Verificar formato de tokens');
const testToken = tokenManager.generateRandomToken(4);
console.log(`  Token de ejemplo: ${testToken}`);
console.log(`  Longitud: ${testToken.length}`);
console.log(`  Contiene solo 1-9,A-Z: ${/^[1-9A-Z]+$/.test(testToken)}`);

// Test 3: Asignar y liberar tokens
console.log('\nTest 3: Asignar y liberar tokens');
const uuid1 = 'test-uuid-1';
const ip1 = '192.168.1.100';
const token1 = tokenManager.assignToken(uuid1, ip1);
console.log(`  Token asignado: ${token1}`);
console.log(`  Información del token:`, tokenManager.getTokenInfo(token1));
console.log(`  Es válido para IP ${ip1}: ${tokenManager.isValidTokenForIp(token1, ip1)}`);
console.log(`  Es válido para IP diferente: ${tokenManager.isValidTokenForIp(token1, '10.0.0.1')}`);

// Liberar token
tokenManager.releaseToken(token1);
console.log(`  Token liberado: ${token1}`);
console.log(`  Token aún activo después de liberar: ${tokenManager.getTokenInfo(token1) !== undefined}`);

// Test 4: Estadísticas
console.log('\nTest 4: Estadísticas del sistema');
const stats = tokenManager.getStats();
console.log('  Estadísticas:', stats);

// Test 5: Limpieza de tokens expirados
console.log('\nTest 5: Simular limpieza de tokens expirados');
// Forzar limpieza
tokenManager.cleanupExpiredTokens();
console.log('  Limpieza completada');

console.log('\n=== Test completado ===');