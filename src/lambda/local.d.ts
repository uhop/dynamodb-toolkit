import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Context} from 'aws-lambda';

import type {LambdaEvent, LambdaResult} from './index.js';

/** Options for {@link createNodeListener} and {@link createFetchBridge}. */
export interface LocalDriverOptions {
  /**
   * Which API Gateway event shape to synthesize from the incoming HTTP request.
   *
   * - `'v2'` (default) — API Gateway HTTP v2 / Function URL. Modern shape,
   *   simpler envelope; matches most new deployments.
   * - `'v1'` — API Gateway REST v1. Use when your production handler relies on
   *   v1-specific fields (`event.path`, `event.httpMethod`, multi-value query).
   *
   * @default 'v2'
   */
  eventShape?: 'v1' | 'v2';
  /**
   * Fixed Lambda `Context` to pass to every invocation. Takes precedence over
   * {@link makeContext}. Useful for tests that want a predictable `awsRequestId`
   * or `invokedFunctionArn`.
   */
  context?: Context;
  /**
   * Factory for the Lambda `Context` per invocation. Called for each request
   * when {@link context} isn't set. Defaults to a minimal `local-*` context.
   */
  makeContext?: () => Context;
}

/** A Lambda handler of the shape {@link createLambdaAdapter} returns. */
export type Handler = (event: LambdaEvent, context: Context) => Promise<LambdaResult>;

/**
 * Build a Node HTTP request listener that drives a Lambda handler.
 *
 * Reads the incoming {@link IncomingMessage} (method, URL, headers, body),
 * synthesizes a full API Gateway event, invokes the handler, and writes the
 * resulting Lambda envelope back through the {@link ServerResponse}. Binary
 * request bodies are base64-encoded (matching AWS's `binary media types`
 * behavior) so the Lambda handler sees the same bytes it would see in prod.
 *
 * Typical usage:
 *
 * ```js
 * import http from 'node:http';
 * import {createLambdaAdapter} from 'dynamodb-toolkit/lambda';
 * import {createNodeListener} from 'dynamodb-toolkit/lambda/local.js';
 *
 * const handler = createLambdaAdapter(adapter, {mountPath: '/planets'});
 * http.createServer(createNodeListener(handler)).listen(3000);
 * ```
 *
 * @param handler The Lambda handler built by {@link createLambdaAdapter} (or
 *   any other `(event, context) => Promise<result>` you want to exercise).
 * @param options Event shape + optional Context factory.
 * @returns A `(req, res) => Promise<void>` suitable for
 *   `http.createServer(listener)` or any Node HTTP framework that accepts a
 *   raw request listener.
 */
export function createNodeListener(handler: Handler, options?: LocalDriverOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Build a Fetch-style bridge that drives a Lambda handler via `Request`/
 * `Response`. Use this with Bun.serve, Deno.serve, Cloudflare Workers, Hono,
 * or any router that accepts a `(request) => Promise<Response>` handler.
 *
 * ```js
 * import {createLambdaAdapter} from 'dynamodb-toolkit/lambda';
 * import {createFetchBridge} from 'dynamodb-toolkit/lambda/local.js';
 *
 * const handler = createLambdaAdapter(adapter);
 * Bun.serve({port: 3000, fetch: createFetchBridge(handler)});
 * ```
 *
 * @param handler The Lambda handler to drive.
 * @param options Event shape + optional Context factory.
 * @returns A `(request) => Promise<Response>` Fetch handler.
 */
export function createFetchBridge(handler: Handler, options?: LocalDriverOptions): (request: Request) => Promise<Response>;
