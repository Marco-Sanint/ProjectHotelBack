// routes/reservations.js
const express = require('express');

module.exports = ({ dbGet, dbRun, dbAll, verificarToken, soloPersonal, soloAdmin }) => {
    const router = express.Router();

    // --- RUTAS DE RESERVAS (CLIENTE) (/reservations) ---

    // POST /reservations
    router.post("/", verificarToken, async (req, res) => {
        const { habitacionId, fecha_inicio, fecha_fin } = req.body;
        const usuarioId = req.user.id;

        if (!habitacionId || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: "Campos de reserva requeridos." });

        try {
            const roomInfo = await dbGet("SELECT * FROM habitaciones WHERE id = ?", [habitacionId]);
            if (!roomInfo || roomInfo.disponible === 0) return res.status(404).json({ error: "Habitación no disponible." });

            const inicio = new Date(fecha_inicio);
            const fin = new Date(fecha_fin);
            const diffTime = Math.abs(fin - inicio);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) return res.status(400).json({ error: "Fechas inválidas." });

            const precio_total = roomInfo.precio_noche * diffDays;

            const reservationResult = await dbRun(
                `INSERT INTO reservas (habitacionId, usuarioId, fecha_inicio, fecha_fin, precio_total, estado) VALUES (?, ?, ?, ?, ?, 'confirmada')`,
                [habitacionId, usuarioId, fecha_inicio, fecha_fin, precio_total]
            );

            res.json({ mensaje: "Reserva creada con éxito.", id: reservationResult.lastID, precio_total });

        } catch (error) {
            console.error("Error en la creación de reserva:", error);
            res.status(500).json({ error: "Error al procesar la reserva." });
        }
    });

    // GET /reservations/my
    router.get("/my", verificarToken, async (req, res) => {
        const usuarioId = req.user.id;
        try {
            const rows = await dbAll("SELECT * FROM reservas WHERE usuarioId = ? ORDER BY fecha_inicio DESC", [usuarioId]);
            res.json({ reservas: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener tus reservas." });
        }
    });


    // --- RUTAS DE ADMINISTRACIÓN DE RESERVAS (/reservations/admin) ---

    // GET /reservations - Ver todas las reservas
    router.get("/", verificarToken, soloPersonal, async (req, res) => {
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
            const rows = await dbAll(sql, []);
            res.json({ reservas: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener todas las reservas." });
        }
    });

    // GET /reservations/:userId - Buscar por ID de Usuario
    router.get("/:userId", verificarToken, soloPersonal, async (req, res) => {
        const { userId } = req.params;
        try {
            const sql = `
                SELECT 
                    r.*, 
                    u.nombre AS nombre_usuario, 
                    h.numero AS numero_habitacion
                FROM reservas r
                JOIN usuarios u ON r.usuarioId = u.id
                JOIN habitaciones h ON r.habitacionId = h.id
                WHERE r.usuarioId = ?
                ORDER BY r.fecha_inicio DESC
            `;
            const rows = await dbAll(sql, [userId]);
            res.json({ reservas: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener reservas por usuario." });
        }
    });

    // GET /reservations/room/:roomId - Buscar por ID de Habitación
    router.get("/:roomId", verificarToken, soloPersonal, async (req, res) => {
        const { roomId } = req.params;
        try {
            const sql = `
                SELECT 
                    r.*, 
                    u.nombre AS nombre_usuario, 
                    h.numero AS numero_habitacion
                FROM reservas r
                JOIN usuarios u ON r.usuarioId = u.id
                JOIN habitaciones h ON r.habitacionId = h.id
                WHERE r.habitacionId = ?
                ORDER BY r.fecha_inicio DESC
            `;
            const rows = await dbAll(sql, [roomId]);
            res.json({ reservas: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener reservas por habitación." });
        }
    });

    // PUT /reservations/:id - Editar reserva
    router.put("/:id", verificarToken, soloPersonal, async (req, res) => {
        const { id } = req.params;
        const { fecha_inicio, fecha_fin, estado, habitacionId } = req.body;

        if (!fecha_inicio || !fecha_fin || !estado || !habitacionId) {
            return res.status(400).json({ error: "Fecha de inicio, fecha de fin, estado y ID de habitación son obligatorios." });
        }

        try {
            const result = await dbRun(
                "UPDATE reservas SET habitacionId = ?, fecha_inicio = ?, fecha_fin = ?, estado = ? WHERE id = ?",
                [habitacionId, fecha_inicio, fecha_fin, estado, id]
            );

            if (result.changes === 0) return res.status(404).json({ error: "Reserva no encontrada o sin cambios realizados." });
            res.json({ mensaje: `Reserva con ID ${id} actualizada a estado: ${estado}.` });

        } catch (error) {
            console.error("Error al actualizar reserva:", error);
            res.status(500).json({ error: "Error al actualizar la reserva." });
        }
    });

    // DELETE /reservations/:id - Eliminar reserva
    router.delete("/:id", verificarToken, soloPersonal, async (req, res) => {
        const { id } = req.params;
        try {
            const result = await dbRun("DELETE FROM reservas WHERE id = ?", [id]);
            if (result.changes === 0) return res.status(404).json({ error: "Reserva no encontrada." });
            res.json({ mensaje: `Reserva con ID ${id} eliminada.` });
        } catch (err) {
            console.error("Error al eliminar reserva:", err);
            res.status(500).json({ error: "Error al eliminar la reserva." });
        }
    });

    return router;
};