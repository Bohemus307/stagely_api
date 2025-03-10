// src/utils/errors.ts

/**
 * Base application error class
 */
export class ApplicationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for not found resources
 */
export class NotFoundError extends ApplicationError {
  constructor(message: string = "Resource not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

/**
 * Error for unauthorized access attempts
 */
export class UnauthorizedError extends ApplicationError {
  constructor(message: string = "Unauthorized access") {
    super(message, 403);
    this.name = "UnauthorizedError";
  }
}

/**
 * Error for bad requests or validation failures
 */
export class BadRequestError extends ApplicationError {
  validation?: any[];

  constructor(message: string = "Bad request", validation?: any[]) {
    super(message, 400);
    this.name = "BadRequestError";
    this.validation = validation;
  }
}

/**
 * Error for conflict situations (e.g. duplicate resources)
 */
export class ConflictError extends ApplicationError {
  constructor(message: string = "Resource conflict") {
    super(message, 409);
    this.name = "ConflictError";
  }
}
