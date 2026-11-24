export type ErrorCode = 'usage' | 'not_found' | 'conflict' | 'invalid' | 'version' | 'unavailable' | 'unauthorized' | 'forbidden' | 'too_large'

export class KbError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'KbError'
  }
}

export const EXIT: Record<ErrorCode, number> = {
  usage: 1,
  not_found: 2,
  conflict: 3,
  invalid: 4,
  version: 5,
  unavailable: 6,
  unauthorized: 7,
  forbidden: 8,
  too_large: 9,
}
