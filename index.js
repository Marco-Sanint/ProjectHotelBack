// index.js
const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bcrypt = require('bcrypt');

const userRoutes = require('./routes/users');
const roomRoutes = require('./routes/rooms');
const reservationRoutes = require('./routes/reservations');

const app = express();
const PORT = 3000;
const SECRET_KEY = "hotelTrivago";
const SALT_ROUNDS = 10; 

const dbHotel = new sqlite3.Database('./hotel.db', (err) => {
    if (err) console.error("Error BD hotel:", err.message);
    else console.log("Conectado a hotel.db");
});

dbHotel.serialize(() => {
    dbHotel.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        telefono TEXT NOT NULL,
        nombre TEXT NOT NULL,
        contraseña TEXT NOT NULL,
        rol TEXT DEFAULT 'cliente'
    )`);
    dbHotel.run(`CREATE TABLE IF NOT EXISTS habitaciones (
        id INTEGER PRIMARY KEY,
        numero TEXT UNIQUE NOT NULL,
        tipo TEXT NOT NULL,
        precio_noche REAL NOT NULL,
        caracteristicas_json TEXT,
        imagenes_json TEXT,
        descripcion TEXT, 
        disponible INTEGER DEFAULT 1
    )`);
    dbHotel.run(`CREATE TABLE IF NOT EXISTS reservas (
        id INTEGER PRIMARY KEY,
        habitacionId INTEGER NOT NULL,
        usuarioId INTEGER NOT NULL,
        fecha_inicio TEXT NOT NULL,
        fecha_fin TEXT NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        precio_total REAL NOT NULL,
        FOREIGN KEY(habitacionId) REFERENCES habitaciones(id) ON DELETE RESTRICT,
        FOREIGN KEY(usuarioId) REFERENCES usuarios(id) ON DELETE RESTRICT
    )`);
});

app.use(cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const dbGet = (sql, params) => new Promise((resolve, reject) => {
    dbHotel.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
    });
});
const dbAll = (sql, params) => new Promise((resolve, reject) => {
    dbHotel.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
    });
});
const dbRun = (sql, params) => new Promise((resolve, reject) => {
    dbHotel.run(sql, params, function(err) {
        if (err) return reject(err);
        resolve(this);
    });
});

const verificarToken = (req, res, next) => {
    const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Acceso denegado. Token requerido." });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(403).json({ error: "Token inválido o expirado." });
        req.user = decoded;
        next();
    });
};

const soloAdmin = (req, res, next) => {
    if (req.user && req.user.rol === 'admin') {
        next();
    } else {
        res.status(403).json({ error: "Acceso denegado. Solo para administradores." });
    }
};

const soloPersonal = (req, res, next) => {
    if (req.user && req.user.rol === 'admin' || req.user && req.user.rol === 'recepcionista') {
        next();
    } else {
        res.status(403).json({ error: "Acceso denegado. Solo para personal." });
    }
};

app.use('/users', userRoutes({ dbGet, dbRun, dbAll, verificarToken, soloAdmin, SECRET_KEY, bcrypt, SALT_ROUNDS }));
app.use('/rooms', roomRoutes({ dbGet, dbRun, dbAll, verificarToken, soloAdmin }));
app.use('/reservations', reservationRoutes({ dbGet, dbRun, dbAll, verificarToken, soloPersonal, soloAdmin }));

app.get("/", (req, res) => {
    res.send("¡Bienvenido al Backend del Hotel! 🏨 Servidor corriendo.");
});

app.listen(PORT, () => {
    console.log(`Servidor de Hotel corriendo en http://localhost:${PORT}`);
});