import fp from "fastify-plugin";
import imageComparisonRoute from "../routes/imageComparison";

export default fp(async (fastify, opts) => {
  fastify.register(imageComparisonRoute);
});