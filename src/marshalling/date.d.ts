import type {Marshaller} from './index.js';

/**
 * Encode `Date` as ISO 8601 UTC string for storage. Lexicographically
 * sortable, human-readable, DynamoDB-string-attribute compatible.
 * `undefined` / `null` pass through unchanged.
 */
export function marshallDateISO(date: Date | undefined): string | undefined;
export function marshallDateISO(date: Date | null): string | null;
export function marshallDateISO(date: Date): string;

/**
 * Inverse of {@link marshallDateISO}. `undefined` / `null` pass through.
 */
export function unmarshallDateISO(s: string | undefined): Date | undefined;
export function unmarshallDateISO(s: string | null): Date | null;
export function unmarshallDateISO(s: string): Date;

/**
 * Encode `Date` as epoch milliseconds for storage. Smaller on-wire
 * footprint than ISO, integer-comparable, compatible with DynamoDB TTL
 * if divided by 1000. `undefined` / `null` pass through unchanged.
 */
export function marshallDateEpoch(date: Date | undefined): number | undefined;
export function marshallDateEpoch(date: Date | null): number | null;
export function marshallDateEpoch(date: Date): number;

/**
 * Inverse of {@link marshallDateEpoch}. `undefined` / `null` pass
 * through.
 */
export function unmarshallDateEpoch(ms: number | undefined): Date | undefined;
export function unmarshallDateEpoch(ms: number | null): Date | null;
export function unmarshallDateEpoch(ms: number): Date;

/**
 * `Marshaller` pair for ISO 8601 encoding. Use when you want to wire
 * both directions from a single object:
 * ```
 * hooks: {
 *   prepare: item => ({...item, created: dateISO.marshall(item.created)}),
 *   revive:  raw  => ({...raw,  created: dateISO.unmarshall(raw.created)})
 * }
 * ```
 */
export const dateISO: Marshaller<Date, string>;

/** `Marshaller` pair for epoch-milliseconds encoding. */
export const dateEpoch: Marshaller<Date, number>;
