export const LogLevel = {
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export type LogEntry = {
    readonly args: readonly unknown[];
    readonly level: LogLevel;
    readonly message: string;
    readonly timestampMs: number;
    readonly appVersion?: string;
};

export type LogTransport = (
    entries: readonly LogEntry[],
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

export type RuntimeLogger = {
    info: (message: string, details?: unknown) => void;
    warn: (message: string, details?: unknown) => void;
    error: (message: string, details?: unknown) => void;
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
