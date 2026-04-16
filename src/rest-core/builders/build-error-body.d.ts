export interface BuildErrorBodyOptions {
  errorId?: string;
  includeDebug?: boolean;
}

export interface ErrorBody {
  code: string;
  message: string;
  errorId?: string;
  stack?: string;
}

export function buildErrorBody(err: unknown, options?: BuildErrorBodyOptions): ErrorBody;
