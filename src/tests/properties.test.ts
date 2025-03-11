// src/tests/properties-tap-logs.test.ts
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

// Create a simple dispatch function that handles property routes
const dispatch = function (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  // Get the path and method
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method;

  // Mock property data
  const mockProperty = {
    id: 1,
    address: "123 Test St",
    city: "Test City",
    country: "Test Country",
    status: "AVAILABLE",
    userId: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Handle routes
  if (method === "GET" && path === "/properties") {
    // GET /properties - list all properties
    const response = {
      data: [mockProperty],
      meta: {
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } else if (method === "GET" && path.match(/^\/properties\/\d+$/)) {
    // GET /properties/:id - get property by ID
    const id = parseInt(path.split("/")[2]);

    if (id === 999) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Not Found", message: "Property not found" }),
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(mockProperty));
  } else if (method === "POST" && path === "/properties") {
    // POST /properties - create a new property
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        if (data.address === "123 Test St") {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Conflict",
              message: "A property with this address already exists",
            }),
          );
          return;
        }

        const newProperty = {
          ...data,
          id: 2,
          userId: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(newProperty));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Bad Request", message: "Invalid JSON" }),
        );
      }
    });
  } else {
    // Route not found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found", message: "Route not found" }));
  }
};

// TAP test with descriptive logging
tap.test("Property Routes", async (t) => {
  // Test GET /properties
  await t.test("GET /properties", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/properties",
    });

    // Log the test results in a descriptive way
    logTest("GET /properties", response, {
      "Has property data array": Array.isArray(
        JSON.parse(response.payload).data,
      ),
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.ok(Array.isArray(result.data), "data should be an array");
    t.equal(result.data.length, 1, "Should return 1 property");
  });

  // Test GET /properties/:id
  await t.test("GET /properties/1", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/properties/1",
    });

    // Log the test results
    const property = JSON.parse(response.payload);
    logTest("GET /properties/1", response, {
      "Property ID": property.id,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(property.id, 1, "Should return property with ID 1");
    t.equal(property.address, "123 Test St", "Should return correct address");
  });

  // Test property not found
  await t.test("GET /properties/999", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/properties/999",
    });

    // Log the test results
    logTest("GET /properties/999 (not found)", response);

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404");
    const error = JSON.parse(response.payload);
    t.equal(error.error, "Not Found", "Should return Not Found error");
  });

  // Test POST /properties
  await t.test("POST /properties", async (t) => {
    const payload = {
      address: "456 New St",
      city: "New City",
      country: "New Country",
      status: "AVAILABLE",
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/properties",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const newProperty = JSON.parse(response.payload);
    logTest("POST /properties", response, {
      "New property address": newProperty.address,
    });

    // TAP assertions
    t.equal(response.statusCode, 201, "Status code should be 201");
    t.equal(newProperty.id, 2, "Should assign ID 2");
    t.equal(newProperty.address, "456 New St", "Should save correct address");
  });

  // Test duplicate address error
  await t.test("POST /properties with duplicate address", async (t) => {
    const payload = {
      address: "123 Test St",
      city: "Test City",
      country: "Test Country",
      status: "AVAILABLE",
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/properties",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    logTest("POST /properties with duplicate address", response);

    // TAP assertions
    t.equal(response.statusCode, 409, "Status code should be 409");
    const error = JSON.parse(response.payload);
    t.equal(error.error, "Conflict", "Should return Conflict error");
  });

  // Test chain API
  await t.test("Chain API - GET /properties", async (t) => {
    const response = await inject(dispatch).get("/properties").end();

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("GET /properties with chaining API", response, {
      "Has data": !!result.data,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(result.data, "Response should have data property");
  });

  // Test promise API
  await t.test("Promise API - GET /properties", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/properties",
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("GET /properties with promise API", response, {
      "Data items": result.data.length,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.data.length, 1, "Should return 1 item");
  });
});
