const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const bcrypt = require('bcrypt'); // Necesario solo para inicializar o pasar a rutas

// 1. Importaciones del Setup
const { dbGet, dbRun, dbAll, initializeDatabase, SALT_ROUNDS } = require('./db');
const userRoutes = require('./routes/users');
const roomRoutes = require('./routes/rooms');
const reservationRoutes = require('./routes/reservations');
const paymentRoutes = require('./routes/payments');
const authMiddleware = require('./middleware/auth'); // ⬅️ Nuevo: Mover Middlewares

const app = express();
const PORT = 3000;
const SECRET_KEY = "hotelTrivago"; // Mantener variables de entorno aquí o en .env

// 2. Inicializar la base de datos
initializeDatabase();

// 3. Middlewares Globales
app.use(cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// 4. Mover y Aplicar Middlewares de Autenticación/Autorización
// Usa la función que requiere la llave secreta para crear los middlewares
const { verificarToken, soloAdmin } = authMiddleware(SECRET_KEY, jwt);

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
app.use('/payments', paymentRoutes({ dbGet, dbRun, dbAll, verificarToken, soloPersonal }));

// 6. Ruta Raíz
app.get("/", (req, res) => {
    res.send("¡Bienvenido al Backend del Hotel! 🏨 Servidor corriendo.");
});

// 7. Arrancar Servidor
app.listen(PORT, () => {
    console.log(`Servidor de Hotel corriendo en http://localhost:${PORT}`);
});