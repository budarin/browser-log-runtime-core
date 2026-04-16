export const LogLevel = {
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export type BaseLogEntry = {
    readonly args: readonly unknown[];
    readonly level: LogLevel;
    readonly message: string;
    readonly timestampMs: number;
    readonly appVersion?: string;
};

export type LogEntry<TFields extends object = Record<never, never>> = BaseLogEntry & Partial<TFields>;

export type LogWriteEntry<TFields extends object = Record<never, never>> = TFields & {
    readonly details?: unknown;
    readonly message: string;
};

export type LogMethod<TFields extends object = Record<never, never>> = {
    (message: string, details?: unknown): void;
    (entry: LogWriteEntry<TFields>): void;
};

export type LogTransport<TFields extends object = Record<never, never>> = (
    entries: readonly LogEntry<TFields>[],
    keepalive: boolean
) => Promise<boolean>;

export type LoggerPolicy = {
    readonly enableLogging?: boolean;
    readonly appVersion?: string;
    readonly batchSize?: number;
    readonly maxQueueSize?: number;
};

export type FlushOptions = {
    readonly keepalive?: boolean;
};

export type RuntimeLogger<TFields extends object = Record<never, never>> = {
    info: LogMethod<TFields>;
    warn: LogMethod<TFields>;
    error: LogMethod<TFields>;
    flush: (options?: FlushOptions) => Promise<void>;
    flushOnLeave: () => void;
    dispose: () => void;
};

export type GlobalErrorPayload = {
    readonly message: string;
    readonly raw: unknown;
    readonly stack?: string;
};

export type ErrorHooksOptions = {
    readonly onError: (payload: GlobalErrorPayload) => void;
    readonly onUnhandledRejection: (payload: GlobalErrorPayload) => void;
};
