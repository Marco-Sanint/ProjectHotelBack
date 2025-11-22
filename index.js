//index.js
const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const bcrypt = require('bcrypt');

const { dbGet, dbRun, dbAll, initializeDatabase, SALT_ROUNDS } = require('./db');
const userRoutes = require('./routes/users');
const roomRoutes = require('./routes/rooms');
const reservationRoutes = require('./routes/reservations');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = 3000;
const SECRET_KEY = "hotelTrivago";

initializeDatabase();

app.use(cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const { verificarToken, soloAdmin, soloPersonal } = authMiddleware(SECRET_KEY, jwt);

app.use('/users', userRoutes({ dbGet, dbRun, dbAll, verificarToken, soloAdmin, SECRET_KEY, bcrypt, SALT_ROUNDS }));
app.use('/rooms', roomRoutes({ dbGet, dbRun, dbAll, verificarToken, soloAdmin }));
app.use('/reservations', reservationRoutes({ dbGet, dbRun, dbAll, verificarToken, soloAdmin, soloPersonal }));

app.get("/", (req, res) => {
    res.send("¡Bienvenido al Backend del Hotel! 🏨 Servidor corriendo.");
});

app.listen(PORT, () => {
    console.log(`Servidor de Hotel corriendo en http://localhost:${PORT}`);
});















