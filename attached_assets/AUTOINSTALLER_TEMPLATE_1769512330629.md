# Plantilla para Crear Autoinstaladores de Aplicaciones Node.js

## Prompt para usar con el Agente de Replit

Copia y adapta este prompt cuando necesites crear un autoinstalador para una nueva aplicación:

---

### PROMPT TEMPLATE

```
Necesito crear un script autoinstalador (install.sh) para mi aplicación [NOMBRE_APP] que se desplegará en un servidor Ubuntu 22.04/24.04.

## Información del Proyecto
- Nombre de la aplicación: [NOMBRE_APP]
- Repositorio GitHub: [URL_REPO]
- Puerto de la aplicación: [PUERTO] (ejemplo: 5000)
- Usuario del sistema: [USUARIO] (ejemplo: miapp)

## Stack Tecnológico
- Runtime: Node.js 20.x
- Base de datos: PostgreSQL
- Gestor de procesos: systemd (NO PM2)
- Proxy reverso: Nginx

## Requisitos del Instalador
1. Usar systemd como gestor de procesos (más confiable que PM2 para reinicios)
2. Guardar configuración en /etc/[NOMBRE_APP]/ (fuera del repositorio)
3. Usar EnvironmentFile en systemd para cargar variables
4. Detectar si es instalación nueva o actualización
5. Preservar credenciales en actualizaciones
6. Opción de configurar Cloudflare Tunnel (preguntando token)
7. Soporte para cookies HTTP (sin HTTPS) con variable SECURE_COOKIES

## Variables de Entorno
- DATABASE_URL: Conexión PostgreSQL
- SESSION_SECRET: Secreto para sesiones (generar automáticamente)
- PORT: Puerto de la aplicación
- NODE_ENV: production
- SECURE_COOKIES: true/false (false si no hay HTTPS)
```

---

## Lecciones Aprendidas (Errores Comunes a Evitar)

### 1. NO usar PM2 como gestor principal
**Problema**: PM2 requiere `pm2 startup` y `pm2 save` que pueden fallar silenciosamente.
**Solución**: Usar systemd directamente con un servicio `.service`.

```bash
# MAL - PM2 puede no sobrevivir reinicios
pm2 start app.js
pm2 save
pm2 startup

# BIEN - systemd es nativo y confiable
cat > /etc/systemd/system/miapp.service << EOF
[Unit]
Description=Mi Aplicación
After=network.target postgresql.service

[Service]
Type=simple
User=miapp
WorkingDirectory=/var/www/miapp
EnvironmentFile=/etc/miapp/env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### 2. Configuración FUERA del repositorio
**Problema**: `git pull` puede sobrescribir `.env` o la configuración se pierde.
**Solución**: Guardar en `/etc/[app]/env` y usar `EnvironmentFile` en systemd.

```bash
# Crear directorio de configuración
mkdir -p /etc/miapp
chmod 700 /etc/miapp

# Guardar configuración (formato systemd, SIN comillas)
cat > /etc/miapp/env << EOF
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://user:pass@localhost:5432/db
SESSION_SECRET=xxxxx
EOF
chmod 600 /etc/miapp/env
```

### 3. Detectar actualización vs instalación nueva
**Problema**: Regenerar credenciales en cada ejecución rompe la base de datos.
**Solución**: Verificar si existe configuración previa.

```bash
if [ -f "/etc/miapp/env" ]; then
    IS_UPDATE=true
    source /etc/miapp/env  # Cargar credenciales existentes
else
    IS_UPDATE=false
    DB_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    SESSION_SECRET=$(openssl rand -base64 32)
fi
```

### 4. Cookies seguras y HTTPS
**Problema**: `secure: true` en cookies requiere HTTPS. Sin él, las sesiones no funcionan.
**Solución**: Usar variable de entorno `SECURE_COOKIES`.

```javascript
// En el código de la aplicación
cookie: {
  secure: process.env.SECURE_COOKIES === "true",
  sameSite: "lax",
}
```

```bash
# En /etc/miapp/env
# Sin HTTPS (red local):
SECURE_COOKIES=false

# Con HTTPS (Cloudflare Tunnel o SSL):
SECURE_COOKIES=true
```

### 5. Cloudflare Tunnel opcional
**Problema**: Abrir puertos en el router no siempre es posible.
**Solución**: Ofrecer configuración de Cloudflare Tunnel durante instalación.

```bash
# Preguntar por token
read -p "Token de Cloudflare (Enter para omitir): " CF_TOKEN

if [ -n "$CF_TOKEN" ]; then
    # Instalar cloudflared
    curl -L --output /tmp/cloudflared.deb \
      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i /tmp/cloudflared.deb
    
    # Instalar servicio con token
    cloudflared service install "$CF_TOKEN"
    systemctl enable cloudflared
    systemctl start cloudflared
    
    # Habilitar cookies seguras (Cloudflare = HTTPS)
    echo "SECURE_COOKIES=true" >> /etc/miapp/env
fi
```

### 6. Marcar Nginx como manual
**Problema**: `apt autoremove` puede eliminar Nginx si se instaló como dependencia.
**Solución**: Marcarlo como paquete manual.

```bash
apt-get install -y nginx
apt-mark manual nginx
```

### 7. Permisos de Node.js
**Problema**: A veces `/usr/bin/node` tiene permisos incorrectos.
**Solución**: Asegurar permisos después de instalar.

```bash
chmod 755 /usr/bin/node
chmod 755 /usr/bin/npm
```

---

## Estructura Completa del Instalador

```bash
#!/bin/bash
set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuración
APP_NAME="miapp"
APP_DIR="/var/www/$APP_NAME"
CONFIG_DIR="/etc/$APP_NAME"
APP_PORT="5000"
APP_USER="miapp"
DB_NAME="miapp"
DB_USER="miapp"
GITHUB_REPO="https://github.com/usuario/repo.git"

# Verificar root
if [ "$EUID" -ne 0 ]; then
    print_error "Ejecutar como root"
    exit 1
fi

# Detectar instalación existente
IS_UPDATE=false
if [ -f "$CONFIG_DIR/env" ]; then
    IS_UPDATE=true
    source "$CONFIG_DIR/env"
else
    DB_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    SESSION_SECRET=$(openssl rand -base64 32)
fi

# Instalar dependencias
apt-get update -qq
apt-get install -y -qq curl git nginx postgresql postgresql-contrib
apt-mark manual nginx

# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -qq nodejs
chmod 755 /usr/bin/node /usr/bin/npm

# PostgreSQL (solo instalación nueva)
if [ "$IS_UPDATE" = false ]; then
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
fi

# Usuario del sistema
id "$APP_USER" &>/dev/null || useradd --system --create-home --shell /bin/bash $APP_USER

# Configuración persistente
mkdir -p "$CONFIG_DIR"
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"

cat > "$CONFIG_DIR/env" << EOF
NODE_ENV=production
PORT=$APP_PORT
DATABASE_URL=$DATABASE_URL
SESSION_SECRET=$SESSION_SECRET
SECURE_COOKIES=false
EOF
chmod 600 "$CONFIG_DIR/env"

# Clonar/actualizar código
git config --global --add safe.directory "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR" && git pull
else
    git clone --depth 1 "$GITHUB_REPO" "$APP_DIR"
fi
chown -R $APP_USER:$APP_USER "$APP_DIR"

# Build
cd "$APP_DIR"
sudo -u $APP_USER npm install
sudo -u $APP_USER npm run build

# Servicio systemd
cat > "/etc/systemd/system/$APP_NAME.service" << EOF
[Unit]
Description=$APP_NAME
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$CONFIG_DIR/env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $APP_NAME
systemctl restart $APP_NAME

# Nginx
cat > "/etc/nginx/sites-available/$APP_NAME" << EOF
server {
    listen 80;
    server_name _;
    client_max_body_size 500M;
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF
ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx

# Cloudflare Tunnel (opcional)
echo ""
read -p "Token de Cloudflare Tunnel (Enter para omitir): " CF_TOKEN
if [ -n "$CF_TOKEN" ]; then
    curl -L -o /tmp/cf.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i /tmp/cf.deb
    cloudflared service install "$CF_TOKEN"
    systemctl enable cloudflared
    systemctl start cloudflared
    sed -i 's/SECURE_COOKIES=false/SECURE_COOKIES=true/' "$CONFIG_DIR/env"
    systemctl restart $APP_NAME
fi

# Resumen
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=========================================="
echo -e "${GREEN}INSTALACIÓN COMPLETADA${NC}"
echo "=========================================="
echo "URL: http://$SERVER_IP"
echo ""
echo "Comandos:"
echo "  Estado:     systemctl status $APP_NAME"
echo "  Logs:       journalctl -u $APP_NAME -f"
echo "  Reiniciar:  systemctl restart $APP_NAME"
echo ""
```

---

## Comandos de Diagnóstico

```bash
# Estado de servicios
systemctl status [app]
systemctl status cloudflared
systemctl status nginx
systemctl status postgresql

# Logs
journalctl -u [app] -f
journalctl -u cloudflared -f

# Verificar puertos
ss -ltnp | grep :5000

# Probar conexión local
curl http://localhost:5000

# Verificar configuración
cat /etc/[app]/env

# Reiniciar todo
systemctl restart [app] nginx cloudflared
```

---

## Solución de Problemas

| Problema | Causa | Solución |
|----------|-------|----------|
| Login no funciona (401 después de 200) | Cookies `secure:true` sin HTTPS | Agregar `SECURE_COOKIES=false` a /etc/app/env |
| Servicio no inicia después de reboot | PM2 mal configurado | Usar systemd en lugar de PM2 |
| "No such file or directory" en systemd | EnvironmentFile no existe | Crear /etc/app/env con mkdir -p |
| Error 521/512 en Cloudflare | Tunnel no apunta al puerto correcto | Configurar hostname a http://localhost:5000 |
| Base de datos no conecta | pg_hba.conf usa "peer" | Cambiar a "md5" y reiniciar PostgreSQL |
| Credenciales cambian en actualización | No detecta instalación previa | Verificar existencia de /etc/app/env |
