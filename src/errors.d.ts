/**
 * Base class for every toolkit-named error. Subclasses carry domain-specific
 * context on named fields. `err.name` matches the class name, so callers
 * can discriminate either via `instanceof` (preferred) or via
 * `err.name === 'ConsistentReadOnGSIRejected'`.
 */
export class ToolkitError extends Error {
  constructor(message: string);
}

/** DynamoDB rejects `ConsistentRead: true` on GSI Query. Use an LSI instead for strong consistency. */
export class ConsistentReadOnGSIRejected extends ToolkitError {
  indexName: string;
  constructor(indexName: string);
}

/** `?sort=<field>` has no matching index declared and the toolkit refuses to in-memory-sort. */
export class NoIndexForSortField extends ToolkitError {
  sortField: string;
  constructor(sortField: string);
}

/** The `f-<field>-<op>=<value>` filter grammar rejected a field not in `filterable`. */
export class BadFilterField extends ToolkitError {
  field: string;
  constructor(field: string);
}

/** The `f-<field>-<op>=<value>` filter grammar rejected an op not allowed for this field. */
export class BadFilterOp extends ToolkitError {
  field: string;
  op: string;
  constructor(field: string, op: string);
}

/**
 * `edit()` detected that the `mapFn` diff touches a keyField. Set
 * `{allowKeyChange: true}` to opt into auto-promotion to a clone+delete.
 */
export class KeyFieldChanged extends ToolkitError {
  fields: string[];
  constructor(fields: string[]);
}

/** `asOf` used without `options.createdAtField` declared on the adapter. */
export class CreatedAtFieldNotDeclared extends ToolkitError {
  constructor();
}

/**
 * Cascade primitive called without a declared parent-child relationship on
 * the adapter.
 */
export class CascadeNotDeclared extends ToolkitError {
  operation: string;
  constructor(operation: string);
}
