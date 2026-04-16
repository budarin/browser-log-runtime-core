import type {
    EmptyLogFields,
    FlushOptions,
    LogEntry,
    LoggerPolicy,
    LogMethod,
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
type AnyLogEntry = LogEntry<AnyLogFields>;

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

export function createBufferedLogger<TFields extends object = EmptyLogFields>(
    transport: LogTransport<TFields>,
    policy: LoggerPolicy
): RuntimeLogger<TFields>;
export function createBufferedLogger(
    transport: LogTransport<EmptyLogFields>,
    policy: LoggerPolicy
): RuntimeLogger;
export function createBufferedLogger(
    transport: LogTransport<AnyLogFields>,
    policy: LoggerPolicy
) {
    const maxQueueSize = resolvePositiveInt(policy.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE);
    const batchSize = resolvePositiveInt(policy.batchSize, DEFAULT_BATCH_SIZE);
    const appVersion = policy.appVersion;

    const queue: LogEntry<AnyLogFields>[] = [];
    let isDisposed = false;
    let isFlushing = false;

    function trimQueue(): void {
        if (queue.length <= maxQueueSize) {
            return;
        }

        queue.splice(0, queue.length - maxQueueSize);
    }

    function createEntry<TFields extends object>(
        level: LogLevel,
        messageOrEntry: string | LogWriteEntry<TFields>,
        details: unknown
    ): LogEntry<TFields> {
        let message: string;
        let entryDetails = details;
        let fields: TFields | EmptyLogFields = {};

        if (isLogWriteEntry(messageOrEntry)) {
            const { details: providedDetails, message: providedMessage, ...rest } = messageOrEntry;
            message = providedMessage;
            entryDetails = providedDetails;
            fields = rest as TFields;
        } else {
            message = messageOrEntry;
        }

        const base: LogEntry<EmptyLogFields> = {
            args: normalizeDetails(entryDetails),
            level,
            message,
            timestampMs: globalThis.Date.now(),
        };
        const entry = {
            ...base,
            ...fields,
        } as LogEntry<TFields>;

        if (typeof appVersion === 'string') {
            return appendAppVersion(entry, appVersion) as LogEntry<TFields>;
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

    function push<TFields extends object>(
        level: LogLevel,
        messageOrEntry: string | LogWriteEntry<TFields>,
        details?: unknown
    ): void {
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

    function info(messageOrEntry: string | LogWriteEntry<AnyLogFields>, details?: unknown): void {
        push(LogLevel.INFO, messageOrEntry, details);
    }

    function warn(messageOrEntry: string | LogWriteEntry<AnyLogFields>, details?: unknown): void {
        push(LogLevel.WARN, messageOrEntry, details);
    }

    function error(messageOrEntry: string | LogWriteEntry<AnyLogFields>, details?: unknown): void {
        push(LogLevel.ERROR, messageOrEntry, details);
    }

    const logger: RuntimeLogger<AnyLogFields> = {
        info: info as LogMethod<AnyLogFields>,
        warn: warn as LogMethod<AnyLogFields>,
        error: error as LogMethod<AnyLogFields>,
        flush,
        flushOnLeave,
        dispose,
    };

    return logger;
}
