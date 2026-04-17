import test from 'node:test';
import assert from 'node:assert/strict';

import { createBufferedLogger, DEFAULT_DEBOUNCE_MS } from '../dist/index.js';
import { attachPagehideFlush } from '../dist/browser.js';

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

test('enqueue delivers batches to flush with consumer-defined shape', async () => {
    /** @type {{ keepalive?: boolean, batch: readonly { n: number }[] }[]} */
    const calls = [];

    const logger = createBufferedLogger({
        flush: async (batch, options) => {
            calls.push({ batch, keepalive: options?.keepalive });
            return true;
        },
        batchSize: 2,
        maxQueueSize: 100,
        debounceMs: 0,
    });

    logger.enqueue({ n: 1 });
    logger.enqueue({ n: 2 });
    await delay(0);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].batch, [{ n: 1 }, { n: 2 }]);
    assert.equal(calls[0].keepalive, undefined);

    logger.dispose();
});

test('flush returns false: batch stays, no re-send until next trigger', async () => {
    /** @type {readonly { n: number }[][]} */
    const batches = [];
    let attempt = 0;

    const logger = createBufferedLogger({
        flush: async (batch) => {
            batches.push(batch);
            attempt += 1;
            return attempt > 1;
        },
        batchSize: 10,
        debounceMs: 0,
    });

    logger.enqueue({ n: 1 });
    await delay(0);
    assert.equal(attempt, 1);
    assert.deepEqual(batches[0], [{ n: 1 }]);

    await logger.flush();
    assert.equal(attempt, 2);
    assert.deepEqual(batches[1], [{ n: 1 }]);

    logger.dispose();
});

test('false stops multi-batch pass and leaves failed head', async () => {
    let calls = 0;
    const logger = createBufferedLogger({
        flush: async (batch) => {
            calls += 1;
            assert.deepEqual(batch, [{ id: 'a' }]);
            return false;
        },
        batchSize: 1,
        debounceMs: 0,
    });

    logger.enqueue({ id: 'a' });
    logger.enqueue({ id: 'b' });
    await logger.flush();

    assert.equal(calls, 1);

    logger.dispose();
});

test('maxQueueSize trims oldest entries', async () => {
    const flushed = [];
    const logger = createBufferedLogger({
        flush: async (batch) => {
            flushed.push(...batch);
            return true;
        },
        batchSize: 10,
        maxQueueSize: 2,
        debounceMs: 0,
    });

    logger.enqueue({ k: 1 });
    logger.enqueue({ k: 2 });
    logger.enqueue({ k: 3 });
    await logger.flush();

    assert.deepEqual(flushed, [{ k: 2 }, { k: 3 }]);

    logger.dispose();
});

test('default debounceMs: auto-flush only after quiet window', async () => {
    let n = 0;
    const logger = createBufferedLogger({
        flush: async () => {
            n += 1;
            return true;
        },
        batchSize: 10,
    });

    logger.enqueue({ x: 1 });
    await delay(0);
    assert.equal(n, 0);
    await delay(DEFAULT_DEBOUNCE_MS + 30);
    assert.equal(n, 1);

    logger.dispose();
});

test('debounceMs: many enqueues coalesce into one flush after quiet window', async () => {
    let flushCount = 0;
    const logger = createBufferedLogger({
        flush: async (batch) => {
            flushCount += 1;
            assert.equal(batch.length, 5);
            return true;
        },
        batchSize: 10,
        debounceMs: 40,
    });

    for (let i = 0; i < 5; i += 1) {
        logger.enqueue({ i });
        await delay(10);
    }

    assert.equal(flushCount, 0);
    await delay(50);
    assert.equal(flushCount, 1);

    logger.dispose();
});

test('flushOnLeave forwards keepalive to flush', async () => {
    /** @type {(boolean | undefined)[]} */
    const keepalives = [];

    const logger = createBufferedLogger({
        flush: async (_batch, options) => {
            keepalives.push(options?.keepalive);
            return true;
        },
        batchSize: 10,
        debounceMs: 0,
    });

    logger.enqueue({ x: 1 });
    logger.flushOnLeave();
    await delay(0);

    assert.equal(keepalives.some((k) => k === true), true);

    logger.dispose();
});

test('attachPagehideFlush invokes callback on pagehide', () => {
    const restoreGlobals = withGlobalEventTarget();
    let calls = 0;
    const detach = attachPagehideFlush(() => {
        calls += 1;
    });

    globalThis.dispatchEvent(new Event('pagehide'));
    assert.equal(calls, 1);

    detach();
    globalThis.dispatchEvent(new Event('pagehide'));
    assert.equal(calls, 1);

    restoreGlobals();
});

test('dispose prevents scheduled flush from sending', async () => {
    let calls = 0;
    const logger = createBufferedLogger({
        flush: async () => {
            calls += 1;
            return true;
        },
        batchSize: 10,
        debounceMs: 0,
    });

    logger.enqueue({ a: 1 });
    logger.dispose();
    await delay(0);

    assert.equal(calls, 0);
});
