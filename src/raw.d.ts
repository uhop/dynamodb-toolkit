// Raw<T> bypass marker — wraps an item to skip prepare/revive hooks.

declare const rawBrand: unique symbol;

export type RawMarked<T> = T & {readonly [rawBrand]: true};

export class Raw<T> {
  readonly item: T;
  constructor(item: T);
}

export function raw<T>(item: T): Raw<T>;
