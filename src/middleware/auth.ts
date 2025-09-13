import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload, UserRole } from '../utils/auth';
import { PrismaClient } from '../generated/prisma';
const prisma = new PrismaClient();

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        email: string;
        name: string;
        role?: UserRole;
      };
    }
  }
}

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;
    
    // Check Authorization header
    if (req.headers.authorization) {
      token = req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : req.headers.authorization; // Accept raw token without Bearer
    } else {
      // Fallback to cookie if no Authorization header
      token = req.cookies?.token;
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token provided'
      });
    }

    let decoded: JwtPayload;
    try {
      decoded = verifyToken(token);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists'
      });
    }

    // Ensure the user object has the required fields for JwtPayload
    if (!user.email) {
      return res.status(401).json({
        success: false,
        message: 'User email not found'
      });
    }

    // Attach user to request
    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};
