import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AddonQuoteError, BookingQuoteError, InvalidMoneyError } from '@booking/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'not_found', 'Route not found'));
};

function isJsonParseError(err: unknown): boolean {
  return err instanceof SyntaxError && (err as { type?: string }).type === 'entity.parse.failed';
}

type HttpClientError = { status: number; type?: string; expose?: boolean };

/** Body-parser / http-errors style 4xx errors (too large, bad charset, bad encoding, ...). */
function isHttpClientError(err: unknown): err is HttpClientError {
  const e = err as Partial<HttpClientError> | null;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.status === 'number' &&
    e.status >= 400 &&
    e.status < 500 &&
    e.expose === true
  );
}

const CLIENT_ERROR_CODES: Readonly<Record<number, [code: string, message: string]>> = {
  413: ['payload_too_large', 'Request body too large'],
  415: ['unsupported_media_type', 'Unsupported request encoding or charset'],
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.status).json({ error: body });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'validation_error', message: 'Invalid request', details: err.issues },
    });
    return;
  }
  if (err instanceof AddonQuoteError) {
    res.status(err.code === 'addon_out_of_stock' ? 409 : 400).json({
      error: { code: err.code, message: err.message, details: { addonId: err.addonId } },
    });
    return;
  }
  if (err instanceof BookingQuoteError) {
    res.status(400).json({ error: { code: err.code, message: err.message, details: { startAt: err.startAt } } });
    return;
  }
  if (err instanceof InvalidMoneyError) {
    res.status(400).json({ error: { code: 'invalid_amount', message: err.message } });
    return;
  }
  if (isJsonParseError(err)) {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
    return;
  }
  if (isHttpClientError(err)) {
    const [code, message] = CLIENT_ERROR_CODES[err.status] ?? ['bad_request', 'Bad request'];
    res.status(err.status).json({ error: { code, message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
};
