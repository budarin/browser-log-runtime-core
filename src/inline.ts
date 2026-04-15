const DEFAULT_MAX_QUEUE_SIZE = 1_000;
const DEFAULT_BATCH_SIZE = 32;

export type InlineLogLevel = 'info' | 'warn' | 'error';

export type InlineLogEntry = {
    readonly args: readonly unknown[];
    readonly level: InlineLogLevel;
    readonly message: string;
    readonly timestampMs: number;
    readonly appVersion?: string;
    readonly source?: string;
};

export type InlineLoggerSend = (
    entries: readonly InlineLogEntry[],
    keepalive: boolean
) => Promise<boolean>;

export type InlineLoggerOptions = {
    readonly send: InlineLoggerSend;
    readonly defaultMessage: string;
    readonly isInfoEnabled: boolean;
    readonly appVersion?: string;
    readonly source?: string;
    readonly batchSize?: number;
    readonly maxQueueSize?: number;
};

export type InlineGlobalErrorPayload = {
    readonly message: string;
    readonly raw: unknown;
    readonly stack?: string;
};

export type InlineErrorHandlers = {
    readonly onError?: (payload: InlineGlobalErrorPayload) => void;
    readonly onUnhandledRejection?: (payload: InlineGlobalErrorPayload) => void;
};

export type InlineLogger = {
    info: (message?: unknown, details?: unknown) => void;
    warn: (message?: unknown, details?: unknown) => void;
    error: (message?: unknown, details?: unknown) => void;
    flush: (keepalive?: boolean) => Promise<void>;
    flushOnLeave: () => void;
    attachGlobalErrorHandlers: (handlers?: InlineErrorHandlers) => () => void;
    attachPagehideFlush: () => () => void;
    dispose: () => void;
};

function resolvePositiveInt(value: number | undefined, fallback: number): number {
    if (value === undefined || globalThis.Number.isInteger(value) === false || value <= 0) {
        return fallback;
    }
    return value;
}

function toStringSafe(value: unknown): string {
    try {
        return globalThis.String(value);
    } catch {
        return '';
    }
}

function toMessage(value: unknown, fallback: string): string {
    if (typeof value === 'string') {
        return value.length > 0 ? value : fallback;
    }
    if (value instanceof globalThis.Error) {
        return value.message.length > 0 ? value.message : fallback;
    }
    if (value === null || value === undefined) {
        return fallback;
    }
    const text = toStringSafe(value);
    return text.length > 0 ? text : fallback;
}

function normalizeError(error: Error): InlineGlobalErrorPayload {
    if (typeof error.stack === 'string' && error.stack.length > 0) {
        return {
            message: toMessage(error.message, 'runtime error'),
            raw: error,
            stack: error.stack,
        };
    }
    return {
        message: toMessage(error.message, 'runtime error'),
        raw: error,
    };
}

function normalizeDetailValue(value: unknown): unknown {
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
        return normalizeError(value);
    }
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, field] of globalThis.Object.entries(value)) {
            out[key] = normalizeDetailValue(field);
        }
        return out;
    }
    const text = toStringSafe(value);
    return text.length > 0 ? text : '[unserializable]';
}

function normalizeDetails(details: unknown): readonly unknown[] {
    if (details === null || details === undefined) {
        return [];
    }
    if (globalThis.Array.isArray(details)) {
        return details.map((item) => normalizeDetailValue(item));
    }
    return [normalizeDetailValue(details)];
}

function toErrorPayload(raw: unknown, fallback: string): InlineGlobalErrorPayload {
    if (raw instanceof globalThis.Error) {
        const payload = normalizeError(raw);
        if (typeof payload.stack === 'string' && payload.stack.length > 0) {
            return {
                message: toMessage(payload.message, fallback),
                raw: payload.raw,
                stack: payload.stack,
            };
        }
        return {
            message: toMessage(payload.message, fallback),
            raw: payload.raw,
        };
    }
    return {
        message: toMessage(raw, fallback),
        raw,
    };
}

export function createInlineLogger(options: InlineLoggerOptions): InlineLogger {
    const maxQueueSize = resolvePositiveInt(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE);
    const batchSize = resolvePositiveInt(options.batchSize, DEFAULT_BATCH_SIZE);

    const queue: InlineLogEntry[] = [];
    const detachSet = new Set<() => void>();

    let isDisposed = false;
    let isFlushing = false;

    function trimQueue(): void {
        if (queue.length > maxQueueSize) {
            queue.splice(0, queue.length - maxQueueSize);
        }
    }

    function makeEntry(level: InlineLogLevel, message: unknown, details: unknown): InlineLogEntry {
        let entry: InlineLogEntry = {
            level,
            message: toMessage(message, options.defaultMessage),
            args: normalizeDetails(details),
            timestampMs: globalThis.Date.now(),
        };
        if (typeof options.appVersion === 'string' && options.appVersion.length > 0) {
            entry = {
                ...entry,
                appVersion: options.appVersion,
            };
        }
        if (typeof options.source === 'string' && options.source.length > 0) {
            entry = {
                ...entry,
                source: options.source,
            };
        }
        return entry;
    }

    async function flush(keepalive?: boolean): Promise<void> {
        if (isDisposed || isFlushing || queue.length === 0) {
            return;
        }
        isFlushing = true;
        try {
            const useKeepalive = keepalive === true;
            while (queue.length > 0) {
                const batch = queue.slice(0, batchSize);
                const ok = await options.send(batch, useKeepalive);
                if (ok === false) {
                    break;
                }
                queue.splice(0, batch.length);
            }
        } finally {
            isFlushing = false;
        }
    }

    function push(level: InlineLogLevel, message: unknown, details: unknown): void {
        if (isDisposed) {
            return;
        }
        if (level === 'info' && options.isInfoEnabled === false) {
            return;
        }
        queue.push(makeEntry(level, message, details));
        trimQueue();
        if (isFlushing === false) {
            void flush(false);
        }
    }

    function flushOnLeave(): void {
        void flush(true);
    }

    function attachPagehideFlush(): () => void {
        if (isDisposed || typeof globalThis.addEventListener !== 'function') {
            return () => undefined;
        }

        let detached = false;
        const onPagehide = (): void => {
            flushOnLeave();
        };

        const detach = (): void => {
            if (detached) {
                return;
            }
            detached = true;
            detachSet.delete(detach);
            if (typeof globalThis.removeEventListener === 'function') {
                globalThis.removeEventListener('pagehide', onPagehide, { capture: true });
            }
        };

        globalThis.addEventListener('pagehide', onPagehide, { capture: true });
        detachSet.add(detach);
        return detach;
    }

    function attachGlobalErrorHandlers(handlers?: InlineErrorHandlers): () => void {
        if (isDisposed || typeof globalThis.addEventListener !== 'function') {
            return () => undefined;
        }

        let detached = false;
        const onError = handlers?.onError ?? ((payload: InlineGlobalErrorPayload): void => {
            push('error', '[runtime] global error', payload);
        });
        const onUnhandled =
            handlers?.onUnhandledRejection ?? ((payload: InlineGlobalErrorPayload): void => {
                push('error', '[runtime] unhandled rejection', payload);
            });

        const onRuntimeError: EventListener = (event): void => {
            let raw: unknown = event;
            let fallback = 'runtime error';
            if ('error' in event && event.error !== undefined) {
                raw = event.error;
            } else if ('message' in event && typeof event.message === 'string') {
                raw = event.message;
            }
            if ('message' in event && typeof event.message === 'string' && event.message.length > 0) {
                fallback = event.message;
            }
            onError(toErrorPayload(raw, fallback));
        };

        const onUnhandledRejection: EventListener = (event): void => {
            let reason: unknown = event;
            if ('reason' in event) {
                reason = event.reason;
            }
            onUnhandled(toErrorPayload(reason, 'unhandled rejection'));
        };

        const detach = (): void => {
            if (detached) {
                return;
            }
            detached = true;
            detachSet.delete(detach);
            if (typeof globalThis.removeEventListener === 'function') {
                globalThis.removeEventListener('error', onRuntimeError);
                globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
            }
        };

        globalThis.addEventListener('error', onRuntimeError);
        globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
        detachSet.add(detach);
        return detach;
    }

    function dispose(): void {
        if (isDisposed) {
            return;
        }
        isDisposed = true;
        for (const detach of detachSet) {
            detach();
        }
        detachSet.clear();
        queue.splice(0, queue.length);
    }

    return {
        info(message, details) {
            push('info', message, details);
        },
        warn(message, details) {
            push('warn', message, details);
        },
        error(message, details) {
            push('error', message, details);
        },
        flush,
        flushOnLeave,
        attachGlobalErrorHandlers,
        attachPagehideFlush,
        dispose,
    };
}
