export type FlushOptions = {
    readonly keepalive?: boolean;
};

/**
 * @returns `true` if the batch was handled and should be removed from the queue.
 * @returns `false` on failure: the batch stays at the head, flushing stops until the next trigger (enqueue / debounced tick / explicit `flush`).
 */
export type BufferedLoggerFlush<T> = (
    batch: readonly T[],
    options?: FlushOptions
) => Promise<boolean>;

export type CreateBufferedLoggerOptions<T> = {
    readonly flush: BufferedLoggerFlush<T>;
    readonly batchSize?: number;
    readonly maxQueueSize?: number;
    /**
     * Quiet time after the last `enqueue` before auto-flush, in ms (trailing debounce).
     * If omitted, the implementation default applies (non-zero, see `DEFAULT_DEBOUNCE_MS` export).
     * Pass `0` to schedule flush on the next microtask (lowest latency; same-tick `enqueue` bursts coalesce).
     */
    readonly debounceMs?: number;
};

export type BufferedLogger<T> = {
    readonly enqueue: (entry: T) => void;
    readonly flush: (options?: FlushOptions) => Promise<void>;
    readonly flushOnLeave: () => void;
    readonly dispose: () => void;
};
