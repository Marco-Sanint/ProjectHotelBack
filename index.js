const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;
const SECRET_KEY = "hotelTrivago";
const SALT_ROUNDS = 10; 

const dbHotel = new sqlite3.Database('./hotel.db', (err) => {
    if (err) console.error("Error BD hotel:", err.message);
    else console.log("Conectado a hotel.db");
});

dbHotel.serialize(() => {
    // Tabla usuarios
    dbHotel.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        telefono TEXT NOT NULL,
        nombre TEXT NOT NULL,
        contraseña TEXT NOT NULL,
        rol TEXT DEFAULT 'cliente'
    )`);

    // Tabla habitaciones
    dbHotel.run(`CREATE TABLE IF NOT EXISTS habitaciones (
        id INTEGER PRIMARY KEY,
        numero TEXT UNIQUE NOT NULL,
        tipo TEXT NOT NULL,
        precio_noche REAL NOT NULL,
        descripcion TEXT,
        disponible INTEGER DEFAULT 1
    )`);

    // Tabla reservas
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

const dbGet = (db, sql, params) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
    });
});
const dbAll = (db, sql, params) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
    });
});
const dbRun = (db, sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
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

app.post("/register", async (req, res) => {
    const { email, telefono, nombre, contraseña } = req.body;
    if (!email || !telefono || !nombre || !contraseña) {
        return res.status(400).json({ error: "Todos los campos (email, teléfono, nombre y contraseña) son obligatorios." });
    }

    try {
        const existingUser = await dbGet(dbHotel, "SELECT * FROM usuarios WHERE email = ?", [email]);
        if (existingUser) return res.status(409).json({ error: "Correo ya registrado." });

        const hashedPassword = await bcrypt.hash(contraseña, SALT_ROUNDS);

        await dbRun(
            dbHotel,
            "INSERT INTO usuarios (email, telefono, nombre, contraseña, rol) VALUES (?, ?, ?, ?, 'cliente')",
            [email, telefono, nombre, hashedPassword]
        );
        res.json({ mensaje: `Registro exitoso, ${nombre}! Por favor, inicia sesión.` });

    } catch (error) {
        console.error("Error al registrar:", error);
        res.status(500).json({ error: "Error interno al procesar el registro." });
    }
});

app.post("/login", async (req, res) => {
    const { email, contraseña } = req.body;
    if (!email || !contraseña) return res.status(400).json({ error: "Email y contraseña requeridos." });

    try {
        const user = await dbGet(dbHotel, "SELECT * FROM usuarios WHERE email = ?", [email]);
        if (!user) return res.status(401).json({ error: "Credenciales incorrectas." });

        const match = await bcrypt.compare(contraseña, user.contraseña);
        if (!match) return res.status(401).json({ error: "Credenciales incorrectas." });

        const payload = { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol };
        const token = jwt.sign(payload, SECRET_KEY, { expiresIn: "8h" });

        res.cookie("token", token, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production', 
            maxAge: 8 * 3600000,
            sameSite: 'Lax'
        });

        res.json({ mensaje: "Login exitoso", usuario: payload });

    } catch (error) {
        console.error("Error en el login:", error);
        res.status(500).json({ error: "Error en el servidor." });
    }
});

app.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ mensaje: "Sesión cerrada con éxito." });
});

app.get("/rooms", async (req, res) => {
    const { disponible } = req.query;
    let sql = "SELECT * FROM habitaciones";
    const params = [];

    if (disponible !== undefined) {
        sql += " WHERE disponible = ?";
        params.push(disponible === 'true' || disponible === '1' ? 1 : 0);
    }

    try {
        const rows = await dbAll(dbHotel, sql, params);
        res.json({
            habitaciones: rows.map(r => ({ ...r, disponible: r.disponible === 1 }))
        });
    } catch (err) {
        res.status(500).json({ error: "Error al obtener habitaciones." });
    }
});

app.get("/room/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const row = await dbGet(dbHotel, "SELECT * FROM habitaciones WHERE id = ?", [id]);
        if (!row) return res.status(404).json({ error: "Habitación no encontrada." });

        res.json({ habitacion: { ...row, disponible: row.disponible === 1 } });
    } catch (err) {
        res.status(500).json({ error: "Error al buscar habitación." });
    }
});

app.post("/reservations", verificarToken, async (req, res) => {
    const { habitacionId, fecha_inicio, fecha_fin } = req.body;
    const usuarioId = req.user.id;

    if (!habitacionId || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: "Campos de reserva requeridos." });

    try {
        const roomInfo = await dbGet(dbHotel, "SELECT * FROM habitaciones WHERE id = ?", [habitacionId]);
        if (!roomInfo || roomInfo.disponible === 0) return res.status(404).json({ error: "Habitación no disponible." });

        const inicio = new Date(fecha_inicio);
        const fin = new Date(fecha_fin);
        const diffTime = Math.abs(fin - inicio);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) return res.status(400).json({ error: "Fechas inválidas." });

        const precio_total = roomInfo.precio_noche * diffDays;

        const reservationResult = await dbRun(
            dbHotel,
            `INSERT INTO reservas (habitacionId, usuarioId, fecha_inicio, fecha_fin, precio_total, estado) VALUES (?, ?, ?, ?, ?, 'confirmada')`,
            [habitacionId, usuarioId, fecha_inicio, fecha_fin, precio_total]
        );

        res.json({ mensaje: "Reserva creada con éxito.", id: reservationResult.lastID, precio_total });

    } catch (error) {
        console.error("Error en la creación de reserva:", error);
        res.status(500).json({ error: "Error al procesar la reserva." });
    }
});

app.get("/reservations/my", verificarToken, async (req, res) => {
    const usuarioId = req.user.id;
    try {
        const rows = await dbAll(dbHotel, "SELECT * FROM reservas WHERE usuarioId = ? ORDER BY fecha_inicio DESC", [usuarioId]);
        res.json({ reservas: rows });
    } catch (err) {
        res.status(500).json({ error: "Error al obtener tus reservas." });
    }
});

app.post("/admin/rooms", verificarToken, soloAdmin, async (req, res) => {
    const { numero, tipo, precio_noche, descripcion } = req.body;
    if (!numero || !tipo || !precio_noche) return res.status(400).json({ error: "Número, tipo y precio son obligatorios." });

    try {
        const result = await dbRun(
            dbHotel,
            "INSERT INTO habitaciones (numero, tipo, precio_noche, descripcion) VALUES (?, ?, ?, ?)",
            [numero, tipo, precio_noche, descripcion]
        );
        res.status(201).json({ mensaje: "Habitación creada.", id: result.lastID });
    } catch (error) {
        console.error("Error al crear habitación:", error);
        res.status(500).json({ error: "Error al crear la habitación." });
    }
});

app.get("/admin/reservations", verificarToken, soloAdmin, async (req, res) => {
    try {
        
        const sql = `
            SELECT 
                r.*, 
                u.nombre AS nombre_usuario, 
                u.email AS email_usuario,
                h.numero AS numero_habitacion
            FROM reservas r
            JOIN usuarios u ON r.usuarioId = u.id
            JOIN habitaciones h ON r.habitacionId = h.id
            ORDER BY r.fecha_inicio DESC
        `;
        const rows = await dbAll(dbHotel, sql, []);
        res.json({ reservas: rows });
    } catch (err) {
        res.status(500).json({ error: "Error al obtener todas las reservas." });
    }
});


app.get("/", (req, res) => {
    res.send("¡Bienvenido al Backend del Hotel! 🏨 Servidor corriendo.");
});

app.listen(PORT, () => {
    console.log(`Servidor de Hotel corriendo en http://localhost:${PORT}`);
    console.log(`\n¡RECUERDA! Debes instalar la librería bcrypt para que el registro y login funcionen de forma segura: npm install bcrypt`);
});