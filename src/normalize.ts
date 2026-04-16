function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || globalThis.Array.isArray(value)) {
        return false;
    }
    const prototype = globalThis.Object.getPrototypeOf(value);
    return prototype === globalThis.Object.prototype || prototype === null;
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

function serializeError(error: Error): { readonly message: string; readonly name: string; readonly stack?: string } {
    const normalizedError: {
        readonly message: string;
        readonly name: string;
        readonly stack?: string;
    } = {
        message: error.message,
        name: error.name,
    };

    if (typeof error.stack === 'string' && error.stack.length > 0) {
        return {
            ...normalizedError,
            stack: error.stack,
        };
    }

    return normalizedError;
}

function toJsonCompatible(value: Record<string, unknown> | readonly unknown[]): unknown {
    try {
        const serialized = globalThis.JSON.stringify(value, (_, currentValue) => {
            if (typeof currentValue === 'bigint') {
                return currentValue.toString();
            }
            if (currentValue instanceof globalThis.Error) {
                return serializeError(currentValue);
            }
            return currentValue;
        });

        if (typeof serialized !== 'string') {
            return undefined;
        }

        return globalThis.JSON.parse(serialized);
    } catch {
        return undefined;
    }
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

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (value instanceof globalThis.Error) {
        return serializeError(value);
    }

    if (globalThis.Array.isArray(value) || isPlainObject(value)) {
        const structured = toJsonCompatible(value);
        if (structured !== undefined) {
            return structured;
        }
    }

    const stringified = stringifyUnknown(value);
    return stringified.length > 0 ? stringified : '[unserializable]';
}

export function normalizeDetails(value: unknown): readonly unknown[] {
    if (value === undefined || value === null) {
        return [];
    }

    if (globalThis.Array.isArray(value)) {
        return value.map(serializeUnknown);
    }

    if (isPlainObject(value)) {
        return [serializeUnknown(value)];
    }

    return [serializeUnknown(value)];
}
