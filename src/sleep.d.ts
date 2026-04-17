/**
 * Promise-based delay — resolves after the given number of milliseconds.
 *
 * @param ms How long to wait, in milliseconds.
 * @returns A promise that resolves (to `undefined`) once the timer has fired.
 */
export function sleep(ms: number): Promise<void>;
