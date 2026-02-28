// Token Manager para el sistema de tokens alfanuméricos cortos
// Caracteres permitidos: 1-9, A-Z (sin 0 ni letras minúsculas)
const ALLOWED_CHARS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

class TokenManager {
    constructor() {
        // Mapa de tokens cortos activos: shortToken -> {uuid, ip, lastActivity}
        this.activeShortTokens = new Map();
        // Mapa de tokens cortos liberados por tiempo: shortToken -> timestamp de liberación
        this.releasedShortTokens = new Map();
        // Longitud actual de los tokens cortos
        this.currentShortTokenLength = 4;
        // Tiempo de expiración en milisegundos (10 minutos)
        this.expirationTime = 10 * 60 * 1000;
        // Mapa de UUID a shortToken para búsqueda inversa
        this.uuidToShortToken = new Map();
        // Limpiar tokens expirados periódicamente
        this.startCleanupInterval();
    }

    // Generar un token corto aleatorio de la longitud especificada
    generateRandomShortToken(length) {
        let token = '';
        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * ALLOWED_CHARS.length);
            token += ALLOWED_CHARS[randomIndex];
        }
        return token;
    }

    // Verificar si un token corto ya está en uso (activo o recientemente liberado)
    isShortTokenInUse(shortToken) {
        return this.activeShortTokens.has(shortToken) || this.releasedShortTokens.has(shortToken);
    }

    // Generar un token corto único
    generateUniqueShortToken() {
        let attempts = 0;
        const maxAttempts = 100;
        
        while (attempts < maxAttempts) {
            const shortToken = this.generateRandomShortToken(this.currentShortTokenLength);
            
            if (!this.isShortTokenInUse(shortToken)) {
                return shortToken;
            }
            
            attempts++;
        }
        
        // Si no se encontró token único con la longitud actual, aumentar longitud
        this.currentShortTokenLength++;
        console.log(`Aumentando longitud de token corto a ${this.currentShortTokenLength} caracteres`);
        
        // Intentar con la nueva longitud
        return this.generateRandomShortToken(this.currentShortTokenLength);
    }

    // Asignar un token corto a un UUID
    assignShortToken(uuid, ip) {
        const shortToken = this.generateUniqueShortToken();
        const now = Date.now();
        
        this.activeShortTokens.set(shortToken, {
            uuid,
            ip,
            lastActivity: now,
            assignedAt: now
        });
        
        // Guardar mapeo inverso
        this.uuidToShortToken.set(uuid, shortToken);
        
        // Si el token estaba en releasedTokens, eliminarlo
        this.releasedShortTokens.delete(shortToken);
        
        return shortToken;
    }

    // Obtener información de un token corto activo
    getShortTokenInfo(shortToken) {
        return this.activeShortTokens.get(shortToken);
    }

    // Obtener shortToken por UUID
    getShortTokenByUuid(uuid) {
        return this.uuidToShortToken.get(uuid);
    }

    // Obtener UUID por shortToken
    getUuidByShortToken(shortToken) {
        const info = this.activeShortTokens.get(shortToken);
        return info ? info.uuid : null;
    }

    // Verificar si un token corto es válido para una IP
    isValidShortTokenForIp(shortToken, ip) {
        const tokenInfo = this.activeShortTokens.get(shortToken);
        if (!tokenInfo) {
            return false;
        }
        
        // Verificar que la IP coincida
        return tokenInfo.ip === ip;
    }

    // Actualizar la última actividad de un token corto
    updateShortTokenActivity(shortToken) {
        const tokenInfo = this.activeShortTokens.get(shortToken);
        if (tokenInfo) {
            tokenInfo.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    // Liberar un token corto (cuando se desconecta)
    releaseShortToken(shortToken) {
        const tokenInfo = this.activeShortTokens.get(shortToken);
        if (tokenInfo) {
            const uuid = tokenInfo.uuid;
            this.activeShortTokens.delete(shortToken);
            // Eliminar mapeo inverso
            this.uuidToShortToken.delete(uuid);
            // Marcar como liberado con timestamp
            this.releasedShortTokens.set(shortToken, Date.now());
            return true;
        }
        return false;
    }

    // Liberar token corto por UUID
    releaseShortTokenByUuid(uuid) {
        const shortToken = this.uuidToShortToken.get(uuid);
        if (shortToken) {
            return this.releaseShortToken(shortToken);
        }
        return false;
    }

    // Limpiar tokens cortos liberados que han expirado (más de 10 minutos)
    cleanupExpiredShortTokens() {
        const now = Date.now();
        const expiredTokens = [];
        
        for (const [shortToken, releaseTime] of this.releasedShortTokens) {
            if (now - releaseTime > this.expirationTime) {
                expiredTokens.push(shortToken);
            }
        }
        
        // Eliminar tokens expirados
        expiredTokens.forEach(shortToken => {
            this.releasedShortTokens.delete(shortToken);
        });
        
        if (expiredTokens.length > 0) {
            console.log(`Limpiados ${expiredTokens.length} tokens cortos expirados: ${expiredTokens.join(', ')}`);
        }
        
        // También limpiar tokens activos inactivos (por si acaso)
        this.cleanupInactiveShortTokens();
    }

    // Limpiar tokens cortos activos inactivos (más de 10 minutos sin actividad)
    cleanupInactiveShortTokens() {
        const now = Date.now();
        const inactiveTokens = [];
        
        for (const [shortToken, info] of this.activeShortTokens) {
            if (now - info.lastActivity > this.expirationTime) {
                inactiveTokens.push(shortToken);
            }
        }
        
        // Liberar tokens inactivos
        inactiveTokens.forEach(shortToken => {
            console.log(`Liberando token corto inactivo: ${shortToken} (última actividad hace ${Math.floor((now - this.activeShortTokens.get(shortToken).lastActivity) / 60000)} minutos)`);
            this.releaseShortToken(shortToken);
        });
    }

    // Iniciar intervalo de limpieza periódica
    startCleanupInterval() {
        // Limpiar cada minuto
        setInterval(() => {
            this.cleanupExpiredShortTokens();
        }, 60 * 1000);
    }

    // Obtener estadísticas
    getStats() {
        return {
            activeShortTokens: this.activeShortTokens.size,
            releasedShortTokens: this.releasedShortTokens.size,
            currentShortTokenLength: this.currentShortTokenLength,
            expirationTimeMinutes: this.expirationTime / 60000
        };
    }

    // Obtener todos los tokens cortos activos
    getAllActiveShortTokens() {
        const result = {};
        for (const [shortToken, info] of this.activeShortTokens) {
            result[shortToken] = {
                uuid: info.uuid,
                ip: info.ip,
                lastActivity: new Date(info.lastActivity).toISOString(),
                assignedAt: new Date(info.assignedAt).toISOString(),
                inactiveForMinutes: Math.floor((Date.now() - info.lastActivity) / 60000)
            };
        }
        return result;
    }
}

module.exports = new TokenManager();