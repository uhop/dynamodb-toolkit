// Normalize field specifications to a string array, applying projectionFieldMap if provided.
// Returns null when no fields are requested (caller interprets as "project everything"),
// including for strings that degenerate to zero segments after trimming (e.g. ',,,').

export const normalizeFields = (fields, projectionFieldMap, separator = '.') => {
  if (!fields) return null;
  if (!Array.isArray(fields)) {
    if (typeof fields === 'string') {
      fields = fields
        .split(',')
        .map(f => f.trim())
        .filter(f => f);
    } else if (typeof fields === 'object') {
      fields = Object.keys(fields);
    } else {
      return null;
    }
  }
  if (!fields.length) return null;
  if (!projectionFieldMap) return fields;
  return fields.map(name => {
    const parts = name.split(separator),
      replacement = projectionFieldMap[parts[0]];
    if (typeof replacement === 'string') {
      parts[0] = replacement;
      return parts.join(separator);
    }
    return name;
  });
};
