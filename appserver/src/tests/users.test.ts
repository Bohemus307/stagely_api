// src/tests/users-tap-logs.test.ts
import http from "http";
import tap from "tap";
import { inject } from "light-my-request";
import { logTest } from "./properties.test";

// Mock JWT user - we'll use this to simulate different user roles and IDs
let mockJwtUser = { userId: 1 };

// Create a simple dispatch function that handles user routes
const dispatch = function (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  // Add user to request (simulating authenticated user)
  (req as any).user = mockJwtUser;

  // Get the path and method
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method;

  // Parse query parameters
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  // Mock user data
  const mockUsers = [
    {
      id: 1,
      auth0Id: "auth0|123456",
      email: "admin@example.com",
      firstName: "Admin",
      lastName: "User",
      phone: "+1234567890",
      profilePictureUrl: "https://example.com/admin.jpg",
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _count: { properties: 2 },
    },
    {
      id: 2,
      auth0Id: "auth0|234567",
      email: "user@example.com",
      firstName: "Regular",
      lastName: "User",
      phone: "+0987654321",
      profilePictureUrl: null,
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _count: { properties: 1 },
    },
  ];

  // Mock user with properties
  const mockUserWithProperties = {
    ...mockUsers[0],
    properties: [
      {
        id: 1,
        address: "123 Admin St",
        city: "Admin City",
        status: "Active",
        _count: { incidents: 2 },
      },
      {
        id: 2,
        address: "456 Admin Ave",
        city: "Admin City",
        status: "Active",
        _count: { incidents: 0 },
      },
    ],
  };

  // Mock user stats
  const mockUserStats = {
    totalProperties: 2,
    activeProperties: 2,
    totalIncidents: 3,
    openIncidents: 1,
    recentActivity: [
      {
        type: "property_created",
        timestamp: new Date().toISOString(),
        details: {
          id: 2,
          address: "456 Admin Ave",
          city: "Admin City",
          country: "Test Country",
        },
      },
      {
        type: "incident_reported",
        timestamp: new Date().toISOString(),
        details: {
          id: 1,
          incidentType: "Maintenance",
          severity: "Medium",
          status: "Open",
          property: {
            id: 1,
            address: "123 Admin St",
          },
        },
      },
    ],
  };

  // Handle routes
  if (method === "GET" && path === "/users") {
    // Parse pagination, filters, etc.
    const page = parseInt(queryParams.page || "1");
    const limit = parseInt(queryParams.limit || "10");

    // Apply search filter if present
    let filteredUsers = [...mockUsers];
    if (queryParams.search) {
      const search = queryParams.search.toLowerCase();
      filteredUsers = filteredUsers.filter(
        (user) =>
          user.email.toLowerCase().includes(search) ||
          user.firstName.toLowerCase().includes(search) ||
          user.lastName.toLowerCase().includes(search),
      );
    }

    const response = {
      data: filteredUsers,
      meta: {
        page: page,
        limit: limit,
        total: filteredUsers.length,
        totalPages: Math.ceil(filteredUsers.length / limit),
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } else if (method === "GET" && path.match(/^\/users\/\d+$/)) {
    // GET /users/:id - get user by ID
    const id = parseInt(path.split("/")[2]);

    // Check if user exists
    const user = mockUsers.find((u) => u.id === id);
    if (!user) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            statusCode: 404,
            message: "User not found",
          },
        }),
      );
      return;
    }

    // Check if allowed to access (admin or own profile)
    if (mockJwtUser.userId !== id) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            statusCode: 403,
            message: "Access denied",
          },
        }),
      );
      return;
    }

    // Return user with properties
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ...user,
        properties: id === 1 ? mockUserWithProperties.properties : [],
      }),
    );
  } else if (method === "GET" && path === "/users/me") {
    // GET /users/me - get current user profile
    const user = mockUsers.find((u) => u.id === mockJwtUser.userId);

    if (!user) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            statusCode: 404,
            message: "User not found",
          },
        }),
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ...user,
        properties: mockUserWithProperties.properties,
      }),
    );
  } else if (method === "POST" && path === "/users") {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Check for existing email
        if (data.email && mockUsers.some((u) => u.email === data.email)) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                statusCode: 409,
                message: "Email already in use",
              },
            }),
          );
          return;
        }

        // Create new user
        const newUser = {
          ...data,
          id: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastLogin: null,
          properties: [],
        };

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(newUser));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              statusCode: 400,
              message: "Invalid JSON",
            },
          }),
        );
      }
    });
  } else if (method === "PUT" && path.match(/^\/users\/\d+$/)) {
    // PUT /users/:id - update user
    const id = parseInt(path.split("/")[2]);

    // Check if user exists
    const userIndex = mockUsers.findIndex((u) => u.id === id);
    if (userIndex === -1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            statusCode: 404,
            message: "User not found",
          },
        }),
      );
      return;
    }

    // Check if allowed to update (admin or own profile)
    if (mockJwtUser.userId !== id) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            statusCode: 403,
            message: "Access denied",
          },
        }),
      );
      return;
    }

    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Check for existing email
        if (
          data.email &&
          data.email !== mockUsers[userIndex].email &&
          mockUsers.some((u) => u.email === data.email)
        ) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                statusCode: 409,
                message: "Email already in use",
              },
            }),
          );
          return;
        }

        // Update user
        const updatedUser = {
          ...mockUsers[userIndex],
          ...data,
          updatedAt: new Date().toISOString(),
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(updatedUser));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              statusCode: 400,
              message: "Invalid JSON",
            },
          }),
        );
      }
    });
  } else if (method === "DELETE" && path.match(/^\/users\/\d+$/)) {
    const id = parseInt(path.split("/")[2]);

    // Check if user exists
    const userExists = mockUsers.some((u) => u.id === id);
    if (!userExists) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            statusCode: 404,
            message: "User not found",
          },
        }),
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, id }));
  } else if (method === "GET" && path === "/users/search") {
    // GET /users/search - search users
    if (!queryParams.query) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            statusCode: 400,
            message: "Search query is required",
          },
        }),
      );
      return;
    }

    const query = queryParams.query.toLowerCase();
    const limit = parseInt(queryParams.limit || "5");

    const results = mockUsers
      .filter(
        (user) =>
          user.email.toLowerCase().includes(query) ||
          user.firstName.toLowerCase().includes(query) ||
          user.lastName.toLowerCase().includes(query),
      )
      .slice(0, limit)
      .map((user) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profilePictureUrl: user.profilePictureUrl,
      }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(results));
  } else if (method === "GET" && path === "/users/stats") {
    // GET /users/stats - get user statistics
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(mockUserStats));
  } else {
    // Route not found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          statusCode: 404,
          message: "Route not found",
        },
      }),
    );
  }
};

// TAP test with descriptive logging
tap.test("User Routes", async (t) => {
  // Test GET /users as admin
  await t.test("GET /users (as admin)", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "GET",
      url: "/users",
    });

    // Log the test results
    logTest("GET /users", response, {
      "User count": JSON.parse(response.payload).data.length,
      "Has pagination": !!JSON.parse(response.payload).meta,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.ok(Array.isArray(result.data), "data should be an array");
    t.ok(result.meta, "response should include pagination metadata");
  });

  // Test GET /users with search
  await t.test("GET /users with search", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "GET",
      url: "/users?search=admin",
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("GET /users with search for 'admin'", response, {
      "Results found": result.data.length,
      "First result": result.data.length > 0 ? result.data[0].email : "None",
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(result.data.length > 0, "Should return at least one result");
    if (result.data.length > 0) {
      t.ok(
        result.data[0].email.includes("admin") ||
          result.data[0].firstName.includes("Admin") ||
          result.data[0].lastName.includes("Admin"),
        "Results should match search term",
      );
    }
  });

  // Test GET /users/:id (own profile)
  await t.test("GET /users/:id (own profile)", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/1",
    });

    // Log the test results
    const user = JSON.parse(response.payload);
    logTest("GET /users/1 (own profile)", response, {
      "User email": user.email,
      "Has properties":
        Array.isArray(user.properties) && user.properties.length > 0,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(user.id, 1, "Should return user with ID 1");
    t.ok(Array.isArray(user.properties), "Should include properties array");
  });

  // Test GET /users/me
  await t.test("GET /users/me", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/me",
    });

    // Log the test results
    const user = JSON.parse(response.payload);
    logTest("GET /users/me", response, {
      "User ID": user.id,
      "User email": user.email,
      "Properties count": user.properties.length,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(user.id, 1, "Should return current user profile");
    t.ok(Array.isArray(user.properties), "Should include properties array");
  });

  // Test POST /users
  await t.test("POST /users", async (t) => {
    mockJwtUser = { userId: 1 };

    const payload = {
      auth0Id: "auth0|345678",
      email: "newuser@example.com",
      firstName: "New",
      lastName: "User",
      phone: "+1122334455",
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/users",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const newUser = JSON.parse(response.payload);
    logTest("POST /users", response, {
      "New user email": newUser.email,
      "New user ID": newUser.id,
    });

    // TAP assertions
    t.equal(response.statusCode, 201, "Status code should be 201 (Created)");
    t.equal(newUser.email, "newuser@example.com", "Should save correct email");
    t.equal(newUser.firstName, "New", "Should save correct first name");
  });

  // Test POST /users (duplicate email)
  await t.test("POST /users with duplicate email", async (t) => {
    mockJwtUser = { userId: 1 };

    const payload = {
      auth0Id: "auth0|unique123",
      email: "admin@example.com", // Already exists
      firstName: "Duplicate",
      lastName: "User",
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/users",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    logTest("POST /users with duplicate email", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error?.message,
    });

    // TAP assertions
    t.equal(response.statusCode, 409, "Status code should be 409 (Conflict)");
    const error = JSON.parse(response.payload).error;
    t.equal(
      error.message,
      "Email already in use",
      "Should return email already in use error",
    );
  });

  // Test PUT /users/:id (own profile)
  await t.test("PUT /users/:id (own profile)", async (t) => {
    mockJwtUser = { userId: 2 };

    const payload = {
      firstName: "Updated",
      lastName: "User",
      phone: "+0099887766",
    };

    const response = await inject(dispatch, {
      method: "PUT",
      url: "/users/2",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const updatedUser = JSON.parse(response.payload);
    logTest("PUT /users/2 (own profile)", response, {
      "Updated first name": updatedUser.firstName,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(updatedUser.firstName, "Updated", "Should update first name");
    t.equal(updatedUser.phone, "+0099887766", "Should update phone");
  });

  // Test DELETE /users/:id
  await t.test("DELETE /users/:id", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "DELETE",
      url: "/users/2",
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("DELETE /users/2", response, {
      Success: result.success,
      "Deleted user ID": result.id,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.id, 2, "Should return deleted user ID");
  });

  // Test DELETE /users/:id (user not found)
  await t.test("DELETE /users/:id (not found)", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "DELETE",
      url: "/users/999",
    });

    // Log the test results
    logTest("DELETE /users/999 (not found)", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error?.message,
    });

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404 (Not Found)");
    const error = JSON.parse(response.payload).error;
    t.equal(
      error.message,
      "User not found",
      "Should return user not found error",
    );
  });

  // Test GET /users/search
  await t.test("GET /users/search", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/search?query=admin",
    });

    // Log the test results
    const results = JSON.parse(response.payload);
    logTest("GET /users/search?query=admin", response, {
      "Results count": results.length,
      "First result email": results.length > 0 ? results[0].email : "None",
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(Array.isArray(results), "Should return an array of results");
    if (results.length > 0) {
      t.ok(
        results[0].email.includes("admin") ||
          results[0].firstName.includes("Admin") ||
          results[0].lastName.includes("Admin"),
        "Results should match search term",
      );
    }
  });

  // Test GET /users/stats
  await t.test("GET /users/stats", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/stats",
    });

    // Log the test results
    const stats = JSON.parse(response.payload);
    logTest("GET /users/stats", response, {
      "Total properties": stats.totalProperties,
      "Active properties": stats.activeProperties,
      "Open incidents": stats.openIncidents,
      "Recent activity count": stats.recentActivity.length,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(
      typeof stats.totalProperties === "number",
      "Should include totalProperties stat",
    );
    t.ok(
      typeof stats.activeProperties === "number",
      "Should include activeProperties stat",
    );
    t.ok(
      typeof stats.totalIncidents === "number",
      "Should include totalIncidents stat",
    );
    t.ok(
      typeof stats.openIncidents === "number",
      "Should include openIncidents stat",
    );
    t.ok(
      Array.isArray(stats.recentActivity),
      "Should include recentActivity array",
    );
    t.ok(stats.recentActivity.length > 0, "RecentActivity should not be empty");
    if (stats.recentActivity.length > 0) {
      const activity = stats.recentActivity[0];
      t.ok(activity.type, "Activity should have a type");
      t.ok(activity.timestamp, "Activity should have a timestamp");
      t.ok(activity.details, "Activity should have details");
    }
  });

  // Test route not found
  await t.test("Route not found", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/nonexistent-route",
    });

    // Log the test results
    logTest("GET /users/nonexistent-route", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error?.message,
    });

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404 (Not Found)");
    const error = JSON.parse(response.payload).error;
    t.equal(
      error.message,
      "Route not found",
      "Should return route not found error",
    );
  });

  // Test invalid JSON
  await t.test("Invalid JSON payload", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/users",
      headers: {
        "content-type": "application/json",
      },
      payload: "{invalid-json",
    });

    // Log the test results
    logTest("POST /users with invalid JSON", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error?.message,
    });

    // TAP assertions
    t.equal(
      response.statusCode,
      400,
      "Status code should be 400 (Bad Request)",
    );
    const error = JSON.parse(response.payload).error;
    t.equal(error.message, "Invalid JSON", "Should return invalid JSON error");
  });

  // Test search with no query parameter
  await t.test("Search with no query parameter", async (t) => {
    mockJwtUser = { userId: 1 };

    const response = await inject(dispatch, {
      method: "GET",
      url: "/users/search",
    });

    // Log the test results
    logTest("GET /users/search (no query)", response, {
      "Expected to fail": true,
      "Error message": JSON.parse(response.payload).error?.message,
    });

    // TAP assertions
    t.equal(
      response.statusCode,
      400,
      "Status code should be 400 (Bad Request)",
    );
    const error = JSON.parse(response.payload).error;
    t.ok(
      error.message.includes("query"),
      "Should mention query parameter in error",
    );
  });
});
