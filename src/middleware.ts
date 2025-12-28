import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized, token missing or invalid"
        });
    }

    let token = authHeader;
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'nijeesh');
        (req as any).user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized, token missing or invalid"
        });
    }
};

export const teacherOnly = (req: Request, res: Response, next: NextFunction) => {
    if ((req as any).user?.role !== 'teacher') {
        return res.status(403).json({
            success: false,
            error: "Forbidden, teacher access required"
        });
    }
    next();
};

export const studentOnly = (req: Request, res: Response, next: NextFunction) => {
    if ((req as any).user?.role !== 'student') {
        return res.status(403).json({
            success: false,
            error: "Forbidden, student access required"
        });
    }
    next();
};