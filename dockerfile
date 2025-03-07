# Start with a Node.js 20 Alpine image for smaller size
FROM node:20-alpine AS build

# Set working directory
WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies including dev dependencies for TypeScript compilation
RUN pnpm install --frozen-lockfile

# Copy application code
COPY . .

# Build TypeScript to JavaScript
RUN pnpm run build

# Create production image
FROM node:20-alpine

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Install pnpm globally in production image
RUN npm install -g pnpm

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S fastify -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy only production dependencies
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod

# Copy compiled JavaScript from build stage
COPY --from=build --chown=fastify:nodejs /app/dist ./dist

# Expose the application port
EXPOSE 3000

# Switch to non-root user
USER fastify

# Set healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application with the compiled JavaScript
CMD ["node", "dist/index.js"]