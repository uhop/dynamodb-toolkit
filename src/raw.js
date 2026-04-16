// Raw<T> bypass marker — wraps an item to skip prepare/revive hooks.

export class Raw {
  constructor(item) {
    this.item = item;
  }
}

export const raw = item => new Raw(item);
