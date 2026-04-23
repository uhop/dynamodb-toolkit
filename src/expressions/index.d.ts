/**
 * Expression builders — pure functions that assemble DynamoDB expression
 * strings with attribute aliasing, placeholders, and deduplication. All
 * accept an optional `params` to extend. JSDoc lives on each re-exported symbol.
 */

export {buildUpdate, type UpdateOptions, type ArrayOp} from './update.js';
export {addProjection} from './projection.js';
export {buildSearch, buildFilterByExample, type SearchOptions} from './search.js';
export {buildCondition, type ConditionClause} from './condition.js';
export {buildKeyCondition, type KeyConditionInput} from './key-condition.js';
export {cleanParams} from './clean-params.js';
export {cloneParams} from './clone-params.js';
