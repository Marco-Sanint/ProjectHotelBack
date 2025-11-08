// routes/rooms.js
const express = require('express');

module.exports = ({ dbGet, dbRun, dbAll, verificarToken, soloAdmin }) => {
    const router = express.Router();

    // --- RUTAS PÚBLICAS DE HABITACIONES (/rooms) ---

    // GET /rooms - Obtener todas las habitaciones (con filtro)
    router.get("/", async (req, res) => {
        const { disponible } = req.query;
        let sql = "SELECT * FROM habitaciones";
        const params = [];

        if (disponible !== undefined) {
            sql += " WHERE disponible = ?";
            params.push(disponible === 'true' || disponible === '1' ? 1 : 0);
        }

        try {
            const rows = await dbAll(sql, params);
            res.json({
                habitaciones: rows.map(r => ({ ...r, disponible: r.disponible === 1 }))
            });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener habitaciones." });
        }
    });

    // GET /rooms/:id - Obtener una habitación por ID
    router.get("/:id", async (req, res) => {
        const { id } = req.params;
        try {
            const row = await dbGet("SELECT * FROM habitaciones WHERE id = ?", [id]);
            if (!row) return res.status(404).json({ error: "Habitación no encontrada." });

            res.json({ habitacion: { ...row, disponible: row.disponible === 1 } });
        } catch (err) {
            res.status(500).json({ error: "Error al buscar habitación." });
        }
    });


    // --- RUTAS DE ADMINISTRACIÓN DE HABITACIONES (/rooms/admin) ---

    // POST /rooms/admin - Crear habitación
    router.post("/admin", verificarToken, soloAdmin, async (req, res) => {
        const { numero, tipo, precio_noche, descripcion } = req.body;
        if (!numero || !tipo || !precio_noche) return res.status(400).json({ error: "Número, tipo y precio son obligatorios." });

        try {
            const result = await dbRun(
                "INSERT INTO habitaciones (numero, tipo, precio_noche, descripcion) VALUES (?, ?, ?, ?)",
                [numero, tipo, precio_noche, descripcion]
            );
            res.status(201).json({ mensaje: "Habitación creada.", id: result.lastID });
        } catch (error) {
            console.error("Error al crear habitación:", error);
            res.status(500).json({ error: "Error al crear la habitación. El número podría estar duplicado." });
        }
    });

    // GET /rooms/admin - Obtener todas las habitaciones (Admin, sin filtro)
    router.get("/admin", verificarToken, soloAdmin, async (req, res) => {
        try {
            const rows = await dbAll("SELECT * FROM habitaciones", []);
            res.json({
                habitaciones: rows.map(r => ({ ...r, disponible: r.disponible === 1 }))
            });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener habitaciones." });
        }
    });

    // PUT /rooms/admin/:id - Editar habitación
    router.put("/admin/:id", verificarToken, soloAdmin, async (req, res) => {
        const { id } = req.params;
        const { numero, tipo, precio_noche, descripcion, disponible } = req.body;
        
        if (!numero || !tipo || !precio_noche || disponible === undefined) {
            return res.status(400).json({ error: "Número, tipo, precio y estado de disponibilidad son obligatorios." });
        }

        try {
            const result = await dbRun(
                "UPDATE habitaciones SET numero = ?, tipo = ?, precio_noche = ?, descripcion = ?, disponible = ? WHERE id = ?",
                [numero, tipo, precio_noche, descripcion, disponible ? 1 : 0, id]
            );

            if (result.changes === 0) return res.status(404).json({ error: "Habitación no encontrada o sin cambios realizados." });
            res.json({ mensaje: `Habitación ${numero} actualizada con éxito.` });

        } catch (err) {
            console.error("Error al actualizar habitación:", err);
            res.status(500).json({ error: "Error al actualizar la habitación." });
        }
    });

    // DELETE /rooms/admin/:id - Eliminar habitación
    router.delete("/admin/:id", verificarToken, soloAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            const result = await dbRun("DELETE FROM habitaciones WHERE id = ?", [id]);
            if (result.changes === 0) return res.status(404).json({ error: "Habitación no encontrada." });
            res.json({ mensaje: `Habitación con ID ${id} eliminada.` });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                return res.status(409).json({ error: "No se puede eliminar la habitación porque tiene reservas asociadas. Elimine las reservas primero." });
            }
            console.error("Error al eliminar habitación:", err);
            res.status(500).json({ error: "Error al eliminar la habitación." });
        }
    });

    return router;
};