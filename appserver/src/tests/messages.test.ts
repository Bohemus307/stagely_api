// src/tests/messaging-tap-logs.test.ts
import http from "http";
import tap from "tap";
import { inject } from "light-my-request";
import { colors, logTest } from "./properties.test";

// Create a dispatch function that handles messaging routes
const dispatch = function (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  // Mock JWT user - we'll use this to simulate the authenticated user
  const mockJwtUser = { userId: 1, sub: "auth0|user1", role: "user" };
  (req as any).user = mockJwtUser;

  // Get the path and method
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method;

  // Mock data for conversations and messages
  const mockConversation = {
    conversationId: "conv_123456789",
    participants: [1, 2, 3],
    propertyId: 42,
    propertyAddress: "123 Main St, Anytown, CA",
    conversationType: "property_related",
    createdAt: Date.now(),
    lastMessageText: "When will the plumber arrive?",
    lastMessageTime: Date.now(),
    lastMessageSenderId: 1,
    unreadCount: {
      "1": 0,
      "2": 2,
      "3": 1
    }
  };

  const mockMessage = {
    messageId: "msg_123456789",
    conversationId: "conv_123456789",
    senderId: 1,
    text: "When will the plumber arrive?",
    timestamp: Date.now(),
    status: {
      "2": "READ",
      "3": "DELIVERED"
    }
  };

  const mockUser = {
    id: 1,
    auth0Id: "auth0|user1",
    email: "user1@example.com",
    firstName: "Test",
    lastName: "User",
    profilePictureUrl: "https://example.com/profile.jpg"
  };

  // Handle routes
  if (method === "GET" && path === "/messaging/conversations") {
    // GET /messaging/conversations - list all conversations for the user
    const response = {
      conversations: [mockConversation],
      lastKey: null
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }
  else if (method === "POST" && path === "/messaging/conversations") {
    // POST /messaging/conversations - create a new conversation
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Check if participants array contains valid user IDs
        if (!Array.isArray(data.participants) || data.participants.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Participants array is required"
            })
          );
          return;
        }

        const newConversation = {
          ...mockConversation,
          conversationId: `conv_${Date.now()}`,
          participants: data.participants,
          propertyId: data.propertyId,
          conversationType: data.type || "general",
          lastMessageText: data.initialMessage || "",
          lastMessageTime: data.initialMessage ? Date.now() : null,
          createdAt: Date.now()
        };

        let message = null;
        if (data.initialMessage) {
          message = {
            ...mockMessage,
            messageId: `msg_${Date.now()}`,
            conversationId: newConversation.conversationId,
            text: data.initialMessage,
            timestamp: Date.now()
          };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            conversation: newConversation,
            message
          })
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Invalid JSON"
          })
        );
      }
    });
  }
  else if (method === "GET" && path.match(/^\/messaging\/conversations\/conv_\w+$/)) {
    // GET /messaging/conversations/:conversationId - get a conversation by ID
    const conversationId = path.split("/")[3];

    if (conversationId === "conv_nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Conversation not found"
        })
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        conversation: {
          ...mockConversation,
          conversationId
        }
      })
    );
  }
  else if (method === "GET" && path.match(/^\/messaging\/conversations\/conv_\w+\/messages$/)) {
    // GET /messaging/conversations/:conversationId/messages - get messages for a conversation
    const conversationId = path.split("/")[3];

    if (conversationId === "conv_nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Conversation not found"
        })
      );
      return;
    }

    const messages = [
      {
        ...mockMessage,
        messageId: "msg_1",
        conversationId,
        text: "Hello, is anyone available?",
        timestamp: Date.now() - 3600000, // 1 hour ago
        senderInfo: {
          firstName: "Test",
          lastName: "User",
          profilePictureUrl: "https://example.com/profile.jpg"
        }
      },
      {
        ...mockMessage,
        messageId: "msg_2",
        conversationId,
        senderId: 2,
        text: "Yes, how can I help you?",
        timestamp: Date.now() - 3500000, // 58 minutes ago
        senderInfo: {
          firstName: "Support",
          lastName: "Agent",
          profilePictureUrl: "https://example.com/agent.jpg"
        }
      },
      {
        ...mockMessage,
        messageId: "msg_3",
        conversationId,
        text: "When will the plumber arrive?",
        timestamp: Date.now() - 3400000, // 56 minutes ago
        senderInfo: {
          firstName: "Test",
          lastName: "User",
          profilePictureUrl: "https://example.com/profile.jpg"
        }
      }
    ];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        messages,
        lastKey: null
      })
    );
  }
  else if (method === "POST" && path.match(/^\/messaging\/conversations\/conv_\w+\/messages$/)) {
    // POST /messaging/conversations/:conversationId/messages - send a message
    const conversationId = path.split("/")[3];

    if (conversationId === "conv_nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Conversation not found"
        })
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

        if (!data.text || typeof data.text !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Message text is required"
            })
          );
          return;
        }

        const newMessage = {
          ...mockMessage,
          messageId: `msg_${Date.now()}`,
          conversationId,
          text: data.text,
          timestamp: Date.now(),
          senderInfo: {
            firstName: "Test",
            lastName: "User",
            profilePictureUrl: "https://example.com/profile.jpg"
          }
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            message: newMessage
          })
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Invalid JSON"
          })
        );
      }
    });
  }
  else if (method === "POST" && path.match(/^\/messaging\/conversations\/conv_\w+\/read$/)) {
    // POST /messaging/conversations/:conversationId/read - mark messages as read
    const conversationId = path.split("/")[3];

    if (conversationId === "conv_nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Conversation not found"
        })
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

        if (!Array.isArray(data.messageIds) || data.messageIds.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Message IDs array is required"
            })
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true
          })
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Invalid JSON"
          })
        );
      }
    });
  }
  else if (method === "POST" && path === "/messaging/property-conversation") {
    // POST /messaging/property-conversation - create a property conversation
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        if (!data.propertyId || typeof data.propertyId !== "number") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Property ID is required"
            })
          );
          return;
        }

        const newConversation = {
          ...mockConversation,
          conversationId: `conv_${Date.now()}`,
          propertyId: data.propertyId,
          conversationType: "property_related",
          lastMessageText: data.initialMessage || "",
          lastMessageTime: data.initialMessage ? Date.now() : null,
          createdAt: Date.now()
        };

        let message = null;
        if (data.initialMessage) {
          message = {
            ...mockMessage,
            messageId: `msg_${Date.now()}`,
            conversationId: newConversation.conversationId,
            text: data.initialMessage,
            timestamp: Date.now()
          };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            conversation: newConversation,
            message
          })
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Invalid JSON"
          })
        );
      }
    });
  }
  else if (method === "GET" && path.match(/^\/messaging\/property\/\d+\/conversations$/)) {
    // GET /messaging/property/:propertyId/conversations - get conversations for a property
    const propertyId = parseInt(path.split("/")[3]);

    if (propertyId === 999) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Property not found"
        })
      );
      return;
    }

    const conversations = [
      {
        ...mockConversation,
        conversationId: "conv_property_1",
        propertyId,
        conversationType: "property_related"
      },
      {
        ...mockConversation,
        conversationId: "conv_property_2",
        propertyId,
        conversationType: "incident_related",
        incidentId: 123
      }
    ];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        conversations,
        lastKey: null
      })
    );
  }
  else if (method === "GET" && path === "/messaging/unread-count") {
    // GET /messaging/unread-count - get unread conversation count
    const unreadCount = 5;
    const conversationsWithUnread = [
      {
        conversationId: "conv_123456789",
        unreadCount: 2,
        lastMessageText: "When will the plumber arrive?",
        lastMessageTime: Date.now()
      },
      {
        conversationId: "conv_987654321",
        unreadCount: 3,
        lastMessageText: "I'll be there tomorrow at 10 AM",
        lastMessageTime: Date.now() - 3600000
      }
    ];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        unreadCount,
        conversationsWithUnread
      })
    );
  }
  else if (method === "POST" && path === "/messaging/initialize") {
    // POST /messaging/initialize - initialize a user for messaging
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        user: {
          userId: mockUser.id,
          email: mockUser.email,
          firstName: mockUser.firstName,
          lastName: mockUser.lastName,
          profilePictureUrl: mockUser.profilePictureUrl,
          lastSeen: Date.now(),
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now()
        }
      })
    );
  }
  else {
    // Route not found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error: "Route not found"
      })
    );
  }
};

// TAP test with descriptive logging
tap.test("Messaging Routes", async (t) => {
  // Test GET /messaging/conversations
  await t.test("GET /messaging/conversations", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations",
    });

    // Log the test results in a descriptive way
    logTest("GET /messaging/conversations", response, {
      "Has conversations array": Array.isArray(
        JSON.parse(response.payload).conversations
      ),
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.ok(Array.isArray(result.conversations), "conversations should be an array");
    t.equal(result.conversations.length, 1, "Should return 1 conversation");
  });

  // Test POST /messaging/conversations
  await t.test("POST /messaging/conversations", async (t) => {
    const payload = {
      participants: [1, 2],
      type: "general",
      initialMessage: "Hello, this is a test message"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("POST /messaging/conversations", response, {
      "Success": result.success,
      "Has conversation": !!result.conversation,
      "Has message": !!result.message
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.ok(result.conversation, "Response should include conversation");
    t.ok(result.message, "Response should include message");
    t.equal(result.conversation.conversationType, "general", "Conversation type should be correct");
    t.equal(result.message.text, "Hello, this is a test message", "Message text should be correct");
  });

  // Test GET /messaging/conversations/:conversationId
  await t.test("GET /messaging/conversations/:conversationId", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/conv_123456789",
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("GET /messaging/conversations/conv_123456789", response, {
      "Success": result.success,
      "Conversation ID": result.conversation.conversationId
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.conversation.conversationId, "conv_123456789", "Should return correct conversation");
  });

  // Test conversation not found
  await t.test("GET /messaging/conversations/:conversationId (not found)", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/conv_nonexistent",
    });

    // Log the test results
    logTest("GET /messaging/conversations/conv_nonexistent", response, {
      "Error": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Conversation not found", "Should return correct error message");
  });

  // Test GET /messaging/conversations/:conversationId/messages
  await t.test("GET /messaging/conversations/:conversationId/messages", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/conv_123456789/messages",
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("GET /messaging/conversations/conv_123456789/messages", response, {
      "Messages count": result.messages.length,
      "First message": result.messages[0].text
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(Array.isArray(result.messages), "messages should be an array");
    t.equal(result.messages.length, 3, "Should return 3 messages");
    t.ok(result.messages[0].senderInfo, "Messages should include sender info");
  });

  // Test POST /messaging/conversations/:conversationId/messages
  await t.test("POST /messaging/conversations/:conversationId/messages", async (t) => {
    const payload = {
      text: "This is a test reply"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_123456789/messages",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("POST /messaging/conversations/conv_123456789/messages", response, {
      "Success": result.success,
      "Message text": result.message.text
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.message.text, "This is a test reply", "Message text should be correct");
  });

  // Test POST /messaging/conversations/:conversationId/read
  await t.test("POST /messaging/conversations/:conversationId/read", async (t) => {
    const payload = {
      messageIds: ["msg_1", "msg_2"]
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_123456789/read",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("POST /messaging/conversations/conv_123456789/read", response, {
      "Success": result.success
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
  });

  // Test POST /messaging/property-conversation
  await t.test("POST /messaging/property-conversation", async (t) => {
    const payload = {
      propertyId: 42,
      initialMessage: "Is there any issue with the plumbing?"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/property-conversation",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("POST /messaging/property-conversation", response, {
      "Success": result.success,
      "Property ID": result.conversation.propertyId,
      "Has message": !!result.message
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.equal(result.conversation.propertyId, 42, "Property ID should be correct");
    t.equal(result.conversation.conversationType, "property_related", "Conversation type should be correct");
    t.ok(result.message, "Response should include message");
  });

  // Test GET /messaging/property/:propertyId/conversations
  await t.test("GET /messaging/property/:propertyId/conversations", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/property/42/conversations",
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("GET /messaging/property/42/conversations", response, {
      "Conversations count": result.conversations.length,
      "Conversation types": result.conversations.map((c: any) => c.conversationType).join(", ")
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(Array.isArray(result.conversations), "conversations should be an array");
    t.equal(result.conversations.length, 2, "Should return 2 conversations");
    t.equal(result.conversations[0].propertyId, 42, "Property ID should be correct");
  });

  // Test GET /messaging/unread-count
  await t.test("GET /messaging/unread-count", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/unread-count",
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("GET /messaging/unread-count", response, {
      "Unread count": result.unreadCount,
      "Conversations with unread": result.conversationsWithUnread.length
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(typeof result.unreadCount, "number", "unreadCount should be a number");
    t.ok(Array.isArray(result.conversationsWithUnread), "conversationsWithUnread should be an array");
  });

  // Test POST /messaging/initialize
  await t.test("POST /messaging/initialize", async (t) => {
    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/initialize",
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest("POST /messaging/initialize", response, {
      "Success": result.success,
      "User ID": result.user.userId,
      "User email": result.user.email
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.ok(result.user, "Response should include user information");
    t.equal(result.user.userId, 1, "User ID should be correct");
  });

  // Test invalid route
  await t.test("Invalid route", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/invalid-route",
    });

    // Log the test results
    logTest("GET /messaging/invalid-route", response, {
      "Error": JSON.parse(response.payload).error
    });

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Route not found", "Should return route not found error");
  });
});
