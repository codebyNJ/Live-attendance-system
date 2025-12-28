import {z} from 'zod';
import { ObjectId } from 'mongodb';

export const UserSchema = z.object({
    name : z.string(),
    email : z.string().email(),
    password : z.string().min(6),
    role : z.union([z.literal("student"), z.literal("teacher")])
});

export const ClassSchema = z.object({
    className : z.string(),
});

export const AttendanceSchema = z.object({
    classId : z.instanceof(ObjectId),
});