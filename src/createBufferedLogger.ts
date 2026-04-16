import type {
    BaseLogEntry,
    FlushOptions,
    LoggerPolicy,
    LogTransport,
    LogWriteEntry,
    RuntimeLogger,
} from './types.js';

import { LogLevel } from './types.js';
import { normalizeDetails } from './normalize.js';

const DEFAULT_MAX_QUEUE_SIZE = 1_000;
const DEFAULT_BATCH_SIZE = 32;

function resolvePositiveInt(value: number | undefined, fallback: number): number {
    if (value === undefined || globalThis.Number.isInteger(value) === false || value <= 0) {
        return fallback;
    }

    return value;
}

type AnyLogFields = Record<string, unknown>;
type AnyLogEntry = BaseLogEntry & AnyLogFields;

function appendAppVersion(entry: AnyLogEntry, appVersion: string): AnyLogEntry {
    if (appVersion.length === 0) {
        return entry;
    }

    return {
        ...entry,
        appVersion,
    };
}

function isLogWriteEntry<TFields extends object>(
    value: string | LogWriteEntry<TFields>
): value is LogWriteEntry<TFields> {
    return typeof value !== 'string';
}

export function createBufferedLogger<TFields extends object = Record<never, never>>(
    transport: LogTransport<TFields>,
    policy: LoggerPolicy
): RuntimeLogger<TFields>;
export function createBufferedLogger(
    transport: LogTransport<Record<never, never>>,
    policy: LoggerPolicy
): RuntimeLogger;
export function createBufferedLogger(
    transport: LogTransport<AnyLogFields>,
    policy: LoggerPolicy
) {
    const maxQueueSize = resolvePositiveInt(policy.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE);
    const batchSize = resolvePositiveInt(policy.batchSize, DEFAULT_BATCH_SIZE);
    const appVersion = policy.appVersion;

    const queue: AnyLogEntry[] = [];
    let isDisposed = false;
    let isFlushing = false;

    function trimQueue(): void {
        if (queue.length <= maxQueueSize) {
            return;
        }

        queue.splice(0, queue.length - maxQueueSize);
    }

    function createEntry(
        level: LogLevel,
        messageOrEntry: string | LogWriteEntry<AnyLogFields>,
        details: unknown
    ): AnyLogEntry {
        let message: string;
        let entryDetails = details;
        let fields: AnyLogFields = {};

        if (isLogWriteEntry(messageOrEntry)) {
            const { details: providedDetails, message: providedMessage, ...rest } = messageOrEntry;
            message = providedMessage;
            entryDetails = providedDetails;
            fields = rest;
        } else {
            message = messageOrEntry;
        }

        const base: BaseLogEntry = {
            args: normalizeDetails(entryDetails),
            level,
            message,
            timestampMs: globalThis.Date.now(),
        };
        const entry = {
            ...base,
            ...fields,
        };

        if (typeof appVersion === 'string') {
            return appendAppVersion(entry, appVersion);
        }

        return entry;
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

    function push(level: LogLevel, messageOrEntry: string | LogWriteEntry<AnyLogFields>, details?: unknown): void {
        if (isDisposed) {
            return;
        }

        if (level === LogLevel.INFO && policy.enableLogging !== true) {
            return;
        }

        queue.push(createEntry(level, messageOrEntry, details));
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

    function info(message: string, details?: unknown): void;
    function info(entry: LogWriteEntry<AnyLogFields>): void;
    function info(messageOrEntry: string | LogWriteEntry<AnyLogFields>, details?: unknown): void {
        push(LogLevel.INFO, messageOrEntry, details);
    }

    function warn(message: string, details?: unknown): void;
    function warn(entry: LogWriteEntry<AnyLogFields>): void;
    function warn(messageOrEntry: string | LogWriteEntry<AnyLogFields>, details?: unknown): void {
        push(LogLevel.WARN, messageOrEntry, details);
    }

    function error(message: string, details?: unknown): void;
    function error(entry: LogWriteEntry<AnyLogFields>): void;
    function error(messageOrEntry: string | LogWriteEntry<AnyLogFields>, details?: unknown): void {
        push(LogLevel.ERROR, messageOrEntry, details);
    }

    return {
        info,
        warn,
        error,
        flush,
        flushOnLeave,
        dispose,
    };
}
