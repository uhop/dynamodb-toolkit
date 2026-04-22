/**
 * Marshall a `Map<string, V>` to a plain object (DynamoDB M attribute
 * shape). Optional `valueTransform` marshalls each value — compose
 * with `marshallDateISO` etc. for nested Date values, or with another
 * `marshallMap` call for nested maps.
 *
 * `undefined` / `null` pass through unchanged. Non-string keys throw —
 * DynamoDB map attribute keys must be strings.
 */
export function marshallMap<V, TStored = V>(map: Map<string, V> | undefined, valueTransform?: (v: V) => TStored): Record<string, TStored> | undefined;
export function marshallMap<V, TStored = V>(map: Map<string, V> | null, valueTransform?: (v: V) => TStored): Record<string, TStored> | null;
export function marshallMap<V, TStored = V>(map: Map<string, V>, valueTransform?: (v: V) => TStored): Record<string, TStored>;

/**
 * Inverse of {@link marshallMap}. Reads a plain object into a `Map`,
 * optionally transforming each value via `valueTransform`. Own
 * enumerable keys only — prototype pollution from storage is not
 * propagated into the returned Map.
 */
export function unmarshallMap<V, TRuntime = V>(obj: Record<string, V> | undefined, valueTransform?: (v: V) => TRuntime): Map<string, TRuntime> | undefined;
export function unmarshallMap<V, TRuntime = V>(obj: Record<string, V> | null, valueTransform?: (v: V) => TRuntime): Map<string, TRuntime> | null;
export function unmarshallMap<V, TRuntime = V>(obj: Record<string, V>, valueTransform?: (v: V) => TRuntime): Map<string, TRuntime>;
