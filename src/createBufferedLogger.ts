import type { FlushOptions, LogEntry, LoggerPolicy, LogTransport, RuntimeLogger } from './types.js';

import { LogLevel } from './types.js';
import { normalizeDetails, normalizeMessage } from './normalize.js';

const DEFAULT_MAX_QUEUE_SIZE = 1_000;
const DEFAULT_BATCH_SIZE = 32;

function resolvePositiveInt(value: number | undefined, fallback: number): number {
    if (value === undefined || globalThis.Number.isInteger(value) === false || value <= 0) {
        return fallback;
    }

    return value;
}

function appendOptionalField(entry: LogEntry, field: 'appVersion' | 'source', value: string): LogEntry {
    if (value.length === 0) {
        return entry;
    }

    if (field === 'appVersion') {
        return {
            ...entry,
            appVersion: value,
        };
    }

    return {
        ...entry,
        source: value,
    };
}

export function createBufferedLogger(transport: LogTransport, policy: LoggerPolicy): RuntimeLogger {
    const maxQueueSize = resolvePositiveInt(policy.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE);
    const batchSize = resolvePositiveInt(policy.batchSize, DEFAULT_BATCH_SIZE);
    const defaultMessage = policy.defaultMessage;
    const appVersion = policy.appVersion;
    const source = policy.source;

    const queue: LogEntry[] = [];
    let isDisposed = false;
    let isFlushing = false;

    function trimQueue(): void {
        if (queue.length <= maxQueueSize) {
            return;
        }

        queue.splice(0, queue.length - maxQueueSize);
    }

    function createEntry(level: LogLevel, message: unknown, details: unknown): LogEntry {
        const base: LogEntry = {
            args: normalizeDetails(details),
            level,
            message: normalizeMessage(message, defaultMessage),
            timestampMs: globalThis.Date.now(),
        };

        let next = base;

        if (typeof appVersion === 'string') {
            next = appendOptionalField(next, 'appVersion', appVersion);
        }

        if (typeof source === 'string') {
            next = appendOptionalField(next, 'source', source);
        }

        return next;
    }

    async function flush(options?: FlushOptions): Promise<void> {
        if (isDisposed || isFlushing || queue.length === 0) {
            return;
        }

        isFlushing = true;
        try {
            const keepalive = options?.keepalive === true;
            while (queue.length > 0) {
                const batch = queue.slice(0, batchSize);
                const isSuccess = await transport(batch, keepalive);
                if (isSuccess === false) {
                    break;
                }
                queue.splice(0, batch.length);
            }
        } finally {
            isFlushing = false;
        }
    }

    function push(level: LogLevel, message: unknown, details: unknown): void {
        if (isDisposed) {
            return;
        }

        if (level === LogLevel.INFO && policy.isInfoEnabled === false) {
            return;
        }

        queue.push(createEntry(level, message, details));
        trimQueue();

        if (isFlushing === false) {
            void flush();
        }
    }

    function flushOnLeave(): void {
        void flush({ keepalive: true });
    }

    function dispose(): void {
        isDisposed = true;
        queue.splice(0, queue.length);
    }

    return {
        info(message, details) {
            push(LogLevel.INFO, message, details);
        },
        warn(message, details) {
            push(LogLevel.WARN, message, details);
        },
        error(message, details) {
            push(LogLevel.ERROR, message, details);
        },
        flush,
        flushOnLeave,
        dispose,
    };
}
