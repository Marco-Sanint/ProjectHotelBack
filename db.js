const sqlite3 = require("sqlite3").verbose();
const bcrypt = require('bcrypt');

const DB_PATH = './hotel.db';
const SALT_ROUNDS = 10;
const ADMIN_EMAIL = "admin@hotel.com";
const ADMIN_PASSWORD = "hola123"; 

const dbHotel = new sqlite3.Database(DB_PATH, (err) => {
    if (err) console.error("Error BD hotel:", err.message);
    else console.log("✅ Conectado a hotel.db");
});

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

const initializeDatabase = () => {
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

        dbHotel.get("SELECT COUNT(*) AS count FROM usuarios WHERE rol = 'admin'", async (err, row) => {
            if (err) return console.error("Error al verificar admin:", err.message);
            
            if (row.count === 0) {
                try {
                    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
                    const sql = `INSERT INTO usuarios (email, telefono, nombre, contraseña, rol) VALUES (?, ?, ?, ?, ?)`;
                    
                    dbHotel.run(sql, [ADMIN_EMAIL, "555-1234", "Admin Master", hashedPassword, "admin"], function(insertErr) {
                        if (insertErr) console.error("Error al crear administrador inicial:", insertErr.message);
                        else console.log(`✅ Administrador inicial creado.`);
                    });
                } catch (e) {
                    console.error("Error en bcrypt:", e);
                }
            }
        });
    });
};

module.exports = {
    dbHotel,
    dbGet, 
    dbAll, 
    dbRun,
    initializeDatabase,
    SALT_ROUNDS
};