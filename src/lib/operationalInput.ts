import { HttpError } from '../middleware/auth';

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

export function requiredString(value: unknown, field: string, min = 1, max = 5000): string {
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_INPUT', `${field} is required.`);
  const text = value.trim();
  if (text.length < min) throw new HttpError(400, 'INVALID_INPUT', `${field} must be at least ${min} characters.`);
  if (text.length > max) throw new HttpError(400, 'INVALID_INPUT', `${field} must be no more than ${max} characters.`);
  return text;
}

export function optionalString(value: unknown, max = 5000): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_INPUT', 'A text value was expected.');
  const text = value.trim();
  if (text.length > max) throw new HttpError(400, 'INVALID_INPUT', `Text must be no more than ${max} characters.`);
  return text || null;
}

export function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

export function optionalWholeNumber(
  value: unknown,
  field: string,
  min = 0,
  max = 100000,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a whole number between ${min} and ${max}.`);
  }
  return number;
}

export function validIsoDateTime(value: unknown, field: string, fallback?: string): string {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  if (typeof raw !== 'string' || Number.isNaN(new Date(raw).getTime())) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a valid date and time.`);
  }
  return new Date(raw).toISOString();
}

export function validDateOnly(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!DATE_PATTERN.test(text)) throw new HttpError(400, 'INVALID_INPUT', `${field} must use YYYY-MM-DD.`);
  return text;
}

export function resolveIdempotencyKey(headerValue: string | undefined, bodyValue: unknown): string | null {
  const body = optionalString(bodyValue, 160);
  const header = optionalString(headerValue, 160);
  return body ?? header;
}
