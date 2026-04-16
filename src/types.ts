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

export type EmptyLogFields = Record<never, never>;

type RequiredKeys<TFields extends object> = {
    [TKey in keyof TFields]-?: {} extends Pick<TFields, TKey> ? never : TKey;
}[keyof TFields];

type HasRequiredKeys<TFields extends object> = [RequiredKeys<TFields>] extends [never] ? false : true;

export type LogEntry<TFields extends object = EmptyLogFields> = BaseLogEntry & TFields;

export type LogWriteEntry<TFields extends object = EmptyLogFields> = TFields & {
    readonly details?: unknown;
    readonly message: string;
};

type LogMethodWithShorthand<TFields extends object> = {
    (message: string, details?: unknown): void;
    (entry: LogWriteEntry<TFields>): void;
};

type LogMethodWithEntryOnly<TFields extends object> = (entry: LogWriteEntry<TFields>) => void;

export type LogMethod<TFields extends object = EmptyLogFields> = HasRequiredKeys<TFields> extends true
    ? LogMethodWithEntryOnly<TFields>
    : LogMethodWithShorthand<TFields>;

export type LogTransport<TFields extends object = EmptyLogFields> = (
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

export type RuntimeLogger<TFields extends object = EmptyLogFields> = {
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
