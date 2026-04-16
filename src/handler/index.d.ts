// HTTP handler — node:http request handler wiring rest-core to (req, res) =>.

export {createHandler, type HandlerOptions, type RequestHandler} from './handler.js';
export {matchRoute, type MatchedRoute} from './match-route.js';
