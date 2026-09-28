const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'pos.json');

// ========== BASE DE DATOS EN JSON ==========
function loadDB() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
        const defaultDB = {
            usuarios: [{ id: 1, username: 'admin', password: hashPassword('admin'), rol: 'admin' }],
            productos: [],
            categorias: [],
            proveedores: [],
            clientes: [],
            ventas: [],
            venta_detalle: [],
            gastos: [],
            compras: [],
            cotizaciones: [],
            nextId: { productos: 1, categorias: 1, proveedores: 1, clientes: 1, ventas: 1, gastos: 1, compras: 1, cotizaciones: 1 }
        };
        saveDB(defaultDB);
        return defaultDB;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password, hash) {
    return hashPassword(password) === hash;
}

function getNextId(db, table) {
    const id = db.nextId[table] || 1;
    db.nextId[table] = id + 1;
    return id;
}

// ========== PARSEO DE REQUEST ==========
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); }
            catch (e) { reject(e); }
        });
    });
}

function parseCookies(req) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = {};
    cookieHeader.split(';').forEach(c => {
        const [key, ...vals] = c.trim().split('=');
        if (key) cookies[key] = decodeURIComponent(vals.join('='));
    });
    return cookies;
}

function getSessionUser(db, req) {
    const cookies = parseCookies(req);
    const userId = cookies['pos_user_id'];
    if (!userId) return null;
    return db.usuarios.find(u => u.id === parseInt(userId)) || null;
}

function sendJSON(res, data, statusCode = 200) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// ========== RUTAS DE API ==========
async function handleAPI(req, res, db) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;

    // LOGIN
    if (pathname === '/api/login' && method === 'POST') {
        const body = await parseBody(req);
        const user = db.usuarios.find(u => u.username === body.username && verifyPassword(body.password, u.password));
        if (user) {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': `pos_user_id=${user.id}; Path=/; HttpOnly`
            });
            res.end(JSON.stringify({ success: true, user: { id: user.id, username: user.username, rol: user.rol } }));
        } else {
            sendJSON(res, { success: false, message: 'Usuario o contraseña incorrectos' }, 401);
        }
        return;
    }

    // Verificar autenticación para el resto de rutas
    const user = getSessionUser(db, req);
    if (!user) {
        sendJSON(res, { success: false, message: 'No autenticado' }, 401);
        return;
    }

    // USUARIOS
    if (pathname === '/api/usuarios' && method === 'GET') {
        return sendJSON(res, db.usuarios.map(u => ({ id: u.id, username: u.username, rol: u.rol, created_at: u.created_at })));
    }
    if (pathname === '/api/usuarios' && method === 'POST') {
        const body = await parseBody(req);
        const hashedPassword = hashPassword(body.password);
        const newUser = {
            id: db.nextId.usuarios || 1,
            username: body.username,
            password: hashedPassword,
            rol: body.rol || 'vendedor',
            created_at: new Date().toISOString()
        };
        db.usuarios.push(newUser);
        db.nextId.usuarios = newUser.id + 1;
        saveDB(db);
        return sendJSON(res, { success: true, id: newUser.id });
    }
    const userMatch = pathname.match(/^\/api\/usuarios\/(\d+)$/);
    if (userMatch && method === 'DELETE') {
        const id = parseInt(userMatch[1]);
        db.usuarios = db.usuarios.filter(u => u.id !== id);
        saveDB(db);
        return sendJSON(res, { success: true });
    }

    // DASHBOARD
    if (pathname === '/api/dashboard' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const ventasHoy = db.ventas.filter(v => v.created_at && v.created_at.startsWith(today)).reduce((s, v) => s + v.total, 0);
        const totalVentas = db.ventas.reduce((s, v) => s + v.total, 0);
        const totalGastos = db.gastos.reduce((s, g) => s + g.monto, 0);
        return sendJSON(res, {
            totalVentas, ventasHoy, totalGastos,
            totalProductos: db.productos.length,
            totalClientes: db.clientes.length
        });
    }

    // PRODUCTOS
    if (pathname === '/api/productos' && method === 'GET') return sendJSON(res, db.productos);
    if (pathname === '/api/productos' && method === 'POST') {
        const body = await parseBody(req);
        const newProduct = { id: getNextId(db, 'productos'), ...body, created_at: new Date().toISOString() };
        db.productos.push(newProduct);
        saveDB(db);
        return sendJSON(res, { success: true, id: newProduct.id });
    }
    const prodMatch = pathname.match(/^\/api\/productos\/(\d+)$/);
    if (prodMatch && method === 'PUT') {
        const id = parseInt(prodMatch[1]);
        const body = await parseBody(req);
        const idx = db.productos.findIndex(p => p.id === id);
        if (idx >= 0) { db.productos[idx] = { ...db.productos[idx], ...body }; saveDB(db); }
        return sendJSON(res, { success: true });
    }
    if (prodMatch && method === 'DELETE') {
        const id = parseInt(prodMatch[1]);
        db.productos = db.productos.filter(p => p.id !== id);
        saveDB(db);
        return sendJSON(res, { success: true });
    }

    // CATEGORIAS
    if (pathname === '/api/categorias' && method === 'GET') return sendJSON(res, db.categorias);
    if (pathname === '/api/categorias' && method === 'POST') {
        const body = await parseBody(req);
        const newCat = { id: getNextId(db, 'categorias'), ...body, created_at: new Date().toISOString() };
        db.categorias.push(newCat);
        saveDB(db);
        return sendJSON(res, { success: true });
    }
    const catMatch = pathname.match(/^\/api\/categorias\/(\d+)$/);
    if (catMatch && method === 'DELETE') {
        const id = parseInt(catMatch[1]);
        db.categorias = db.categorias.filter(c => c.id !== id);
        saveDB(db);
        return sendJSON(res, { success: true });
    }

    // PROVEEDORES
    if (pathname === '/api/proveedores' && method === 'GET') return sendJSON(res, db.proveedores);
    if (pathname === '/api/proveedores' && method === 'POST') {
        const body = await parseBody(req);
        const newProv = { id: getNextId(db, 'proveedores'), ...body, created_at: new Date().toISOString() };
        db.proveedores.push(newProv);
        saveDB(db);
        return sendJSON(res, { success: true });
    }
    const provMatch = pathname.match(/^\/api\/proveedores\/(\d+)$/);
    if (provMatch && method === 'DELETE') {
        const id = parseInt(provMatch[1]);
        db.proveedores = db.proveedores.filter(p => p.id !== id);
        saveDB(db);
        return sendJSON(res, { success: true });
    }

    // CLIENTES
    if (pathname === '/api/clientes' && method === 'GET') return sendJSON(res, db.clientes);
    if (pathname.match(/^\/api\/clientes\/\d+$/) && method === 'GET') {
        const id = parseInt(pathname.split('/').pop());
        const cliente = db.clientes.find(c => c.id === id);
        if (cliente) return sendJSON(res, cliente);
        return sendJSON(res, null, 404);
    }
    if (pathname === '/api/clientes' && method === 'POST') {
        const body = await parseBody(req);
        const newCli = { id: getNextId(db, 'clientes'), ...body, created_at: new Date().toISOString() };
        db.clientes.push(newCli);
        saveDB(db);
        return sendJSON(res, { success: true });
    }
    const cliMatch = pathname.match(/^\/api\/clientes\/(\d+)$/);
    if (cliMatch && method === 'DELETE') {
        const id = parseInt(cliMatch[1]);
        db.clientes = db.clientes.filter(c => c.id !== id);
        saveDB(db);
        return sendJSON(res, { success: true });
    }

    // VENTAS
    if (pathname === '/api/ventas' && method === 'GET') {
        return sendJSON(res, db.ventas.map(v => {
            const cliente = db.clientes.find(c => c.id === v.cliente_id);
            return { ...v, cliente_nombre: cliente?.nombre || null };
        }));
    }
    if (pathname === '/api/ventas' && method === 'POST') {
        const body = await parseBody(req);
        const newVenta = { id: getNextId(db, 'ventas'), created_at: new Date().toISOString(), ...body, items: undefined };
        db.ventas.push(newVenta);
        if (body.items) {
            body.items.forEach(item => {
                db.venta_detalle.push({
                    id: db.venta_detalle.length + 1,
                    venta_id: newVenta.id,
                    ...item
                });
                const prod = db.productos.find(p => p.id === item.producto_id);
                if (prod) prod.stock = Math.max(0, (prod.stock || 0) - item.cantidad);
            });
        }
        saveDB(db);
        return sendJSON(res, { success: true, id: newVenta.id });
    }

    // GASTOS
    if (pathname === '/api/gastos' && method === 'GET') return sendJSON(res, db.gastos);
    if (pathname === '/api/gastos' && method === 'POST') {
        const body = await parseBody(req);
        const newGasto = { id: getNextId(db, 'gastos'), ...body, created_at: new Date().toISOString() };
        db.gastos.push(newGasto);
        saveDB(db);
        return sendJSON(res, { success: true });
    }
    const gastoMatch = pathname.match(/^\/api\/gastos\/(\d+)$/);
    if (gastoMatch && method === 'DELETE') {
        const id = parseInt(gastoMatch[1]);
        db.gastos = db.gastos.filter(g => g.id !== id);
        saveDB(db);
        return sendJSON(res, { success: true });
    }

    // COMPRAS
    if (pathname === '/api/compras' && method === 'GET') return sendJSON(res, db.compras);
    if (pathname === '/api/compras' && method === 'POST') {
        const body = await parseBody(req);
        const newCompra = { id: getNextId(db, 'compras'), ...body, created_at: new Date().toISOString() };
        db.compras.push(newCompra);
        if (body.producto_id && body.cantidad) {
            const prod = db.productos.find(p => p.id === body.producto_id);
            if (prod) prod.stock = (prod.stock || 0) + body.cantidad;
        }
        saveDB(db);
        return sendJSON(res, { success: true });
    }

    // COTIZACIONES
    if (pathname === '/api/cotizaciones' && method === 'GET') return sendJSON(res, db.cotizaciones);
    if (pathname === '/api/cotizaciones' && method === 'POST') {
        const body = await parseBody(req);
        const newCot = { id: getNextId(db, 'cotizaciones'), estado: 'pendiente', created_at: new Date().toISOString(), ...body };
        db.cotizaciones.push(newCot);
        saveDB(db);
        return sendJSON(res, { success: true });
    }

    // FACTURAS - Obtener factura por ID de venta
    const facturaMatch = pathname.match(/^\/api\/facturas\/(\d+)$/);
    if (facturaMatch && method === 'GET') {
        const ventaId = parseInt(facturaMatch[1]);
        const venta = db.ventas.find(v => v.id === ventaId);
        if (!venta) return sendJSON(res, { success: false, message: 'Venta no encontrada' }, 404);
        const cliente = db.clientes.find(c => c.id === venta.cliente_id);
        const detalles = db.venta_detalle.filter(d => d.venta_id === ventaId);
        const productos = detalles.map(d => {
            const prod = db.productos.find(p => p.id === d.producto_id);
            return {
                ...d,
                producto_nombre: prod?.nombre || 'Producto eliminado',
                medidas: prod?.medidas || '',
                descripcion2: prod?.descripcion2 || ''
            };
        });
        return sendJSON(res, { venta, cliente, productos });
    }

    // CUENTA CORRIENTE - Obtener estado de cuenta de un cliente
    const ccMatch = pathname.match(/^\/api\/cuenta-corriente\/(\d+)$/);
    if (ccMatch && method === 'GET') {
        const clienteId = parseInt(ccMatch[1]);
        const ventasCC = db.ventas.filter(v => v.cliente_id === clienteId && v.metodo_pago === 'cuenta_corriente');
        const pagos = db.pagos ? db.pagos.filter(p => p.cliente_id === clienteId) : [];
        const totalVentas = ventasCC.reduce((s, v) => s + v.total, 0);
        const totalPagos = pagos.reduce((s, p) => s + p.monto, 0);
        const saldo = totalVentas - totalPagos;
        return sendJSON(res, {
            ventas: ventasCC,
            pagos: pagos,
            totalVentas,
            totalPagos,
            saldo
        });
    }

    // CUENTA CORRIENTE - Registrar pago
    if (pathname === '/api/pagos' && method === 'POST') {
        const body = await parseBody(req);
        const nuevoPago = {
            id: db.nextId.pagos || 1,
            cliente_id: body.cliente_id,
            monto: body.monto,
            metodo_pago: body.metodo_pago || 'efectivo',
            concepto: body.concepto || 'Pago de cuenta corriente',
            created_at: new Date().toISOString()
        };
        if (!db.pagos) db.pagos = [];
        db.pagos.push(nuevoPago);
        db.nextId.pagos = nuevoPago.id + 1;
        saveDB(db);
        return sendJSON(res, { success: true, id: nuevoPago.id });
    }

    // REPORTES
    if (pathname === '/api/reportes/ventas' && method === 'GET') {
        return sendJSON(res, db.ventas);
    }

    sendJSON(res, { success: false, message: 'Ruta no encontrada' }, 404);
}

// ========== SERVIDOR HTTP ==========
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    const db = loadDB();

    // Rutas API
    if (pathname.startsWith('/api/')) {
        try {
            await handleAPI(req, res, db);
        } catch (e) {
            sendJSON(res, { success: false, message: 'Error del servidor' }, 500);
        }
        return;
    }

    // Archivos estáticos
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const ext = path.extname(filePath);
    const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const fullPath = path.join(__dirname, 'public', filePath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(fullPath).pipe(res);
    } else {
        res.writeHead(404);
        res.end('No encontrado');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=== Sistema POS - Software Unico Canos Embalse ===`);
    console.log(`Servidor corriendo en: http://localhost:${PORT}`);
    console.log(`Base de datos: ${DB_FILE}`);
    console.log(`\nPara acceder desde otras dispositivos:`);
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`  http://${iface.address}:${PORT}`);
            }
        }
    }
});
