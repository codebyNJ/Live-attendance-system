import type {Request, Response, NextFunction}  from "express";
import jwt from 'jsonwebtoken';


interface AuthenticatedRequest extends Request {
    user?: {
        email: string;
        role: 'student' | 'teacher';
    };
}

export const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({
            "success": false,
            "message": "Authorization header missing"
        });
    }

    const token = authHeader.split(' ')[1];
    console.log("Token:", token);
    if(!token){
        return res.status(401).json({
            "status" : false,
            "message" : "unauthorized user"
        })
    }

    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'nijeesh') as { email: string; role: 'student' | 'teacher' };
        req.user = {
            email: decoded.email,
            role: decoded.role
        };
        next();
    }catch{
        return res.status(401).json({
            "status" : false,
            "message" : "invalid token"
        })
    }
}

export const teacherOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if(req.user?.role !== 'teacher'){
        return res.status(403).json({
            "status" : false,
            "message" : "forbidden access"
        })
    }
    next();
}

export const studentOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if(req.user?.role !== 'student'){
        return res.status(403).json({
            "status" : false,
            "message" : "forbidden access"
        })
    }
    next();
}