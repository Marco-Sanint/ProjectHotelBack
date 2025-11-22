// routes/reservations.js
const express = require('express');

module.exports = ({ dbGet, dbRun, dbAll, verificarToken, soloPersonal, soloAdmin }) => {
    const router = express.Router();

    // POST /reservations
    router.post("/", verificarToken, async (req, res) => {
        const { habitacionId, fecha_inicio, fecha_fin } = req.body;
        const usuarioId = req.user.id;

        if (!habitacionId || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: "Campos de reserva requeridos." });

        try {
            // Verificación disponibilidad y existencia habitación
            const roomInfo = await dbGet("SELECT * FROM habitaciones WHERE id = ?", [habitacionId]);
            if (!roomInfo || roomInfo.disponible === 0) return res.status(404).json({ error: "Habitación no disponible (generalmente)." });

            // Validación de Fechas
            const inicio = new Date(fecha_inicio);
            const fin = new Date(fecha_fin);
            const diffTime = Math.abs(fin - inicio);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) return res.status(400).json({ error: "Fechas inválidas o duración cero." });

            const precio_total = roomInfo.precio_noche * diffDays;

            // Verificación conflictos de fechas
            const conflictSql = `
                SELECT id FROM reservas 
                WHERE habitacionId = ? 
                AND estado = 'confirmada'  -- Solo verifica conflictos con reservas ya confirmadas
                AND (
                    (fecha_fin > ?) AND (fecha_inicio < ?)
                )
            `;
            const conflictParams = [habitacionId, fecha_inicio, fecha_fin];
            const conflictingReservation = await dbGet(conflictSql, conflictParams);

            if (conflictingReservation) {
                return res.status(409).json({ 
                    error: "Conflicto de reserva. La habitación ya está ocupada en ese rango de fechas.", 
                    conflictingId: conflictingReservation.id
                });
            }
            
            // Inserción de la Reserva
            const reservationResult = await dbRun(
                `INSERT INTO reservas (habitacionId, usuarioId, fecha_inicio, fecha_fin, precio_total, estado) VALUES (?, ?, ?, ?, ?, 'confirmada')`,
                [habitacionId, usuarioId, fecha_inicio, fecha_fin, precio_total]
            );

            res.json({ mensaje: "Reserva creada y confirmada con éxito.", id: reservationResult.lastID, precio_total });

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

    // GET /reservations/admin - Ver todas las reservas
    router.get("/", verificarToken, soloPersonal, async (req, res) => {
        const { userId, roomId } = req.query; 

        let sql = `
            SELECT 
                r.*, 
                u.nombre AS nombre_usuario, 
                u.email AS email_usuario,
                h.numero AS numero_habitacion
            FROM reservas r
            JOIN usuarios u ON r.usuarioId = u.id
            JOIN habitaciones h ON r.habitacionId = h.id
        `;
        let params = [];
        let whereClause = [];

        if (userId) {
            whereClause.push("r.usuarioId = ?");
            params.push(userId);
        }
        if (roomId) {
            whereClause.push("r.habitacionId = ?");
            params.push(roomId);
        }

        if (whereClause.length > 0) {
            sql += " WHERE " + whereClause.join(" AND ");
        }
        
        sql += " ORDER BY r.fecha_inicio DESC";

        try {
            const rows = await dbAll(sql, params);
            res.json({ reservas: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener reservas filtradas." });
        }
    });

    // PUT /reservations/admin/:id - Editar reserva
    router.put("/:id", verificarToken, soloPersonal, async (req, res) => {
        const { id } = req.params;
        const { fecha_inicio, fecha_fin, estado, habitacionId } = req.body;

        if (!fecha_inicio || !fecha_fin || !estado || !habitacionId) {
            return res.status(400).json({ error: "Campos obligatorios faltantes." });
        }

        try {
            // Verificación de Conflictos
            // Búsqueda de conflictos con otras reservas
            const conflictSql = `
                SELECT id FROM reservas 
                WHERE habitacionId = ? 
                AND id != ? 
                AND estado = 'confirmada'
                AND ((fecha_fin > ?) AND (fecha_inicio < ?))
            `;
            const conflictParams = [habitacionId, id, fecha_inicio, fecha_fin];
            const conflictingReservation = await dbGet(conflictSql, conflictParams);

            if (conflictingReservation) {
                return res.status(409).json({ 
                    error: "Conflicto de fechas. La nueva fecha/habitación se superpone con otra reserva confirmada.", 
                    conflictingId: conflictingReservation.id
                });
            }
            
            // Ejecución de la Actualización
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

    // DELETE /reservations/:id - Cancelar o eliminar reserva
    router.delete("/:id", verificarToken, async (req, res) => {
        const { id } = req.params;
        const usuarioId = req.user.id;
        const userRole = req.user.rol;
        
        // Rango de cancelación permitido para el cliente
        const limiteCancelacion = 7; 

        try {
            // Verificar si la reserva existe y obtener datos clave
            const reserva = await dbGet("SELECT usuarioId, fecha_inicio FROM reservas WHERE id = ?", [id]);
            if (!reserva) return res.status(404).json({ error: "Reserva no encontrada." });

            // Definir que rol quiere hacer la acción
            const esDueno = reserva.usuarioId === usuarioId;
            const esPersonal = userRole === 'admin' || userRole === 'recepcionista';

            // Autorización
            if (esPersonal) {
                // El personal (admin/recepcionista) puede eliminar en cualquier momento.
            } else if (esDueno) {
                // El dueño solo puede cancelar dentro del límite de días.
                const fechaInicio = new Date(reserva.fecha_inicio);
                const hoy = new Date();
                
                // Calcula la diferencia en milisegundos y la convierte a días
                const diffTime = fechaInicio.getTime() - hoy.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays <= limiteCancelacion) {
                    // Si la diferencia es menor o igual al límite (ej: 7 días o menos), ¡Acceso denegado!
                    return res.status(403).json({ 
                        error: `Acceso denegado. Las reservas solo pueden cancelarse con más de ${limiteCancelacion} días de anticipación. Faltan ${diffDays} días para el inicio.` 
                    });
                }
            } else {
                // El usuario no es ni el dueño ni el personal.
                return res.status(403).json({ error: "Acceso denegado. Solo puedes eliminar tus propias reservas o necesitas rol de personal." });
            }
            
            // Ejecutar la eliminación
            const result = await dbRun("DELETE FROM reservas WHERE id = ?", [id]);
            
            if (result.changes === 0) return res.status(404).json({ error: "Reserva no encontrada después de la verificación." });
            
            const mensaje = esPersonal ? 
                `Reserva con ID ${id} eliminada por el personal.` : 
                `Reserva con ID ${id} cancelada con éxito.`;

            res.json({ mensaje });

        } catch (err) {
            console.error("Error al eliminar reserva (Límite de Días):", err);
            res.status(500).json({ error: "Error al eliminar la reserva." });
        }
    });

    return router;
};
