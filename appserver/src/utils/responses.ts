import { FastifyReply } from "fastify";

export function sendNotFound(
  reply: FastifyReply,
  message: string = "Resource not found",
) {
  return reply.code(404).send({
    error: {
      statusCode: 404,
      message,
    },
  });
}

export function sendForbidden(
  reply: FastifyReply,
  message: string = "Access forbidden",
) {
  return reply.code(403).send({
    error: {
      statusCode: 403,
      message,
    },
  });
}

export function sendUnauthorized(
  reply: FastifyReply,
  message: string = "Authentication required",
) {
  return reply.code(401).send({
    error: {
      statusCode: 401,
      message,
    },
  });
}

export function sendConflict(
  reply: FastifyReply,
  message: string = "Resource conflict",
) {
  return reply.code(409).send({
    error: {
      statusCode: 409,
      message,
    },
  });
}
