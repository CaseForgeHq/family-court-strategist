export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function publicError(error) {
  return error instanceof AppError ? error.message : "The operation could not finish. Your existing case files have been preserved.";
}
