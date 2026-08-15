const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// 1. FIXED: Open CORS completely to allow your Netlify domain to connect seamlessly
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 2. Mock Database Structure (Replace with your custom db logic if needed)
const DB_FILE = path.join(__dirname, '../data/db.json');
const ensureDbExists = () => {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], bots: [] }, null, 2));
};
ensureDbExists();

// 3. Central Landing Route (Bypasses the "Cannot GET /" screen with a clean message)
app.get('/', (req, res) => {
    res.json({ status: "online", message: "BotForge Backend API is running smoothly!" });
});

// 4. Standard Authentication API Routes
app.post('/api/auth/register', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Missing fields" });
        
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (db.users.find(u => u.username === username)) return res.status(400).json({ error: "User already exists" });
        
        const newUser = { id: Date.now().toString(), username, password };
        db.users.push(newUser);
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
        
        res.status(201).json({ success: true, user: { id: newUser.id, username: newUser.username } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        const user = db.users.find(u => u.username === username && u.password === password);
        
        if (!user) return res.status(401).json({ error: "Invalid credentials" });
        res.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Discord Bot Deployment Manager Route Placeholder
app.post('/api/bots/deploy', (req, res) => {
    const { token, template, userId } = req.body;
    if (!token) return res.status(400).json({ error: "Discord token required" });
    
    // Log intent to console for validation tracking in Render logs
    console.log(`Attempting dynamic bot launch for user ${userId} with template ${template}`);
    
    // Standard successful initialization mock back to frontend UI dashboard
    res.json({ success: true, message: "Bot initializing process launched successfully." });
});

// 6. FIXED: Bind to 0.0.0.0 and process.env.PORT to satisfy Render network requirements
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully deployed and running on port ${PORT}`);
});
