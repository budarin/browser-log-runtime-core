# @budarin/browser-log-runtime-core

Небольшая библиотека для **буферного журнала** в памяти: вы задаёте тип записи `T`, функцию **`flush`**, лимиты очереди и размер пачки. Записи складываются в очередь, с головы отдаются в `flush` пачками; успех или ошибка определяется **только** возвращаемым значением `flush` — `Promise<boolean>`.

Пакет **не** реализует HTTP, RPC, сериализацию под ваш сервер и **не** вешает глобальные обработчики ошибок. Работает везде, где есть `setTimeout`, `queueMicrotask` и промисы (Node, браузер и т.д.).

---

## Что поставляется

| Entry | Содержимое |
| --- | --- |
| `@budarin/browser-log-runtime-core` | `createBufferedLogger`, типы, константа **`DEFAULT_DEBOUNCE_MS`** |
| `@budarin/browser-log-runtime-core/browser` | **`attachPagehideFlush`** — только `pagehide`, без подписок на ошибки |

---

## Установка и импорт

```bash
pnpm add @budarin/browser-log-runtime-core
```

```ts
import {
    createBufferedLogger,
    DEFAULT_DEBOUNCE_MS,
} from '@budarin/browser-log-runtime-core';
```

---

## Значения по умолчанию

Если в опциях что-то не указано, используются такие числа:

| Параметр | По умолчанию |
| --- | --- |
| `batchSize` | `32` |
| `maxQueueSize` | `1000` |
| `debounceMs` | **`DEFAULT_DEBOUNCE_MS` (сейчас `50`)** — не ноль: после серии `enqueue` авто-сброс ждёт столько миллисекунд тишины |

Чтобы **не** ждать таймер и гнать сброс почти сразу после текущего синхронного кода, передайте **`debounceMs: 0`**: тогда авто-сброс ставится на **следующий microtask** (несколько `enqueue` в одном синхронном участке обычно сливаются в один вызов `flush`).

---

## Как это работает

### Очередь

- **`enqueue(entry)`** — в конец очереди; если длина стала больше `maxQueueSize`, с **начала** удаляются самые старые записи, пока длина не станет допустимой.

### Когда после `enqueue` вообще вызовется `flush`

Пока **не** идёт уже активный сброс:

1. **Если `debounceMs > 0`** (в том числе значение по умолчанию **50**): на каждый `enqueue` сбрасывается предыдущий таймер и заводится новый. **`flush`** вызывается только когда с момента **последнего** `enqueue` прошло `debounceMs` миллисекунд без новых записей. Это обычный **trailing debounce**: при частом потоке событий не дергают сеть на каждую строку, а ждут короткой паузы.

2. **Если вы явно передали `debounceMs: 0`**: таймера нет — один запланированный сброс на **следующий microtask**. Записи, добавленные подряд в одном синхронном блоке, чаще всего попадут в **один** проход `flush`.

Если сброс **уже выполняется**, новый план из `enqueue` не создаётся: хвост очереди подхватывается текущим проходом.

### Один «проход» сброса

Пока очередь не пуста:

1. Берётся срез с головы не больше **`batchSize`** элементов.
2. Вызывается **`await flush(batch, options)`**. В `options`, например, может быть `{ keepalive: true }`, если сброс пришёл из **`flushOnLeave()`** (или из **`flush({ keepalive: true })`**).
3. Если **`flush` вернул строго `true`**: эти элементы снимаются с головы очереди; если очередь ещё не пуста — в **том же** проходе берётся следующая пачка (то есть за один заход можно отправить много пачек подряд).
4. Если вернулось **`false`** или не `true`: проход **останавливается**, пачка **остаётся**. Ядро **само** не повторяет вызов `flush` для этой пачки. Следующая попытка — когда снова сработает авто-сброс (debounce / microtask) или вы вызовете **`flush`** сами.

### Явный `flush` и `flushOnLeave`

- **`flush(options?)`** — тот же проход сброса; в начале **отменяется** отложенный таймер debounce, чтобы не получить двойную отправку «таймер + рука».
- **`flushOnLeave()`** — то же, что **`flush({ keepalive: true })`**. Смысл `keepalive` определяете вы внутри своего `flush` (часто для last-chance запроса в браузере).

### Параллельный `flush`

Если `flush` вызвали, пока уже идёт сброс, опции накапливаются: если хоть раз передали `keepalive: true`, это сохранится. После завершения текущего прохода, если очередь ещё не пуста и был отложенный запрос, выполняется ещё один проход с объединёнными опциями.

### `dispose()`

Логгер выключается: новые `enqueue` игнорируются, очередь очищается, таймер debounce снимается. Уже запущенный у вас асинхронный код внутри `flush` может ещё отработать — это граница вашего кода.

---

## Опции `createBufferedLogger<T>(options)`

| Поле | Обязательное | Описание |
| --- | --- | --- |
| `flush` | да | `(batch: readonly T[], options?: { keepalive?: boolean }) => Promise<boolean>` |
| `batchSize` | нет | размер пачки (по умолчанию `32`) |
| `maxQueueSize` | нет | лимит длины очереди (по умолчанию `1000`) |
| `debounceMs` | нет | тишина в мс перед авто-`flush` после `enqueue`; по умолчанию **`DEFAULT_DEBOUNCE_MS`**; **`0`** — режим microtask |

### Методы возвращаемого логгера

`enqueue`, `flush`, `flushOnLeave`, `dispose`.

---

## `…/browser` — только уход со страницы

```ts
import { attachPagehideFlush } from '@budarin/browser-log-runtime-core/browser';

const detach = attachPagehideFlush(() => {
    void logger.flushOnLeave();
});
// …
detach();
```

Подписка на **`pagehide`** с `{ capture: true }`. Глобальные **`error` / `unhandledrejection`** не трогаются.

---

## Примеры

### Обычный случай: дефолтный debounce (ничего не передаём)

Подходит, когда записи сыплются часто, а отправлять хочется пачками после короткой паузы:

```ts
import { createBufferedLogger, DEFAULT_DEBOUNCE_MS } from '@budarin/browser-log-runtime-core';

type LogRow = { level: string; message: string; at: number };

const logger = createBufferedLogger<LogRow>({
    batchSize: 32,
    maxQueueSize: 1000,
    // debounceMs не указан — будет DEFAULT_DEBOUNCE_MS (сейчас 50)
    flush: async (batch, opts) => {
        const res = await fetch('/api/logs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ events: batch }),
            keepalive: opts?.keepalive === true,
        });
        return res.ok;
    },
});

logger.enqueue({ level: 'info', message: 'готово', at: Date.now() });
// через ~DEFAULT_DEBOUNCE_MS мс тишины без новых enqueue вызовется flush
```

### Нужна минимальная задержка: `debounceMs: 0`

Когда важно среагировать на следующий тик цикла событий без ожидания 50 мс:

```ts
const logger = createBufferedLogger({
    debounceMs: 100,
    flush: async (batch) => {
        await someSink.write(batch);
        return true;
    },
});
```

---

## Лицензия

MIT
