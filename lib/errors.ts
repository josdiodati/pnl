// Thrown whenever a request targets a company the user does not belong to,
// lacks the required role for, or references data outside the active company.
// Route handlers map it to HTTP 403; server actions map it to a visible error.
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'No tenés acceso a esta empresa o tu rol no alcanza para esta acción.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// Domain rule violation (illegal state transition, percentages not summing 100,
// closed period, etc.). Surfaced to the user as a form error.
export class DomainError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isForbidden(err: unknown): err is ForbiddenError {
  return err instanceof Error && err.name === 'ForbiddenError';
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof Error && err.name === 'DomainError';
}
