const DEFAULT_MAX_QUEUE_SIZE = 1_000;
const DEFAULT_BATCH_SIZE = 32;

export type InlineLogLevel = 'info' | 'warn' | 'error';

export type EmptyInlineLogFields = Record<never, never>;

type RequiredKeys<TFields extends object> = {
    [TKey in keyof TFields]-?: {} extends Pick<TFields, TKey> ? never : TKey;
}[keyof TFields];

type HasRequiredKeys<TFields extends object> = [RequiredKeys<TFields>] extends [never] ? false : true;

export type InlineBaseLogEntry = {
    args: unknown[];
    level: InlineLogLevel;
    message: string;
    timestampMs: number;
    appVersion?: string;
};

export type InlineLogEntry<TFields extends object = EmptyInlineLogFields> = InlineBaseLogEntry & TFields;

export type InlineLogWriteEntry<TFields extends object = EmptyInlineLogFields> = TFields & {
    details?: unknown;
    message: string;
};

type InlineLogMethodWithShorthand<TFields extends object> = {
    (message: string, details?: unknown): void;
    (entry: InlineLogWriteEntry<TFields>): void;
};

type InlineLogMethodWithEntryOnly<TFields extends object> = (entry: InlineLogWriteEntry<TFields>) => void;

export type InlineLogMethod<TFields extends object = EmptyInlineLogFields> = HasRequiredKeys<TFields> extends true
    ? InlineLogMethodWithEntryOnly<TFields>
    : InlineLogMethodWithShorthand<TFields>;

export type InlineLoggerSend<TFields extends object = EmptyInlineLogFields> = (
    entries: InlineLogEntry<TFields>[],
    keepalive: boolean
) => Promise<boolean>;

export type InlineLoggerOptions<TFields extends object = EmptyInlineLogFields> = {
    send: InlineLoggerSend<TFields>;
    enableLogging?: boolean;
    appVersion?: string;
    batchSize?: number;
    maxQueueSize?: number;
};

export type InlineGlobalErrorPayload = {
    message: string;
    raw: unknown;
    stack?: string;
};

export type InlineErrorHandlers = {
    onError?: (payload: InlineGlobalErrorPayload) => void;
    onUnhandledRejection?: (payload: InlineGlobalErrorPayload) => void;
};

export type InlineLogger<TFields extends object = EmptyInlineLogFields> = {
    info: InlineLogMethod<TFields>;
    warn: InlineLogMethod<TFields>;
    error: InlineLogMethod<TFields>;
    flush: (keepalive?: boolean) => Promise<void>;
    flushOnLeave: () => void;
    attachGlobalErrorHandlers: (handlers?: InlineErrorHandlers) => () => void;
    attachPagehideFlush: () => () => void;
    dispose: () => void;
};

function stringify(value: unknown): string {
    try {
        return globalThis.String(value);
    } catch {
        return '';
    }
}

function serializeError(error: Error): { message: string; name: string; stack?: string } {
    const message = error.message.length > 0 ? error.message : 'runtime error';
    const name = error.name.length > 0 ? error.name : 'Error';
    if (typeof error.stack === 'string' && error.stack.length > 0) {
        return {
            message,
            name,
            stack: error.stack,
        };
    }
    return {
        message,
        name,
    };
}

function serializeDetail(value: unknown): unknown {
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
    const text = stringify(value);
    return text.length > 0 ? text : '[unserializable]';
}

function normalizeDetails(details: unknown): unknown[] {
    if (details === null || details === undefined) {
        return [];
    }
    if (globalThis.Array.isArray(details)) {
        return details.map((item) => serializeDetail(item));
    }
    return [serializeDetail(details)];
}

function toErrorPayload(raw: unknown, fallback: string): InlineGlobalErrorPayload {
    if (raw instanceof globalThis.Error) {
        const message = raw.message.length > 0 ? raw.message : fallback;
        if (typeof raw.stack === 'string' && raw.stack.length > 0) {
            return {
                message,
                raw,
                stack: raw.stack,
            };
        }
        return {
            message,
            raw,
        };
    }
    if (typeof raw === 'string' && raw.length > 0) {
        return {
            message: raw,
            raw,
        };
    }
    const text = stringify(raw);
    return {
        message: text.length > 0 ? text : fallback,
        raw,
    };
}

function isInlineLogWriteEntry<TFields extends object>(
    value: string | InlineLogWriteEntry<TFields>
): value is InlineLogWriteEntry<TFields> {
    return typeof value !== 'string';
}

export function createInlineLogger<TFields extends object = EmptyInlineLogFields>(
    options: InlineLoggerOptions<TFields>
): InlineLogger<TFields>;
export function createInlineLogger(options: InlineLoggerOptions<EmptyInlineLogFields>): InlineLogger;
export function createInlineLogger(options: InlineLoggerOptions<Record<string, unknown>>) {
    const maxQueueSize =
        options.maxQueueSize !== undefined &&
        globalThis.Number.isInteger(options.maxQueueSize) &&
        options.maxQueueSize > 0
            ? options.maxQueueSize
            : DEFAULT_MAX_QUEUE_SIZE;
    const batchSize =
        options.batchSize !== undefined &&
        globalThis.Number.isInteger(options.batchSize) &&
        options.batchSize > 0
            ? options.batchSize
            : DEFAULT_BATCH_SIZE;

    const queue: InlineLogEntry<Record<string, unknown>>[] = [];
    let detachPagehide: (() => void) | undefined;
    let detachGlobalErrors: (() => void) | undefined;

    let isDisposed = false;
    let isFlushing = false;

    function trimQueue(): void {
        if (queue.length > maxQueueSize) {
            queue.splice(0, queue.length - maxQueueSize);
        }
    }

    function makeEntry<TFields extends object>(
        level: InlineLogLevel,
        messageOrEntry: string | InlineLogWriteEntry<TFields>,
        details: unknown
    ): InlineLogEntry<TFields> {
        let message: string;
        let entryDetails = details;
        let fields: TFields | EmptyInlineLogFields = {};

        if (isInlineLogWriteEntry(messageOrEntry)) {
            const { details: providedDetails, message: providedMessage, ...rest } = messageOrEntry;
            message = providedMessage;
            entryDetails = providedDetails;
            fields = rest as TFields;
        } else {
            message = messageOrEntry;
        }

        const entry = {
            level,
            message,
            args: normalizeDetails(entryDetails),
            timestampMs: globalThis.Date.now(),
            ...fields,
        } as InlineLogEntry<TFields>;
        if (typeof options.appVersion === 'string' && options.appVersion.length > 0) {
            return {
                ...entry,
                appVersion: options.appVersion,
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

    function push<TFields extends object>(
        level: InlineLogLevel,
        messageOrEntry: string | InlineLogWriteEntry<TFields>,
        details: unknown
    ): void {
        if (isDisposed) {
            return;
        }
        if (level === 'info' && options.enableLogging !== true) {
            return;
        }
        queue.push(makeEntry(level, messageOrEntry, details));
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

        if (detachPagehide !== undefined) {
            return detachPagehide;
        }

        let detached = false;
        const onPagehide = (): void => {
            flushOnLeave();
        };

        const detachLocal = (): void => {
            if (detached) {
                return;
            }
            detached = true;
            detachPagehide = undefined;
            if (typeof globalThis.removeEventListener === 'function') {
                globalThis.removeEventListener('pagehide', onPagehide, { capture: true });
            }
        };

        globalThis.addEventListener('pagehide', onPagehide, { capture: true });
        detachPagehide = detachLocal;
        return detachLocal;
    }

    function attachGlobalErrorHandlers(handlers?: InlineErrorHandlers): () => void {
        if (isDisposed || typeof globalThis.addEventListener !== 'function') {
            return () => undefined;
        }

        if (detachGlobalErrors !== undefined) {
            return detachGlobalErrors;
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
            const raw =
                'error' in event && event.error !== undefined
                    ? event.error
                    : 'message' in event
                      ? event.message
                      : event;
            onError(toErrorPayload(raw, 'runtime error'));
        };

        const onUnhandledRejection: EventListener = (event): void => {
            const reason = 'reason' in event ? event.reason : event;
            onUnhandled(toErrorPayload(reason, 'unhandled rejection'));
        };

        const detachLocal = (): void => {
            if (detached) {
                return;
            }
            detached = true;
            detachGlobalErrors = undefined;
            if (typeof globalThis.removeEventListener === 'function') {
                globalThis.removeEventListener('error', onRuntimeError);
                globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
            }
        };

        globalThis.addEventListener('error', onRuntimeError);
        globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
        detachGlobalErrors = detachLocal;
        return detachLocal;
    }

    function dispose(): void {
        if (isDisposed) {
            return;
        }
        isDisposed = true;

        if (detachPagehide !== undefined) {
            detachPagehide();
        }

        if (detachGlobalErrors !== undefined) {
            detachGlobalErrors();
        }

        detachPagehide = undefined;
        detachGlobalErrors = undefined;
        queue.splice(0, queue.length);
    }

    function info(messageOrEntry: string | InlineLogWriteEntry<Record<string, unknown>>, details?: unknown): void {
        push('info', messageOrEntry, details);
    }

    function warn(messageOrEntry: string | InlineLogWriteEntry<Record<string, unknown>>, details?: unknown): void {
        push('warn', messageOrEntry, details);
    }

    function error(messageOrEntry: string | InlineLogWriteEntry<Record<string, unknown>>, details?: unknown): void {
        push('error', messageOrEntry, details);
    }

    const logger: InlineLogger<Record<string, unknown>> = {
        info: info as InlineLogMethod<Record<string, unknown>>,
        warn: warn as InlineLogMethod<Record<string, unknown>>,
        error: error as InlineLogMethod<Record<string, unknown>>,
        flush,
        flushOnLeave,
        attachGlobalErrorHandlers,
        attachPagehideFlush,
        dispose,
    };

    return logger;
}
