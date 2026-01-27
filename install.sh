#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

APP_NAME="litagents"
APP_DIR="/var/www/$APP_NAME"
CONFIG_DIR="/etc/$APP_NAME"
APP_PORT="5000"
APP_USER="litagents"
DB_NAME="litagents"
DB_USER="litagents"
GITHUB_REPO="https://github.com/atreyu1968/API-Orchestrator-II.git"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}       ${GREEN}LitAgents - Autoinstalador para Ubuntu${NC}                ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}       Sistema de Orquestación de Agentes Literarios IA       ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$EUID" -ne 0 ]; then
    print_error "Este script debe ejecutarse como root"
    echo "Uso: sudo bash install.sh"
    exit 1
fi

print_status "Detectando tipo de instalación..."
IS_UPDATE=false
if [ -f "$CONFIG_DIR/env" ]; then
    IS_UPDATE=true
    print_warning "Instalación existente detectada - Modo ACTUALIZACIÓN"
    source "$CONFIG_DIR/env"
else
    print_status "Primera instalación - Generando credenciales..."
    DB_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    SESSION_SECRET=$(openssl rand -base64 32)
fi

print_status "Actualizando sistema e instalando dependencias..."
apt-get update -qq
apt-get install -y -qq curl git nginx postgresql postgresql-contrib build-essential
apt-mark manual nginx postgresql
print_success "Dependencias del sistema instaladas"

print_status "Instalando Node.js 20.x..."
if ! command -v node &> /dev/null || [[ $(node -v) != v20* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi
chmod 755 /usr/bin/node /usr/bin/npm 2>/dev/null || true
print_success "Node.js $(node -v) instalado"

print_status "Configurando PostgreSQL..."
systemctl enable postgresql
systemctl start postgresql

if [ "$IS_UPDATE" = false ]; then
    print_status "Creando base de datos y usuario..."
    sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
        sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
    sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
        sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
    print_success "Base de datos '$DB_NAME' creada"
else
    print_status "Usando base de datos existente..."
fi

print_status "Configurando usuario del sistema..."
id "$APP_USER" &>/dev/null || useradd --system --create-home --shell /bin/bash $APP_USER
print_success "Usuario '$APP_USER' configurado"

print_status "Guardando configuración en $CONFIG_DIR..."
mkdir -p "$CONFIG_DIR"

# En modo actualización, preservar DATABASE_URL y SESSION_SECRET existentes
if [ "$IS_UPDATE" = true ]; then
    # DATABASE_URL y SESSION_SECRET ya fueron cargados con source
    print_status "Preservando credenciales existentes..."
else
    # Solo en instalación nueva, construir DATABASE_URL
    DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
fi

echo ""
print_status "Configuración de claves API DeepSeek:"
echo -e "  ${CYAN}LitAgents usa 3 claves API separadas para mejor gestión de cuotas:${NC}"
echo -e "  - Escritor: Para generación de novelas (DEEPSEEK_API_KEY)"
echo -e "  - Traductor: Para traducción de manuscritos (DEEPSEEK_TRANSLATOR_API_KEY)"
echo -e "  - Re-editor: Para edición de manuscritos (DEEPSEEK_REEDITOR_API_KEY)"
echo ""

if [ "$IS_UPDATE" = false ] || [ -z "$DEEPSEEK_API_KEY" ]; then
    read -p "$(echo -e ${YELLOW}DeepSeek API Key - Escritor${NC} [Enter para omitir]: )" INPUT_DEEPSEEK
    DEEPSEEK_API_KEY="${INPUT_DEEPSEEK:-$DEEPSEEK_API_KEY}"
fi

if [ "$IS_UPDATE" = false ] || [ -z "$DEEPSEEK_TRANSLATOR_API_KEY" ]; then
    read -p "$(echo -e ${YELLOW}DeepSeek API Key - Traductor${NC} [Enter para omitir]: )" INPUT_DEEPSEEK_TRANS
    DEEPSEEK_TRANSLATOR_API_KEY="${INPUT_DEEPSEEK_TRANS:-$DEEPSEEK_TRANSLATOR_API_KEY}"
fi

if [ "$IS_UPDATE" = false ] || [ -z "$DEEPSEEK_REEDITOR_API_KEY" ]; then
    read -p "$(echo -e ${YELLOW}DeepSeek API Key - Re-editor${NC} [Enter para omitir]: )" INPUT_DEEPSEEK_REEDIT
    DEEPSEEK_REEDITOR_API_KEY="${INPUT_DEEPSEEK_REEDIT:-$DEEPSEEK_REEDITOR_API_KEY}"
fi

echo ""
print_status "Configuración de Gemini (opcional - alternativa a DeepSeek):"

if [ "$IS_UPDATE" = false ] || [ -z "$GEMINI_API_KEY" ]; then
    read -p "$(echo -e ${YELLOW}Gemini API Key${NC} [Enter para omitir]: )" INPUT_GEMINI
    GEMINI_API_KEY="${INPUT_GEMINI:-$GEMINI_API_KEY}"
fi

# Preservar SECURE_COOKIES existente en actualizaciones
if [ "$IS_UPDATE" = true ] && [ -n "$SECURE_COOKIES" ]; then
    CURRENT_SECURE_COOKIES="$SECURE_COOKIES"
else
    CURRENT_SECURE_COOKIES="false"
fi

cat > "$CONFIG_DIR/env" << EOF
NODE_ENV=production
PORT=$APP_PORT
DATABASE_URL=$DATABASE_URL
SESSION_SECRET=$SESSION_SECRET
SECURE_COOKIES=$CURRENT_SECURE_COOKIES
# DeepSeek API Keys (3 claves para gestión de cuotas)
DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY
DEEPSEEK_TRANSLATOR_API_KEY=$DEEPSEEK_TRANSLATOR_API_KEY
DEEPSEEK_REEDITOR_API_KEY=$DEEPSEEK_REEDITOR_API_KEY
# Gemini API (alternativa)
GEMINI_API_KEY=$GEMINI_API_KEY
AI_INTEGRATIONS_GEMINI_API_KEY=$GEMINI_API_KEY
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
EOF
chmod 600 "$CONFIG_DIR/env"
chown root:root "$CONFIG_DIR/env"
print_success "Configuración guardada en $CONFIG_DIR/env"

print_status "Descargando/actualizando código fuente..."
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

if [ -d "$APP_DIR/.git" ]; then
    print_status "Actualizando repositorio existente..."
    cd "$APP_DIR"
    git fetch origin
    git reset --hard origin/main
else
    print_status "Clonando repositorio..."
    rm -rf "$APP_DIR"
    git clone --depth 1 "$GITHUB_REPO" "$APP_DIR"
fi
chown -R $APP_USER:$APP_USER "$APP_DIR"
print_success "Código fuente listo en $APP_DIR"

print_status "Instalando dependencias de Node.js..."
cd "$APP_DIR"
sudo -u $APP_USER npm install --legacy-peer-deps
print_success "Dependencias instaladas"

print_status "Compilando aplicación..."
sudo -u $APP_USER npm run build
print_success "Aplicación compilada"

print_status "Aplicando migraciones de base de datos..."
cd "$APP_DIR"
set -a
source "$CONFIG_DIR/env"
set +a
sudo -E -u $APP_USER npx drizzle-kit push --force 2>/dev/null || true
print_success "Base de datos actualizada"

print_status "Configurando servicio systemd..."
cat > "/etc/systemd/system/$APP_NAME.service" << EOF
[Unit]
Description=LitAgents - Sistema de Orquestación de Agentes Literarios IA
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$CONFIG_DIR/env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$APP_NAME

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $APP_NAME
print_success "Servicio systemd configurado"

print_status "Configurando Nginx..."
cat > "/etc/nginx/sites-available/$APP_NAME" << 'NGINX_EOF'
server {
    listen 80;
    server_name _;
    
    client_max_body_size 500M;
    proxy_read_timeout 600s;
    proxy_connect_timeout 600s;
    proxy_send_timeout 600s;
    
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /api/events {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
print_success "Nginx configurado"

echo ""
print_status "Configuración de Cloudflare Tunnel (opcional):"
read -p "$(echo -e ${YELLOW}Token de Cloudflare Tunnel${NC} [Enter para omitir]: )" CF_TOKEN

if [ -n "$CF_TOKEN" ]; then
    print_status "Instalando Cloudflare Tunnel..."
    curl -L -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i /tmp/cloudflared.deb
    rm /tmp/cloudflared.deb
    
    cloudflared service install "$CF_TOKEN"
    systemctl enable cloudflared
    systemctl start cloudflared
    
    sed -i 's/SECURE_COOKIES=false/SECURE_COOKIES=true/' "$CONFIG_DIR/env"
    print_success "Cloudflare Tunnel configurado (HTTPS habilitado)"
fi

print_status "Iniciando LitAgents..."
systemctl restart $APP_NAME
sleep 5

if systemctl is-active --quiet $APP_NAME; then
    print_success "LitAgents iniciado correctamente"
else
    print_error "Error al iniciar LitAgents"
    echo "Revisa los logs con: journalctl -u $APP_NAME -f"
fi

SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}              INSTALACIÓN COMPLETADA${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}URL de acceso:${NC} http://$SERVER_IP"
if [ -n "$CF_TOKEN" ]; then
    echo -e "  ${BLUE}Cloudflare:${NC}    Configurado (revisa tu dashboard)"
fi
echo ""
echo -e "  ${YELLOW}Comandos útiles:${NC}"
echo "    Estado:      systemctl status $APP_NAME"
echo "    Logs:        journalctl -u $APP_NAME -f"
echo "    Reiniciar:   systemctl restart $APP_NAME"
echo "    Detener:     systemctl stop $APP_NAME"
echo ""
echo -e "  ${YELLOW}Configuración:${NC}"
echo "    Archivo:     $CONFIG_DIR/env"
echo "    Editar:      sudo nano $CONFIG_DIR/env"
echo ""
echo -e "  ${YELLOW}Actualizar:${NC}"
echo "    Ejecutar:    sudo bash install.sh"
echo ""
if [ -z "$DEEPSEEK_API_KEY" ]; then
    print_warning "DeepSeek API Key no configurada - Algunas funciones estarán limitadas"
    echo "    Agregar:     sudo nano $CONFIG_DIR/env"
    echo "                 Añadir: DEEPSEEK_API_KEY=tu_clave"
    echo "                 Luego:  sudo systemctl restart $APP_NAME"
fi
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
