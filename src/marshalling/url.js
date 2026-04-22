// URL ↔ string. DynamoDB stores URLs as strings; in-memory they're
// `URL` instances for typed field access and validation. These
// helpers are round-trip clean: `unmarshall(marshall(u)).href === u.href`.
//
// `undefined` / `null` pass through unchanged.

export const marshallURL = url => {
  if (url === undefined || url === null) return url;
  if (!(url instanceof URL)) throw new TypeError('marshallURL: expected URL');
  return url.href;
};

export const unmarshallURL = s => {
  if (s === undefined || s === null) return s;
  return new URL(s);
};

export const url = {marshall: marshallURL, unmarshall: unmarshallURL};
