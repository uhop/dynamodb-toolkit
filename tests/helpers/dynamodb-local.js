// DynamoDB Local lifecycle helper.
// Spawns the amazon/dynamodb-local Docker container on a random port.
// Skips gracefully when Docker is unavailable.

import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const DYNAMODB_LOCAL_IMAGE = 'amazon/dynamodb-local:latest';
const STARTUP_TIMEOUT_MS = 15_000;
const HEALTH_POLL_MS = 300;

async function isDockerAvailable() {
  try {
    await execFileAsync('docker', ['info'], {timeout: 5000});
    return true;
  } catch {
    return false;
  }
}

async function waitForReady(port, timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': 'DynamoDB_20120810.ListTables'},
        body: '{}'
      });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, HEALTH_POLL_MS));
  }
  throw new Error(`DynamoDB Local did not become ready within ${timeoutMs}ms`);
}

export async function startDynamoDBLocal() {
  if (!(await isDockerAvailable())) {
    return {skip: true, reason: 'Docker is not available — skipping DynamoDB Local tests'};
  }

  // Find a free port by binding to 0
  const {createServer} = await import('node:http');
  const port = await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const {port} = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });

  const containerName = `dynamodb-local-test-${port}`;

  const proc = spawn(
    'docker',
    ['run', '--rm', '--name', containerName, '-p', `${port}:8000`, DYNAMODB_LOCAL_IMAGE, '-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb'],
    {stdio: 'ignore'}
  );

  proc.on('error', () => {});

  try {
    await waitForReady(port);
  } catch (err) {
    proc.kill();
    throw err;
  }

  return {
    skip: false,
    port,
    endpoint: `http://127.0.0.1:${port}`,
    async stop() {
      try {
        await execFileAsync('docker', ['stop', containerName], {timeout: 10_000});
      } catch {
        proc.kill();
      }
    }
  };
}
