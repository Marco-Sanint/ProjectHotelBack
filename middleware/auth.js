module.exports = (SECRET_KEY, jwt) => {

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
        // Permite acceso a administradores O recepcionistas
        if (req.user && (req.user.rol === 'admin' || req.user.rol === 'recepcionista')) {
            next();
        } else {
            res.status(403).json({ error: "Acceso denegado. Solo para personal." });
        }
    };
    
    return { verificarToken, soloAdmin, soloPersonal };
};
