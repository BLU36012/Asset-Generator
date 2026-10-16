/** Thrown from route handlers; the error middleware turns it into a JSON response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function notFound(message = 'Not found'): HttpError {
  return new HttpError(404, message);
}
