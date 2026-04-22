import test from 'tape-six';
import {Adapter, TableVerificationFailed} from 'dynamodb-toolkit';
import {
  buildCreateTableInput,
  buildAddGsiInput,
  planAddOnly,
  ensureTable,
  verifyTable,
  diffTable,
  buildDescriptorSnapshot,
  compareDescriptor,
  descriptorRecordKey,
  extractDeclaration
} from 'dynamodb-toolkit/provisioning';
import {makeMockClient} from './helpers/mock-client.js';

const TABLE = 'Rentals';

// Minimal composite-keyed adapter for provisioning tests.
const makeProvisioningAdapter = (clientHandler, overrides = {}) => {
  const client = makeMockClient(clientHandler);
  const adapter = new Adapter({
    client,
    table: TABLE,
    keyFields: [
      {name: 'state', type: 'string'},
      {name: 'rentalName', type: 'string'}
    ],
    structuralKey: {name: '_sk', separator: '|'},
    technicalPrefix: '_',
    indices: {
      'by-status-date': {
        type: 'gsi',
        pk: {name: 'status', type: 'string'},
        sk: {name: 'createdAt', type: 'string'},
        projection: 'all'
      }
    },
    ...overrides
  });
  return {adapter, client};
};

// --- declaration normalization ---

test('extractDeclaration: Adapter instance passes through', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}));
  const decl = extractDeclaration(adapter);
  t.equal(decl.table, TABLE);
  t.equal(decl.keyFields.length, 2);
  t.equal(decl.structuralKey.name, '_sk');
  t.equal(decl.billingMode, 'PAY_PER_REQUEST', 'default billing mode');
  t.ok(decl.indices['by-status-date'], 'index pulled through');
});

test('extractDeclaration: rejects non-object / missing fields', t => {
  t.throws(() => extractDeclaration(null), 'null input');
  t.throws(() => extractDeclaration({table: 't', keyFields: []}), 'missing client');
  t.throws(() => extractDeclaration({client: {}, keyFields: []}), 'missing table');
  t.throws(() => extractDeclaration({client: {}, table: 't'}), 'missing keyFields');
});

// --- CreateTable input shape ---

test('buildCreateTableInput: single-field keyFields (no structural key)', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}), {
    keyFields: ['name'],
    structuralKey: undefined,
    technicalPrefix: undefined,
    indices: {}
  });
  const input = buildCreateTableInput(extractDeclaration(adapter));
  t.deepEqual(input.KeySchema, [{AttributeName: 'name', KeyType: 'HASH'}]);
  t.deepEqual(input.AttributeDefinitions, [{AttributeName: 'name', AttributeType: 'S'}]);
  t.equal(input.BillingMode, 'PAY_PER_REQUEST');
  t.equal(input.GlobalSecondaryIndexes, undefined, 'no GSIs');
  t.equal(input.LocalSecondaryIndexes, undefined, 'no LSIs');
});

test('buildCreateTableInput: composite keyFields + GSI', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}));
  const input = buildCreateTableInput(extractDeclaration(adapter));
  t.deepEqual(input.KeySchema, [
    {AttributeName: 'state', KeyType: 'HASH'},
    {AttributeName: '_sk', KeyType: 'RANGE'}
  ]);
  t.ok(input.AttributeDefinitions.some(a => a.AttributeName === 'state' && a.AttributeType === 'S'));
  t.ok(input.AttributeDefinitions.some(a => a.AttributeName === '_sk' && a.AttributeType === 'S'));
  t.ok(input.AttributeDefinitions.some(a => a.AttributeName === 'status' && a.AttributeType === 'S'));
  t.ok(input.AttributeDefinitions.some(a => a.AttributeName === 'createdAt' && a.AttributeType === 'S'));
  t.equal(input.GlobalSecondaryIndexes.length, 1);
  t.equal(input.GlobalSecondaryIndexes[0].IndexName, 'by-status-date');
  t.deepEqual(input.GlobalSecondaryIndexes[0].Projection, {ProjectionType: 'ALL'});
});

test('buildCreateTableInput: LSI included', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}), {
    indices: {
      'by-vin': {
        type: 'lsi',
        sk: {name: 'vin', type: 'string'},
        projection: 'keys-only'
      }
    }
  });
  const input = buildCreateTableInput(extractDeclaration(adapter));
  t.equal(input.LocalSecondaryIndexes.length, 1);
  t.equal(input.LocalSecondaryIndexes[0].IndexName, 'by-vin');
  t.deepEqual(input.LocalSecondaryIndexes[0].KeySchema, [
    {AttributeName: 'state', KeyType: 'HASH'},
    {AttributeName: 'vin', KeyType: 'RANGE'}
  ]);
  t.deepEqual(input.LocalSecondaryIndexes[0].Projection, {ProjectionType: 'KEYS_ONLY'});
});

test('buildCreateTableInput: PROVISIONED requires provisionedThroughput', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}));
  const decl = extractDeclaration(adapter);
  decl.billingMode = 'PROVISIONED';
  t.throws(() => buildCreateTableInput(decl), 'missing throughput');
  decl.provisionedThroughput = {ReadCapacityUnits: 5, WriteCapacityUnits: 5};
  const input = buildCreateTableInput(decl);
  t.deepEqual(input.ProvisionedThroughput, {ReadCapacityUnits: 5, WriteCapacityUnits: 5});
});

test('buildAddGsiInput: wraps one Create per call', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}));
  const decl = extractDeclaration(adapter);
  const idx = decl.indices['by-status-date'];
  const input = buildAddGsiInput(decl, 'by-status-date', idx);
  t.equal(input.TableName, TABLE);
  t.equal(input.GlobalSecondaryIndexUpdates.length, 1);
  t.ok(input.GlobalSecondaryIndexUpdates[0].Create, 'Create action');
  t.equal(input.GlobalSecondaryIndexUpdates[0].Create.IndexName, 'by-status-date');
});

// --- plan logic ---

test('planAddOnly: null live → create step', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}));
  const plan = planAddOnly(extractDeclaration(adapter), null);
  t.equal(plan.steps.length, 1);
  t.equal(plan.steps[0].action, 'create');
  t.matchString(plan.summary[0], /Would CREATE table Rentals/);
});

test('planAddOnly: missing GSI → add-gsi step; extra GSI → skip-extra-gsi', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}));
  const live = {
    TableName: TABLE,
    KeySchema: [
      {AttributeName: 'state', KeyType: 'HASH'},
      {AttributeName: '_sk', KeyType: 'RANGE'}
    ],
    AttributeDefinitions: [
      {AttributeName: 'state', AttributeType: 'S'},
      {AttributeName: '_sk', AttributeType: 'S'},
      {AttributeName: 'legacy', AttributeType: 'S'}
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'by-legacy',
        KeySchema: [{AttributeName: 'legacy', KeyType: 'HASH'}],
        Projection: {ProjectionType: 'ALL'}
      }
    ]
  };
  const plan = planAddOnly(extractDeclaration(adapter), live);
  t.ok(plan.steps.some(s => s.action === 'add-gsi' && s.name === 'by-status-date'));
  t.ok(plan.steps.some(s => s.action === 'skip-extra-gsi' && s.name === 'by-legacy'));
  t.ok(plan.summary.some(l => l.includes('Would ADD GSI by-status-date')));
  t.ok(plan.summary.some(l => l.includes('Extra GSI by-legacy')));
});

test('planAddOnly: declaration matches live → no-op plan', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}));
  const live = {
    TableName: TABLE,
    KeySchema: [
      {AttributeName: 'state', KeyType: 'HASH'},
      {AttributeName: '_sk', KeyType: 'RANGE'}
    ],
    GlobalSecondaryIndexes: [{IndexName: 'by-status-date'}]
  };
  const plan = planAddOnly(extractDeclaration(adapter), live);
  t.equal(plan.steps.length, 0);
  t.matchString(plan.summary[0], /matches declaration/);
});

// --- ensureTable integration ---

test('ensureTable: default returns plan, writes nothing', async t => {
  const sends = [];
  const {adapter} = makeProvisioningAdapter(async cmd => {
    sends.push(cmd);
    if (cmd.constructor.name === 'DescribeTableCommand') {
      const err = new Error('not found');
      err.name = 'ResourceNotFoundException';
      throw err;
    }
    return {};
  });
  const result = await ensureTable(adapter);
  t.ok(result.steps, 'returns a plan');
  t.equal(result.steps[0].action, 'create');
  t.equal(sends.filter(c => c.constructor.name !== 'DescribeTableCommand').length, 0, 'no writes');
});

test('ensureTable: {yes: true} executes the plan', async t => {
  const sends = [];
  const {adapter} = makeProvisioningAdapter(async cmd => {
    sends.push(cmd);
    if (cmd.constructor.name === 'DescribeTableCommand') {
      const err = new Error('not found');
      err.name = 'ResourceNotFoundException';
      throw err;
    }
    return {};
  });
  const result = await ensureTable(adapter, {yes: true});
  t.equal(result.executed.length, 1);
  t.matchString(result.executed[0], /create:Rentals/);
  t.ok(
    sends.some(c => c.constructor.name === 'CreateTableCommand'),
    'CreateTable sent'
  );
});

test('ensureTable: {yes: true} writes descriptor when declared', async t => {
  const {adapter} = makeProvisioningAdapter(
    async cmd => {
      if (cmd.constructor.name === 'DescribeTableCommand') {
        const err = new Error('not found');
        err.name = 'ResourceNotFoundException';
        throw err;
      }
      return {};
    },
    {descriptorKey: '__adapter__'}
  );
  const result = await ensureTable(adapter, {yes: true});
  t.equal(result.descriptorWritten, true);
});

// --- verifyTable ---

test('verifyTable: live absent → error diff', async t => {
  const {adapter} = makeProvisioningAdapter(async () => {
    const err = new Error('not found');
    err.name = 'ResourceNotFoundException';
    throw err;
  });
  const r = await verifyTable(adapter);
  t.equal(r.ok, false);
  t.ok(r.diffs.some(d => d.path === 'table' && d.severity === 'error'));
});

test('verifyTable: matching schema → ok', async t => {
  const {adapter} = makeProvisioningAdapter(async cmd => {
    if (cmd.constructor.name === 'DescribeTableCommand') {
      return {
        Table: {
          TableName: TABLE,
          KeySchema: [
            {AttributeName: 'state', KeyType: 'HASH'},
            {AttributeName: '_sk', KeyType: 'RANGE'}
          ],
          AttributeDefinitions: [
            {AttributeName: 'state', AttributeType: 'S'},
            {AttributeName: '_sk', AttributeType: 'S'},
            {AttributeName: 'status', AttributeType: 'S'},
            {AttributeName: 'createdAt', AttributeType: 'S'}
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'by-status-date',
              KeySchema: [
                {AttributeName: 'status', KeyType: 'HASH'},
                {AttributeName: 'createdAt', KeyType: 'RANGE'}
              ],
              Projection: {ProjectionType: 'ALL'}
            }
          ]
        }
      };
    }
    return {};
  });
  const r = await verifyTable(adapter);
  t.equal(r.ok, true);
  t.equal(r.diffs.length, 0);
});

test('verifyTable: missing GSI → error diff', async t => {
  const {adapter} = makeProvisioningAdapter(async cmd => {
    if (cmd.constructor.name === 'DescribeTableCommand') {
      return {
        Table: {
          TableName: TABLE,
          KeySchema: [
            {AttributeName: 'state', KeyType: 'HASH'},
            {AttributeName: '_sk', KeyType: 'RANGE'}
          ],
          AttributeDefinitions: [
            {AttributeName: 'state', AttributeType: 'S'},
            {AttributeName: '_sk', AttributeType: 'S'}
          ]
        }
      };
    }
    return {};
  });
  const r = await verifyTable(adapter);
  t.equal(r.ok, false);
  t.ok(r.diffs.some(d => d.path === 'gsi.by-status-date' && d.severity === 'error'));
});

test('verifyTable: extra GSI → warn only', async t => {
  const {adapter} = makeProvisioningAdapter(async cmd => {
    if (cmd.constructor.name === 'DescribeTableCommand') {
      return {
        Table: {
          TableName: TABLE,
          KeySchema: [
            {AttributeName: 'state', KeyType: 'HASH'},
            {AttributeName: '_sk', KeyType: 'RANGE'}
          ],
          AttributeDefinitions: [
            {AttributeName: 'state', AttributeType: 'S'},
            {AttributeName: '_sk', AttributeType: 'S'},
            {AttributeName: 'status', AttributeType: 'S'},
            {AttributeName: 'createdAt', AttributeType: 'S'},
            {AttributeName: 'legacy', AttributeType: 'S'}
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'by-status-date',
              KeySchema: [
                {AttributeName: 'status', KeyType: 'HASH'},
                {AttributeName: 'createdAt', KeyType: 'RANGE'}
              ],
              Projection: {ProjectionType: 'ALL'}
            },
            {
              IndexName: 'by-legacy',
              KeySchema: [{AttributeName: 'legacy', KeyType: 'HASH'}],
              Projection: {ProjectionType: 'ALL'}
            }
          ]
        }
      };
    }
    return {};
  });
  const r = await verifyTable(adapter);
  t.equal(r.ok, true, 'extra GSI is a warn, not error');
  t.ok(r.diffs.some(d => d.path === 'gsi.by-legacy' && d.severity === 'warn'));
});

test('verifyTable: throwOnMismatch throws TableVerificationFailed', async t => {
  const {adapter} = makeProvisioningAdapter(async () => {
    const err = new Error('not found');
    err.name = 'ResourceNotFoundException';
    throw err;
  });
  let thrown;
  try {
    await verifyTable(adapter, {throwOnMismatch: true});
  } catch (e) {
    thrown = e;
  }
  t.ok(thrown instanceof TableVerificationFailed, 'TableVerificationFailed thrown');
  t.equal(thrown.tableName, TABLE);
  t.ok(thrown.diffs.length > 0);
});

test('verifyTable: requireDescriptor + missing → error', async t => {
  const {adapter} = makeProvisioningAdapter(
    async cmd => {
      if (cmd.constructor.name === 'DescribeTableCommand') {
        return {
          Table: {
            TableName: TABLE,
            KeySchema: [
              {AttributeName: 'state', KeyType: 'HASH'},
              {AttributeName: '_sk', KeyType: 'RANGE'}
            ],
            AttributeDefinitions: [
              {AttributeName: 'state', AttributeType: 'S'},
              {AttributeName: '_sk', AttributeType: 'S'},
              {AttributeName: 'status', AttributeType: 'S'},
              {AttributeName: 'createdAt', AttributeType: 'S'}
            ],
            GlobalSecondaryIndexes: [
              {
                IndexName: 'by-status-date',
                KeySchema: [
                  {AttributeName: 'status', KeyType: 'HASH'},
                  {AttributeName: 'createdAt', KeyType: 'RANGE'}
                ],
                Projection: {ProjectionType: 'ALL'}
              }
            ]
          }
        };
      }
      if (cmd.constructor.name === 'GetCommand') return {}; // no descriptor
      return {};
    },
    {descriptorKey: '__adapter__'}
  );
  const r = await verifyTable(adapter, {requireDescriptor: true});
  t.equal(r.ok, false);
  t.ok(r.diffs.some(d => d.path === 'descriptor' && d.severity === 'error'));
});

// --- descriptor ---

test('descriptorRecordKey: includes structural key for composite', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}), {descriptorKey: '__adapter__'});
  const key = descriptorRecordKey(extractDeclaration(adapter));
  t.equal(key.state, '__adapter__');
  t.equal(key._sk, '__adapter__');
});

test('buildDescriptorSnapshot: captures declaration fields', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}), {descriptorKey: '__adapter__'});
  const snap = buildDescriptorSnapshot(extractDeclaration(adapter));
  t.equal(snap.version, 1);
  t.equal(snap.table, TABLE);
  t.equal(snap.keyFields.length, 2);
  t.ok(snap.indices['by-status-date']);
  t.equal(snap.technicalPrefix, '_');
});

test('compareDescriptor: clean round-trip → no diffs', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}), {descriptorKey: '__adapter__'});
  const decl = extractDeclaration(adapter);
  const snap = buildDescriptorSnapshot(decl);
  // Round-trip through JSON to match real read path.
  const stored = JSON.parse(JSON.stringify(snap));
  const diffs = compareDescriptor(stored, decl);
  t.equal(diffs.length, 0);
});

test('compareDescriptor: drift in technicalPrefix → warn diff', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}), {descriptorKey: '__adapter__'});
  const decl = extractDeclaration(adapter);
  const snap = buildDescriptorSnapshot(decl);
  const stored = JSON.parse(JSON.stringify(snap));
  stored.technicalPrefix = '@@@'; // drifted
  const diffs = compareDescriptor(stored, decl);
  t.ok(diffs.some(d => d.path === 'descriptor.technicalPrefix' && d.severity === 'warn'));
});

// --- plain diffTable utility ---

test('diffTable: attribute type mismatch → error', t => {
  const {adapter} = makeProvisioningAdapter(async () => ({}));
  const decl = extractDeclaration(adapter);
  const live = {
    TableName: TABLE,
    KeySchema: [
      {AttributeName: 'state', KeyType: 'HASH'},
      {AttributeName: '_sk', KeyType: 'RANGE'}
    ],
    AttributeDefinitions: [
      {AttributeName: 'state', AttributeType: 'N'}, // should be S
      {AttributeName: '_sk', AttributeType: 'S'},
      {AttributeName: 'status', AttributeType: 'S'},
      {AttributeName: 'createdAt', AttributeType: 'S'}
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'by-status-date',
        KeySchema: [
          {AttributeName: 'status', KeyType: 'HASH'},
          {AttributeName: 'createdAt', KeyType: 'RANGE'}
        ],
        Projection: {ProjectionType: 'ALL'}
      }
    ]
  };
  const diffs = diffTable(decl, live);
  t.ok(diffs.some(d => d.path === 'table.AttributeDefinitions.state' && d.severity === 'error'));
});
