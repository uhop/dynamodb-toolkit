// Date marshalling — two canonical encodings. Callers pick ONE per field
// and stick with it for the field's lifetime. No generic `marshallDate`:
// silently choosing ISO vs epoch behind a single name is how
// format-migration bugs happen.
//
// All four helpers pass `undefined` and `null` through unchanged so they
// compose cleanly with optional fields (e.g., `dueDate?: Date`).

export const marshallDateISO = date => {
  if (date === undefined || date === null) return date;
  if (!(date instanceof Date)) throw new TypeError('marshallDateISO: expected Date');
  return date.toISOString();
};

export const unmarshallDateISO = s => {
  if (s === undefined || s === null) return s;
  return new Date(s);
};

export const marshallDateEpoch = date => {
  if (date === undefined || date === null) return date;
  if (!(date instanceof Date)) throw new TypeError('marshallDateEpoch: expected Date');
  return date.getTime();
};

export const unmarshallDateEpoch = ms => {
  if (ms === undefined || ms === null) return ms;
  return new Date(ms);
};

// Marshaller pairs — handy for declarative wiring in prepare/revive hooks.
export const dateISO = {marshall: marshallDateISO, unmarshall: unmarshallDateISO};
export const dateEpoch = {marshall: marshallDateEpoch, unmarshall: unmarshallDateEpoch};
