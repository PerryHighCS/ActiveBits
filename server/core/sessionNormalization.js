const sessionNormalizers = new Map();

function ensurePlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function registerSessionNormalizer(activityType, normalizer) {
    if (typeof activityType !== 'string' || activityType.length === 0) {
        throw new Error('registerSessionNormalizer requires a non-empty activity type string');
    }
    if (typeof normalizer !== 'function') {
        throw new Error(`registerSessionNormalizer for "${activityType}" requires a function`);
    }

    if (sessionNormalizers.has(activityType)) {
        console.warn(`[sessionNormalization] Overriding session normalizer for "${activityType}"`);
    }

    sessionNormalizers.set(activityType, normalizer);
}

export function getRegisteredSessionNormalizers() {
    return new Map(sessionNormalizers);
}

export function normalizeSessionData(session) {
    if (!session || typeof session !== 'object') return session;
    session.data = ensurePlainObject(session.data);

    const normalizer = sessionNormalizers.get(session.type);
    if (normalizer) {
        try {
            normalizer(session);
        } catch (err) {
            console.error(`[sessionNormalization] Failed to normalize session for "${session.type}":`, err);
        }
    }
    return session;
}

export function resetSessionNormalizersForTests() {
    sessionNormalizers.clear();
}
