import test from 'node:test';
import assert from 'node:assert/strict';

import { createInlineLogger } from '../dist/inline.js';

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

test('queue trim keeps the newest entries', async () => {
    const sentBatches = [];
    const logger = createInlineLogger({
        send: async (entries) => {
            sentBatches.push(entries.map((entry) => entry.message));
            return false;
        },
        defaultMessage: 'fallback',
        enableLogging: true,
        maxQueueSize: 2,
        batchSize: 10,
    });

    logger.warn('first');
    await delay(0);
    logger.warn('second');
    await delay(0);
    logger.warn('third');
    await delay(0);

    assert.deepEqual(sentBatches[sentBatches.length - 1], ['second', 'third']);
    logger.dispose();
});

test('info is skipped when disabled', async () => {
    let sendCalls = 0;
    const logger = createInlineLogger({
        send: async () => {
            sendCalls += 1;
            return true;
        },
        defaultMessage: 'fallback',
        enableLogging: false,
    });

    logger.info('hidden');
    await logger.flush();
    assert.equal(sendCalls, 0);
    logger.dispose();
});

test('info is skipped by default when enableLogging omitted', async () => {
    let sendCalls = 0;
    const logger = createInlineLogger({
        send: async () => {
            sendCalls += 1;
            return true;
        },
        defaultMessage: 'fallback',
    });

    logger.info('hidden by default');
    await logger.flush();
    assert.equal(sendCalls, 0);
    logger.dispose();
});

test('failed send keeps queue for next flush', async () => {
    const sentBatches = [];
    let callIndex = 0;
    const logger = createInlineLogger({
        send: async (entries) => {
            sentBatches.push(entries.map((entry) => entry.message));
            callIndex += 1;
            return callIndex > 1;
        },
        defaultMessage: 'fallback',
        enableLogging: true,
        batchSize: 10,
    });

    logger.error('persist');
    await delay(0);
    await logger.flush();

    assert.equal(sentBatches.length >= 2, true);
    assert.deepEqual(sentBatches[0], ['persist']);
    assert.deepEqual(sentBatches[1], ['persist']);
    logger.dispose();
});

test('pagehide triggers keepalive flush', async () => {
    const restoreGlobals = withGlobalEventTarget();
    const keepaliveValues = [];
    const logger = createInlineLogger({
        send: async (_, keepalive) => {
            keepaliveValues.push(keepalive);
            return keepalive;
        },
        defaultMessage: 'fallback',
        enableLogging: true,
    });

    logger.warn('before hide');
    await delay(0);
    const detach = logger.attachPagehideFlush();

    globalThis.dispatchEvent(new Event('pagehide'));
    await delay(0);

    assert.equal(keepaliveValues.includes(true), true);

    detach();
    detach();
    logger.dispose();
    restoreGlobals();
});

test('global handlers attach and detach safely', async () => {
    const restoreGlobals = withGlobalEventTarget();
    const logger = createInlineLogger({
        send: async () => true,
        defaultMessage: 'fallback',
        enableLogging: true,
    });

    let runtimeErrors = 0;
    let unhandledRejections = 0;
    const detach = logger.attachGlobalErrorHandlers({
        onError() {
            runtimeErrors += 1;
        },
        onUnhandledRejection() {
            unhandledRejections += 1;
        },
    });

    const rejectionEvent = new Event('unhandledrejection');
    Object.defineProperty(rejectionEvent, 'reason', {
        value: new Error('boom'),
        configurable: true,
    });

    globalThis.dispatchEvent(new Event('error'));
    globalThis.dispatchEvent(rejectionEvent);

    assert.equal(runtimeErrors, 1);
    assert.equal(unhandledRejections, 1);

    detach();
    detach();
    globalThis.dispatchEvent(new Event('error'));
    globalThis.dispatchEvent(rejectionEvent);

    assert.equal(runtimeErrors, 1);
    assert.equal(unhandledRejections, 1);

    logger.dispose();
    restoreGlobals();
});

test('dispose detaches registered listeners', async () => {
    const restoreGlobals = withGlobalEventTarget();
    let sendCalls = 0;
    const logger = createInlineLogger({
        send: async () => {
            sendCalls += 1;
            return false;
        },
        defaultMessage: 'fallback',
        enableLogging: true,
    });

    logger.warn('before listeners');
    await delay(0);

    logger.attachPagehideFlush();
    logger.attachGlobalErrorHandlers();

    logger.dispose();

    globalThis.dispatchEvent(new Event('pagehide'));
    globalThis.dispatchEvent(new Event('error'));

    await delay(0);
    assert.equal(sendCalls, 1);
    restoreGlobals();
});
