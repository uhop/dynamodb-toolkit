// Marshalling helpers — thin transforms between in-memory JS types and
// DynamoDB attribute shapes. Callers compose them in their `prepare` /
// `revive` hooks on the Adapter; the toolkit never applies them
// automatically. Pair rule: if you marshall a field one way on write,
// unmarshall it the same way on read. Wire the pair at declaration
// time so symmetry can't drift — see the `Marshaller` pairs like
// `dateISO`, `dateEpoch`, `url`.

export {marshallDateISO, unmarshallDateISO, marshallDateEpoch, unmarshallDateEpoch, dateISO, dateEpoch} from './date.js';
export {marshallMap, unmarshallMap} from './map.js';
export {marshallURL, unmarshallURL, url} from './url.js';
