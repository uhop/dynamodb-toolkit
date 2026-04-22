import type {Marshaller} from './index.js';

/**
 * Encode a `URL` as a string (`.href`) for storage. `undefined` /
 * `null` pass through unchanged.
 */
export function marshallURL(url: URL | undefined): string | undefined;
export function marshallURL(url: URL | null): string | null;
export function marshallURL(url: URL): string;

/**
 * Inverse of {@link marshallURL}. Throws `TypeError` on malformed
 * string (delegates to `URL` constructor). `undefined` / `null` pass
 * through.
 */
export function unmarshallURL(s: string | undefined): URL | undefined;
export function unmarshallURL(s: string | null): URL | null;
export function unmarshallURL(s: string): URL;

/** `Marshaller` pair for `URL`. */
export const url: Marshaller<URL, string>;
