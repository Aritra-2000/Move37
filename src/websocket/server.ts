import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt';
import { PrismaClient, Prisma } from '../generated/prisma';

const prisma = new PrismaClient();

// Type Definitions
interface AuthenticatedSocket extends Socket {
  userId?: number;
  username?: string;
}

interface PollRoom {
  users: Set<string>; // socket.ids
  admin?: string;
}

interface UserData {
  userId: number;
  username: string;
  socketId: string;
  lastActive: number;
}

// In-memory stores
const activeUsers = new Map<string, UserData>(); // socketId -> UserData
const pollRooms = new Map<string, PollRoom>(); // pollId -> PollRoom

// Rate limiting
const rateLimit = new Map<string, { count: number; lastRequest: number }>();
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const MAX_REQUESTS = 5;

export function setupWebSocket(server: HttpServer): SocketIOServer {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5000'
  ];

  console.log('Initializing WebSocket server with origins:', allowedOrigins);

  const io = new SocketIOServer(server, {
    path: '/socket.io',
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 3600
    },
    // Increase ping timeout and interval
    pingTimeout: 60000,      // 60 seconds
    pingInterval: 25000,     // 25 seconds
    // Enable both transports for better compatibility
    transports: ['websocket', 'polling'],
    // Enable compatibility with older Socket.IO clients
    allowEIO3: true,
    allowUpgrades: true,
    // Disable serving the client
    serveClient: false,
    // Enable connection state recovery
    connectionStateRecovery: {
      // the backup duration of the sessions and the packets
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      // whether to skip middlewares upon successful recovery
      skipMiddlewares: true,
    },
    // Enable per-message deflate
    perMessageDeflate: {
      threshold: 1024, // Size threshold in bytes
      zlibDeflateOptions: {
        level: 6 // Compression level (0-9)
      }
    },
    // Enable HTTP long-polling fallback
    allowRequest: (req, callback) => {
      // Add any request validation here if needed
      callback(null, true);
    }
  });
  
  // Add connection logging
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
    
    // Test endpoint - works with both Socket.IO clients and raw WebSocket clients
    socket.on('ping', (data, callback) => {
      console.log('Ping received from:', socket.id);
      const response = JSON.stringify({
        event: 'pong',
        data: { 
          status: 'success',
          timestamp: new Date().toISOString(),
          clientId: socket.id 
        }
      });
      
      // Handle callback for Socket.IO clients
      if (typeof callback === 'function') {
        try {
          callback(response);
        } catch (error) {
          console.error('Error in ping callback:', error);
        }
      } 
      // For raw WebSocket clients
      else if (typeof data === 'object' && data !== null) {
        socket.emit('pong', response);
      } else {
        // For simple string 'ping' from Postman
        socket.emit('pong', 'pong');
      }
    });

    // Handle connection errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`Client ${socket.id} disconnected. Reason: ${reason}`);
    });
  });

  // Log connection status
  io.engine.on('connection_error', (err) => {
    console.error('WebSocket connection error:', err);
  });

  // Handle connection
  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('Client connected:', socket.id);

    // Handle authentication
    socket.on('authenticate', async ({ token }: { token: string }) => {
      try {
        const { userId, username } = await verifyToken(token);
        const userIdNumber = typeof userId === 'string' ? parseInt(userId, 10) : userId;
        socket.userId = userIdNumber;
        socket.username = username;
        
        // Store user in active users
        activeUsers.set(socket.id, {
          userId: userIdNumber,
          username,
          socketId: socket.id,
          lastActive: Date.now()
        });

        socket.emit('authenticated', { success: true, userId, username });
      } catch (error) {
        console.error('Authentication error:', error);
        socket.emit('authentication_error', { error: 'Invalid token' });
      }
    });

    // Join a poll room
    socket.on('join_poll', async ({ pollId }: { pollId: string }) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      try {
        // Leave any existing rooms
        socket.rooms.forEach(room => {
          if (room !== socket.id) {
            socket.leave(room);
          }
        });

        // Join the new room
        socket.join(`poll_${pollId}`);
        
        // Update poll room tracking
        if (!pollRooms.has(pollId)) {
          pollRooms.set(pollId, { users: new Set() });
        }
        pollRooms.get(pollId)?.users.add(socket.id);

        // Notify others in the room
        socket.to(`poll_${pollId}`).emit('user_joined', {
          userId: socket.userId,
          username: socket.username
        });

        // Send current poll data
        const userId = socket.userId?.toString();
        const poll = await getPollWithVotes(parseInt(pollId), userId);
        socket.emit('poll_data', poll);

      } catch (error) {
        console.error('Error joining poll:', error);
        socket.emit('error', { message: 'Failed to join poll' });
      }
    });

    // Handle voting
    socket.on('vote', async ({ pollId, optionId }: { pollId: string; optionId: number }) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      try {
        // Check rate limiting
        const userRateLimit = rateLimit.get(socket.id) || { count: 0, lastRequest: 0 };
        const now = Date.now();
        
        if (now - userRateLimit.lastRequest < RATE_LIMIT_WINDOW) {
          if (userRateLimit.count >= MAX_REQUESTS) {
            socket.emit('error', { message: 'Rate limit exceeded' });
            return;
          }
          userRateLimit.count++;
        } else {
          userRateLimit.count = 1;
          userRateLimit.lastRequest = now;
        }
        rateLimit.set(socket.id, userRateLimit);

        // Record vote in database
        const userIdNumber = typeof socket.userId === 'string' ? parseInt(socket.userId, 10) : (socket.userId || 0);
        
        // First, delete any existing vote from this user for this poll
        if (socket.userId === undefined) {
          throw new Error('User not authenticated');
        }
        
        await prisma.vote.deleteMany({
          where: {
            userId: socket.userId,
            pollOption: {
              pollId: parseInt(pollId)
            }
          }
        });

        // Then create a new vote
        await prisma.vote.create({
          data: {
            userId: userIdNumber,
            pollOptionId: optionId,
            createdAt: new Date()
          }
        });

        // Get updated poll data
        const pollIdNumber = typeof pollId === 'string' ? parseInt(pollId, 10) : Number(pollId);
        const updatedPoll = await getPollWithVotes(pollIdNumber, userIdNumber);
        
        // Broadcast to all in the room
        io.to(`poll_${pollId}`).emit('poll_updated', updatedPoll);

      } catch (error) {
        console.error('Vote error:', error);
        socket.emit('error', { message: 'Failed to record vote' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      // Remove from active users
      activeUsers.delete(socket.id);
      
      // Remove from poll rooms
      pollRooms.forEach((room, pollId) => {
        if (room.users.has(socket.id)) {
          room.users.delete(socket.id);
          
          // Notify others in the room
          socket.to(`poll_${pollId}`).emit('user_left', {
            userId: socket.userId,
            username: socket.username
          });
          
          // Remove room if empty
          if (room.users.size === 0) {
            pollRooms.delete(pollId);
          }
        }
      });
    });
  });

  return io;
}

// Types for the poll with votes
type PollWithOptionsAndVotes = Prisma.PollGetPayload<{
  include: {
    options: {
      include: {
        _count: {
          select: { votes: boolean };
        };
      };
    };
    votes?: boolean | {
      where: { userId: number };
      select: { optionId: boolean };
    };
  };
}>;

// Helper function to get poll with vote counts
async function getPollWithVotes(pollId: number, userId?: string | number) {
  const includeOptions = {
    include: {
      _count: {
        select: { votes: true }
      }
    }
  };

  const userIdNumber = userId ? (typeof userId === 'string' ? parseInt(userId, 10) : userId) : undefined;
  
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      options: includeOptions,
      ...(userIdNumber !== undefined && {
        votes: {
          where: { userId: userIdNumber },
          select: { optionId: true }
        }
      })
    }
  }) as unknown as PollWithOptionsAndVotes | null;

  if (!poll) return null;

  // Calculate total votes
  const totalVotes = (poll as any).options.reduce(
    (sum: number, option: any) => sum + (option._count?.votes || 0), 0
  );

  // Transform the data
  const result = {
    ...poll,
    totalVotes,
    userVote: (poll as any).votes?.[0]?.optionId as number | undefined,
    options: (poll as any).options.map((option: any) => ({
      id: option.id,
      text: option.text,
      pollId: option.pollId,
      votes: option._count?.votes || 0
    }))
  };

  return result;
}
