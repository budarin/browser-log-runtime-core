import test from 'node:test';
import assert from 'node:assert/strict';

import { attachPagehideFlush, createBufferedLogger } from '../dist/index.js';

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function withGlobalEventTarget() {
    const eventTarget = new EventTarget();

    const previousAddEventListener = globalThis.addEventListener;
    const previousRemoveEventListener = globalThis.removeEventListener;
    const previousDispatchEvent = globalThis.dispatchEvent;

    globalThis.addEventListener = eventTarget.addEventListener.bind(eventTarget);
    globalThis.removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
    globalThis.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);

    return () => {
        globalThis.addEventListener = previousAddEventListener;
        globalThis.removeEventListener = previousRemoveEventListener;
        globalThis.dispatchEvent = previousDispatchEvent;
    };
}

test('base buffered logger flow stays compatible', async () => {
    const sentBatches = [];
    const logger = createBufferedLogger(
        async (entries, keepalive) => {
            sentBatches.push({
                keepalive,
                entries: entries.map((entry) => ({
                    level: entry.level,
                    message: entry.message,
                    args: entry.args,
                    appVersion: entry.appVersion,
                })),
            });

            return true;
        },
        {
            appVersion: '1.2.3',
            batchSize: 10,
            enableLogging: true,
        }
    );

    logger.info('hello', { foo: 'bar' });
    await delay(0);

    assert.equal(sentBatches.length, 1);
    assert.deepEqual(sentBatches[0], {
        keepalive: false,
        entries: [
            {
                level: 'info',
                message: 'hello',
                args: [{ foo: 'bar' }],
                appVersion: '1.2.3',
            },
        ],
    });

    logger.dispose();
});

test('root logger keeps plain object details structured', async () => {
    const sentEntries = [];
    const logger = createBufferedLogger(
        async (entries) => {
            sentEntries.push(...entries);
            return true;
        },
        {
            enableLogging: true,
        }
    );

    logger.warn('object details', { foo: 'bar' });
    await delay(0);
    await logger.flush();

    assert.deepEqual(sentEntries, [
        {
            level: 'warn',
            message: 'object details',
            args: [{ foo: 'bar' }],
            timestampMs: sentEntries[0]?.timestampMs,
        },
    ]);

    logger.dispose();
});

test('root logger keeps array details structured', async () => {
    const sentEntries = [];
    const logger = createBufferedLogger(
        async (entries) => {
            sentEntries.push(...entries);
            return true;
        },
        {
            enableLogging: true,
        }
    );

    logger.warn('array details', [{ a: 1 }, 'x']);
    await delay(0);
    await logger.flush();

    assert.deepEqual(sentEntries, [
        {
            level: 'warn',
            message: 'array details',
            args: [{ a: 1 }, 'x'],
            timestampMs: sentEntries[0]?.timestampMs,
        },
    ]);

    logger.dispose();
});

test('root logger keeps empty object details instead of dropping them', async () => {
    const sentEntries = [];
    const logger = createBufferedLogger(
        async (entries) => {
            sentEntries.push(...entries);
            return true;
        },
        {
            enableLogging: true,
        }
    );

    logger.warn('empty object', {});
    await delay(0);
    await logger.flush();

    assert.deepEqual(sentEntries, [
        {
            level: 'warn',
            message: 'empty object',
            args: [{}],
            timestampMs: sentEntries[0]?.timestampMs,
        },
    ]);

    logger.dispose();
});

test('root logger serializes bigint details as strings', async () => {
    const sentEntries = [];
    const logger = createBufferedLogger(
        async (entries) => {
            sentEntries.push(...entries);
            return true;
        },
        {
            enableLogging: true,
        }
    );

    logger.warn('bigint details', 10n);
    await delay(0);
    await logger.flush();

    assert.deepEqual(sentEntries, [
        {
            level: 'warn',
            message: 'bigint details',
            args: ['10'],
            timestampMs: sentEntries[0]?.timestampMs,
        },
    ]);

    logger.dispose();
});

test('root logger keeps nested bigint and error JSON-compatible', async () => {
    const sentEntries = [];
    const logger = createBufferedLogger(
        async (entries) => {
            sentEntries.push(...entries);
            return true;
        },
        {
            enableLogging: true,
        }
    );

    logger.warn('nested structured details', {
        count: 10n,
        error: new Error('boom'),
    });
    await delay(0);
    await logger.flush();

    assert.equal(sentEntries.length, 1);
    assert.deepEqual(sentEntries[0].args[0].count, '10');
    assert.equal(sentEntries[0].args[0].error.name, 'Error');
    assert.equal(sentEntries[0].args[0].error.message, 'boom');

    logger.dispose();
});

test('root logger keeps working for unserializable details', async () => {
    const sentEntries = [];
    const logger = createBufferedLogger(
        async (entries) => {
            sentEntries.push(...entries);
            return true;
        },
        {
            enableLogging: true,
        }
    );

    const circular = {};
    circular.self = circular;

    logger.warn('circular details', circular);
    logger.warn('after circular', { ok: true });
    await delay(0);
    await logger.flush();

    assert.equal(sentEntries.length, 2);
    assert.equal(typeof sentEntries[0].args[0], 'string');
    assert.deepEqual(sentEntries[1].args, [{ ok: true }]);

    logger.dispose();
});

test('extended entry fields survive queue retries and reach transport', async () => {
    const sentBatches = [];
    let attempt = 0;
    const logger = createBufferedLogger(
        async (entries) => {
            sentBatches.push(
                entries.map((entry) => ({
                    message: entry.message,
                    source: entry.source,
                    sessionId: entry.sessionId,
                    appVersion: entry.appVersion,
                }))
            );
            attempt += 1;

            return attempt > 1;
        },
        {
            appVersion: '2.0.0',
            batchSize: 10,
        }
    );

    logger.warn({
        message: 'retry me',
        details: { reason: 'network' },
        source: 'app',
        sessionId: 'session-42',
    });

    await delay(0);
    await logger.flush();

    assert.deepEqual(sentBatches, [
        [{ message: 'retry me', source: 'app', sessionId: 'session-42', appVersion: '2.0.0' }],
        [{ message: 'retry me', source: 'app', sessionId: 'session-42', appVersion: '2.0.0' }],
    ]);

    logger.dispose();
});

test('flushOnLeave via pagehide keeps extended shape', async () => {
    const restoreGlobals = withGlobalEventTarget();
    const received = [];
    const logger = createBufferedLogger(
        async (entries, keepalive) => {
            received.push({
                keepalive,
                entries: entries.map((entry) => ({
                    message: entry.message,
                    source: entry.source,
                    sessionId: entry.sessionId,
                })),
            });

            return keepalive;
        },
        {
            batchSize: 10,
        }
    );

    logger.error({
        message: 'before leave',
        details: new Error('boom'),
        source: 'serviceWorker',
        sessionId: 'session-pagehide',
    });
    await delay(0);

    const detach = attachPagehideFlush(logger.flushOnLeave);
    globalThis.dispatchEvent(new Event('pagehide'));
    await delay(0);

    assert.equal(received.some((batch) => batch.keepalive === true), true);
    assert.deepEqual(received[received.length - 1], {
        keepalive: true,
        entries: [{ message: 'before leave', source: 'serviceWorker', sessionId: 'session-pagehide' }],
    });

    detach();
    logger.dispose();
    restoreGlobals();
});
