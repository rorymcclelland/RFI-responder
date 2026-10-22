/** An error whose message is safe to show the caller, with the HTTP status to use. No imports, so tests can load it. */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}
