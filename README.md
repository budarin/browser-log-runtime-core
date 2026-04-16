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

## Inline runtime

Для inline runtime-сценариев (splash/update-host) используйте отдельный entrypoint:

```ts
import { createInlineLogger } from '@budarin/browser-log-runtime-core/inline';
```

Этот entrypoint не реэкспортирует root helpers, но теперь поддерживает ту же generic-модель shape лог-записи,
что и root runtime API.

### API `createInlineLogger(options)`

`options`:

- `send(entries, keepalive): Promise<boolean>`
- `enableLogging?: boolean` (default `false`)
- `appVersion?: string`
- `batchSize?: number` (default `32`)
- `maxQueueSize?: number` (default `1000`)

Возвращаемый logger:

- если у logger нет обязательных extra fields:
  - `info(message?, details?)`
  - `warn(message?, details?)`
  - `error(message?, details?)`
- object-вызов всегда доступен:
  - `info({ message, details?, ...extraFields })`
  - `warn({ message, details?, ...extraFields })`
  - `error({ message, details?, ...extraFields })`
- если у logger есть обязательные extra fields, shorthand-вызов по строке запрещён типами
- `flush(keepalive?: boolean)`
- `flushOnLeave()`
- `attachGlobalErrorHandlers({ onError?, onUnhandledRejection? }) -> detach`
- `attachPagehideFlush() -> detach`
- `dispose()`

### Поведение inline logger

- `info` включен только когда `enableLogging === true`;
- queue хранит точный `InlineLogEntry<TFields>` shape конкретного logger instance;
- `send` получает тот же точный shape без optionalization обязательных полей;
- `details` нормализуется в `args` без потери JSON-совместимой структуры: plain object / array доезжают как объект / массив, а не как `"[object Object]"`;
- для `bigint` используется строковое представление, для `Error` — объект `{ name, message, stack? }`;
- если значение не удаётся честно привести к JSON-совместимой структуре, используется безопасный fallback без падения logger;
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

export type EmptyLogFields = Record<never, never>;

export type LogEntry<TFields extends object = EmptyLogFields> = BaseLogEntry & TFields;

export type LogWriteEntry<TFields extends object = EmptyLogFields> = TFields & {
    readonly details?: unknown;
    readonly message: string;
};

export type LogTransport<TFields extends object = EmptyLogFields> = (
    entries: readonly LogEntry<TFields>[],
    keepalive: boolean
) => Promise<boolean>;

export type LoggerPolicy = {
    readonly enableLogging?: boolean;
    readonly appVersion?: string;
    readonly batchSize?: number;
    readonly maxQueueSize?: number;
};

export type RuntimeLogger<TFields extends object = EmptyLogFields> = {
    info: LogMethod<TFields>;
    warn: LogMethod<TFields>;
    error: LogMethod<TFields>;
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
- `entries` типизируются как `readonly LogEntry<TFields>[]`, поэтому transport получает ровно тот же shape, что и конкретный logger instance;
- `keepalive` — признак flush при уходе со страницы;
- вернуть `true`, если батч успешно отправлен и его можно удалить из очереди;
- вернуть `false`, если отправка неуспешна (батч останется в очереди).

### `policy`

- `enableLogging` — включать ли `info` логи (`false` по умолчанию)
- `appVersion` — если непустая строка, добавляется в каждую запись как часть базового контракта
- `batchSize` — размер батча, по умолчанию `32`
- `maxQueueSize` — лимит очереди, по умолчанию `1000`

### Поведение `RuntimeLogger`

- если у logger нет обязательных extra fields, `info/warn/error` по-прежнему поддерживают старый вызов `logger.warn(message, details)`;
- если у logger есть обязательные extra fields, запись принимается только в форме `logger.warn({ message, details, ...extraFields })`;
- object-вызов `logger.warn({ message, details, ...extraFields })` работает в обоих сценариях;
- `details` нормализуется в `args` с сохранением JSON-совместимой структуры: plain object / array не превращаются в `"[object Object]"`;
- `bigint` сериализуется в строку, `Error` — в объект `{ name, message, stack? }`, а для реально несериализуемых значений остаётся безопасный fallback;
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

## Пример: обязательные и опциональные extra fields

```ts
import { createBufferedLogger } from '@budarin/browser-log-runtime-core';

type RuntimeLogFields = {
    readonly source: 'app' | 'serviceWorker';
    readonly sessionId: string;
    readonly traceId?: string;
};

const logger = createBufferedLogger<RuntimeLogFields>(
    async (entries) => {
        entries[0].source;
        entries[0].sessionId;
        entries[0].traceId;
        return true;
    },
    {}
);

logger.error({
    message: 'request failed',
    source: 'app',
    sessionId: 'session-42',
});

// TypeScript error: нельзя забыть обязательные поля.
logger.error('request failed');
```

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

## Пример: inline logger с обязательными extra fields

```ts
import { createInlineLogger } from '@budarin/browser-log-runtime-core/inline';

type InlineRuntimeFields = {
    readonly source: 'app' | 'serviceWorker';
    readonly sessionId: string;
};

const logger = createInlineLogger<InlineRuntimeFields>({
    send: async (entries) => {
        entries[0].source;
        entries[0].sessionId;
        return true;
    },
});

logger.error({
    message: 'runtime failed',
    source: 'app',
    sessionId: 'session-42',
});

// TypeScript error
logger.error('runtime failed');
```
