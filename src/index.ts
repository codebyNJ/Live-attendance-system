import express from 'express';
import jwt from 'jsonwebtoken';
import { AttendanceSchema, ClassSchema, UserSchema } from './types/types.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { authenticate, studentOnly, teacherOnly } from './middleware.js';
import WebSocket, { WebSocketServer } from 'ws';

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
        console.log("invalid data")
        return res.status(400).json({
            "success" : false,
            "message" : "Invalid payload"
        })
    }
    
    console.log("User data is valid:", parsedData.data);

    try{
        const newUser = new UserModel(parsedData.data);
        await newUser.save();
        res.status(201).json({
            "success" : true,
            "data" : newUser
        })
    }catch(error){
        res.status(500).json({
            "success" : false,
            "message" : "Internal server error"
        })
    }
});

app.post('/auth/login', async(req, res) => {
    const parsedData = UserSchema.pick({email:true, password:true}).safeParse(req.body);
    if(!parsedData.success){
        console.log("invalid data")
        return res.status(400).json({
            "success" : false,
            "message" : "invalid email or password"
        })
    }
    console.log("Login data is valid:", parsedData.data);
    try{
        const user = await UserModel.findOne({
            email : parsedData.data.email        
        })
        if(!user){
            return res.status(404).json({
                "success" : false,
                "message" : "user not found"
            })
        }
        const isPasswordValid = user.password === parsedData.data.password;
        if(!isPasswordValid){
            return res.status(401).json({
                "success" : false,
                "message" : "invalid password"
            })
        }
        const token = jwt.sign({ email: user.email, role : user.role}, process.env.JWT_SECRET || 'nijeesh');
        res.status(200).json({
            "success" : true,
            "data" : {
                "token" : token
            }
        })
        
    }catch(error){
        res.status(500).json({
            "success" : false,
            "message" : "Internal server error"
        })
    }
});

app.post("/class", authenticate, teacherOnly, async (req, res) => {
    const parsedData = ClassSchema.safeParse(req.body);
    if(!parsedData.data?.className){
        res.status(400).json({
            "status" : false,
            "message" : "Invalid payload"
        })
    }
    console.log("Class data is valid:", parsedData.data);

    try{
        const newClass = new ClassModel(parsedData.data);
        await newClass.save();
        res.status(201).json({
            "status" : true,
            "data" : newClass
        })
    }catch(error){
        res.status(500).json({
            "status" : false,
            "message" : "Internal server error"
        })
    }
});

app.post("/class/:id/add-student", authenticate, teacherOnly, async (req, res) => {
    const classId = req.params.id;
    const studentId = req.body.studentId;
    try{
        const classObj = await ClassModel.findById(classId);
        if(!classObj){
            return res.status(404).json({
                "status" : false,
                "message" : "class not found"
            })
        }
        classObj.studentIds.push(studentId);
        await classObj.save();
        res.status(200).json({
            "status" : true,
            "data" : classObj
        })
    }catch(error){
        return res.status(500).json({
            "status" : false,
            "message" : "internal server error"
        })
    }
});

app.get("/class/:id", authenticate, async (req, res) => {
    const classId = req.params.id;
    try{
        const classObj = await ClassModel.findById(classId);
        if(!classObj){
            return res.status(404).json({
                "status" : false,
                "message" : "class not found"
            })
        }
        res.status(200).json({
            "status" : true,
            "data" : classObj
        })
    }catch(error){
        return res.status(500).json({
            "status" : false,
            "message" : "internal server error"
        })
    }
});

app.get("/students", authenticate, teacherOnly, async(req, res) => {
    try{
        const studentObj = await UserModel.find({role : 'student'});
        res.status(200).json({
            "status" : true,
            "data" : studentObj
        })
    }catch(error){
        return res.status(500).json({
            "status" : false,
            "message" : "internal server error"
        })
    }
});

app.get("/class/:id/my-attendance", authenticate, studentOnly, async(req, res) => {
    const classId = req.params.id;
    try{
        const attendObj = await AttendanceModel.findById(classId);
        res.status(200).json({
            "status" : true,
            "data" : attendObj
        })
    }catch{
        res.status(500).json({
            "status" : false,
            "message" : "internal server error"
        })
    }
});

app.post("/attendance/start", authenticate, teacherOnly, async(req, res) => {
    const parsedData = AttendanceSchema.safeParse(req.body);

    if(!parsedData.success){
        return res.status(400).json({
            "status" : false,
            "message" : "Invalid payload"
        })
    }
    try{
        const classObj = await ClassModel.findById(parsedData.data.classId);
        if(!classObj){
            return res.status(404).json({
                "status" : false,
                "message" : "class not found"
            })
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
            "status" : false,
            "message" : "internal server error"
        })
    }

});

app.listen(3000, () => {
    console.log("Server started on port 3000");
});


const wss = new WebSocketServer({ port: 8080 });


wss.on('connection', function connection(ws, request){
    const url = request.url;
    if(!url){
        return;
    }

    const queryParams = new URLSearchParams(url.split('?')[1]);
    const token = queryParams.get('token') || '';
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'nijeesh');
    } catch (err) {
        ws.close();
        return;
    }

    ws.user = {
        email: (decoded as {email: string}).email,
        role: (decoded as {role: 'student' | 'teacher'}).role,
    }

    ws.on('message', function message(data){
        const parsedData = JSON.parse(data as unknown as string);
        console.log('received: %s', parsedData);

        if(ws.user?.role === 'teacher'){
            if(parsedData.event === 'ATTENDANCE_MARKED'){
                const {studentId, status} = parsedData.data;
                if(activeSession.classId && activeSession.attendance[studentId]){
                    activeSession.attendance[studentId] = status;

                    wss.clients.forEach(client => {
                        if(client.readyState === WebSocket.OPEN){
                            client.send(JSON.stringify({
                                event : "ATTENDANCE_MARKED",
                                data: activeSession
                            }))
                        }
                    })
                }
            }

            if(parsedData.event === 'TODAY_SUMMARY'){
                const summary = activeSession.attendance;
                wss.clients.forEach(client => {
                    if(client.readyState === WebSocket.OPEN){
                        client.send(JSON.stringify({
                            event : "TODAY_SUMMARY",
                            data: summary
                        }))
                    }
                })
            }

            if(parsedData.event === 'DONE'){
                try{
                    const attendanceRecords = Object.entries(activeSession.attendance).map(([studentId, status]) => ({
                        classId : activeSession.classId,
                        studentId,
                        status
                    }));

                    AttendanceModel.insertMany(attendanceRecords);

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
                                    message: "Failed to presist data"
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
                const data = userId ? activeSession.attendance[userId] : undefined;

                wss.clients.forEach(client => {
                    if(client.readyState === WebSocket.OPEN){
                        client.send(JSON.stringify({
                            event: 'MY_ATTENDANCE',
                            data: data
                        }))
                    }
                })
            }
        }

    })
})