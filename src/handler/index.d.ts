/**
 * HTTP handler — `(req, res) =>` wiring the REST core to `node:http`. JSDoc
 * lives on each re-exported symbol.
 */

export {createHandler, type HandlerOptions, type RequestHandler} from './handler.js';
export {matchRoute, type MatchedRoute} from './match-route.js';
export {readJsonBody, type ReadJsonBodyOptions} from './read-json-body.js';
