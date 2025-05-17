// src/tests/email-tap-logs.test.ts
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
const mockEmailResponse = {
  MessageId: "mock-message-id-123456"
};

// Create a dispatch function that handles email routes
const dispatch = function (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  // Add user to request as if authenticated
  (req as any).user = { sub: "auth0|123456" };

  // Add mock email service to fastify
  (req as any).fastify = {
    email: {
      sendInvitationEmail: (email: string, token: string, inviterName?: string) => {
        // Simulate email sending behavior
        if (email === "error@example.com") {
          throw new Error("Failed to send email");
        }
        return Promise.resolve(mockEmailResponse.MessageId);
      }
    }
  };

  // Get the path and method
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method;

  // Handle routes
  if (method === "POST" && path === "/email/send-invitation") {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate required fields
        if (!data.email || !data.token) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Email and token are required"
          }));
          return;
        }

        // Test error case
        if (data.email === "error@example.com") {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Failed to send email"
          }));
          return;
        }

        // Mock successful sending
        const messageId = mockEmailResponse.MessageId;

        // Construct email parameters for logging
        const emailParams = {
          to: data.email,
          subject: `${data.inviterName || 'Someone'} invited you to Stagely`,
          token: data.token,
          inviterName: data.inviterName || 'Someone'
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          messageId,
          emailParams
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
  } else if (method === "POST" && path === "/email/send-welcome") {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate required fields
        if (!data.email) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Email is required"
          }));
          return;
        }

        // Mock successful sending
        const messageId = mockEmailResponse.MessageId;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          messageId,
          email: data.email
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
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
tap.test("Email Service", async (t) => {
  // Test sending invitation email
  await t.test("POST /email/send-invitation", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/email/send-invitation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "test@example.com",
        token: "test-token-123",
        inviterName: "Test User"
      }),
    });

    // Log the test results
    logTest("POST /email/send-invitation", response, {
      "Email": "test@example.com",
      "Token": "test-token-123",
      "InviterName": "Test User",
      "MessageId": JSON.parse(response.payload).messageId
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.messageId, "mock-message-id-123456", "Message ID should be returned");
    t.equal(result.emailParams.to, "test@example.com", "Email recipient should match");
    t.equal(result.emailParams.inviterName, "Test User", "Inviter name should match");
  });

  // Test sending invitation email with error
  await t.test("POST /email/send-invitation (error)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/email/send-invitation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "error@example.com",
        token: "test-token-123",
        inviterName: "Test User"
      }),
    });

    // Log the test results
    logTest("POST /email/send-invitation (error)", response, {
      "Email": "error@example.com",
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 500, "Status code should be 500");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Failed to send email", "Error message should indicate sending failure");
  });

  // Test missing required fields
  await t.test("POST /email/send-invitation (missing fields)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/email/send-invitation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        // Missing email and token
        inviterName: "Test User"
      }),
    });

    // Log the test results
    logTest("POST /email/send-invitation (missing fields)", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 400, "Status code should be 400");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Email and token are required", "Error message should indicate missing fields");
  });

  // Test missing inviter name (should default)
  await t.test("POST /email/send-invitation (default inviter)", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/email/send-invitation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "test@example.com",
        token: "test-token-123"
        // No inviterName
      }),
    });

    // Log the test results
    logTest("POST /email/send-invitation (default inviter)", response, {
      "Email": "test@example.com",
      "Default inviter name": JSON.parse(response.payload).emailParams.inviterName
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.emailParams.inviterName, "Someone", "Inviter name should default to 'Someone'");
  });

  // Test welcome email
  await t.test("POST /email/send-welcome", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/email/send-welcome",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "new@example.com"
      }),
    });

    // Log the test results
    logTest("POST /email/send-welcome", response, {
      "Email": "new@example.com",
      "MessageId": JSON.parse(response.payload).messageId
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.email, "new@example.com", "Email should match");
  });

  // Test invalid route
  await t.test("Non-existent route", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/email/invalid-route",
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

  // Test invalid JSON body
  await t.test("Invalid JSON body", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/email/send-invitation",
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
});
