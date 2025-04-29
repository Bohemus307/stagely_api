// src/tests/messaging-tap-logs.test.ts
import http from "http";
import tap from "tap";
import { inject } from "light-my-request";
import { logTest } from "./properties.test";


// Create a simple dispatch function that handles messaging routes
const dispatch = function (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  // Get the path and method
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method;

  // Mock user data - in a real test, this would come from authentication
  const mockUser = {
    id: 1,
    auth0Id: "auth0|123456",
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    role: "user",
  };

  // Mock conversation data
  const mockConversation = {
    conversationId: "conv_123456789",
    participants: [1, 2],
    type: "general",
    createdAt: Date.now(),
    lastMessageText: "Hello, this is a test message",
    lastMessageTime: Date.now(),
    lastMessageSenderId: 1,
    unreadCount: {
      "1": 0,
      "2": 1,
    },
  };

  const mockConversations = [
    mockConversation,
    {
      conversationId: "conv_987654321",
      participants: [1, 3],
      type: "general",
      createdAt: Date.now() - 86400000, // 1 day ago
      lastMessageText: "This is an older conversation",
      lastMessageTime: Date.now() - 86400000,
      lastMessageSenderId: 3,
      unreadCount: {
        "1": 2,
        "3": 0,
      },
    },
  ];

  // Mock message data
  const mockMessages = [
    {
      messageId: "msg_123456789",
      conversationId: "conv_123456789",
      senderId: 1,
      text: "Hello, this is a test message",
      timestamp: Date.now(),
      status: {
        "1": "READ",
        "2": "SENT",
      },
      senderInfo: {
        firstName: "Test",
        lastName: "User",
      },
    },
    {
      messageId: "msg_987654321",
      conversationId: "conv_123456789",
      senderId: 2,
      text: "Hello back to you!",
      timestamp: Date.now() - 3600000, // 1 hour ago
      status: {
        "1": "READ",
        "2": "READ",
      },
      senderInfo: {
        firstName: "Other",
        lastName: "User",
      },
    },
  ];

  // Simulate authentication middleware
  // In a real test, you would check authentication headers
  // and set authenticated user information
  req.authenticatedUser = mockUser;

  // Handle routes
  if (method === "GET" && path === "/messaging/conversations") {
    // GET /messaging/conversations - list all conversations
    const response = {
      conversations: mockConversations,
      lastKey: null,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } else if (method === "POST" && path === "/messaging/conversations") {
    // POST /messaging/conversations - create a new conversation
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Create a new conversation with the provided data
        const newConversation = {
          conversationId: `conv_${Date.now()}`,
          participants: data.participants || [],
          type: data.type || "general",
          createdAt: Date.now(),
          lastMessageText: data.initialMessage || null,
          lastMessageTime: data.initialMessage ? Date.now() : null,
          lastMessageSenderId: data.initialMessage ? mockUser.id : null,
          unreadCount: {},
        };

        // Initialize unread counts
        newConversation.participants.forEach(participantId => {
          newConversation.unreadCount[participantId] = participantId === mockUser.id ? 0 : data.initialMessage ? 1 : 0;
        });

        // Create initial message if provided
        let message = null;
        if (data.initialMessage) {
          message = {
            messageId: `msg_${Date.now()}`,
            conversationId: newConversation.conversationId,
            senderId: mockUser.id,
            text: data.initialMessage,
            timestamp: Date.now(),
            status: {},
            senderInfo: {
              firstName: mockUser.firstName,
              lastName: mockUser.lastName,
            },
          };

          // Set initial message status
          newConversation.participants.forEach(participantId => {
            message.status[participantId] = participantId === mockUser.id ? "READ" : "SENT";
          });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          conversation: newConversation,
          message: message,
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Bad Request",
            message: "Invalid JSON"
          }),
        );
      }
    });
  } else if (method === "GET" && path.match(/^\/messaging\/conversations\/[^\/]+$/)) {
    // GET /messaging/conversations/:conversationId - get conversation by ID
    const conversationId = path.split("/")[3];

    // Find the conversation
    const conversation = mockConversations.find(c => c.conversationId === conversationId);

    if (!conversation) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Not Found",
          message: "Conversation not found"
        }),
      );
      return;
    }

    // Check if user is a participant
    if (!conversation.participants.includes(mockUser.id)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden",
          message: "You don't have permission to access this conversation"
        }),
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      conversation,
    }));
  } else if (method === "GET" && path.match(/^\/messaging\/conversations\/[^\/]+\/messages$/)) {
    // GET /messaging/conversations/:conversationId/messages - get messages for a conversation
    const conversationId = path.split("/")[3];

    // Find the conversation
    const conversation = mockConversations.find(c => c.conversationId === conversationId);

    if (!conversation) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Not Found",
          message: "Conversation not found"
        }),
      );
      return;
    }

    // Check if user is a participant
    if (!conversation.participants.includes(mockUser.id)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden",
          message: "You don't have permission to access this conversation"
        }),
      );
      return;
    }

    // Get messages for this conversation
    const messages = mockMessages.filter(m => m.conversationId === conversationId);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      messages,
      lastKey: null,
    }));
  } else if (method === "POST" && path.match(/^\/messaging\/conversations\/[^\/]+\/messages$/)) {
    // POST /messaging/conversations/:conversationId/messages - send a message
    const conversationId = path.split("/")[3];

    // Find the conversation
    const conversation = mockConversations.find(c => c.conversationId === conversationId);

    if (!conversation) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Not Found",
          message: "Conversation not found"
        }),
      );
      return;
    }

    // Check if user is a participant
    if (!conversation.participants.includes(mockUser.id)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden",
          message: "You don't have permission to access this conversation"
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

        // Create new message
        const newMessage = {
          messageId: `msg_${Date.now()}`,
          conversationId,
          senderId: mockUser.id,
          text: data.text,
          timestamp: Date.now(),
          status: {},
          senderInfo: {
            firstName: mockUser.firstName,
            lastName: mockUser.lastName,
          },
        };

        // Set initial message status
        conversation.participants.forEach(participantId => {
          newMessage.status[participantId] = participantId === mockUser.id ? "READ" : "SENT";
        });

        // Update conversation
        conversation.lastMessageText = data.text;
        conversation.lastMessageTime = Date.now();
        conversation.lastMessageSenderId = mockUser.id;

        // Update unread counts
        conversation.participants.forEach(participantId => {
          if (participantId !== mockUser.id) {
            conversation.unreadCount[participantId] = (conversation.unreadCount[participantId] || 0) + 1;
          }
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          message: newMessage,
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Bad Request",
            message: "Invalid JSON"
          }),
        );
      }
    });
  } else if (method === "POST" && path.match(/^\/messaging\/conversations\/[^\/]+\/read$/)) {
    // POST /messaging/conversations/:conversationId/read - mark messages as read
    const conversationId = path.split("/")[3];

    // Find the conversation
    const conversation = mockConversations.find(c => c.conversationId === conversationId);

    if (!conversation) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Not Found",
          message: "Conversation not found"
        }),
      );
      return;
    }

    // Check if user is a participant
    if (!conversation.participants.includes(mockUser.id)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden",
          message: "You don't have permission to access this conversation"
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

        // Mark messages as read
        const messageIds = data.messageIds || [];

        // Reset unread count for this user
        conversation.unreadCount[mockUser.id] = 0;

        // Update message status
        mockMessages.forEach(message => {
          if (messageIds.includes(message.messageId)) {
            message.status[mockUser.id] = "READ";
          }
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Bad Request",
            message: "Invalid JSON"
          }),
        );
      }
    });
  } else if (method === "POST" && path.match(/^\/messaging\/conversations\/[^\/]+\/participants$/)) {
    // POST /messaging/conversations/:conversationId/participants - add participant
    const conversationId = path.split("/")[3];

    // Find the conversation
    const conversation = mockConversations.find(c => c.conversationId === conversationId);

    if (!conversation) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Not Found",
          message: "Conversation not found"
        }),
      );
      return;
    }

    // Check if user is a participant
    if (!conversation.participants.includes(mockUser.id)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden",
          message: "You don't have permission to modify this conversation"
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
        const participantId = data.participantId;

        // Add participant if not already in the conversation
        if (!conversation.participants.includes(participantId)) {
          conversation.participants.push(participantId);
          conversation.unreadCount[participantId] = 0;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          conversation,
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Bad Request",
            message: "Invalid JSON"
          }),
        );
      }
    });
  } else if (method === "DELETE" && path.match(/^\/messaging\/conversations\/[^\/]+\/participants\/\d+$/)) {
    // DELETE /messaging/conversations/:conversationId/participants/:participantId - remove participant
    const conversationId = path.split("/")[3];
    const participantId = parseInt(path.split("/")[5]);

    // Find the conversation
    const conversation = mockConversations.find(c => c.conversationId === conversationId);

    if (!conversation) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Not Found",
          message: "Conversation not found"
        }),
      );
      return;
    }

    // Check if user can remove the participant
    // (Either removing themselves or is a participant)
    const isRemovingSelf = mockUser.id === participantId;
    if (!conversation.participants.includes(mockUser.id) && !isRemovingSelf) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden",
          message: "You don't have permission to modify this conversation"
        }),
      );
      return;
    }

    // Remove the participant
    conversation.participants = conversation.participants.filter(id => id !== participantId);

    // Remove unread count for this participant
    delete conversation.unreadCount[participantId];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      conversation,
    }));
  } else if (method === "GET" && path === "/messaging/unread-count") {
    // GET /messaging/unread-count - get unread count

    // Count unread messages for current user
    let totalUnread = 0;
    const conversationsWithUnread = [];

    mockConversations.forEach(conversation => {
      const unreadCount = conversation.unreadCount[mockUser.id] || 0;
      if (unreadCount > 0) {
        totalUnread += unreadCount;
        conversationsWithUnread.push({
          conversationId: conversation.conversationId,
          unreadCount,
          lastMessageText: conversation.lastMessageText,
          lastMessageTime: conversation.lastMessageTime,
        });
      }
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      unreadCount: totalUnread,
      conversationsWithUnread,
    }));
  } else {
    // Route not found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: false,
      error: "Not Found",
      message: "Route not found"
    }));
  }
};

// Add authenticatedUser property to Request
declare global {
  namespace http {
    interface IncomingMessage {
      authenticatedUser?: {
        id: number;
        auth0Id: string;
        email: string;
        firstName: string;
        lastName: string;
        role: string;
      };
    }
  }
}

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
        JSON.parse(response.payload).conversations,
      ),
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.ok(Array.isArray(result.conversations), "conversations should be an array");
    t.ok(result.conversations.length > 0, "Should return at least one conversation");
  });

  // Test POST /messaging/conversations
  await t.test("POST /messaging/conversations", async (t) => {
    const payload = {
      participants: [2, 3],
      type: "general",
      initialMessage: "Hello, this is a test conversation.",
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
      "Conversation ID": result.conversation?.conversationId,
      "Has message": !!result.message,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.ok(result.conversation, "Response should include conversation object");
    t.ok(result.message, "Response should include message object");
    t.equal(result.message.text, payload.initialMessage, "Message text should match initial message");

    // Store conversation ID for later tests
    const conversationId = result.conversation.conversationId;
    t.context.conversationId = conversationId;
  });

  // Test GET /messaging/conversations/:conversationId
  await t.test("GET /messaging/conversations/:conversationId", async (t) => {
    // Use the conversation from previous test, or fall back to a known conversation ID
    const conversationId = t.context.conversationId || "conv_123456789";

    const response = await inject(dispatch, {
      method: "GET",
      url: `/messaging/conversations/${conversationId}`,
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest(`GET /messaging/conversations/${conversationId}`, response, {
      "Success": result.success,
      "Participants count": result.conversation?.participants?.length || 0,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.ok(result.conversation, "Response should include conversation object");
    t.equal(result.conversation.conversationId, conversationId, "Conversation ID should match");
  });

  // Test GET /messaging/conversations/:conversationId/messages
  await t.test("GET /messaging/conversations/:conversationId/messages", async (t) => {
    // Use conversation ID from context or default
    const conversationId = t.context.conversationId || "conv_123456789";

    const response = await inject(dispatch, {
      method: "GET",
      url: `/messaging/conversations/${conversationId}/messages`,
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest(`GET /messaging/conversations/${conversationId}/messages`, response, {
      "Messages count": result.messages?.length || 0,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.ok(Array.isArray(result.messages), "Response should include messages array");

    // Store a message ID for later tests if available
    if (result.messages && result.messages.length > 0) {
      t.context.messageId = result.messages[0].messageId;
    }
  });

  // Test POST /messaging/conversations/:conversationId/messages
  await t.test("POST /messaging/conversations/:conversationId/messages", async (t) => {
    // Use conversation ID from context or default
    const conversationId = t.context.conversationId || "conv_123456789";

    const payload = {
      text: "This is a test message sent at " + new Date().toISOString(),
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: `/messaging/conversations/${conversationId}/messages`,
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest(`POST /messaging/conversations/${conversationId}/messages`, response, {
      "Success": result.success,
      "Message text": result.message?.text,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.ok(result.message, "Response should include message object");
    t.equal(result.message.text, payload.text, "Message text should match sent text");

    // Store message ID for later tests
    t.context.messageId = result.message.messageId;
  });

  // Test POST /messaging/conversations/:conversationId/read
  await t.test("POST /messaging/conversations/:conversationId/read", async (t) => {
    // Use conversation ID and message ID from context or defaults
    const conversationId = t.context.conversationId || "conv_123456789";
    const messageId = t.context.messageId || "msg_123456789";

    const payload = {
      messageIds: [messageId],
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: `/messaging/conversations/${conversationId}/read`,
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest(`POST /messaging/conversations/${conversationId}/read`, response, {
      "Success": result.success,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
  });

  // Test POST /messaging/conversations/:conversationId/participants
  await t.test("POST /messaging/conversations/:conversationId/participants", async (t) => {
    // Use conversation ID from context or default
    const conversationId = t.context.conversationId || "conv_123456789";

    const payload = {
      participantId: 4, // Add a new participant
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: `/messaging/conversations/${conversationId}/participants`,
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest(`POST /messaging/conversations/${conversationId}/participants`, response, {
      "Success": result.success,
      "Participants count": result.conversation?.participants?.length || 0,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.ok(result.conversation, "Response should include conversation object");
    t.ok(result.conversation.participants.includes(payload.participantId), "New participant should be in the participants list");
  });

  // Test DELETE /messaging/conversations/:conversationId/participants/:participantId
  await t.test("DELETE /messaging/conversations/:conversationId/participants/:participantId", async (t) => {
    // Use conversation ID from context or default
    const conversationId = t.context.conversationId || "conv_123456789";
    const participantIdToRemove = 4; // Remove the participant we just added

    const response = await inject(dispatch, {
      method: "DELETE",
      url: `/messaging/conversations/${conversationId}/participants/${participantIdToRemove}`,
    });

    // Log the test results
    const result = JSON.parse(response.payload);
    logTest(`DELETE /messaging/conversations/${conversationId}/participants/${participantIdToRemove}`, response, {
      "Success": result.success,
      "Participants count": result.conversation?.participants?.length || 0,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.equal(result.success, true, "Response should indicate success");
    t.ok(result.conversation, "Response should include conversation object");
    t.notOk(result.conversation.participants.includes(participantIdToRemove), "Removed participant should not be in the participants list");
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
      "Conversations with unread": result.conversationsWithUnread?.length || 0,
    });

    // TAP assertions
    t.equal(response.statusCode, 200, "Status code should be 200");
    t.type(result.unreadCount, "number", "Response should include unread count as a number");
    t.ok(Array.isArray(result.conversationsWithUnread), "Response should include conversations with unread array");
  });

  // Test error case: Conversation not found
  await t.test("GET /messaging/conversations/nonexistent", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/nonexistent",
    });

    // Log the test results
    logTest("GET /messaging/conversations/nonexistent (not found)", response);

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Not Found", "Response should include correct error");
  });

  // Test error case: Route not found
  await t.test("GET /messaging/nonexistent", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/nonexistent",
    });

    // Log the test results
    logTest("GET /messaging/nonexistent (route not found)", response);

    // TAP assertions
    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Response should indicate failure");
    t.equal(result.error, "Not Found", "Response should include correct error");
  });
});
