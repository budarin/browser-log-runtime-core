# @budarin/browser-log-runtime-core

Небольшое browser-runtime ядро для:

- буферизации логов в памяти;
- отправки логов батчами через пользовательский transport;
- подписки на глобальные ошибки (`error`, `unhandledrejection`);
- flush очереди на `pagehide` (в том числе с `keepalive`).

Пакет не зависит от React, Vite и DI приложения.

## Установка

```bash
pnpm add @budarin/browser-log-runtime-core
```

## Root runtime API

Основной entrypoint `@budarin/browser-log-runtime-core` остаётся совместимым и экспортирует:

```ts
import {
    attachGlobalErrorHooks,
    attachPagehideFlush,
    createBufferedLogger,
    normalizeDetails,
    normalizeMessage,
    serializeUnknown,
} from '@budarin/browser-log-runtime-core';
```

## Inline runtime (size-optimized)

Для inline runtime-сценариев (splash/update-host) используйте отдельный lightweight entrypoint:

```ts
import { createInlineLogger } from '@budarin/browser-log-runtime-core/inline';
```

Этот entrypoint не реэкспортирует root helpers и содержит узкую специализированную реализацию,
чтобы уменьшить итоговый bundle dependency graph для inline-кода.

### API `createInlineLogger(options)`

`options`:

- `send(entries, keepalive): Promise<boolean>`
- `enableLogging?: boolean` (default `false`)
- `appVersion?: string`
- `batchSize?: number` (default `32`)
- `maxQueueSize?: number` (default `1000`)

Возвращаемый logger:

- `info(message?, details?)`
- `warn(message?, details?)`
- `error(message?, details?)`
- `flush(keepalive?: boolean)`
- `flushOnLeave()`
- `attachGlobalErrorHandlers({ onError?, onUnhandledRejection? }) -> detach`
- `attachPagehideFlush() -> detach`
- `dispose()`

### Поведение inline logger

- `info` включен только когда `enableLogging === true`;
- очередь ограничивается `maxQueueSize` (удаляются самые старые записи);
- `flush` отправляет батчи в цикле до первой неуспешной отправки;
- `flushOnLeave` вызывает отправку с `keepalive = true`;
- `attach`/`detach`/`dispose` безопасны и идемпотентны.

## Основные типы

```ts
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

export type RuntimeLogger = {
    info: (message: string, details?: unknown) => void;
    warn: (message: string, details?: unknown) => void;
    error: (message: string, details?: unknown) => void;
    flush: (options?: { readonly keepalive?: boolean }) => Promise<void>;
    flushOnLeave: () => void;
    dispose: () => void;
};

export type GlobalErrorPayload = {
    readonly message: string;
    readonly raw: unknown;
    readonly stack?: string;
};
```

## Контракт `createBufferedLogger` (root)

### `transport(entries, keepalive)`

- `entries` — текущий батч логов;
- `keepalive` — признак flush при уходе со страницы;
- вернуть `true`, если батч успешно отправлен и его можно удалить из очереди;
- вернуть `false`, если отправка неуспешна (батч останется в очереди).

### `policy`

| Поле | Обязательное | Значение |
| --- | --- | --- |
| `enableLogging` | нет | включать ли `info` логи (`false` по умолчанию) |
| `appVersion` | нет | если непустая строка, добавляется в `LogEntry` |
| `batchSize` | нет | размер батча, по умолчанию `32` |
| `maxQueueSize` | нет | лимит очереди, по умолчанию `1000` |

### Поведение `RuntimeLogger`

- `info/warn/error` добавляют запись в очередь;
- `info` игнорируется, если `enableLogging !== true`;
- при переполнении очередь обрезается до `maxQueueSize` (удаляются самые старые);
- `flush()` отправляет накопленное через `transport`;
- `flushOnLeave()` эквивалентен `flush({ keepalive: true })`;
- `dispose()` очищает очередь и отключает логгер.

## Контракт `attachGlobalErrorHooks` (root)

`attachGlobalErrorHooks(options)` подписывает глобальные события:

- `window error` -> `options.onError(payload)`
- `window unhandledrejection` -> `options.onUnhandledRejection(payload)`

`payload` содержит:

- `message` — нормализованное сообщение;
- `raw` — исходный объект ошибки/reason;
- `stack` — только если доступен.

Функция возвращает `detach()`, который снимает обе подписки.

## Контракт `attachPagehideFlush` (root)

`attachPagehideFlush(flushOnLeave)`:

- подписывает `pagehide` с `{ capture: true }`;
- при событии вызывает `flushOnLeave`;
- возвращает `detach()`.

## Пример: inline-host (splash/update-host)

```ts
import { createInlineLogger } from '@budarin/browser-log-runtime-core/inline';

const logger = createInlineLogger({
    send: async (entries, keepalive) => {
        const response = await fetch('/api/log', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            keepalive,
            body: JSON.stringify({
                id: Date.now(),
                method: 'log',
                params: { entries },
            }),
        });

        return response.ok;
    },
    enableLogging: true,
    appVersion: '1.0.0',
    batchSize: 32,
    maxQueueSize: 1000,
});

const detachPagehide = logger.attachPagehideFlush();
const detachErrors = logger.attachGlobalErrorHandlers({
    onError(payload) {
        logger.error('[runtime] global error', payload);
    },
    onUnhandledRejection(payload) {
        logger.error('[runtime] unhandled rejection', payload);
    },
});

function teardownRuntime(): void {
    detachErrors();
    detachPagehide();
    logger.dispose();
}
```
