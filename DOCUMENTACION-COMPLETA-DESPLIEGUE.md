# LitAgents - Documentación Completa de Despliegue

## Documento Maestro: Instalación, Configuración y Despliegue en Ubuntu Server

**Versión**: 2.9.9+
**Última actualización**: Febrero 2026

---

## ÍNDICE

1. [Descripción del Sistema](#1-descripción-del-sistema)
2. [Arquitectura Técnica](#2-arquitectura-técnica)
3. [Requisitos del Servidor](#3-requisitos-del-servidor)
4. [Subida a GitHub](#4-subida-a-github)
5. [Instalación Rápida (Script Automático)](#5-instalación-rápida-script-automático)
6. [Instalación Manual Paso a Paso](#6-instalación-manual-paso-a-paso)
7. [Contenido del Script install.sh](#7-contenido-del-script-installsh)
8. [Configuración de Variables de Entorno](#8-configuración-de-variables-de-entorno)
9. [Administración del Servidor](#9-administración-del-servidor)
10. [Acceso Externo con Cloudflare Tunnel](#10-acceso-externo-con-cloudflare-tunnel)
11. [Backups y Restauración](#11-backups-y-restauración)
12. [Actualización del Sistema](#12-actualización-del-sistema)
13. [Solución de Problemas](#13-solución-de-problemas)
14. [Desinstalación](#14-desinstalación)
15. [Estructura de Archivos](#15-estructura-de-archivos)
16. [Contenido del README.md](#16-contenido-del-readmemd)

---

## 1. Descripción del Sistema

LitAgents es un sistema autónomo de orquestación de agentes de IA para la escritura, edición, auditoría y traducción de novelas completas. El sistema es **portátil** y usa las API keys del usuario (DeepSeek y/o Gemini).

### Módulos principales:

| Módulo | Descripción | API utilizada |
|--------|-------------|---------------|
| **LitAgents 2.0** (Generador) | Pipeline de escritura basado en escenas con 6 agentes | DeepSeek (deepseek-reasoner + deepseek-chat) |
| **LitEditors** (Re-editor) | Editor de desarrollo con auditoría forense | DeepSeek (deepseek-chat V3) |
| **LitTranslators 2.0** (Traductor) | Traducción literaria con revisión nativa | DeepSeek (deepseek-chat V3) |
| **Auditor Literario** | Auditoría profesional de manuscritos | Gemini (gemini-2.5-flash) |
| **Writing Lessons** | Aprendizaje cruzado entre proyectos | DeepSeek (deepseek-chat V3) |

### Agentes del sistema:

**Generador (6 agentes)**:
- Global Architect (deepseek-reasoner) - Planificación estructural
- Chapter Architect (deepseek-chat) - Diseño de escenas
- Ghostwriter V2 (deepseek-chat) - Escritura creativa
- Smart Editor (deepseek-chat) - Edición y refinamiento
- Summarizer (deepseek-chat) - Resúmenes
- Narrative Director (deepseek-chat) - Coherencia narrativa

**Re-editor (4 agentes)**:
- Forensic Consistency Auditor - Detección de errores
- Beta Reader - Análisis comercial
- Copyeditor - Corrección de estilo
- Final Reviewer - Evaluación final

**Traductor (4 agentes)**:
- Strategist - Análisis de estilo
- Drafter - Traducción inicial
- Proofreader - Revisión
- Native Beta Reader - Revisión nativa

**Auditor Literario (4 agentes)**:
- Continuity Auditor (gemini-2.5-flash) - Continuidad
- Character Auditor (gemini-2.5-flash) - Personajes
- Style Auditor (gemini-2.5-flash) - Estilo
- Final Auditor (gemini-2.5-flash) - Evaluación final

**Writing Lessons Agent** (deepseek-chat):
- Analiza errores de TODOS los proyectos completados
- Lee de 3 fuentes: finalReviewResult, manuscript_audits, reedit_audit_reports
- Genera lecciones universales que se inyectan al Ghostwriter

---

## 2. Arquitectura Técnica

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE (React)                        │
│  Vite + TypeScript + Tailwind + shadcn/ui + TanStack     │
│  Puerto: 5000 (servido por Express en producción)        │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTP/SSE
┌─────────────────────────▼───────────────────────────────┐
│                   SERVIDOR (Express)                      │
│  Node.js 20 + TypeScript + Drizzle ORM                   │
│  Puerto interno: 5000                                     │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Orchestrator V2 (orchestrator-v2.ts)                 │ │
│  │ - Pipeline de generación                             │ │
│  │ - Sistema de corrección                              │ │
│  │ - Inyección de Writing Lessons                       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Agentes (server/agents/)                             │ │
│  │ - 29 archivos de agentes especializados              │ │
│  │ - BaseAgent con soporte DeepSeek + Gemini            │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                    PostgreSQL                              │
│  Drizzle ORM - Schema en shared/schema.ts                 │
│  Tablas: projects, chapters, world_bibles, thought_logs,  │
│  agent_statuses, series, manuscript_audits,                │
│  reedit_audit_reports, writing_lessons, etc.               │
└─────────────────────────────────────────────────────────┘
```

### Flujo de datos en producción:

```
Usuario → Nginx (80/443) → Express (5000) → PostgreSQL (5432)
                                  ↕
                          DeepSeek API / Gemini API
```

### Scripts de package.json:

```json
{
  "dev": "NODE_ENV=development tsx server/index.ts",
  "build": "tsx script/build.ts",
  "start": "NODE_ENV=production node dist/index.cjs",
  "check": "tsc",
  "db:push": "drizzle-kit push"
}
```

- `npm run dev` → Desarrollo con hot-reload (tsx)
- `npm run build` → Compila servidor (esbuild → dist/index.cjs) + cliente (Vite → dist/public/)
- `npm start` → Ejecuta el build de producción
- `npm run db:push` → Aplica migraciones de schema a PostgreSQL

---

## 3. Requisitos del Servidor

### Hardware Mínimo

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8 GB+ |
| Disco | 20 GB SSD | 50 GB SSD |
| Red | Conexión estable | Conexión estable |

### Software Base

- Ubuntu 22.04 LTS o 24.04 LTS
- Node.js 20.x
- PostgreSQL 15+
- Nginx
- Git, curl, build-essential

---

## 4. Subida a GitHub

### Opción A: Desde tu computadora local (recomendado)

**Paso 1: Descargar de Replit**
1. En Replit, haz clic en los tres puntos (...) en el panel de archivos
2. Selecciona "Download as zip"
3. Extrae el ZIP en tu computadora

**Paso 2: Preparar y subir**

```bash
# Navegar a la carpeta extraída
cd ruta/a/la/carpeta/extraida

# Eliminar archivos innecesarios (NO deben subirse)
rm -rf node_modules dist .cache attached_assets .config

# Inicializar git
git init

# Agregar el repositorio remoto
git remote add origin https://github.com/atreyu1968/API-Orchestrator-II.git

# Agregar todos los archivos
git add .

# Crear commit
git commit -m "LitAgents v2.9.9+ - Sistema de Orquestación de Agentes Literarios IA"

# Subir a GitHub
git push -u origin main
```

**Si el repositorio ya tiene contenido y quieres sobrescribir:**

```bash
git push -u origin main --force
```

### Opción B: Usando GitHub CLI

```bash
# Instalar GitHub CLI
# macOS: brew install gh
# Ubuntu: sudo apt install gh

# Autenticarse
gh auth login

# Clonar, copiar y subir
gh repo clone atreyu1968/API-Orchestrator-II
# Copiar archivos del proyecto (sin node_modules, dist, .cache)
cd API-Orchestrator-II
git add .
git commit -m "LitAgents v2.9.9+"
git push
```

### Opción C: Subida directa desde la web de GitHub

1. Ve a https://github.com/atreyu1968/API-Orchestrator-II
2. Haz clic en "Add file" > "Upload files"
3. Arrastra los archivos del proyecto
4. Haz commit

**Nota:** Límite de 100 archivos por vez.

### Verificar que estos archivos estén en GitHub:

```
install.sh           ← Script de instalación automática
README.md            ← Documentación principal
package.json         ← Dependencias del proyecto
drizzle.config.ts    ← Configuración de migraciones
tsconfig.json        ← Configuración TypeScript
vite.config.ts       ← Configuración Vite
.gitignore           ← Archivos excluidos de Git
server/              ← Código del backend
  ├── index.ts
  ├── routes.ts
  ├── storage.ts
  ├── db.ts
  ├── orchestrator-v2.ts
  ├── vite.ts
  └── agents/        ← 29 agentes especializados
client/              ← Código del frontend
  └── src/
      ├── App.tsx
      ├── pages/     ← 20 páginas
      └── components/
shared/              ← Schemas compartidos
  ├── schema.ts
  └── series-templates.ts
migrations/          ← Migraciones SQL
script/              ← Scripts de build
```

### Archivos que NO deben subirse (ya están en .gitignore):

```
node_modules/        ← Se instalan con npm install
dist/                ← Se genera con npm run build
.cache/              ← Cache temporal
.env                 ← Variables de entorno (secretas)
attached_assets/     ← Archivos grandes
*.log                ← Logs
```

---

## 5. Instalación Rápida (Script Automático)

Una vez el código está en GitHub, en tu servidor Ubuntu:

```bash
# 1. Clonar repositorio
git clone https://github.com/atreyu1968/API-Orchestrator-II.git
cd API-Orchestrator-II

# 2. Ejecutar instalador
sudo bash install.sh
```

### Lo que hace el instalador automáticamente:

1. Detecta si es primera instalación o actualización
2. Actualiza el sistema e instala dependencias (curl, git, nginx, postgresql, build-essential)
3. Instala Node.js 20.x (si no existe)
4. Crea usuario y base de datos PostgreSQL (solo primera vez)
5. Pide las API keys interactivamente:
   - DeepSeek API Key - Escritor
   - DeepSeek API Key - Traductor
   - DeepSeek API Key - Re-editor
   - Gemini API Key (opcional)
   - Contraseña de acceso (opcional)
6. Guarda configuración en `/etc/litagents/env`
7. Clona/actualiza código en `/var/www/litagents`
8. Instala dependencias npm
9. Compila la aplicación (`npm run build`)
10. Aplica migraciones de base de datos (`drizzle-kit push`)
11. Crea servicio systemd
12. Configura Nginx como reverse proxy
13. (Opcional) Configura Cloudflare Tunnel
14. Inicia la aplicación

### Notas sobre API Keys:

- Puedes usar la **misma clave DeepSeek** para las 3 funciones (escritor, traductor, re-editor)
- O crear claves separadas en https://platform.deepseek.com/ para mejor control de cuotas
- La clave Gemini es opcional pero necesaria para el Auditor Literario
- Si omites alguna clave, puedes agregarla después editando `/etc/litagents/env`

---

## 6. Instalación Manual Paso a Paso

Si prefieres control total, sigue estos pasos:

### 6.1 Actualizar el sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt autoremove -y
```

### 6.2 Instalar herramientas base

```bash
sudo apt install -y curl git wget nano build-essential
```

### 6.3 Instalar Node.js 20.x

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # Verificar: v20.x.x
npm --version    # Verificar: 10.x.x
```

### 6.4 Instalar PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 6.5 Crear base de datos

```bash
sudo -u postgres psql
```

En la consola PostgreSQL:
```sql
CREATE USER litagents WITH PASSWORD 'tu_password_seguro_aqui';
CREATE DATABASE litagents OWNER litagents;
GRANT ALL PRIVILEGES ON DATABASE litagents TO litagents;
\q
```

La URL de conexión será:
```
postgresql://litagents:tu_password_seguro_aqui@localhost:5432/litagents
```

### 6.6 Instalar Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

### 6.7 Crear usuario del sistema

```bash
sudo useradd --system --create-home --shell /bin/bash litagents
```

### 6.8 Clonar el código

```bash
sudo mkdir -p /var/www/litagents
sudo chown litagents:litagents /var/www/litagents

sudo -u litagents git clone https://github.com/atreyu1968/API-Orchestrator-II.git /var/www/litagents
```

### 6.9 Instalar dependencias y compilar

```bash
cd /var/www/litagents
sudo -u litagents npm install --legacy-peer-deps
sudo -u litagents npm run build
```

### 6.10 Configurar variables de entorno

```bash
sudo mkdir -p /etc/litagents
sudo nano /etc/litagents/env
```

Contenido del archivo `/etc/litagents/env`:

```env
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://litagents:tu_password_seguro_aqui@localhost:5432/litagents
SESSION_SECRET=genera_una_cadena_aleatoria_de_32_caracteres
SECURE_COOKIES=false

# Contraseña de acceso (dejar vacío para desactivar)
LITAGENTS_PASSWORD=

# DeepSeek API Keys (3 claves para gestión de cuotas)
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_TRANSLATOR_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_REEDITOR_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# Gemini API (para Auditor Literario)
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxx
AI_INTEGRATIONS_GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxx
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
```

Proteger el archivo:
```bash
sudo chmod 600 /etc/litagents/env
sudo chown root:root /etc/litagents/env
```

Para generar SESSION_SECRET:
```bash
openssl rand -base64 32
```

### 6.11 Aplicar migraciones de base de datos

```bash
cd /var/www/litagents
# Cargar variables de entorno
set -a && source /etc/litagents/env && set +a
# Ejecutar migraciones
sudo -E -u litagents npx drizzle-kit push --force
```

### 6.12 Crear servicio systemd

```bash
sudo nano /etc/systemd/system/litagents.service
```

Contenido:

```ini
[Unit]
Description=LitAgents - Sistema de Orquestación de Agentes Literarios IA
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=litagents
Group=litagents
WorkingDirectory=/var/www/litagents
EnvironmentFile=/etc/litagents/env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=litagents

[Install]
WantedBy=multi-user.target
```

Activar:
```bash
sudo systemctl daemon-reload
sudo systemctl enable litagents
```

### 6.13 Configurar Nginx

```bash
sudo nano /etc/nginx/sites-available/litagents
```

Contenido:

```nginx
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

    # SSE (Server-Sent Events) para el dashboard en tiempo real
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
```

Activar:
```bash
sudo ln -sf /etc/nginx/sites-available/litagents /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### 6.14 Configurar firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 6.15 Iniciar la aplicación

```bash
sudo systemctl start litagents
```

Verificar:
```bash
sudo systemctl status litagents
# Debe mostrar "active (running)"

# Probar acceso
curl http://localhost:5000
```

---

## 7. Contenido del Script install.sh

El script `install.sh` es el instalador automático. A continuación su código completo:

```bash
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

if [ "$IS_UPDATE" = true ]; then
    print_status "Preservando credenciales existentes..."
else
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

echo ""
print_status "Configuración de seguridad:"
echo -e "  ${CYAN}Establece una contraseña para proteger el acceso a la aplicación.${NC}"
echo -e "  ${CYAN}Si la dejas vacía, la aplicación estará accesible sin autenticación.${NC}"
echo ""

if [ "$IS_UPDATE" = false ] || [ -z "$LITAGENTS_PASSWORD" ]; then
    read -sp "$(echo -e ${YELLOW}Contraseña de acceso${NC} [Enter para desactivar]: )" INPUT_PASSWORD
    echo ""
    LITAGENTS_PASSWORD="${INPUT_PASSWORD:-$LITAGENTS_PASSWORD}"
    if [ -n "$LITAGENTS_PASSWORD" ]; then
        print_success "Contraseña configurada"
    else
        print_warning "Sin contraseña - acceso libre a la aplicación"
    fi
fi

if [ "$IS_UPDATE" = true ] && [ -n "$SECURE_COOKIES" ]; then
    CURRENT_SECURE_COOKIES="$SECURE_COOKIES"
else
    CURRENT_SECURE_COOKIES="false"
fi

{
    printf 'NODE_ENV=production\n'
    printf 'PORT=%s\n' "$APP_PORT"
    printf 'DATABASE_URL=%s\n' "$DATABASE_URL"
    printf 'SESSION_SECRET=%s\n' "$SESSION_SECRET"
    printf 'SECURE_COOKIES=%s\n' "$CURRENT_SECURE_COOKIES"
    printf '# Contraseña de acceso (dejar vacío para desactivar)\n'
    printf 'LITAGENTS_PASSWORD=%s\n' "$LITAGENTS_PASSWORD"
    printf '# DeepSeek API Keys (3 claves para gestión de cuotas)\n'
    printf 'DEEPSEEK_API_KEY=%s\n' "$DEEPSEEK_API_KEY"
    printf 'DEEPSEEK_TRANSLATOR_API_KEY=%s\n' "$DEEPSEEK_TRANSLATOR_API_KEY"
    printf 'DEEPSEEK_REEDITOR_API_KEY=%s\n' "$DEEPSEEK_REEDITOR_API_KEY"
    printf '# Gemini API (alternativa)\n'
    printf 'GEMINI_API_KEY=%s\n' "$GEMINI_API_KEY"
    printf 'AI_INTEGRATIONS_GEMINI_API_KEY=%s\n' "$GEMINI_API_KEY"
    printf 'AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com\n'
} > "$CONFIG_DIR/env"
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
```

---

## 8. Configuración de Variables de Entorno

### Archivo de configuración: `/etc/litagents/env`

| Variable | Descripción | Requerido | Auto-generado |
|----------|-------------|-----------|---------------|
| `NODE_ENV` | Modo de ejecución | Si | Si (production) |
| `PORT` | Puerto de la aplicación | Si | Si (5000) |
| `DATABASE_URL` | URL de conexión PostgreSQL | Si | Si |
| `SESSION_SECRET` | Secreto para firmar sesiones | Si | Si |
| `SECURE_COOKIES` | Cookies seguras (true con HTTPS) | Si | Si (false) |
| `LITAGENTS_PASSWORD` | Contraseña de acceso a la app | No | No |
| `DEEPSEEK_API_KEY` | DeepSeek - Escritor/Generador | Recomendado | No |
| `DEEPSEEK_TRANSLATOR_API_KEY` | DeepSeek - Traductor | Opcional* | No |
| `DEEPSEEK_REEDITOR_API_KEY` | DeepSeek - Re-editor | Opcional* | No |
| `GEMINI_API_KEY` | Google Gemini - Auditor Literario | Opcional | No |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Alias interno de Gemini | Opcional | Si (=GEMINI_API_KEY) |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | URL base de Gemini | Opcional | Si |

*Si no se configuran, usan `DEEPSEEK_API_KEY` como fallback.

### Editar configuración después de la instalación:

```bash
# Editar
sudo nano /etc/litagents/env

# Reiniciar para aplicar cambios
sudo systemctl restart litagents
```

### Obtener API Keys:

**DeepSeek (Principal)**:
1. Visita https://platform.deepseek.com/
2. Crea una cuenta y agrega créditos ($2-5 para empezar)
3. Genera una API key en el panel de control
4. Modelos usados: `deepseek-reasoner` (R1) y `deepseek-chat` (V3)

**Google Gemini (Auditor Literario)**:
1. Visita https://aistudio.google.com/
2. Haz clic en "Get API Key"
3. Crea una clave de API
4. Modelo usado: `gemini-2.5-flash`

---

## 9. Administración del Servidor

### Comandos esenciales:

```bash
# Ver estado del servicio
systemctl status litagents

# Ver logs en tiempo real
journalctl -u litagents -f

# Ver últimas 100 líneas de logs
journalctl -u litagents -n 100

# Reiniciar servicio
sudo systemctl restart litagents

# Detener servicio
sudo systemctl stop litagents

# Iniciar servicio
sudo systemctl start litagents

# Ver uso de memoria/CPU
htop
# o
ps aux | grep litagents
```

### Monitorear logs de todos los servicios:

```bash
# Logs de la aplicación
journalctl -u litagents -f

# Logs de Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Logs de PostgreSQL
sudo tail -f /var/log/postgresql/postgresql-*-main.log

# Estado de todos los servicios
systemctl status litagents postgresql nginx
```

### Crear swap si hay poca memoria:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 10. Acceso Externo con Cloudflare Tunnel

Si necesitas acceso HTTPS desde internet sin abrir puertos:

### Paso 1: Crear el túnel en Cloudflare

1. Ve a https://one.dash.cloudflare.com/
2. Ve a Networks > Tunnels
3. Crea un nuevo túnel
4. Copia el token del túnel

### Paso 2: Instalar en el servidor

Si no lo hiciste durante la instalación:

```bash
# Descargar e instalar cloudflared
curl -L -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb

# Instalar como servicio con tu token
sudo cloudflared service install TU_TOKEN_AQUI
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### Paso 3: Configurar el hostname

En el dashboard de Cloudflare Tunnels:
- Agrega un Public Hostname
- Configura: Service = `http://localhost:5000`
- Guarda

### Paso 4: Activar cookies seguras

```bash
# Editar configuración
sudo nano /etc/litagents/env
# Cambiar: SECURE_COOKIES=true

# Reiniciar
sudo systemctl restart litagents
```

---

## 11. Backups y Restauración

### Backup de la base de datos:

```bash
# Crear backup completo
sudo -u postgres pg_dump litagents > ~/backup_litagents_$(date +%Y%m%d_%H%M%S).sql

# Backup comprimido
sudo -u postgres pg_dump litagents | gzip > ~/backup_litagents_$(date +%Y%m%d).sql.gz
```

### Restaurar backup:

```bash
# Desde archivo SQL
sudo -u postgres psql litagents < backup_litagents_20260206.sql

# Desde archivo comprimido
gunzip -c backup_litagents_20260206.sql.gz | sudo -u postgres psql litagents
```

### Backup automático (cron):

```bash
# Editar crontab
sudo crontab -e

# Agregar esta línea para backup diario a las 3:00 AM
0 3 * * * sudo -u postgres pg_dump litagents | gzip > /var/backups/litagents_$(date +\%Y\%m\%d).sql.gz

# Limpiar backups de más de 30 días
0 4 * * * find /var/backups/ -name "litagents_*.sql.gz" -mtime +30 -delete
```

### Backup del código:

El código está en GitHub, no necesita backup local. Pero si quieres:

```bash
tar -czf ~/litagents_code_backup_$(date +%Y%m%d).tar.gz /var/www/litagents --exclude=node_modules --exclude=dist
```

---

## 12. Actualización del Sistema

### Actualización rápida (recomendado):

```bash
cd /var/www/litagents
sudo bash install.sh
```

El instalador detecta automáticamente la instalación existente y:
- Preserva credenciales de base de datos
- Preserva API keys
- Preserva contraseña de acceso
- Actualiza el código desde GitHub
- Reinstala dependencias
- Recompila
- Aplica migraciones nuevas
- Reinicia el servicio

### Actualización manual:

```bash
# Detener servicio
sudo systemctl stop litagents

# Actualizar código
cd /var/www/litagents
sudo -u litagents git fetch origin
sudo -u litagents git reset --hard origin/main

# Reinstalar dependencias
sudo -u litagents npm install --legacy-peer-deps

# Recompilar
sudo -u litagents npm run build

# Aplicar migraciones
set -a && source /etc/litagents/env && set +a
sudo -E -u litagents npx drizzle-kit push --force

# Reiniciar
sudo systemctl start litagents
```

---

## 13. Solución de Problemas

### El servicio no inicia

```bash
# Ver logs detallados
journalctl -u litagents -n 50 --no-pager

# Verificar que PostgreSQL está activo
sudo systemctl status postgresql

# Verificar configuración
cat /etc/litagents/env

# Probar ejecución manual
cd /var/www/litagents
set -a && source /etc/litagents/env && set +a
npm start
```

### Error de conexión a base de datos

```bash
# Verificar PostgreSQL
sudo systemctl start postgresql
sudo -u postgres psql -c "\l"

# Verificar que el usuario existe
sudo -u postgres psql -c "\du"

# Probar conexión manual
psql "postgresql://litagents:tu_password@localhost:5432/litagents" -c "SELECT 1"
```

### Puerto 5000 en uso

```bash
# Ver qué proceso usa el puerto
sudo lsof -i :5000

# Matar proceso si es necesario
sudo kill -9 $(sudo lsof -t -i:5000)

# Reiniciar
sudo systemctl restart litagents
```

### Login no funciona

- Con Cloudflare Tunnel: verificar `SECURE_COOKIES=true`
- Sin HTTPS: verificar `SECURE_COOKIES=false`
- Sin contraseña configurada: acceso libre (verificar `LITAGENTS_PASSWORD` en `/etc/litagents/env`)

### Permisos de archivos

```bash
sudo chown -R litagents:litagents /var/www/litagents
```

### Memoria insuficiente

```bash
# Verificar memoria
free -h

# Crear swap de 2GB
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### SSL Certificate expired (si usas Certbot en vez de Cloudflare)

```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Writing Lessons muestra "0 proyectos analizados"

1. Verificar que hay auditorías completadas:
```bash
# Abrir en el navegador:
http://TU_IP/api/writing-lessons/diagnose
```

2. El diagnóstico mostrará:
   - `projectsWithFinalReview` - Proyectos con revisión final del generador
   - `manuscriptAuditsCount` - Auditorías del Auditor Literario
   - `reeditReportsCount` - Reportes del Re-editor

3. Si hay auditorías pero no lecciones, hacer clic en "Regenerar Lecciones" en la interfaz

---

## 14. Desinstalación

```bash
# Detener y deshabilitar servicio
sudo systemctl stop litagents
sudo systemctl disable litagents

# Eliminar archivos de la aplicación
sudo rm -rf /var/www/litagents

# Eliminar configuración
sudo rm -rf /etc/litagents

# Eliminar servicio systemd
sudo rm /etc/systemd/system/litagents.service
sudo systemctl daemon-reload

# Eliminar configuración Nginx
sudo rm /etc/nginx/sites-enabled/litagents
sudo rm /etc/nginx/sites-available/litagents
sudo systemctl restart nginx

# Eliminar base de datos (CUIDADO: esto borra todos los datos)
sudo -u postgres psql -c "DROP DATABASE litagents;"
sudo -u postgres psql -c "DROP USER litagents;"

# Eliminar usuario del sistema
sudo userdel -r litagents

# (Opcional) Eliminar Cloudflare Tunnel
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
sudo apt remove cloudflared
```

---

## 15. Estructura de Archivos

### En el servidor:

```
/var/www/litagents/              # Código de la aplicación
├── package.json                 # Dependencias (80 deps, 23 devDeps)
├── install.sh                   # Script de instalación
├── drizzle.config.ts            # Config de migraciones
├── tsconfig.json                # Config TypeScript
├── vite.config.ts               # Config Vite (frontend)
├── dist/                        # Build de producción
│   ├── index.cjs                # Servidor compilado
│   └── public/                  # Frontend compilado
├── server/                      # Backend
│   ├── index.ts                 # Entry point
│   ├── routes.ts                # API REST (~7700 líneas)
│   ├── storage.ts               # Interfaz de almacenamiento
│   ├── db.ts                    # Conexión PostgreSQL
│   ├── orchestrator-v2.ts       # Orquestador del pipeline
│   ├── vite.ts                  # Servidor Vite (dev)
│   ├── static.ts                # Archivos estáticos (prod)
│   ├── cost-calculator.ts       # Calculadora de costos
│   ├── queue-manager.ts         # Gestor de cola
│   ├── translation-orchestrator.ts  # Orquestador traducción
│   └── agents/                  # 29 agentes IA
│       ├── base-agent.ts        # Clase base
│       ├── architect.ts         # Global Architect
│       ├── ghostwriter.ts       # Ghostwriter V2
│       ├── editor.ts            # Smart Editor
│       ├── writing-lessons-agent.ts  # Lecciones cruzadas
│       ├── forensic-consistency-auditor.ts
│       ├── beta-reader.ts
│       └── ... (22 más)
├── client/                      # Frontend React
│   └── src/
│       ├── App.tsx              # Router principal
│       ├── pages/               # 20 páginas
│       │   ├── dashboard.tsx
│       │   ├── manuscript.tsx
│       │   ├── auditor.tsx
│       │   ├── reedit.tsx
│       │   ├── writing-lessons.tsx
│       │   ├── export.tsx
│       │   └── ... (14 más)
│       ├── components/          # Componentes UI
│       └── lib/                 # Utilidades
├── shared/                      # Código compartido
│   ├── schema.ts                # Schema de base de datos (Drizzle)
│   └── series-templates.ts      # Templates de series
└── migrations/                  # Migraciones SQL

/etc/litagents/
└── env                          # Variables de entorno (permisos 600)

/etc/systemd/system/
└── litagents.service            # Servicio systemd

/etc/nginx/sites-available/
└── litagents                    # Config Nginx
```

---

## 16. Contenido del README.md

El archivo `README.md` que debe estar en la raíz del repositorio en GitHub:

```markdown
# LitAgents - Sistema de Orquestación de Agentes Literarios IA

Sistema autónomo de orquestación de agentes de IA para la escritura, edición,
auditoría y traducción de novelas completas.

## Características Principales

- **Generador de Novelas (LitAgents 2.0)**: Pipeline basado en escenas con 6 agentes
- **Re-editor de Manuscritos (LitEditors)**: Editor de desarrollo con auditoría forense
- **Traductor de Novelas (LitTranslators 2.0)**: Traducción literaria con revisión nativa
- **Auditor Literario**: Auditoría profesional con 4 agentes especializados (Gemini)
- **Writing Lessons**: Aprendizaje cruzado entre proyectos para prevenir errores
- **World Bible**: Base de datos de consistencia para personajes, ubicaciones y reglas
- **Seguimiento de Costos**: Tracking granular de tokens por proyecto
- **Autenticación**: Protección con contraseña para servidor propio

## Requisitos

- Ubuntu 22.04 / 24.04 LTS
- 4GB RAM mínimo (8GB recomendado)
- 20GB espacio en disco
- Conexión a internet
- API Key de DeepSeek y/o Gemini

## Instalación Rápida

### 1. Clonar e instalar

    git clone https://github.com/atreyu1968/API-Orchestrator-II.git
    cd API-Orchestrator-II
    sudo bash install.sh

### 2. Durante la instalación

El instalador pide:
- DeepSeek API Key (Escritor, Traductor, Re-editor)
- Gemini API Key (opcional, para Auditor Literario)
- Contraseña de acceso (opcional)
- Cloudflare Tunnel Token (opcional, para HTTPS)

### 3. Acceder

    http://TU_IP_SERVIDOR

## Configuración Manual de API Keys

    sudo nano /etc/litagents/env
    sudo systemctl restart litagents

## Comandos de Administración

    systemctl status litagents       # Estado
    journalctl -u litagents -f       # Logs
    sudo systemctl restart litagents # Reiniciar
    sudo systemctl stop litagents    # Detener

## Actualización

    cd /var/www/litagents
    sudo bash install.sh

Preserva automáticamente: credenciales, API keys, contraseña, datos.

## Variables de Entorno

| Variable | Descripción | Requerido |
|----------|-------------|-----------|
| DATABASE_URL | Conexión PostgreSQL | Si (auto) |
| SESSION_SECRET | Secreto de sesiones | Si (auto) |
| DEEPSEEK_API_KEY | DeepSeek - Escritor | Recomendado |
| DEEPSEEK_TRANSLATOR_API_KEY | DeepSeek - Traductor | Opcional* |
| DEEPSEEK_REEDITOR_API_KEY | DeepSeek - Re-editor | Opcional* |
| GEMINI_API_KEY | Gemini - Auditor Literario | Opcional |
| LITAGENTS_PASSWORD | Contraseña de acceso | Opcional |
| SECURE_COOKIES | Cookies seguras (HTTPS) | Si (auto) |

*Si no se configuran, usan DEEPSEEK_API_KEY como fallback.

## Backup

    sudo -u postgres pg_dump litagents > backup_$(date +%Y%m%d).sql
    sudo -u postgres psql litagents < backup_20260101.sql

## Estructura en el Servidor

    /var/www/litagents/     # Código
    /etc/litagents/env      # Configuración
    /etc/systemd/system/litagents.service  # Servicio
    /etc/nginx/sites-available/litagents   # Nginx

## Licencia

MIT License
```

---

## Resumen de Proceso Completo

### Flujo de despliegue de principio a fin:

```
1. REPLIT (desarrollo)
   └── Descargar ZIP del proyecto
   
2. COMPUTADORA LOCAL
   ├── Extraer ZIP
   ├── Eliminar: node_modules, dist, .cache, attached_assets
   ├── git init
   ├── git remote add origin https://github.com/atreyu1968/API-Orchestrator-II.git
   ├── git add .
   ├── git commit -m "LitAgents v2.9.9+"
   └── git push -u origin main (--force si ya existe)

3. SERVIDOR UBUNTU
   ├── git clone https://github.com/atreyu1968/API-Orchestrator-II.git
   ├── cd API-Orchestrator-II
   ├── sudo bash install.sh
   │   ├── Instala Node.js 20, PostgreSQL, Nginx
   │   ├── Crea BD y usuario
   │   ├── Pide API keys
   │   ├── npm install + npm run build
   │   ├── drizzle-kit push (migraciones)
   │   ├── Crea servicio systemd
   │   ├── Configura Nginx
   │   └── Inicia la aplicación
   └── Acceder: http://IP_SERVIDOR

4. ACTUALIZACIONES FUTURAS
   ├── Subir cambios a GitHub desde local
   └── En servidor: cd /var/www/litagents && sudo bash install.sh
```
