import { httpServer, prisma } from './app';
import { config } from 'dotenv';

config();

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    const server = httpServer.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });

    console.log('✅ WebSocket server initialized');

    // Graceful shutdown
    const shutdown = async () => {
      console.log('🛑 Shutting down server...');
      
      // Close HTTP server
      server.close(async () => {
        console.log('✅ HTTP server closed');
        
        // Close Prisma connection
        await prisma.$disconnect();
        console.log('✅ Database connection closed');
        
        process.exit(0);
      });

      // Force close server after 5 seconds
      setTimeout(() => {
        console.error('❌ Forcing shutdown...');
        process.exit(1);
      }, 5000);
    };

    // Handle termination signals
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  console.error('❌ Unhandled Rejection:', err);
  httpServer.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  console.error('❌ Uncaught Exception:', err);
  httpServer.close(() => process.exit(1));
});

startServer();