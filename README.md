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

export type BaseLogEntry = {
    readonly args: readonly unknown[];
    readonly level: LogLevel;
    readonly message: string;
    readonly timestampMs: number;
    readonly appVersion?: string;
};

export type LogEntry<TFields extends object = Record<never, never>> = BaseLogEntry & Partial<TFields>;

export type LogWriteEntry<TFields extends object = Record<never, never>> = TFields & {
    readonly details?: unknown;
    readonly message: string;
};

export type LogTransport<TFields extends object = Record<never, never>> = (
    entries: readonly LogEntry<TFields>[],
    keepalive: boolean
) => Promise<boolean>;

export type LoggerPolicy = {
    readonly enableLogging?: boolean;
    readonly appVersion?: string;
    readonly batchSize?: number;
    readonly maxQueueSize?: number;
};

export type RuntimeLogger<TFields extends object = Record<never, never>> = {
    info: {
        (message: string, details?: unknown): void;
        (entry: LogWriteEntry<TFields>): void;
    };
    warn: {
        (message: string, details?: unknown): void;
        (entry: LogWriteEntry<TFields>): void;
    };
    error: {
        (message: string, details?: unknown): void;
        (entry: LogWriteEntry<TFields>): void;
    };
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

`createBufferedLogger` больше не фиксирует финальный shape лог-записи только через базовый `LogEntry`.
Базовый контракт остаётся минимальным, а приложение может типобезопасно расширить запись своими top-level полями.

### `transport(entries, keepalive)`

- `entries` — текущий батч логов;
- `entries` типизируются как `readonly LogEntry<TFields>[]`, поэтому transport получает и базовые поля, и расширения приложения, если они были переданы при записи;
- `keepalive` — признак flush при уходе со страницы;
- вернуть `true`, если батч успешно отправлен и его можно удалить из очереди;
- вернуть `false`, если отправка неуспешна (батч останется в очереди).

### `policy`

- `enableLogging` — включать ли `info` логи (`false` по умолчанию)
- `appVersion` — если непустая строка, добавляется в каждую запись как часть базового контракта
- `batchSize` — размер батча, по умолчанию `32`
- `maxQueueSize` — лимит очереди, по умолчанию `1000`

### Поведение `RuntimeLogger`

- `info/warn/error` по-прежнему поддерживают старый вызов `logger.warn(message, details)`;
- `info/warn/error` также принимают объект `logger.warn({ message, details, ...extraFields })`;
- `info` игнорируется, если `enableLogging !== true`;
- при переполнении очередь обрезается до `maxQueueSize` (удаляются самые старые);
- `flush()` отправляет накопленное через `transport`;
- `flushOnLeave()` эквивалентен `flush({ keepalive: true })`;
- `dispose()` очищает очередь и отключает логгер.

## Пример: базовый сценарий без расширений

```ts
import { createBufferedLogger } from '@budarin/browser-log-runtime-core';

const logger = createBufferedLogger(
    async (entries, keepalive) => {
        await fetch('/api/log', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            keepalive,
            body: JSON.stringify({ entries }),
        });

        return true;
    },
    {
        enableLogging: true,
        appVersion: '1.0.0',
    }
);

logger.info('runtime started', { route: '/' });
```

## Пример: расширенный shape лог-записи

```ts
import { createBufferedLogger, type LogEntry } from '@budarin/browser-log-runtime-core';

type AppLogFields = {
    readonly sessionId: string;
};

type AppLogEntry = LogEntry<AppLogFields>;

const logger = createBufferedLogger<AppLogFields>(
    async (entries: readonly AppLogEntry[], keepalive) => {
        await fetch('/api/log', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            keepalive,
            body: JSON.stringify({ entries }),
        });

        return true;
    },
    {
        enableLogging: true,
        appVersion: '1.0.0',
    }
);

logger.warn({
    message: 'request failed',
    details: { status: 500 },
    sessionId: 'session-42',
});
```

В этом сценарии `sessionId`:

- хранится в очереди вместе с базовыми полями;
- не теряется при batching и retry;
- доезжает до `transport` как часть `LogEntry<AppLogFields>`;
- не является специальной сущностью пакета, а только примером расширения.

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
