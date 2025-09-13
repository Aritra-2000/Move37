import z from "zod";

// Common validators
const emailValidator = z.string()
  .email('Invalid email address')
  .toLowerCase()
  .trim()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format');

const passwordValidator = z.string()
  .min(6, 'Password must be at least 6 characters')
  .max(100, 'Password is too long');

const nameValidator = z.string()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name is too long')
  .trim();

// Auth Schemas
export const registerSchema = z.object({
  name: nameValidator,
  email: emailValidator,
  password: passwordValidator
});

export const loginSchema = z.object({
  email: emailValidator,
  password: z.string().min(1, 'Password is required')
});

// Poll Schemas
export const createPollSchema = z.object({
  question: z.string()
    .min(3, 'Question must be at least 3 characters')
    .max(500, 'Question is too long')
    .trim(),
  isPublished: z.boolean().optional().default(false),
  options: z.array(
    z.string()
      .min(1, 'Option cannot be empty')
      .max(200, 'Option is too long')
      .trim()
  ).min(2, 'At least 2 options are required')
  .max(10, 'Maximum of 10 options allowed')
});

export const updatePollSchema = createPollSchema.partial().extend({
  options: z.array(
    z.string().min(1, 'Option cannot be empty').max(200, 'Option is too long').trim()
  ).min(2, 'At least 2 options are required').max(10, 'Maximum of 10 options allowed').optional()
});

export const voteSchema = z.object({
  optionId: z.number().int().positive('Invalid option ID')
});

// Pagination Schema
export const paginationSchema = z.object({
  page: z.string()
    .optional()
    .default('1')
    .transform(Number)
    .refine(n => n > 0, 'Page must be greater than 0'),
  limit: z.string()
    .optional()
    .default('10')
    .transform(Number)
    .refine(n => n > 0 && n <= 100, 'Limit must be between 1 and 100'),
  search: z.string().optional(),
  creatorId: z.string().optional(),
  isPublished: z.string().optional(),
  sortBy: z.enum(['createdAt', 'question', 'voteCount']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

// Export Types
export type RegisterSchema = z.infer<typeof registerSchema>;
export type LoginSchema = z.infer<typeof loginSchema>;
export type CreatePollSchema = z.infer<typeof createPollSchema>;
export type UpdatePollSchema = z.infer<typeof updatePollSchema>;
export type VoteSchema = z.infer<typeof voteSchema>;
export type PaginationSchema = z.infer<typeof paginationSchema>;

// Utility functions for validation
export const validateWithSchema = <T>(schema: z.ZodSchema<T>, data: unknown) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      success: false as const,
      error: {
        message: 'Validation failed',
        issues: result.error.issues
      }
    };
  }
  return { success: true as const, data: result.data };
};

export const validatePagination = (query: unknown) => {
  return validateWithSchema(paginationSchema, query);
};
