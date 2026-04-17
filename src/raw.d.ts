/**
 * Brand symbol used to mark items that have already been shaped for DynamoDB.
 * Consumers rarely touch it — use {@link Raw} and {@link raw} instead.
 */
declare const rawBrand: unique symbol;

/** A branded type indicating the value has bypassed `prepare` / `revive`. */
export type RawMarked<T> = T & {readonly [rawBrand]: true};

/**
 * Bypass marker for items already shaped for DynamoDB.
 *
 * On writes (`post` / `put` / `patch`), a `Raw` item skips `prepare` and
 * `validateItem` and is written verbatim (SDK marshalling still runs).
 * On reads with `{reviveItems: false}`, results come back wrapped in `Raw<T>`.
 *
 * Detect via `x instanceof Raw`; unwrap via `x.item`.
 */
export class Raw<T> {
  /** The wrapped value, accessed directly at `raw.item`. */
  readonly item: T;
  /**
   * @param item The already-shaped value to wrap.
   */
  constructor(item: T);
}

/**
 * Convenience factory for {@link Raw}. Equivalent to `new Raw(item)`.
 *
 * @param item The already-shaped value to wrap.
 */
export function raw<T>(item: T): Raw<T>;
