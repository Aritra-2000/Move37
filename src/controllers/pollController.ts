import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient } from '../generated/prisma';
import { AuthenticatedRequest } from '../types/express';

const prisma = new PrismaClient();

// Type definitions
interface PollResponse {
  id: number;
  question: string;
  isPublished: boolean;
  creatorId: number;
  creator: {
    id: number;
    name: string;
    email: string;
  };
  options: Array<{
    id: number;
    text: string;
    order: number;
    _count: {
      votes: number;
    };
  }>;
  _count: {
    options: number;
  };
  isOwner: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Validation schemas
const createPollSchema = z.object({
  question: z.string().min(3, 'Question must be at least 3 characters'),
  options: z.array(z.string().min(1, 'Option text is required')).min(2, 'At least 2 options are required'),
  isPublished: z.boolean().optional().default(false),
});

const updatePollSchema = z.object({
  question: z.string().min(3).optional(),
  isPublished: z.boolean().optional(),
});

const voteSchema = z.object({
  optionId: z.number().int().positive('Option ID must be a positive integer'),
});

// Helper function to format poll response
const formatPollResponse = (poll: any, userId?: number) => {
  return {
    id: poll.id,
    question: poll.question,
    isPublished: poll.isPublished,
    creatorId: poll.creatorId,
    creator: poll.creator ? {
      id: poll.creator.id,
      name: poll.creator.name,
      email: poll.creator.email,
    } : null,
    options: poll.options ? poll.options.map((option: any) => ({
      id: option.id,
      text: option.text,
      order: option.order,
      voteCount: option._count?.votes || 0
    })) : [],
    totalVotes: poll.options ? 
      poll.options.reduce((sum: number, option: any) => sum + (option._count?.votes || 0), 0) : 0,
    isOwner: userId ? poll.creatorId === userId : false,
    createdAt: poll.createdAt,
    updatedAt: poll.updatedAt
  };
};

// Helper function to broadcast poll updates
const broadcastPollUpdate = async (io: SocketIOServer | undefined, pollId: number) => {
  if (!io) return;
  
  const updatedPoll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      options: {
        include: {
          _count: {
            select: { votes: true },
          },
        },
        orderBy: { order: 'asc' },
      },
      _count: {
        select: { options: true },
      },
    },
  });

  if (updatedPoll) {
    io.to(`poll_${pollId}`).emit('poll:updated', formatPollResponse(updatedPoll));
  }
};

// Create a new poll
export const createPoll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { question, options, isPublished } = createPollSchema.parse(req.body);
    const userId = (req as any).user.userId;

    const poll = await prisma.poll.create({
      data: {
        question,
        isPublished,
        creatorId: userId,
        options: {
          create: options.map((text, index) => ({
            text,
            order: index,
          })),
        },
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        options: true,
        _count: {
          select: { options: true },
        },
      },
    });

    const response = formatPollResponse(poll, userId);
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
};

// Get a single poll by ID
export const getPoll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pollId = parseInt(req.params.id);
    const userId = (req as any).user?.userId;

    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        options: {
          include: {
            _count: {
              select: { votes: true },
            },
          },
          orderBy: { order: 'asc' },
        },
        _count: {
          select: { options: true },
        },
      },
    });

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // If poll is not published and user is not the creator, return 404
    if (!poll.isPublished && poll.creatorId !== userId) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    const response = formatPollResponse(poll, userId);
    res.json(response);
  } catch (error) {
    next(error);
  }
};

// List all published polls with pagination
export const listPolls = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const userId = (req as any).user?.userId;

    const [polls, total] = await Promise.all([
      prisma.poll.findMany({
        where: { isPublished: true },
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: { options: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.poll.count({ where: { isPublished: true } }),
    ]);

    const response = {
      data: polls.map((poll: any) => formatPollResponse(poll, userId)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

// Update a poll
export const updatePoll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pollId = parseInt(req.params.id);
    const userId = (req as any).user.userId;
    const updateData = updatePollSchema.parse(req.body);

    // Check if poll exists and user is the owner
    const existingPoll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        _count: {
          select: { options: true },
        },
      },
    });

    if (!existingPoll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    if (existingPoll.creatorId !== userId) {
      return res.status(403).json({ message: 'Not authorized to update this poll' });
    }

    const updatedPoll = await prisma.poll.update({
      where: { id: pollId },
      data: updateData,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        options: {
          include: {
            _count: {
              select: { votes: true },
            },
          },
          orderBy: { order: 'asc' },
        },
        _count: {
          select: { options: true },
        },
      },
    });

    // Broadcast update to all connected clients
    if ((req as any).io) {
      await broadcastPollUpdate((req as any).io, pollId);
    }

    const response = formatPollResponse(updatedPoll, userId);
    res.json(response);
  } catch (error) {
    next(error);
  }
};

// Delete a poll
export const deletePoll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pollId = parseInt(req.params.id);
    const userId = (req as any).user.userId;

    // Check if poll exists and user is the owner
    const existingPoll = await prisma.poll.findUnique({
      where: { id: pollId },
    });

    if (!existingPoll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    if (existingPoll.creatorId !== userId) {
      return res.status(403).json({ message: 'Not authorized to delete this poll' });
    }

    // Delete the poll (cascading deletes will handle related options and votes)
    await prisma.poll.delete({
      where: { id: pollId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// Vote on a poll
export const voteOnPoll = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const pollId = parseInt(req.params.id);
    
    // Ensure we have a valid user ID from the authentication middleware
    if (!req.user?.userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    const userId = req.user.userId;
    
    // Validate request body
    const { optionId } = voteSchema.parse(req.body);
    
    if (isNaN(pollId) || isNaN(optionId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid poll or option ID' 
      });
    }

    // Check if poll exists and is published
    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        options: {
          where: { id: optionId },
          select: { 
            id: true,
            pollId: true  // Ensure the option belongs to the poll
          },
        },
      },
    });

    if (!poll) {
      return res.status(404).json({ 
        success: false, 
        message: 'Poll not found' 
      });
    }

    if (!poll.isPublished) {
      return res.status(400).json({ 
        success: false, 
        message: 'This poll is not published' 
      });
    }

    if (poll.options.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid option for this poll' 
      });
    }

    // Use a transaction to ensure data consistency
    try {
      await prisma.$transaction(async (tx) => {
        // Check if user has already voted on this poll
        const existingVote = await tx.vote.findFirst({
          where: {
            userId,
            pollOption: {
              pollId: pollId
            }
          },
          select: { id: true }
        });

        if (existingVote) {
          return res.status(400).json({ 
            success: false, 
            message: 'You have already voted on this poll' 
          });
        }

        // Create the vote
        await tx.vote.create({
          data: {
            userId,
            pollOptionId: optionId,
          },
        });
      });

      // Get updated poll data
      const updatedPoll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: {
          options: {
            include: {
              _count: {
                select: { votes: true }
              }
            },
            orderBy: { order: 'asc' }
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      // Broadcast update to all connected clients
      if ((req as any).io) {
        await broadcastPollUpdate((req as any).io, pollId);
      }

      res.status(201).json({ 
        success: true, 
        message: 'Vote recorded successfully',
        data: formatPollResponse(updatedPoll, userId)
      });
      
    } catch (error: any) {
      console.error('Vote error:', error);
      if (error.code === 'P2002') { // Unique constraint violation
        return res.status(400).json({ 
          success: false, 
          message: 'You have already voted on this poll' 
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('Vote processing error:', error);
    next(error);
  }
};

export default {
  createPoll,
  getPoll,
  listPolls,
  updatePoll,
  deletePoll,
  voteOnPoll,
};
