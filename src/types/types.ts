import {z} from 'zod';
import { ObjectId } from 'mongodb';

export const UserSchema = z.object({
    _id : z.instanceof(ObjectId).optional(),
    name : z.string(),
    email : z.string(),
    password : z.string(),
    role : z.union([z.literal("student"), z.literal("teacher")])
});

export const ClassSchema = z.object({
    _id : z.instanceof(ObjectId).optional(),
    className : z.string(),
    teacherId : z.instanceof(ObjectId).optional(),
    studentIds : z.array(z.instanceof(ObjectId)).optional()
});

export const AttendanceSchema = z.object({
    _id : z.instanceof(ObjectId).optional(),
    classId : z.instanceof(ObjectId),
    studentId : z.instanceof(ObjectId).optional(),
    status : z.enum(['present', 'absent']),
});