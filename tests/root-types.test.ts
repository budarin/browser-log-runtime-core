import { createBufferedLogger, type BufferedLoggerFlush } from '../src/index.js';

type Row = {
    readonly id: string;
    readonly payload: number;
};

const flush: BufferedLoggerFlush<Row> = async (batch) => {
    const first: Row | undefined = batch[0];
    first?.id.toUpperCase();
    return true;
};

const logger = createBufferedLogger<Row>({
    flush,
    batchSize: 4,
    debounceMs: 0,
});

logger.enqueue({ id: 'a', payload: 1 });

// @ts-expect-error wrong entry shape
logger.enqueue({ id: 1, payload: 1 });

void logger.flush();
