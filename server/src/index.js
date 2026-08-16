import express from 'express';
import cors from 'cors';

const app = express();

// 1. Open CORS parameters fully for external verification
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 2. FIXED: In-memory arrays bypass the file system entirely to prevent writing permissions blocks
const usersDatabase = [];
const activeBotsTracker = [];

// 3. Central Web Route
app.get('/', (req, res) => {
    res.json({ status: "online", message: "BotForge Live Array System Active!" });
});

// 4. Registration API Endpoint
app.post('/api/auth/register', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Missing tracking credentials" });
        
        // Search inside the in-memory array
        if (usersDatabase.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            return res.status(400).json({ error: "User profile already registered" });
        }
        
        const newUser = { id: Date.now().toString(), username, password };
        usersDatabase.push(newUser);
        
        console.log(`Successfully registered new user container: ${username}`);
        res.status(201).json({ success: true, user: { id: newUser.id, username: newUser.username } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Login API Endpoint
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = usersDatabase.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
        
        if (!user) return res.status(401).json({ error: "Invalid username or password match" });
        res.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Bind configuration vectors to Render ports
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Array runtime system listening directly on port ${PORT}`);
});
