function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && globalThis.Array.isArray(value) === false;
}

function stringifyUnknown(value: unknown): string {
    try {
        return globalThis.String(value);
    } catch {
        return '';
    }
}

export function normalizeMessage(value: unknown, fallback: string): string {
    if (typeof value === 'string') {
        return value.length > 0 ? value : fallback;
    }

    if (value === undefined || value === null) {
        return fallback;
    }

    const message = stringifyUnknown(value);
    return message.length > 0 ? message : fallback;
}

export function serializeUnknown(value: unknown): unknown {
    if (
        value === null ||
        value === undefined ||
        typeof value === 'boolean' ||
        typeof value === 'number' ||
        typeof value === 'string'
    ) {
        return value;
    }

    if (value instanceof globalThis.Error) {
        const normalizedError: {
            readonly message: string;
            readonly name: string;
            readonly stack?: string;
        } = {
            message: value.message,
            name: value.name,
        };

        if (typeof value.stack === 'string' && value.stack.length > 0) {
            return {
                ...normalizedError,
                stack: value.stack,
            };
        }

        return normalizedError;
    }

    try {
        const serialized = globalThis.JSON.stringify(value);
        if (serialized === undefined) {
            return stringifyUnknown(value);
        }

        return globalThis.JSON.parse(serialized);
    } catch {
        const stringified = stringifyUnknown(value);
        return stringified.length > 0 ? stringified : '[unserializable]';
    }
}

export function normalizeDetails(value: unknown): readonly unknown[] {
    if (value === undefined || value === null) {
        return [];
    }

    if (globalThis.Array.isArray(value)) {
        return value.map(serializeUnknown);
    }

    if (isPlainObject(value)) {
        const keys = globalThis.Object.keys(value);
        if (keys.length === 0) {
            return [];
        }

        return [serializeUnknown(value)];
    }

    return [serializeUnknown(value)];
}
