import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodTypeAny, ZodSchema } from 'zod';

type SchemaType<TBody = any, TQuery = any, TParams = any> = {
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  params?: ZodSchema<TParams>;
};

const validateRequest = <TBody = any, TQuery = any, TParams = any>(schemas: SchemaType<TBody, TQuery, TParams>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate each part of the request
      if (schemas.body) {
        const parsedBody = await schemas.body.parseAsync(req.body);
        req.body = parsedBody as unknown as any; // Type assertion to bypass type checking
      }
      if (schemas.query) {
        const parsedQuery = await schemas.query.parseAsync(req.query);
        req.query = parsedQuery as unknown as any; // Type assertion to bypass type checking
      }
      if (schemas.params) {
        const parsedParams = await schemas.params.parseAsync(req.params);
        req.params = parsedParams as unknown as any; // Type assertion to bypass type checking
      }
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          status: 'error',
          message: 'Validation failed',
          errors: error.issues,
        });
      }
      next(error);
    }
  };
};

export { validateRequest };
export default validateRequest;
