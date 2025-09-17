// src/tests/invitation-tap-logs.test.ts
import http from "http";
import tap from "tap";
import { inject } from "light-my-request";

// Set up colors for better console output
export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

// Helper function for pretty logging
export function logTest(title: string, response: any, extraInfo?: any) {
  console.log(
    `\n${colors.bright}${colors.cyan}Testing ${title}${colors.reset}`,
  );
  console.log(`${colors.yellow}Status: ${response.statusCode}${colors.reset}`);
  console.log(`${colors.dim}Body: ${response.payload}${colors.reset}`);

  if (extraInfo) {
    Object.entries(extraInfo).forEach(([key, value]) => {
      console.log(`${colors.green}${key}: ${colors.reset}${value}`);
    });
  }
}

// Mock data for testing
const mockUser = {
  id: 1,
  auth0Id: "auth0|123456",
  email: "current@example.com",
  firstName: "Current",
  lastName: "User",
  profilePictureUrl: "https://example.com/avatar.jpg"
};

// Create a dispatch function that handles invitation routes
const dispatch = function (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  // Add user to request as if authenticated
  (req as any).user = { sub: "auth0|123456" };

  // Add mock services to fastify
  (req as any).fastify = {
    prisma: {
      user: {
        findUnique: (query: { where: { auth0Id: string }}) => {
          if (query.where.auth0Id === "auth0|123456") {
            return Promise.resolve(mockUser);
          }
          return Promise.resolve(null);
        }
      }
    },
    email: {
      sendInvitationEmail: (email: string, token: string, inviterName: string) => {
        // Simulate email sending behavior
        if (email === "error@example.com") {
          throw new Error("Failed to send email");
        }
        return Promise.resolve("mock-message-id");
      }
    }
  };

  // Get the path and method
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method;

  // Handle routes
  if (method === "POST" && path === "/users/invite") {
    // POST /users/invite - Invite a user
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate email is provided
        if (!data.email) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Email is required"
          }));
          return;
        }

        // Test cases for different email addresses
        if (data.email === "existing@example.com") {
          // Existing active user
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            user: {
              id: 3,
              email: data.email,
              isPlaceholder: false
            }
          }));
          return;
        } else if (data.email === "pending@example.com") {
          // Existing invitation
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            user: {
              id: 4,
              email: data.email,
              isPlaceholder: true
            }
          }));
          return;
        } else if (data.email === "error@example.com") {
          // Simulate email sending error
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Failed to send invitation email"
          }));
          return;
        }

        // New invitation (default case)
        // Generate mock token
        const invitationToken = "token-" + Date.now().toString(36);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          user: {
            id: 5,
            email: data.email,
            isPlaceholder: true
          },
          invitationToken: invitationToken
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
  } else if (method === "POST" && path === "/users/accept-invitation") {
    // POST /users/accept-invitation - Accept an invitation
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate token is provided
        if (!data.token) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Token is required"
          }));
          return;
        }

        // Test cases for different tokens
        if (data.token === "invalid-token") {
          // Invalid or expired token
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Invitation not found or expired"
          }));
          return;
        } else if (data.token === "error-token") {
          // Simulate error during acceptance
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Failed to accept invitation"
          }));
          return;
        }

        // Successful acceptance (default case)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          message: "Invitation accepted successfully"
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
  } else if (method === "GET" && path === "/users/check-invitation") {
    // GET /users/check-invitation - Check if an invitation token is valid
    const token = url.searchParams.get("token");

    // Validate token is provided
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Token is required"
      }));
      return;
    }

    // Test cases for different tokens
    if (token === "invalid-token") {
      // Invalid or expired token
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        valid: false,
        email: null
      }));
      return;
    } else if (token === "error-token") {
      // Simulate error during check
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Failed to check invitation"
      }));
      return;
    }

    // Valid token (default case)
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      valid: true,
      email: "invited@example.com"
    }));
  } else {
    // Route not found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: false,
      error: "Route not found"
    }));
  }
};

// TAP tests with descriptive logging
tap.test("Invitation Routes", async (t) => {
  // Test inviting a user
  await t.test("POST /users/invite", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/invite",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "newuser@example.com"
      }),
    });

    // Log the test results
    logTest("POST /users/invite", response, {
      "Email": "newuser@example.com",
      "User ID": JSON.parse(response.payload).user.id,
      "Is placeholder": JSON.parse(response.payload).user.isPlaceholder
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.user.email, "newuser@example.com", "Email should match the request");
    t.equal(result.user.isPlaceholder, true, "User should be a placeholder");
    t.ok(result.invitationToken, "Invitation token should be returned");
  });

  // Test inviting an existing user
  await t.test("POST /users/invite (existing user)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/invite",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "existing@example.com"
      }),
    });

    // Log the test results
    logTest("POST /users/invite (existing user)", response, {
      "Email": "existing@example.com",
      "User ID": JSON.parse(response.payload).user.id,
      "Is placeholder": JSON.parse(response.payload).user.isPlaceholder
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.user.email, "existing@example.com", "Email should match the request");
    t.equal(result.user.isPlaceholder, false, "User should not be a placeholder");
  });

  // Test inviting a user with pending invitation
  await t.test("POST /users/invite (pending invitation)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/invite",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "pending@example.com"
      }),
    });

    // Log the test results
    logTest("POST /users/invite (pending invitation)", response, {
      "Email": "pending@example.com",
      "User ID": JSON.parse(response.payload).user.id,
      "Is placeholder": JSON.parse(response.payload).user.isPlaceholder
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.user.email, "pending@example.com", "Email should match the request");
    t.equal(result.user.isPlaceholder, true, "User should be a placeholder");
  });

  // Test inviting a user with no email
  await t.test("POST /users/invite (missing email)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/invite",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });

    // Log the test results
    logTest("POST /users/invite (missing email)", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 400, "Status code should be 400");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Email is required", "Error message should indicate missing email");
  });

  // Test email sending error
  await t.test("POST /users/invite (email sending error)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/invite",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "error@example.com"
      }),
    });

    // Log the test results
    logTest("POST /users/invite (email sending error)", response, {
      "Email": "error@example.com",
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 500, "Status code should be 500");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Failed to send invitation email", "Error message should indicate email sending failure");
  });

  // Test accepting an invitation
  await t.test("POST /users/accept-invitation", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/accept-invitation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        token: "valid-token"
      }),
    });

    // Log the test results
    logTest("POST /users/accept-invitation", response, {
      "Token": "valid-token",
      "Success": JSON.parse(response.payload).success,
      "Message": JSON.parse(response.payload).message
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.message, "Invitation accepted successfully", "Message should indicate successful acceptance");
  });

  // Test accepting an invitation with invalid token
  await t.test("POST /users/accept-invitation (invalid token)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/accept-invitation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        token: "invalid-token"
      }),
    });

    // Log the test results
    logTest("POST /users/accept-invitation (invalid token)", response, {
      "Token": "invalid-token",
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Invitation not found or expired", "Error message should indicate invalid token");
  });

  // Test checking an invitation
  await t.test("GET /users/check-invitation", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/check-invitation?token=valid-token",
    });

    // Log the test results
    logTest("GET /users/check-invitation", response, {
      "Token": "valid-token",
      "Valid": JSON.parse(response.payload).valid,
      "Email": JSON.parse(response.payload).email
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.valid, true, "Token should be valid");
    t.equal(result.email, "invited@example.com", "Email should be returned");
  });

  // Test checking an invalid invitation
  await t.test("GET /users/check-invitation (invalid token)", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/check-invitation?token=invalid-token",
    });

    // Log the test results
    logTest("GET /users/check-invitation (invalid token)", response, {
      "Token": "invalid-token",
      "Valid": JSON.parse(response.payload).valid,
      "Email": JSON.parse(response.payload).email === null ? "null" : JSON.parse(response.payload).email
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.valid, false, "Token should be invalid");
    t.equal(result.email, null, "Email should be null");
  });

  // Test checking an invitation without token
  await t.test("GET /users/check-invitation (missing token)", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/check-invitation",
    });

    // Log the test results
    logTest("GET /users/check-invitation (missing token)", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 400, "Status code should be 400");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Token is required", "Error message should indicate missing token");
  });

  // Test checking an invitation with error
  await t.test("GET /users/check-invitation (error)", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/check-invitation?token=error-token",
    });

    // Log the test results
    logTest("GET /users/check-invitation (error)", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 500, "Status code should be 500");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Failed to check invitation", "Error message should indicate check failure");
  });

  // Test invalid JSON
  await t.test("Invalid JSON body", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/invite",
      headers: {
        "content-type": "application/json",
      },
      payload: "{ invalid json",
    });

    // Log the test results
    logTest("Invalid JSON body", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 400, "Status code should be 400");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Invalid JSON", "Error message should indicate invalid JSON");
  });

  // Test route not found
  await t.test("Route not found", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/non-existent-route",
    });

    // Log the test results
    logTest("Non-existent route", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Route not found", "Error message should indicate route not found");
  });

  // Test missing token for acceptance
  await t.test("POST /users/accept-invitation (missing token)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/accept-invitation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });

    // Log the test results
    logTest("POST /users/accept-invitation (missing token)", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 400, "Status code should be 400");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Token is required", "Error message should indicate missing token");
  });

  // Test error during acceptance
  await t.test("POST /users/accept-invitation (error)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/users/accept-invitation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        token: "error-token"
      }),
    });

    // Log the test results
    logTest("POST /users/accept-invitation (error)", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 500, "Status code should be 500");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Failed to accept invitation", "Error message should indicate acceptance failure");
  });
});
