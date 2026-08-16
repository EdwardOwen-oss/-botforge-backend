import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const app = express();

// 1. Establish path names manually for modern ES module scopes
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. Open CORS completely to allow your Netlify domain to connect
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 3. Database Layer Setup
const DB_FILE = path.join(__dirname, '../data/db.json');
const ensureDbExists = () => {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], bots: [] }, null, 2));
};
ensureDbExists();

// 4. Central Route
app.get('/', (req, res) => {
    res.json({ status: "online", message: "BotForge Backend API running on ESM!" });
});

// 5. Authentication API Routes
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

// 6. Bind to 0.0.0.0 and process.env.PORT for Render compliance
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully deployed and running on port ${PORT}`);
});
