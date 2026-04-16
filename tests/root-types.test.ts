import {
    createBufferedLogger,
    type LogEntry,
    type LogTransport,
    type LogWriteEntry,
} from '../src/index.js';

type RequiredAppFields = {
    readonly source: 'app' | 'serviceWorker';
    readonly sessionId: string;
};

type MixedAppFields = {
    readonly source?: 'app' | 'serviceWorker';
    readonly sessionId?: string;
};

const requiredTransport: LogTransport<RequiredAppFields> = async (entries) => {
    const requiredEntry: LogEntry<RequiredAppFields> = entries[0]!;
    requiredEntry.sessionId.toUpperCase();
    requiredEntry.source satisfies 'app' | 'serviceWorker';

    return true;
};

const requiredLogger = createBufferedLogger<RequiredAppFields>(requiredTransport, {
    appVersion: '1.0.0',
});

requiredLogger.warn({
    message: 'structured only',
    source: 'app',
    sessionId: 'session-1',
});

// @ts-expect-error required extra fields must be provided for structured writes
requiredLogger.warn({
    message: 'missing session',
    source: 'app',
});

// @ts-expect-error shorthand write would skip required extra fields
requiredLogger.warn('missing structured fields');

const optionalLogger = createBufferedLogger<MixedAppFields>(async (entries) => {
    const optionalEntry: LogEntry<MixedAppFields> = entries[0]!;
    optionalEntry.source satisfies 'app' | 'serviceWorker' | undefined;
    optionalEntry.sessionId?.toUpperCase();

    return true;
}, {});

optionalLogger.info('shorthand stays available when extras are optional');
optionalLogger.info({
    message: 'structured optional fields',
    source: 'serviceWorker',
});
optionalLogger.warn({
    message: 'source can still be narrowed when present',
    source: 'app',
});

const baseLogger = createBufferedLogger(async (entries) => {
    const baseEntry: LogEntry = entries[0]!;
    baseEntry.appVersion satisfies string | undefined;

    return true;
}, {});

baseLogger.error('base flow stays compatible');

const writeEntry: LogWriteEntry<RequiredAppFields> = {
    message: 'transport shape matches logger shape',
    source: 'app',
    sessionId: 'session-2',
};

requiredLogger.error(writeEntry);
