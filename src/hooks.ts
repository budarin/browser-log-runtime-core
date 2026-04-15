import type { ErrorHooksOptions, GlobalErrorPayload } from './types.js';

import { normalizeMessage } from './normalize.js';

function toErrorPayload(raw: unknown, fallback: string): GlobalErrorPayload {
    if (raw instanceof globalThis.Error) {
        const basePayload: GlobalErrorPayload = {
            message: normalizeMessage(raw.message, fallback),
            raw,
        };

        if (typeof raw.stack === 'string' && raw.stack.length > 0) {
            return {
                ...basePayload,
                stack: raw.stack,
            };
        }

        return basePayload;
    }

    return {
        message: normalizeMessage(raw, fallback),
        raw,
    };
}

export function attachPagehideFlush(flushOnLeave: () => void): () => void {
    function onPagehide(): void {
        flushOnLeave();
    }

    if (typeof globalThis.addEventListener === 'function') {
        globalThis.addEventListener('pagehide', onPagehide, { capture: true });
    }

    return () => {
        if (typeof globalThis.removeEventListener === 'function') {
            globalThis.removeEventListener('pagehide', onPagehide, { capture: true });
        }
    };
}

export function attachGlobalErrorHooks(options: ErrorHooksOptions): () => void {
    const onRuntimeError: EventListener = (event): void => {
        if (event instanceof globalThis.ErrorEvent === false) {
            return;
        }

        const payload = toErrorPayload(event.error ?? event.message, 'runtime error');
        options.onError(payload);
    };

    const onUnhandledRejection: EventListener = (event): void => {
        if (event instanceof globalThis.PromiseRejectionEvent === false) {
            return;
        }

        const payload = toErrorPayload(event.reason, 'unhandled rejection');
        options.onUnhandledRejection(payload);
    };

    if (typeof globalThis.addEventListener === 'function') {
        globalThis.addEventListener('error', onRuntimeError);
        globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
    }

    return () => {
        if (typeof globalThis.removeEventListener === 'function') {
            globalThis.removeEventListener('error', onRuntimeError);
            globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
        }
    };
}
