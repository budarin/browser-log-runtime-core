import {
    createInlineLogger,
    type InlineLogEntry,
    type InlineLoggerSend,
    type InlineLogWriteEntry,
} from '../src/inline.js';

type RequiredInlineFields = {
    readonly source: 'app' | 'serviceWorker';
    readonly sessionId: string;
};

type OptionalInlineFields = {
    readonly source?: 'app' | 'serviceWorker';
    readonly sessionId?: string;
};

const requiredSend: InlineLoggerSend<RequiredInlineFields> = async (entries) => {
    const entry: InlineLogEntry<RequiredInlineFields> = entries[0]!;
    entry.source satisfies 'app' | 'serviceWorker';
    entry.sessionId.toUpperCase();
    return true;
};

const requiredLogger = createInlineLogger<RequiredInlineFields>({
    send: requiredSend,
    appVersion: '1.0.0',
});

requiredLogger.error({
    message: 'structured only',
    source: 'app',
    sessionId: 'session-inline',
});

// @ts-expect-error shorthand write would skip required extra fields
requiredLogger.error('missing fields');

// @ts-expect-error required extra fields must be provided
requiredLogger.warn({
    message: 'missing session',
    source: 'serviceWorker',
});

const optionalLogger = createInlineLogger<OptionalInlineFields>({
    send: async (entries) => {
        const entry: InlineLogEntry<OptionalInlineFields> = entries[0]!;
        entry.source satisfies 'app' | 'serviceWorker' | undefined;
        entry.sessionId?.toUpperCase();
        return true;
    },
});

optionalLogger.info('shorthand stays available');
optionalLogger.warn({
    message: 'optional shape works too',
    source: 'app',
});

const baseLogger = createInlineLogger({
    send: async (entries) => {
        const entry: InlineLogEntry = entries[0]!;
        entry.appVersion satisfies string | undefined;
        return true;
    },
});

baseLogger.warn('base inline flow stays compatible');

const writeEntry: InlineLogWriteEntry<RequiredInlineFields> = {
    message: 'write shape is preserved',
    source: 'app',
    sessionId: 'session-2',
};

requiredLogger.info(writeEntry);
