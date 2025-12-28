import express from 'express';
import jwt from 'jsonwebtoken';
import { AttendanceSchema, ClassSchema, UserSchema } from './types/types.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { authenticate, studentOnly, teacherOnly } from './middleware.js';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

declare module 'ws' {
    interface WebSocket {
        user?: {
            email: string;
            role: 'student' | 'teacher';
            userId?: string;
        };
    }
}

dotenv.config();

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attend-sys')

const UserModel = mongoose.model('User', new mongoose.Schema({
    name : String,
    email : {type: String, unique: true},
    password : String,
    role : {type: String, enum: ['student', 'teacher']}
}));

const ClassModel = mongoose.model('Class', new mongoose.Schema({
    className : String,
    teacherId : String,
    studentIds : [{type: String}]
}));

const AttendanceModel = mongoose.model('Attendance', new mongoose.Schema({
    classId : String,
    studentId : String,
    status : {type: String, enum: ['present', 'absent']}   
}));

const activeSession = {
    classId : "",
    startedAt : "",
    attendance : {} as Record<string, 'present' | 'absent'>
}

app.post('/auth/signup', async(req, res) =>{
    const parsedData = UserSchema.safeParse(req.body);
    if(!parsedData.success){
        return res.status(400).json({
            "success" : false,
            "error" : "Invalid request schema"
        })
    }
    
    try{
        const newUser = new UserModel(parsedData.data);
        await newUser.save();
        res.status(201).json({
            "success" : true,
            "data" : newUser
        })
    }catch(error: any){
        if (error.code === 11000) {
            return res.status(400).json({
                "success" : false,
                "error" : "Email already exists"
            })
        }
        res.status(500).json({
            "success" : false,
            "error" : "Internal server error"
        })
    }
});

app.post('/auth/login', async(req, res) => {
    const parsedData = UserSchema.pick({email:true, password:true}).safeParse(req.body);
    if(!parsedData.success){
        return res.status(400).json({
            "success" : false,
            "error" : "Invalid request schema"
        })
    }
    try{
        const user = await UserModel.findOne({
            email : parsedData.data.email        
        })
        if(!user){
            return res.status(400).json({
                "success" : false,
                "error" : "Invalid email or password"
            })
        }
        const isPasswordValid = user.password === parsedData.data.password;
        if(!isPasswordValid){
            return res.status(400).json({
                "success" : false,
                "error" : "Invalid email or password"
            })
        }
        const token = jwt.sign({ email: user.email, role : user.role, userId: user._id.toString()}, process.env.JWT_SECRET || 'nijeesh');
        res.status(200).json({
            "success" : true,
            "data" : {
                "token" : token
            }
        })
        
    }catch(error){
        res.status(500).json({
            "success" : false,
            "error" : "Internal server error"
        })
    }
});

app.get('/auth/me', authenticate, async(req, res) => {
    try {
        const user = await UserModel.findOne({ email: (req as any).user?.email });
        if (!user) {
            return res.status(401).json({
                "success": false,
                "error": "Unauthorized or invalid token"
            });
        }
        res.status(200).json({
            "success": true,
            "data": user
        });
    } catch (error) {
        res.status(401).json({
            "success": false,
            "error": "Unauthorized or invalid token"
        });
    }
});

app.post("/class", authenticate, teacherOnly, async (req, res) => {
    const parsedData = ClassSchema.safeParse(req.body);
    if(!parsedData.success){
        return res.status(400).json({
            "success" : false,
            "error" : "Invalid request schema"
        })
    }

    try{
        const newClass = new ClassModel({
            ...parsedData.data,
            teacherId: (req as any).user?.email
        });
        await newClass.save();
        res.status(201).json({
            "success" : true,
            "data" : newClass
        })
    }catch(error){
        res.status(500).json({
            "success" : false,
            "error" : "Internal server error"
        })
    }
});

app.post("/class/:id/add-student", authenticate, teacherOnly, async (req, res) => {
    const classId = req.params.id;
    const studentId = req.body.studentId;
    const userEmail = (req as any).user?.email;
    
    if (!studentId) {
        return res.status(400).json({
            "success": false,
            "error": "Invalid request schema"
        });
    }

    try{
        const classObj = await ClassModel.findById(classId);
        if(!classObj){
            return res.status(404).json({
                "success" : false,
                "error" : "Class not found"
            })
        }
        
        if (classObj.teacherId !== userEmail) {
            return res.status(403).json({
                "success": false,
                "error": "Forbidden"
            });
        }
        
        const student = await UserModel.findById(studentId);
        if (!student || student.role !== 'student') {
            return res.status(404).json({
                "success": false,
                "error": "Student not found"
            });
        }
        
        if (classObj.studentIds.includes(studentId)) {
            return res.status(200).json({
                "success": true,
                "data": classObj
            });
        }
        
        classObj.studentIds.push(studentId);
        await classObj.save();
        res.status(200).json({
            "success" : true,
            "data" : classObj
        })
    }catch(error){
        return res.status(500).json({
            "success" : false,
            "error" : "Internal server error"
        })
    }
});

app.get("/class/:id", authenticate, async (req, res) => {
    const classId = req.params.id;
    const userEmail = (req as any).user?.email;
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;
    
    try{
        const classObj = await ClassModel.findById(classId);
        if(!classObj){
            return res.status(404).json({
                "success" : false,
                "error" : "Class not found"
            })
        }
        
        if (userRole === 'teacher') {
            if (classObj.teacherId !== userEmail) {
                return res.status(403).json({
                    "success": false,
                    "error": "Forbidden"
                });
            }
        } else if (userRole === 'student') {
            if (!classObj.studentIds.includes(userId)) {
                return res.status(403).json({
                    "success": false,
                    "error": "Forbidden"
                });
            }
        }
        
        res.status(200).json({
            "success" : true,
            "data" : classObj
        })
    }catch(error){
        return res.status(500).json({
            "success" : false,
            "error" : "Internal server error"
        })
    }
});

app.get("/students", authenticate, teacherOnly, async(req, res) => {
    try{
        const studentObj = await UserModel.find({role : 'student'});
        res.status(200).json({
            "success" : true,
            "data" : studentObj
        })
    }catch(error){
        return res.status(500).json({
            "success" : false,
            "error" : "Internal server error"
        })
    }
});

app.get("/class/:id/my-attendance", authenticate, studentOnly, async(req, res) => {
    const classId = req.params.id;
    try{
        const attendObj = await AttendanceModel.findById(classId);
        res.status(200).json({
            "success" : true,
            "data" : attendObj
        })
    }catch{
        res.status(500).json({
            "success" : false,
            "error" : "Internal server error"
        })
    }
});

app.post("/attendance/start", authenticate, teacherOnly, async(req, res) => {
    const parsedData = AttendanceSchema.safeParse(req.body);
    const userEmail = (req as any).user?.email;

    if(!parsedData.success){
        return res.status(400).json({
            "success" : false,
            "error" : "Invalid request schema"
        })
    }
    try{
        const classObj = await ClassModel.findById(parsedData.data.classId);
        if(!classObj){
            return res.status(404).json({
                "success" : false,
                "error" : "Class not found"
            })
        }
        
        if (classObj.teacherId !== userEmail) {
            return res.status(403).json({
                "success": false,
                "error": "Forbidden"
            });
        }
        
        activeSession.classId = parsedData.data.classId.toString();
        activeSession.startedAt = new Date().toISOString();
        activeSession.attendance = {};
        
        classObj.studentIds.forEach(studentId => {
            activeSession.attendance[studentId] = 'absent';
        });

        res.status(200).json({
            "success" : true,
            "data" : activeSession
        })
    }catch(error){
        return res.status(500).json({
            "success" : false,
            "error" : "Internal server error"
        })
    }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', function connection(ws, request){
    const url = request.url;
    if(!url){
        ws.send(JSON.stringify({
            event: "ERROR",
            data: { message: "Unauthorized or invalid token" }
        }));
        ws.close();
        return;
    }

    const queryParams = new URLSearchParams(url.split('?')[1]);
    const token = queryParams.get('token') || '';
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'nijeesh');
    } catch (err) {
        ws.send(JSON.stringify({
            event: "ERROR",
            data: { message: "Unauthorized or invalid token" }
        }));
        ws.close();
        return;
    }

    ws.user = {
        email: (decoded as {email: string}).email,
        role: (decoded as {role: 'student' | 'teacher'}).role,
        userId: (decoded as {userId: string}).userId,
    }

    ws.on('message', async function message(data){
        let parsedData;
        try {
            parsedData = JSON.parse(data as unknown as string);
        } catch {
            ws.send(JSON.stringify({
                event: "ERROR",
                data: { message: "Invalid message format" }
            }));
            return;
        }

        if(['ATTENDANCE_MARKED', 'TODAY_SUMMARY', 'DONE'].includes(parsedData.event) && ws.user?.role !== 'teacher'){
            ws.send(JSON.stringify({
                event: "ERROR",
                data: { message: "Forbidden, teacher event only" }
            }));
            return;
        }

        if(['MY_ATTENDANCE'].includes(parsedData.event) && ws.user?.role !== 'student'){
            ws.send(JSON.stringify({
                event: "ERROR",
                data: { message: "Forbidden, student event only" }
            }));
            return;
        }

        if(ws.user?.role === 'teacher'){
            if(parsedData.event === 'ATTENDANCE_MARKED'){
                const {studentId, status} = parsedData.data;
                if(!activeSession.classId){
                    ws.send(JSON.stringify({
                        event: "ERROR",
                        data: { message: "No active attendance session" }
                    }));
                    return;
                }
                if(activeSession.attendance.hasOwnProperty(studentId)){
                    activeSession.attendance[studentId] = status;

                    wss.clients.forEach(client => {
                        if(client.readyState === WebSocket.OPEN){
                            client.send(JSON.stringify({
                                event : "ATTENDANCE_MARKED",
                                data: {
                                    studentId,
                                    status
                                }
                            }))
                        }
                    })
                }
            }

            if(parsedData.event === 'TODAY_SUMMARY'){
                if(!activeSession.classId){
                    ws.send(JSON.stringify({
                        event: "ERROR",
                        data: { message: "No active attendance session" }
                    }));
                    return;
                }
                
                const present = Object.values(activeSession.attendance).filter(s => s === 'present').length;
                const absent = Object.values(activeSession.attendance).filter(s => s === 'absent').length;
                const total = Object.keys(activeSession.attendance).length;
                
                wss.clients.forEach(client => {
                    if(client.readyState === WebSocket.OPEN){
                        client.send(JSON.stringify({
                            event : "TODAY_SUMMARY",
                            data: {
                                present,
                                absent,
                                total
                            }
                        }))
                    }
                })
            }

            if(parsedData.event === 'DONE'){
                if(!activeSession.classId){
                    ws.send(JSON.stringify({
                        event: "ERROR",
                        data: { message: "No active attendance session" }
                    }));
                    return;
                }
                try{
                    const attendanceRecords = Object.entries(activeSession.attendance).map(([studentId, status]) => ({
                        classId : activeSession.classId,
                        studentId,
                        status
                    }));

                    await AttendanceModel.insertMany(attendanceRecords);

                    activeSession.classId = "";
                    activeSession.startedAt = "";
                    activeSession.attendance = {};

                    wss.clients.forEach(client => {
                        if(client.readyState === WebSocket.OPEN){
                            client.send(JSON.stringify({
                                event : "DONE",
                                data:{
                                    success: true,
                                    message: "Attendance data persisted successfully",
                                    present: attendanceRecords.filter(record => record.status === 'present').length,
                                    absent: attendanceRecords.filter(record => record.status === 'absent').length,
                                    total: attendanceRecords.length 
                                }
                            }))
                        }
                    })

                }catch(error){
                    wss.clients.forEach(client => {
                        if(client.readyState === WebSocket.OPEN){
                            client.send(JSON.stringify({
                                event: "DONE",
                                data:{
                                    success: false,
                                    message: "Failed to persist data"
                                }
                            }))
                        }
                    })
                }
            }
        }
        
        if(ws.user?.role === 'student'){
            const userId = ws.user?.userId;
            if(parsedData.event === 'MY_ATTENDANCE'){
                if(!activeSession.classId){
                    ws.send(JSON.stringify({
                        event: "ERROR",
                        data: { message: "No active attendance session" }
                    }));
                    return;
                }
                const status = activeSession.attendance[userId] || 'not yet updated';

                ws.send(JSON.stringify({
                    event: 'MY_ATTENDANCE',
                    data: { status }
                }))
            }
        }

        if(!['ATTENDANCE_MARKED', 'TODAY_SUMMARY', 'DONE', 'MY_ATTENDANCE'].includes(parsedData.event)){
            ws.send(JSON.stringify({
                event: 'ERROR',
                data: { message: 'Unknown event' }
            }));
        }
    })

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
})

server.listen(3000, () => {
    console.log("Express server started on port 3000");
    console.log("WebSocket server running on ws://localhost:3000");
});