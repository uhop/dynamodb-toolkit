/**
 * Symmetric marshalling pair. `marshall` converts the in-memory
 * runtime representation (`TRuntime`) to the stored DynamoDB shape
 * (`TStored`); `unmarshall` inverts.
 *
 * Packaging both directions in a single object nudges callers to keep
 * the write path and read path in sync — if you change the write
 * encoding, you're forced to update the read decoder in the same
 * commit.
 */
export interface Marshaller<TRuntime, TStored> {
  marshall: (value: TRuntime) => TStored;
  unmarshall: (stored: TStored) => TRuntime;
}

export {marshallDateISO, unmarshallDateISO, marshallDateEpoch, unmarshallDateEpoch, dateISO, dateEpoch} from './date.js';
export {marshallMap, unmarshallMap} from './map.js';
export {marshallURL, unmarshallURL, url} from './url.js';
