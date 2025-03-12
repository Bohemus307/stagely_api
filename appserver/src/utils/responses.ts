import { FastifyReply } from "fastify";

/**
 * Helper export functions for sending standardized error responses
 */
export function sendNotFound(
  reply: FastifyReply,
  message: string = "Resource not found",
) {
  return reply.code(404).send({ error: "Not Found", message });
}

export function sendForbidden(
  reply: FastifyReply,
  message: string = "Access forbidden",
) {
  return reply.code(403).send({ error: "Forbidden", message });
}

export function sendUnauthorized(
  reply: FastifyReply,
  message: string = "Authentication required",
) {
  return reply.code(401).send({ error: "Unauthorized", message });
}

export function sendConflict(
  reply: FastifyReply,
  message: string = "Resource conflict",
) {
  return reply.code(409).send({ error: "Conflict", message });
}
