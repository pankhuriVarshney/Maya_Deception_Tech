import { Request, Response, NextFunction } from 'express';
export interface ApiError extends Error {
    statusCode?: number;
    isOperational?: boolean;
}
export declare const errorHandler: (err: ApiError, req: Request, res: Response, next: NextFunction) => void;
export declare const asyncHandler: (fn: Function) => (req: Request, res: Response, next: NextFunction) => void;
