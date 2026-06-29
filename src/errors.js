// @ts-self-types="./errors.d.ts"
// Toolkit-named error classes. Thrown by the toolkit for constraints it
// detects itself — not used to wrap caller-supplied callback throws (those
// propagate unchanged; see the cross-project rule
// `topics/user-callbacks-throw-no-toolkit-wrap` in the knowledge vault).

export class ToolkitError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConsistentReadOnGSIRejected extends ToolkitError {
  constructor(indexName) {
    super(
      `ConsistentRead is not supported on GSI Query (index '${indexName}'). Use an LSI if strong consistency is required. See https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-gsi.html`
    );
    this.indexName = indexName;
  }
}

export class NoIndexForSortField extends ToolkitError {
  constructor(sortField) {
    super(
      `No index defined for sort field '${sortField}'. Declare an LSI or GSI with sk.name === '${sortField}', or drop the sort parameter. See https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html`
    );
    this.sortField = sortField;
  }
}

export class BadFilterField extends ToolkitError {
  constructor(field) {
    super(`Filter field '${field}' is not allowlisted. Add it to options.filterable on the adapter.`);
    this.field = field;
  }
}

export class BadFilterOp extends ToolkitError {
  constructor(field, op) {
    super(`Filter op '${op}' is not allowed for field '${field}'. Add '${op}' to options.filterable['${field}'] or use a supported op.`);
    this.field = field;
    this.op = op;
  }
}

export class KeyFieldChanged extends ToolkitError {
  constructor(fields) {
    super(
      `edit() cannot change key fields [${fields.map(f => `'${f}'`).join(', ')}]. Use adapter.move() instead, or pass {allowKeyChange: true} to auto-promote.`
    );
    this.fields = fields.slice();
  }
}

export class CreatedAtFieldNotDeclared extends ToolkitError {
  constructor() {
    super('asOf: options.createdAtField is not declared on the adapter — declare it to use {asOf}.');
  }
}

export class CascadeNotDeclared extends ToolkitError {
  constructor(operation) {
    super(`${operation}: no cascade relationships declared on the adapter. Declare options.relationships to use cascade primitives.`);
    this.operation = operation;
  }
}

export class TableVerificationFailed extends ToolkitError {
  constructor(tableName, diffs) {
    super(`verifyTable: ${diffs.length} mismatch(es) on table '${tableName}' — see err.diffs for details.`);
    this.tableName = tableName;
    this.diffs = diffs.slice();
  }
}
