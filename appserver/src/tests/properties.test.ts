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

  // Mock property data - NOW WITH imageUrl field
  const mockProperty = {
    id: 1,
    address: "123 Test St",
    city: "Test City",
    country: "Test Country",
    status: "AVAILABLE",
    imageUrl: "https://example.com/property-1.jpg", // Add imageUrl field
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
  } else if (method === "PUT" && path.match(/^\/properties\/\d+$/)) {
    // PUT /properties/:id - update property (NEW!)
    const id = parseInt(path.split("/")[2]);
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const updateData = JSON.parse(body);

        if (id === 999) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Not Found", message: "Property not found" }),
          );
          return;
        }

        // Simulate updating the property
        const updatedProperty = {
          ...mockProperty,
          ...updateData,
          id,
          updatedAt: new Date().toISOString(),
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(updatedProperty));
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
tap.test("Property Routes with ImageUrl Support", async (t) => {
  // Test GET /properties
  await t.test("GET /properties", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/properties",
    });

    // Log the test results in a descriptive way
    const result = JSON.parse(response.payload);
    logTest("GET /properties", response, {
      "Has property data array": Array.isArray(result.data),
      "First property has imageUrl": !!result.data[0]?.imageUrl,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(Array.isArray(result.data), "data should be an array");
    t.equal(result.data.length, 1, "Should return 1 property");
    t.ok(result.data[0].imageUrl, "Property should have imageUrl field");
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
      "Has imageUrl": !!property.imageUrl,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(property.id, 1, "Should return property with ID 1");
    t.equal(property.address, "123 Test St", "Should return correct address");
    t.equal(property.imageUrl, "https://example.com/property-1.jpg", "Should return imageUrl");
  });

  // Test POST /properties with imageUrl
  await t.test("POST /properties with imageUrl", async (t) => {
    const payload = {
      address: "456 New St",
      city: "New City",
      country: "New Country",
      status: "AVAILABLE",
      imageUrl: "https://s3.amazonaws.com/new-property.jpg",
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
    logTest("POST /properties with imageUrl", response, {
      "New property address": newProperty.address,
      "Has imageUrl": !!newProperty.imageUrl,
    });

    // TAP assertions
    t.equal(response.statusCode, 201, "Status code should be 201");
    t.equal(newProperty.id, 2, "Should assign ID 2");
    t.equal(newProperty.address, "456 New St", "Should save correct address");
    t.equal(newProperty.imageUrl, "https://s3.amazonaws.com/new-property.jpg", "Should save imageUrl");
  });

  // NEW TEST: PUT /properties/:id to update imageUrl
  await t.test("PUT /properties/1 - update imageUrl", async (t) => {
    const payload = {
      imageUrl: "https://s3.amazonaws.com/updated-property-image.jpg",
    };

    const response = await inject(dispatch, {
      method: "PUT",
      url: "/properties/1",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const updatedProperty = JSON.parse(response.payload);
    logTest("PUT /properties/1 - update imageUrl", response, {
      "Updated imageUrl": updatedProperty.imageUrl,
      "Address unchanged": updatedProperty.address,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(updatedProperty.id, 1, "Should maintain property ID");
    t.equal(updatedProperty.address, "123 Test St", "Should maintain original address");
    t.equal(
      updatedProperty.imageUrl,
      "https://s3.amazonaws.com/updated-property-image.jpg",
      "Should update imageUrl"
    );
  });

  // NEW TEST: PUT /properties/:id to update multiple fields including imageUrl
  await t.test("PUT /properties/1 - update multiple fields with imageUrl", async (t) => {
    const payload = {
      address: "789 Updated St",
      city: "Updated City",
      imageUrl: "https://s3.amazonaws.com/completely-new-image.jpg",
    };

    const response = await inject(dispatch, {
      method: "PUT",
      url: "/properties/1",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const updatedProperty = JSON.parse(response.payload);
    logTest("PUT /properties/1 - update multiple fields", response, {
      "Updated address": updatedProperty.address,
      "Updated city": updatedProperty.city,
      "Updated imageUrl": updatedProperty.imageUrl,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(updatedProperty.id, 1, "Should maintain property ID");
    t.equal(updatedProperty.address, "789 Updated St", "Should update address");
    t.equal(updatedProperty.city, "Updated City", "Should update city");
    t.equal(
      updatedProperty.imageUrl,
      "https://s3.amazonaws.com/completely-new-image.jpg",
      "Should update imageUrl"
    );
  });

  // Test property not found for update
  await t.test("PUT /properties/999 - property not found", async (t) => {
    const payload = {
      imageUrl: "https://s3.amazonaws.com/nonexistent-property.jpg",
    };

    const response = await inject(dispatch, {
      method: "PUT",
      url: "/properties/999",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    logTest("PUT /properties/999 (not found)", response);

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404");
    const error = JSON.parse(response.payload);
    t.equal(error.error, "Not Found", "Should return Not Found error");
  });

  // Test original functionality still works
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

  // Test duplicate address error still works
  await t.test("POST /properties with duplicate address", async (t) => {
    const payload = {
      address: "123 Test St",
      city: "Test City",
      country: "Test Country",
      status: "AVAILABLE",
      imageUrl: "https://s3.amazonaws.com/duplicate-test.jpg",
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

  // Test chain API still works
  await t.test("Chain API - GET /properties", async (t) => {
    const response = await inject(dispatch).get("/properties").end();

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("GET /properties with chaining API", response, {
      "Has data": !!result.data,
      "Has imageUrl in first property": !!result.data[0]?.imageUrl,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(result.data, "Response should have data property");
    t.ok(result.data[0].imageUrl, "First property should have imageUrl");
  });
});
