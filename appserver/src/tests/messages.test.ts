// src/tests/messaging-tap-logs.test.ts
import http from "http";
import tap from "tap";
import { inject } from "light-my-request";

type UnreadCount = Record<string, number>;
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

// Mock data for messaging testing
const mockUser = {
  id: 1,
  auth0Id: "auth0|123456",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePictureUrl: "https://example.com/avatar.jpg"
};

const mockConversation = {
  conversationId: "conv_12345",
  participants: [1, 2],
  conversationType: "general",
  createdAt: Date.now(),
  lastMessageText: "Hello, how are you?",
  lastMessageTime: Date.now(),
  lastMessageSenderId: 2,
  unreadCount: { "1": 1, "2": 0 } as UnreadCount,
  participantId: 1 // For GSI
};

const mockMessage = {
  messageId: "msg_12345",
  conversationId: "conv_12345",
  senderId: 2,
  text: "Hello, how are you?",
  timestamp: Date.now(),
  status: { "1": "SENT", "2": "READ" }
};

// Create a mock dispatch function for messaging routes
const dispatch = function(req: http.IncomingMessage, res: http.ServerResponse) {
  // Add mock auth user to request (simulating authentication middleware)
  (req as any).user = { sub: "auth0|123456" };

  // Parse URL and method
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  const method = req.method;

  // Handle different messaging routes
  if (method === "POST" && path === "/messaging/invite") {
    // Invite a user and create conversation
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

        // If testing existing user flow
        if (data.email === "existing@example.com") {
          const newConversation = {
            ...mockConversation,
            conversationId: "conv_" + Date.now(),
            participants: [1, 3], // User ID 3 for existing user
          };

          let newMessage = null;
          if (data.initialMessage) {
            newMessage = {
              ...mockMessage,
              messageId: "msg_" + Date.now(),
              conversationId: newConversation.conversationId,
              senderId: 1,
              text: data.initialMessage,
              timestamp: Date.now()
            };
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            conversation: newConversation,
            message: newMessage,
            user: {
              id: 3,
              email: "existing@example.com",
              isPlaceholder: false
            },
            invitationToken: undefined
          }));
          return;
        }

        // For new user invitation flow
        const invitationToken = "inv_" + Date.now().toString(36);
        const newConversation = {
          ...mockConversation,
          conversationId: "conv_" + Date.now(),
          participants: [1, 4], // User ID 4 for placeholder user
        };

        let newMessage = null;
        if (data.initialMessage) {
          newMessage = {
            ...mockMessage,
            messageId: "msg_" + Date.now(),
            conversationId: newConversation.conversationId,
            senderId: 1,
            text: data.initialMessage,
            timestamp: Date.now()
          };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          conversation: newConversation,
          message: newMessage,
          user: {
            id: 4,
            email: data.email,
            isPlaceholder: true
          },
          invitationToken
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
  } else if (method === "POST" && path === "/messaging/conversations") {
    // Create a new conversation
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate required fields
        if (!data.participants || !Array.isArray(data.participants)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Participants array is required"
          }));
          return;
        }

        // Mock non-existent participant error
        if (data.participants.includes(999)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "One or more participants do not exist"
          }));
          return;
        }

        const newConversation = {
          ...mockConversation,
          conversationId: "conv_" + Date.now(),
          participants: [...new Set([1, ...data.participants])], // Ensure creator is included
          conversationType: data.type || "general",
          createdAt: Date.now(),
          lastMessageText: "",
          lastMessageTime: Date.now(),
          lastMessageSenderId: 1
        };

        let newMessage = null;
        if (data.initialMessage) {
          newMessage = {
            ...mockMessage,
            messageId: "msg_" + Date.now(),
            conversationId: newConversation.conversationId,
            senderId: 1,
            text: data.initialMessage,
            timestamp: Date.now()
          };

          newConversation.lastMessageText = data.initialMessage;
          newConversation.lastMessageTime = Date.now();
          newConversation.lastMessageSenderId = 1;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          conversation: newConversation,
          message: newMessage
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
  } else if (method === "GET" && path === "/messaging/conversations") {
    // Get all conversations for current user

    // Mock pagination functionality
    const lastKey = url.searchParams.get("lastKey");
    const limit = parseInt(url.searchParams.get("limit") || "20");

    let conversations = [
      mockConversation,
      {
        ...mockConversation,
        conversationId: "conv_67890",
        lastMessageText: "When can we meet?",
        lastMessageTime: Date.now() - 3600000, // 1 hour ago
        lastMessageSenderId: 3
      }
    ];

    // Simulate pagination
    let nextLastKey = null;
    if (lastKey === null && conversations.length > limit) {
      conversations = conversations.slice(0, limit);
      nextLastKey = { conversationId: conversations[conversations.length - 1].conversationId };
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      conversations,
      lastKey: nextLastKey ? JSON.stringify(nextLastKey) : null
    }));
  } else if (method === "GET" && path.match(/^\/messaging\/conversations\/[^\/]+$/)) {
    // Get conversation by ID
    const conversationId = path.split("/")[3];

    // Mock non-existent conversation
    if (conversationId === "nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Conversation not found"
      }));
      return;
    }

    // Mock unauthorized access
    if (conversationId === "unauthorized") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "User is not a participant in this conversation"
      }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      conversation: { ...mockConversation, conversationId }
    }));
  } else if (method === "GET" && path.match(/^\/messaging\/conversations\/[^\/]+\/messages$/)) {
    // Get messages for a conversation
    const conversationId = path.split("/")[3];

    // Mock non-existent conversation
    if (conversationId === "nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Conversation not found"
      }));
      return;
    }

    // Mock unauthorized access
    if (conversationId === "unauthorized") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "User is not a participant in this conversation"
      }));
      return;
    }

    // Handle pagination
    const lastKey = url.searchParams.get("lastKey");
    const limit = parseInt(url.searchParams.get("limit") || "20");

    const messages = [
      { ...mockMessage, conversationId },
      {
        ...mockMessage,
        messageId: "msg_67890",
        text: "I'm doing well, thanks!",
        senderId: 1,
        timestamp: Date.now() - 300000 // 5 minutes ago
      }
    ];

    // Simulate pagination
    let nextLastKey = null;
    if (lastKey === null && messages.length > limit) {
      const visibleMessages = messages.slice(0, limit);
      nextLastKey = {
        messageId: visibleMessages[visibleMessages.length - 1].messageId,
        conversationId
      };
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      messages: messages.slice(0, limit),
      lastKey: nextLastKey ? JSON.stringify(nextLastKey) : null
    }));
  } else if (method === "POST" && path.match(/^\/messaging\/conversations\/[^\/]+\/messages$/)) {
    // Send a message in conversation
    const conversationId = path.split("/")[3];

    // Mock non-existent conversation
    if (conversationId === "nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Conversation not found"
      }));
      return;
    }

    // Mock unauthorized access
    if (conversationId === "unauthorized") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "User is not a participant in this conversation"
      }));
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate required fields
        if (!data.text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Message text is required"
          }));
          return;
        }

        const newMessage = {
          ...mockMessage,
          messageId: "msg_" + Date.now(),
          conversationId,
          senderId: 1, // Current user
          text: data.text,
          timestamp: Date.now(),
          status: { "1": "READ", "2": "SENT" }
        };

        // Simulate email notification if fastify mock is passed
        let emailSent = false;
        if (((req as any).fastify && (req as any).fastify.email) || (req as any).emailEnabled) {
          emailSent = true;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          message: newMessage,
          emailSent
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
  } else if (method === "POST" && path.match(/^\/messaging\/conversations\/[^\/]+\/read$/)) {
    // Mark messages as read
    const conversationId = path.split("/")[3];

    // Mock non-existent conversation
    if (conversationId === "nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Conversation not found"
      }));
      return;
    }

    // Mock unauthorized access
    if (conversationId === "unauthorized") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "User is not a participant in this conversation"
      }));
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate required fields
        if (!Array.isArray(data.messageIds) || data.messageIds.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Message IDs are required"
          }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
  } else if (method === "POST" && path.match(/^\/messaging\/conversations\/[^\/]+\/participants$/)) {
    // Add participant to conversation
    const conversationId = path.split("/")[3];

    // Mock non-existent conversation
    if (conversationId === "nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Conversation not found"
      }));
      return;
    }

    // Mock unauthorized access
    if (conversationId === "unauthorized") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "User is not a participant in this conversation"
      }));
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        // Validate required fields
        if (!data.participantId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Participant ID is required"
          }));
          return;
        }

        // Mock non-existent participant
        if (data.participantId === 999) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: "Participant not found: 999"
          }));
          return;
        }

        // Check if already a participant
        if (mockConversation.participants.includes(data.participantId)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            conversation: { ...mockConversation, conversationId }
          }));
          return;
        }

        const updatedConversation = {
          ...mockConversation,
          conversationId,
          participants: [...mockConversation.participants, data.participantId],
          unreadCount: {
            ...mockConversation.unreadCount,
            [data.participantId]: 0
          }
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          conversation: updatedConversation
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          error: "Invalid JSON"
        }));
      }
    });
  } else if (method === "DELETE" && path.match(/^\/messaging\/conversations\/[^\/]+\/participants\/\d+$/)) {
    // Remove participant from conversation
    const parts = path.split("/");
    const conversationId = parts[3];
    const participantId = parseInt(parts[5]);

    // Mock non-existent conversation
    if (conversationId === "nonexistent") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Conversation not found"
      }));
      return;
    }

    // Mock unauthorized access - only for third party removal
    if (conversationId === "unauthorized" && participantId !== 1) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "User does not have permission to remove participants from this conversation"
      }));
      return;
    }

    // Mock non-existent participant
    if (participantId === 999) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        error: "Participant not found: 999"
      }));
      return;
    }

    // Check if not a participant (no-op)
    if (!mockConversation.participants.includes(participantId)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        conversation: { ...mockConversation, conversationId }
      }));
      return;
    }

    const updatedConversation = {
      ...mockConversation,
      conversationId,
      participants: mockConversation.participants.filter(id => id !== participantId)
    };

    // Remove from unread counts
    const updatedUnreadCount = { ...mockConversation.unreadCount };
    delete updatedUnreadCount[participantId.toString()];
    updatedConversation.unreadCount = updatedUnreadCount;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      conversation: updatedConversation
    }));
  } else if (method === "GET" && path === "/messaging/unread-count") {
    // Get unread count for current user
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      unreadCount: 3,
      conversationsWithUnread: [
        {
          conversationId: "conv_12345",
          unreadCount: 1,
          lastMessageText: "Hello, how are you?",
          lastMessageTime: Date.now()
        },
        {
          conversationId: "conv_67890",
          unreadCount: 2,
          lastMessageText: "When can we meet?",
          lastMessageTime: Date.now() - 3600000 // 1 hour ago
        }
      ]
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

// TAP tests for messaging functionality
tap.test("Messaging Routes", async (t) => {
  // Test inviting a user and creating conversation
  await t.test("POST /messaging/invite (new user)", async (t) => {
    const payload = {
      email: "newuser@example.com",
      initialMessage: "Hello! I'd like to chat with you."
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/invite",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/invite (new user)", response, {
      "Success": JSON.parse(response.payload).success,
      "User email": JSON.parse(response.payload).user.email,
      "Is placeholder": JSON.parse(response.payload).user.isPlaceholder,
      "Has invitation token": !!JSON.parse(response.payload).invitationToken
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.equal(result.user.email, "newuser@example.com", "Should have correct email");
    t.equal(result.user.isPlaceholder, true, "Should be a placeholder user");
    t.ok(result.invitationToken, "Should have an invitation token");
    t.ok(result.conversation, "Should create a conversation");
    t.equal(result.message.text, "Hello! I'd like to chat with you.", "Should include initial message");
  });

  // Test inviting an existing user
  await t.test("POST /messaging/invite (existing user)", async (t) => {
    const payload = {
      email: "existing@example.com",
      initialMessage: "Hi there!"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/invite",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/invite (existing user)", response, {
      "Success": JSON.parse(response.payload).success,
      "User email": JSON.parse(response.payload).user.email,
      "Is placeholder": JSON.parse(response.payload).user.isPlaceholder,
      "Has invitation token": !!JSON.parse(response.payload).invitationToken
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.equal(result.user.email, "existing@example.com", "Should have correct email");
    t.equal(result.user.isPlaceholder, false, "Should not be a placeholder user");
    t.notOk(result.invitationToken, "Should not have an invitation token");
  });

  // Test missing email in invite
  await t.test("POST /messaging/invite (missing email)", async (t) => {
    const payload = {
      initialMessage: "Hi there!"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/invite",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/invite (missing email)", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 400, "Status code should be 400");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "Email is required", "Should indicate email is required");
  });

  // Test creating a conversation
  await t.test("POST /messaging/conversations", async (t) => {
    const payload = {
      participants: [2, 3],
      type: "general",
      initialMessage: "Hello everyone!"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations", response, {
      "Success": JSON.parse(response.payload).success,
      "Participants": JSON.parse(response.payload).conversation.participants.join(", "),
      "Has initial message": !!JSON.parse(response.payload).message
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.ok(result.conversation.participants.includes(1), "Should include creator");
    t.ok(result.conversation.participants.includes(2), "Should include participant 2");
    t.ok(result.conversation.participants.includes(3), "Should include participant 3");
    t.equal(result.message.text, "Hello everyone!", "Should include initial message");
  });

  // Test creating a conversation with non-existent participants
  await t.test("POST /messaging/conversations (non-existent participant)", async (t) => {
    const payload = {
      participants: [2, 999],
      type: "general"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations (non-existent participant)", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "One or more participants do not exist", "Should indicate participant not found");
  });

  // Test getting conversations
  await t.test("GET /messaging/conversations", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations"
    });

    logTest("GET /messaging/conversations", response, {
      "Conversation count": JSON.parse(response.payload).conversations.length,
      "Has lastKey": !!JSON.parse(response.payload).lastKey
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.ok(Array.isArray(result.conversations), "Should return conversations array");
    t.ok(result.conversations.length > 0, "Should return at least one conversation");
  });

  // Test getting conversations with pagination
  await t.test("GET /messaging/conversations with pagination", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations?limit=1"
    });

    logTest("GET /messaging/conversations with pagination", response, {
      "Conversation count": JSON.parse(response.payload).conversations.length,
      "Limited to 1": JSON.parse(response.payload).conversations.length === 1
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.conversations.length, 1, "Should limit to 1 conversation");
  });

  // Test getting a conversation by ID
  await t.test("GET /messaging/conversations/:conversationId", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/conv_12345"
    });

    logTest("GET /messaging/conversations/:conversationId", response, {
      "Success": JSON.parse(response.payload).success,
      "Conversation ID": JSON.parse(response.payload).conversation.conversationId
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.equal(result.conversation.conversationId, "conv_12345", "Should return conversation with correct ID");
  });

  // Test getting a non-existent conversation
  await t.test("GET /messaging/conversations/nonexistent", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/nonexistent"
    });

    logTest("GET /messaging/conversations/nonexistent", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "Conversation not found", "Should indicate conversation not found");
  });

  // Test unauthorized access to conversation
  await t.test("GET /messaging/conversations/unauthorized", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/unauthorized"
    });

    logTest("GET /messaging/conversations/unauthorized", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 403, "Status code should be 403");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "User is not a participant in this conversation", "Should indicate unauthorized");
  });

  // Test getting messages for a conversation
  await t.test("GET /messaging/conversations/:conversationId/messages", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/conv_12345/messages"
    });

    logTest("GET /messaging/conversations/:conversationId/messages", response, {
      "Message count": JSON.parse(response.payload).messages.length,
      "First message text": JSON.parse(response.payload).messages[0].text
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.ok(Array.isArray(result.messages), "Should return messages array");
    t.ok(result.messages.length > 0, "Should return at least one message");
  });

  // Test getting messages with pagination
  await t.test("GET /messaging/conversations/:conversationId/messages with pagination", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/conversations/conv_12345/messages?limit=1"
    });

    logTest("GET /messaging/conversations/:conversationId/messages with pagination", response, {
      "Message count": JSON.parse(response.payload).messages.length,
      "Limited to 1": JSON.parse(response.payload).messages.length === 1
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.messages.length, 1, "Should limit to 1 message");
  });

  // Test sending a message
  await t.test("POST /messaging/conversations/:conversationId/messages", async (t) => {
    const payload = {
      text: "This is a test message"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_12345/messages",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations/:conversationId/messages", response, {
      "Success": JSON.parse(response.payload).success,
      "Message text": JSON.parse(response.payload).message.text,
      "Sender ID": JSON.parse(response.payload).message.senderId
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.equal(result.message.text, "This is a test message", "Should create message with correct text");
    t.equal(result.message.senderId, 1, "Should set current user as sender");
  });

  // Test sending a message with fastify email notification
// Alternative approach: Modify the dispatch function directly for this test
await t.test("POST /messaging/conversations/:conversationId/messages with email notification", async (t) => {
  const payload = {
    text: "This should trigger an email notification"
  };

  // Create a modified dispatch function that handles email notifications
  const emailEnabledDispatch = (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Add email property to check in the dispatch function
    (req as any).emailEnabled = true;

    // Call original dispatch
    return dispatch(req, res);
  };

  // Then modify the dispatch function to check for emailEnabled instead of fastify.email

  const response = await inject(emailEnabledDispatch, {
    method: "POST",
    url: "/messaging/conversations/conv_12345/messages",
    headers: {
      "content-type": "application/json"
    },
    payload: JSON.stringify(payload)
  });

  logTest("POST /messaging/conversations/:conversationId/messages with email", response, {
    "Success": JSON.parse(response.payload).success,
    "Email notification enabled": !!JSON.parse(response.payload).emailSent
  });

  t.equal(response.statusCode, 200, "Status code should be 200");
  const result = JSON.parse(response.payload);
  t.equal(result.success, true, "Should return success");
  t.equal(result.emailSent, true, "Should indicate email was sent");
});

  // Test sending a message to non-existent conversation
  await t.test("POST /messaging/conversations/nonexistent/messages", async (t) => {
    const payload = {
      text: "This message should fail"
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/nonexistent/messages",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations/nonexistent/messages", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "Conversation not found", "Should indicate conversation not found");
  });

  // Test missing message text
  await t.test("POST /messaging/conversations/:conversationId/messages (missing text)", async (t) => {
    const payload = {};

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_12345/messages",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations/:conversationId/messages (missing text)", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 400, "Status code should be 400");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "Message text is required", "Should indicate text is required");
  });

  // Test marking messages as read
  await t.test("POST /messaging/conversations/:conversationId/read", async (t) => {
    const payload = {
      messageIds: ["msg_12345", "msg_67890"]
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_12345/read",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations/:conversationId/read", response, {
      "Success": JSON.parse(response.payload).success
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
  });

  // Test marking messages as read with empty message IDs
  await t.test("POST /messaging/conversations/:conversationId/read (empty message IDs)", async (t) => {
    const payload = {
      messageIds: []
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_12345/read",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations/:conversationId/read (empty message IDs)", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 400, "Status code should be 400");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "Message IDs are required", "Should indicate message IDs are required");
  });

  // Test adding a participant to a conversation
  await t.test("POST /messaging/conversations/:conversationId/participants", async (t) => {
    const payload = {
      participantId: 3
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_12345/participants",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations/:conversationId/participants", response, {
      "Success": JSON.parse(response.payload).success,
      "Participants include new user": JSON.parse(response.payload).conversation.participants.includes(3),
      "New user unread count": JSON.parse(response.payload).conversation.unreadCount["3"]
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.ok(result.conversation.participants.includes(3), "Should add participant");
    t.equal(result.conversation.unreadCount["3"], 0, "Should initialize unread count to 0");
  });

  // Test adding non-existent participant
  await t.test("POST /messaging/conversations/:conversationId/participants (non-existent user)", async (t) => {
    const payload = {
      participantId: 999
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_12345/participants",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations/:conversationId/participants (non-existent user)", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "Participant not found: 999", "Should indicate participant not found");
  });

  // Test adding a participant that's already in the conversation
  await t.test("POST /messaging/conversations/:conversationId/participants (already a participant)", async (t) => {
    const payload = {
      participantId: 2
    };

    const response = await inject(dispatch, {
      method: "POST",
      url: "/messaging/conversations/conv_12345/participants",
      headers: {
        "content-type": "application/json"
      },
      payload: JSON.stringify(payload)
    });

    logTest("POST /messaging/conversations/:conversationId/participants (already a participant)", response, {
      "Success": JSON.parse(response.payload).success,
      "Is a no-op": JSON.parse(response.payload).conversation.participants.includes(2)
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.ok(result.conversation.participants.includes(2), "Should keep existing participant");
  });

  // Test removing a participant (self)
  await t.test("DELETE /messaging/conversations/:conversationId/participants/:participantId (self)", async (t) => {
    const response = await inject(dispatch, {
      method: "DELETE",
      url: "/messaging/conversations/conv_12345/participants/1"
    });

    logTest("DELETE /messaging/conversations/:conversationId/participants/:participantId (self)", response, {
      "Success": JSON.parse(response.payload).success,
      "Self removed": !JSON.parse(response.payload).conversation.participants.includes(1)
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.notOk(result.conversation.participants.includes(1), "Should remove user from participants");
    t.notOk(result.conversation.unreadCount["1"], "Should remove user from unread counts");
  });

  // Test removing another participant
  await t.test("DELETE /messaging/conversations/:conversationId/participants/:participantId (other)", async (t) => {
    const response = await inject(dispatch, {
      method: "DELETE",
      url: "/messaging/conversations/conv_12345/participants/2"
    });

    logTest("DELETE /messaging/conversations/:conversationId/participants/:participantId (other)", response, {
      "Success": JSON.parse(response.payload).success,
      "Other removed": !JSON.parse(response.payload).conversation.participants.includes(2)
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.success, true, "Should return success");
    t.notOk(result.conversation.participants.includes(2), "Should remove other user from participants");
    t.notOk(result.conversation.unreadCount["2"], "Should remove other user from unread counts");
  });

  // Test removing a non-existent participant
  await t.test("DELETE /messaging/conversations/:conversationId/participants/999", async (t) => {
    const response = await inject(dispatch, {
      method: "DELETE",
      url: "/messaging/conversations/conv_12345/participants/999"
    });

    logTest("DELETE /messaging/conversations/:conversationId/participants/999", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "Participant not found: 999", "Should indicate participant not found");
  });

  // Test unauthorized participant removal
  await t.test("DELETE /messaging/conversations/unauthorized/participants/2", async (t) => {
    const response = await inject(dispatch, {
      method: "DELETE",
      url: "/messaging/conversations/unauthorized/participants/2"
    });

    logTest("DELETE /messaging/conversations/unauthorized/participants/2", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 403, "Status code should be 403");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "User does not have permission to remove participants from this conversation", "Should indicate unauthorized");
  });

  // Test getting unread count
  await t.test("GET /messaging/unread-count", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/unread-count"
    });

    logTest("GET /messaging/unread-count", response, {
      "Total unread": JSON.parse(response.payload).unreadCount,
      "Unread conversations count": JSON.parse(response.payload).conversationsWithUnread.length
    });

    t.equal(response.statusCode, 200, "Status code should be 200");
    const result = JSON.parse(response.payload);
    t.equal(result.unreadCount, 3, "Should return correct total unread count");
    t.equal(result.conversationsWithUnread.length, 2, "Should return 2 conversations with unread messages");
    t.ok(result.conversationsWithUnread[0].lastMessageText, "Should include last message text");
    t.ok(result.conversationsWithUnread[0].lastMessageTime, "Should include last message time");
  });

  // Test route not found
  await t.test("Route not found", async (t) => {
    const response = await inject(dispatch, {
      method: "GET",
      url: "/messaging/nonexistent-route"
    });

    logTest("Route not found", response, {
      "Success": JSON.parse(response.payload).success,
      "Error": JSON.parse(response.payload).error
    });

    t.equal(response.statusCode, 404, "Status code should be 404");
    const result = JSON.parse(response.payload);
    t.equal(result.success, false, "Should return failure");
    t.equal(result.error, "Route not found", "Should indicate route not found");
  });
});

