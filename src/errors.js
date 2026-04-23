// Toolkit-named error classes. Thrown by the toolkit for constraints it
// detects itself — not used to wrap caller-supplied callback throws (those
// propagate unchanged; see the cross-project rule
// `topics/user-callbacks-throw-no-toolkit-wrap` in the knowledge vault).

/**
 * Base class so `err instanceof ToolkitError` lets callers catch any
 * toolkit-named error at once. Each subclass carries domain-specific context
 * on named fields; every subclass also sets `err.name` to the class name
 * for code paths that prefer string-based discrimination.
 */
export class ToolkitError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * DynamoDB rejects `ConsistentRead: true` on GSI Query (GSIs are eventually
 * consistent by design). The adapter refuses up front when a consistent
 * read is requested against a declared GSI — LSIs support strong
 * consistency and aren't refused.
 */
export class ConsistentReadOnGSIRejected extends ToolkitError {
  constructor(indexName) {
    super(
      `ConsistentRead is not supported on GSI Query (index '${indexName}'). Use an LSI if strong consistency is required. See https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-gsi.html`
    );
    this.indexName = indexName;
  }
}

/**
 * `?sort=<field>` requested but no declared index has `sk.name === <field>`.
 * The toolkit does not in-memory-sort (per the no-client-side-list-manipulation
 * principle); it refuses and the caller must declare an index or handle
 * sort in the application layer.
 */
export class NoIndexForSortField extends ToolkitError {
  constructor(sortField) {
    super(
      `No index defined for sort field '${sortField}'. Declare an LSI or GSI with sk.name === '${sortField}', or drop the sort parameter. See https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html`
    );
    this.sortField = sortField;
  }
}

/**
 * The `<op>-<field>=<value>` filter grammar rejected a field that isn't
 * present in the adapter's `filterable` allowlist.
 */
export class BadFilterField extends ToolkitError {
  constructor(field) {
    super(`Filter field '${field}' is not allowlisted. Add it to options.filterable on the adapter.`);
    this.field = field;
  }
}

/**
 * The `<op>-<field>=<value>` filter grammar accepted the field but
 * rejected the op — the op isn't in the field's allowlist entry.
 */
export class BadFilterOp extends ToolkitError {
  constructor(field, op) {
    super(`Filter op '${op}' is not allowed for field '${field}'. Add '${op}' to options.filterable['${field}'] or use a supported op.`);
    this.field = field;
    this.op = op;
  }
}

/**
 * `edit()` detected that the `mapFn` diff touches a keyField. Edit is for
 * in-place non-key updates; key changes require move. Set
 * `{allowKeyChange: true}` to opt into auto-promotion.
 */
export class KeyFieldChanged extends ToolkitError {
  constructor(fields) {
    super(
      `edit() cannot change key fields [${fields.map(f => `'${f}'`).join(', ')}]. Use adapter.move() instead, or pass {allowKeyChange: true} to auto-promote.`
    );
    this.fields = fields.slice();
  }
}

/**
 * `asOf` mass-op option used but the adapter didn't declare
 * `createdAtField` — the toolkit has no field to build the
 * scope-freeze `FilterExpression` against.
 */
export class CreatedAtFieldNotDeclared extends ToolkitError {
  constructor() {
    super('asOf: options.createdAtField is not declared on the adapter — declare it to use {asOf}.');
  }
}

/**
 * Cascade primitive (`deleteAllUnder` / `cloneAllUnder` / `moveAllUnder`)
 * called without a declared parent-child relationship on the adapter. The
 * toolkit will not infer cascade scope from composite `keyFields` — the
 * relationship must be explicit.
 */
export class CascadeNotDeclared extends ToolkitError {
  constructor(operation) {
    super(`${operation}: no cascade relationships declared on the adapter. Declare options.relationships to use cascade primitives.`);
    this.operation = operation;
  }
}

/**
 * `verifyTable({throwOnMismatch: true})` detected drift between the
 * declared schema and the live DynamoDB table. Carries the same
 * structured `diffs` array the default return surfaces.
 */
export class TableVerificationFailed extends ToolkitError {
  constructor(tableName, diffs) {
    super(`verifyTable: ${diffs.length} mismatch(es) on table '${tableName}' — see err.diffs for details.`);
    this.tableName = tableName;
    this.diffs = diffs.slice();
  }
}
