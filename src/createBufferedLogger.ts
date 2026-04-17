import type { BufferedLogger, BufferedLoggerFlush, CreateBufferedLoggerOptions, FlushOptions } from './types.js';

const DEFAULT_MAX_QUEUE_SIZE = 1_000;
const DEFAULT_BATCH_SIZE = 32;
/** Default quiet time after the last `enqueue` before auto-flush (trailing debounce). */
export const DEFAULT_DEBOUNCE_MS = 50;

function resolvePositiveInt(value: number | undefined, fallback: number): number {
    if (value === undefined || globalThis.Number.isInteger(value) === false || value <= 0) {
        return fallback;
    }

    return value;
}

function resolveNonNegativeInt(value: number | undefined, fallback: number): number {
    if (value === undefined || globalThis.Number.isInteger(value) === false || value < 0) {
        return fallback;
    }

    return value;
}

function mergeFlushOptions(a: FlushOptions | undefined, b: FlushOptions | undefined): FlushOptions | undefined {
    if (a === undefined) {
        return b;
    }

    if (b === undefined) {
        return a;
    }

    if (a.keepalive === true || b.keepalive === true) {
        return {
            keepalive: true,
        };
    }

    return {};
}

async function callFlush<T>(flush: BufferedLoggerFlush<T>, batch: readonly T[], options: FlushOptions): Promise<boolean> {
    return (await flush(batch, options)) === true;
}

export function createBufferedLogger<T>(options: CreateBufferedLoggerOptions<T>): BufferedLogger<T> {
    const maxQueueSize = resolvePositiveInt(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE);
    const batchSize = resolvePositiveInt(options.batchSize, DEFAULT_BATCH_SIZE);
    const debounceMs =
        options.debounceMs === undefined
            ? DEFAULT_DEBOUNCE_MS
            : resolveNonNegativeInt(options.debounceMs, 0);
    const flushBatch = options.flush;

    const queue: T[] = [];
    let isDisposed = false;
    let isFlushing = false;
    let flushScheduled = false;
    let pendingFollowUp: FlushOptions | undefined;
    let debounceTimerId: ReturnType<typeof globalThis.setTimeout> | undefined;

    function clearDebounceTimer(): void {
        if (debounceTimerId !== undefined) {
            globalThis.clearTimeout(debounceTimerId);
            debounceTimerId = undefined;
        }
    }

    function trimQueue(): void {
        if (queue.length <= maxQueueSize) {
            return;
        }

        queue.splice(0, queue.length - maxQueueSize);
    }

    function scheduleFlush(): void {
        if (isDisposed || isFlushing) {
            return;
        }

        if (debounceMs > 0) {
            clearDebounceTimer();
            debounceTimerId = globalThis.setTimeout(() => {
                debounceTimerId = undefined;
                if (isDisposed === false) {
                    void flushInternal();
                }
            }, debounceMs);
            return;
        }

        if (flushScheduled) {
            return;
        }

        flushScheduled = true;
        queueMicrotask(() => {
            flushScheduled = false;
            if (isDisposed === false) {
                void flushInternal();
            }
        });
    }

    async function flushInternal(flushOptions?: FlushOptions): Promise<void> {
        if (isDisposed) {
            return;
        }

        clearDebounceTimer();

        if (isFlushing) {
            pendingFollowUp = mergeFlushOptions(pendingFollowUp, flushOptions);
            return;
        }

        if (queue.length === 0) {
            return;
        }

        isFlushing = true;
        try {
            const passOptions: FlushOptions = flushOptions ?? {};

            while (queue.length > 0 && isDisposed === false) {
                const batch = queue.slice(0, batchSize);

                if (isDisposed) {
                    return;
                }

                const ok = await callFlush(flushBatch, batch, passOptions);

                if (ok) {
                    queue.splice(0, batch.length);
                    continue;
                }

                return;
            }
        } finally {
            isFlushing = false;
            if (isDisposed) {
                pendingFollowUp = undefined;
                return;
            }

            const followUp = pendingFollowUp;
            pendingFollowUp = undefined;
            if (queue.length > 0 && followUp !== undefined) {
                void flushInternal(followUp);
            }
        }
    }

    function enqueue(entry: T): void {
        if (isDisposed) {
            return;
        }

        queue.push(entry);
        trimQueue();

        if (isFlushing === false) {
            scheduleFlush();
        }
    }

    function flushOnLeave(): void {
        void flushInternal({ keepalive: true });
    }

    function dispose(): void {
        isDisposed = true;
        pendingFollowUp = undefined;
        flushScheduled = false;
        clearDebounceTimer();
        queue.splice(0, queue.length);
    }

    return {
        enqueue,
        flush: flushInternal,
        flushOnLeave,
        dispose,
    };
}
