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

## Что экспортируется

- `LogLevel`
- `createBufferedLogger(transport, policy)`
- `attachGlobalErrorHooks(options)`
- `attachPagehideFlush(flushOnLeave)`
- `normalizeMessage(value, fallback)`
- `normalizeDetails(value)`
- `serializeUnknown(value)`

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
    readonly source?: string;
};

export type LogTransport = (
    entries: readonly LogEntry[],
    keepalive: boolean
) => Promise<boolean>;

export type LoggerPolicy = {
    readonly defaultMessage: string;
    readonly isInfoEnabled: boolean;
    readonly appVersion?: string;
    readonly batchSize?: number;
    readonly maxQueueSize?: number;
    readonly source?: string;
};

export type RuntimeLogger = {
    info: (message?: unknown, details?: unknown) => void;
    warn: (message?: unknown, details?: unknown) => void;
    error: (message?: unknown, details?: unknown) => void;
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

## Контракт `createBufferedLogger`

### `transport(entries, keepalive)`

- `entries` — текущий батч логов;
- `keepalive` — признак flush при уходе со страницы;
- вернуть `true`, если батч успешно отправлен и его можно удалить из очереди;
- вернуть `false`, если отправка неуспешна (батч останется в очереди).

### `policy`

| Поле | Обязательное | Значение |
| --- | --- | --- |
| `defaultMessage` | да | fallback текста сообщения |
| `isInfoEnabled` | да | включать ли `info` логи |
| `appVersion` | нет | если непустая строка, добавляется в `LogEntry` |
| `source` | нет | если непустая строка, добавляется в `LogEntry` |
| `batchSize` | нет | размер батча, по умолчанию `32` |
| `maxQueueSize` | нет | лимит очереди, по умолчанию `1000` |

### Поведение `RuntimeLogger`

- `info/warn/error` добавляют запись в очередь;
- `info` игнорируется, если `isInfoEnabled === false`;
- при переполнении очередь обрезается до `maxQueueSize` (удаляются самые старые);
- `flush()` отправляет накопленное через `transport`;
- `flushOnLeave()` эквивалентен `flush({ keepalive: true })`;
- `dispose()` очищает очередь и отключает логгер.

## Контракт `attachGlobalErrorHooks`

`attachGlobalErrorHooks(options)` подписывает глобальные события:

- `window error` -> `options.onError(payload)`
- `window unhandledrejection` -> `options.onUnhandledRejection(payload)`

`payload` содержит:

- `message` — нормализованное сообщение;
- `raw` — исходный объект ошибки/reason;
- `stack` — только если доступен.

Функция возвращает `detach()`, который снимает обе подписки.

## Контракт `attachPagehideFlush`

`attachPagehideFlush(flushOnLeave)`:

- подписывает `pagehide` с `{ capture: true }`;
- при событии вызывает `flushOnLeave`;
- возвращает `detach()`.

## Пример: inline-host (splash/update-splash)

```ts
import {
    attachGlobalErrorHooks,
    attachPagehideFlush,
    createBufferedLogger,
} from '@budarin/browser-log-runtime-core';

const logger = createBufferedLogger(
    async (entries, keepalive) => {
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
    {
        defaultMessage: 'runtime event',
        isInfoEnabled: true,
        appVersion: '1.0.0',
        source: 'update-sw-splash-host',
        batchSize: 32,
        maxQueueSize: 1000,
    }
);

const detachPagehide = attachPagehideFlush(logger.flushOnLeave);
const detachErrors = attachGlobalErrorHooks({
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

## Utility функции

- `normalizeMessage(value, fallback)` — приводит `unknown` к строке;
- `normalizeDetails(value)` — приводит `details` к `readonly unknown[]`;
- `serializeUnknown(value)` — безопасная сериализация значения (в том числе `Error`).
