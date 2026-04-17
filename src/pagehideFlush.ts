/**
 * Subscribe to `pagehide` and invoke `flushOnLeave` (typically `logger.flushOnLeave()`).
 * Browser-only helper; does not register global error handlers.
 */
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
