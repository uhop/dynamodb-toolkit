// REST end-to-end tests: spin up node:http server with the standard handler against
// a real DynamoDB Local table; exercise the full Postman-era contract via fetch.
// Skips entirely when Docker is unavailable.

import test, {beforeAll, afterAll} from 'tape-six';
import {DynamoDBClient, CreateTableCommand, DeleteTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

import {Adapter} from 'dynamodb-toolkit';
import {createHandler} from 'dynamodb-toolkit/handler';

import {tableSchema} from '../fixtures/table-schema.js';
import {planets} from '../fixtures/planets.js';
import {startDynamoDBLocal} from '../helpers/dynamodb-local.js';
import {withServer} from '../helpers/withServer.js';

const ctx = {skip: false, reason: null};

beforeAll(async () => {
  const local = await startDynamoDBLocal();
  if (local.skip) {
    ctx.skip = true;
    ctx.reason = local.reason;
    return;
  }

  ctx.local = local;
  ctx.client = new DynamoDBClient({
    endpoint: local.endpoint,
    region: 'us-east-1',
    credentials: {accessKeyId: 'fake', secretAccessKey: 'fake'}
  });
  ctx.docClient = DynamoDBDocumentClient.from(ctx.client, {marshallOptions: {removeUndefinedValues: true}});

  ctx.tableName = 'rest-' + Math.random().toString(36).slice(2, 8);
  await ctx.client.send(new CreateTableCommand(tableSchema(ctx.tableName)));

  // Adapter mirrors the v2 routes.js consumer: searchable mirror columns,
  // a `-t` partition trick to enable a sortable GSI scan.
  ctx.adapter = new Adapter({
    client: ctx.docClient,
    table: ctx.tableName,
    keyFields: ['name'],
    searchable: {name: 1, climate: 1, terrain: 1},
    hooks: {
      prepare(item, isPatch) {
        const out = {};
        for (const key of Object.keys(item)) {
          if (key.startsWith('-')) continue;
          out[key] = item[key];
          if (this.searchable?.[key] === 1) out['-search-' + key] = String(item[key]).toLowerCase();
        }
        if (isPatch) {
          delete out.name;
        } else {
          out['-t'] = 1;
        }
        return out;
      },
      revive(item) {
        const out = {};
        for (const key of Object.keys(item)) {
          if (!key.startsWith('-')) out[key] = item[key];
        }
        return out;
      },
      prepareListInput(_, index) {
        const idx = index || '-t-name-index';
        return {
          IndexName: idx,
          KeyConditionExpression: '#t = :t',
          ExpressionAttributeNames: {'#t': '-t'},
          ExpressionAttributeValues: {':t': 1}
        };
      }
    }
  });
  // searchable lives on the adapter directly (not on hooks); rebind for the prepare hook
  ctx.adapter.hooks.prepare = ctx.adapter.hooks.prepare.bind(ctx.adapter);

  ctx.handler = createHandler(ctx.adapter, {
    sortableIndices: {name: '-t-name-index'}
  });

  // Pre-load planets once for read-heavy tests
  await ctx.adapter.putAll(planets);
});

afterAll(async () => {
  if (ctx.skip) return;
  try {
    await ctx.client.send(new DeleteTableCommand({TableName: ctx.tableName}));
  } catch {
    // best-effort
  }
  await ctx.local.stop();
  ctx.docClient.destroy();
  ctx.client.destroy();
});

const skipIfNoDocker = t => {
  if (ctx.skip) {
    t.comment('SKIP: ' + ctx.reason);
    return true;
  }
  return false;
};

const run = (t, fn) => {
  if (skipIfNoDocker(t)) return;
  return withServer(ctx.handler, fn);
};

const json = res => res.json();

// --- collection reads ---

test('REST: GET / paginates with envelope', t =>
  run(t, async base => {
    const res = await fetch(`${base}/?sort=name&fields=name&limit=10`);
    t.equal(res.status, 200);
    const body = await json(res);
    t.equal(body.data.length, 10);
    t.equal(body.offset, 0);
    t.equal(body.limit, 10);
    t.equal(body.total, planets.length);
    // Ascending sort: Alderaan should be first
    t.equal(body.data[0].name, 'Alderaan');
  }));

test('REST: GET / desc sort + search', t =>
  run(t, async base => {
    const res = await fetch(`${base}/?sort=-name&fields=name&search=tooine&limit=10`);
    t.equal(res.status, 200);
    const body = await json(res);
    t.ok(body.data.length >= 2);
    // 'tooine' matches Tatooine and Dantooine; descending by name
    t.equal(body.data[0].name, 'Tatooine');
    t.equal(body.data[1].name, 'Dantooine');
  }));

test('REST: GET / paging links present', t =>
  run(t, async base => {
    const res = await fetch(`${base}/?sort=name&fields=name&limit=10&offset=10`);
    const body = await json(res);
    t.ok(body.links, 'links envelope present');
    t.matchString(body.links.prev, /offset=0/);
    t.matchString(body.links.next, /offset=20/);
  }));

test('REST: GET /:key returns one item', t =>
  run(t, async base => {
    const res = await fetch(`${base}/Tatooine`);
    t.equal(res.status, 200);
    const body = await json(res);
    t.equal(body.name, 'Tatooine');
    t.equal(body.climate, 'arid');
  }));

test('REST: GET /:key 404 on miss', t =>
  run(t, async base => {
    const res = await fetch(`${base}/NeverWas`);
    t.equal(res.status, 404);
  }));

test('REST: GET /:key with fields projection', t =>
  run(t, async base => {
    const res = await fetch(`${base}/Hoth?fields=name,climate`);
    const body = await json(res);
    t.equal(body.name, 'Hoth');
    t.equal(body.climate, 'frozen');
    t.equal(body.diameter, undefined);
  }));

test('REST: GET /-by-names returns length-preserving array with null at misses', t =>
  run(t, async base => {
    const res = await fetch(`${base}/-by-names?names=Hoth,Endor,Bespin,XX&fields=name,diameter`);
    const body = await json(res);
    t.ok(Array.isArray(body));
    t.equal(body.length, 4, 'length matches requested names count');
    // Length-preserving: result[i] corresponds to names[i]. The missing 'XX'
    // becomes null on the wire (undefined in JS → JSON.stringify → null).
    t.equal(body[3], null, 'XX missing → null at position 3');
    // Found items in whichever position their name was requested.
    const nameAt = i => body[i]?.name;
    t.deepEqual([nameAt(0), nameAt(1), nameAt(2)], ['Hoth', 'Endor', 'Bespin']);
  }));

// --- collection writes ---

test('REST: POST / creates a new item; 204', t =>
  run(t, async base => {
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'AAA Fake', climate: 'temperate', terrain: 'rocky'})
    });
    t.equal(res.status, 204);
    const get = await fetch(`${base}/AAA%20Fake`);
    const body = await get.json();
    t.equal(body.climate, 'temperate');
    // cleanup
    await fetch(`${base}/AAA%20Fake`, {method: 'DELETE'});
  }));

test('REST: POST / on existing → 409 (ConditionalCheckFailed)', t =>
  run(t, async base => {
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'Hoth', climate: 'duplicate'})
    });
    t.equal(res.status, 409);
  }));

test('REST: PUT /:key replaces (with force)', t =>
  run(t, async base => {
    const res = await fetch(`${base}/Tatooine?force=yes`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({climate: 'overridden', terrain: 'sand'})
    });
    t.equal(res.status, 204);
    const after = await (await fetch(`${base}/Tatooine`)).json();
    t.equal(after.climate, 'overridden');
    // restore
    const original = planets.find(p => p.name === 'Tatooine');
    await fetch(`${base}/Tatooine?force=yes`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(original)
    });
  }));

test('REST: PUT /:key without force, missing item → 409', t =>
  run(t, async base => {
    const res = await fetch(`${base}/NotThere`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({climate: 'whatever'})
    });
    t.equal(res.status, 409);
  }));

test('REST: PATCH /:key with _delete', t =>
  run(t, async base => {
    const res = await fetch(`${base}/Hoth`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({gravity: 'patched', _delete: ['surface_water']})
    });
    t.equal(res.status, 204);
    const after = await (await fetch(`${base}/Hoth`)).json();
    t.equal(after.gravity, 'patched');
    t.equal(after.surface_water, undefined);
    // restore
    const original = planets.find(p => p.name === 'Hoth');
    await fetch(`${base}/Hoth?force=yes`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(original)
    });
  }));

test('REST: DELETE /:key returns 204', t =>
  run(t, async base => {
    // Add then delete
    await fetch(`${base}/`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'Throwaway', climate: 'x'})
    });
    const res = await fetch(`${base}/Throwaway`, {method: 'DELETE'});
    t.equal(res.status, 204);
    const get = await fetch(`${base}/Throwaway`);
    t.equal(get.status, 404);
  }));

test('REST: DELETE /:key idempotent (missing item → 204)', t =>
  run(t, async base => {
    const res = await fetch(`${base}/NeverExisted`, {method: 'DELETE'});
    t.equal(res.status, 204);
  }));

// --- /-by-names mass writes ---

test('REST: DELETE /-by-names removes specified', t =>
  run(t, async base => {
    // Seed three throwaway items
    await fetch(`${base}/`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'tx1'})});
    await fetch(`${base}/`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'tx2'})});
    const res = await fetch(`${base}/-by-names?names=tx1,tx2`, {method: 'DELETE'});
    t.equal(res.status, 200);
    const body = await res.json();
    t.equal(body.processed, 2);
  }));

test('REST: PUT /-clone-by-names clones with body overlay', t =>
  run(t, async base => {
    // Seed source planet
    await fetch(`${base}/`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'Original', climate: 'foo'})});
    // Body needs both: the names list AND the overlay. The handler resolves names from query first.
    const res = await fetch(`${base}/-clone-by-names?names=Original`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'OriginalCopy'})
    });
    t.equal(res.status, 200);
    const body = await res.json();
    t.equal(body.processed, 1);
    const copy = await (await fetch(`${base}/OriginalCopy`)).json();
    t.equal(copy.climate, 'foo');
    // cleanup
    await fetch(`${base}/Original`, {method: 'DELETE'});
    await fetch(`${base}/OriginalCopy`, {method: 'DELETE'});
  }));

// --- error mapping ---

test('REST: error envelope on validation failure', t =>
  run(t, async base => {
    // Oversized item triggers validation? Hard to force without a real schema; instead
    // send an attempt to PATCH an item with an empty body — that produces an
    // UpdateExpression parse error (ValidationException) in DynamoDB Local.
    const res = await fetch(`${base}/Hoth`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({})
    });
    t.equal(res.status, 422, 'mapped to validation status');
    const body = await res.json();
    t.ok(body.code, 'error envelope has code');
    t.ok(body.message, 'error envelope has message');
  }));

test('REST: 405 on unsupported method', t =>
  run(t, async base => {
    const res = await fetch(`${base}/`, {method: 'PATCH'});
    t.equal(res.status, 405);
  }));
