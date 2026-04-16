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

test('extended entry fields survive queue retries and reach transport', async () => {
    const sentBatches = [];
    let attempt = 0;
    const logger = createBufferedLogger(
        async (entries) => {
            sentBatches.push(
                entries.map((entry) => ({
                    message: entry.message,
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
        sessionId: 'session-42',
    });

    await delay(0);
    await logger.flush();

    assert.deepEqual(sentBatches, [
        [{ message: 'retry me', sessionId: 'session-42', appVersion: '2.0.0' }],
        [{ message: 'retry me', sessionId: 'session-42', appVersion: '2.0.0' }],
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
        sessionId: 'session-pagehide',
    });
    await delay(0);

    const detach = attachPagehideFlush(logger.flushOnLeave);
    globalThis.dispatchEvent(new Event('pagehide'));
    await delay(0);

    assert.equal(received.some((batch) => batch.keepalive === true), true);
    assert.deepEqual(received[received.length - 1], {
        keepalive: true,
        entries: [{ message: 'before leave', sessionId: 'session-pagehide' }],
    });

    detach();
    logger.dispose();
    restoreGlobals();
});
