# Guía de Despliegue: LitAgents en Ubuntu Server

Esta guía explica cómo desplegar LitAgents (o proyectos similares Node.js + PostgreSQL) en un servidor Ubuntu.

---

## Requisitos del Servidor

### Hardware Mínimo
- **CPU**: 2 cores (4+ recomendado para procesamiento AI)
- **RAM**: 4GB mínimo (8GB+ recomendado)
- **Disco**: 20GB SSD
- **Red**: Conexión estable para llamadas API a DeepSeek/Gemini

### Software Base
- Ubuntu 22.04 LTS o superior
- Node.js 20.x
- PostgreSQL 15+
- Nginx (reverse proxy)
- PM2 (gestor de procesos)
- Certbot (SSL gratuito)

---

## 1. Preparación del Servidor

### 1.1 Actualizar Sistema
```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 Instalar Node.js 20.x
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Verificar: v20.x.x
```

### 1.3 Instalar PostgreSQL
```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 1.4 Instalar Nginx y Certbot
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
```

### 1.5 Instalar PM2 (Gestor de Procesos)
```bash
sudo npm install -g pm2
```

---

## 2. Configurar Base de Datos

### 2.1 Crear Usuario y Base de Datos
```bash
sudo -u postgres psql
```

En la consola PostgreSQL:
```sql
CREATE USER litagents WITH PASSWORD 'tu_password_seguro';
CREATE DATABASE litagents_db OWNER litagents;
GRANT ALL PRIVILEGES ON DATABASE litagents_db TO litagents;
\q
```

### 2.2 Construir URL de Conexión
```
DATABASE_URL=postgresql://litagents:tu_password_seguro@localhost:5432/litagents_db
```

---

## 3. Desplegar la Aplicación

### 3.1 Crear Usuario de Aplicación (Seguridad)
```bash
sudo useradd -m -s /bin/bash litagents
sudo mkdir -p /var/www/litagents
sudo chown litagents:litagents /var/www/litagents
```

### 3.2 Clonar o Transferir Código
```bash
sudo su - litagents
cd /var/www/litagents

# Opción A: Clonar desde Git
git clone https://tu-repositorio.git .

# Opción B: Transferir con rsync desde máquina local
# (ejecutar desde tu máquina local)
rsync -avz --exclude='node_modules' --exclude='.git' \
  ./proyecto/ usuario@servidor:/var/www/litagents/
```

### 3.3 Instalar Dependencias
```bash
cd /var/www/litagents
npm install
```

### 3.4 Configurar Variables de Entorno
Crear archivo `.env`:
```bash
nano /var/www/litagents/.env
```

Contenido del archivo `.env`:
```env
# Base de Datos
DATABASE_URL=postgresql://litagents:tu_password_seguro@localhost:5432/litagents_db

# API Keys - DeepSeek (Principal)
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_TRANSLATOR_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_REEDITOR_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# API Keys - Gemini (Opcional)
AI_INTEGRATIONS_GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxx
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta

# Configuración de Servidor
NODE_ENV=production
PORT=5000
```

### 3.5 Ejecutar Migraciones de Base de Datos
```bash
npm run db:push
```

### 3.6 Compilar para Producción
```bash
npm run build
```

---

## 4. Configurar PM2 (Proceso en Background)

### 4.1 Crear Archivo de Configuración PM2
```bash
nano /var/www/litagents/ecosystem.config.js
```

Contenido:
```javascript
module.exports = {
  apps: [{
    name: 'litagents',
    script: 'dist/index.js',
    cwd: '/var/www/litagents',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: '/var/log/litagents/error.log',
    out_file: '/var/log/litagents/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

### 4.2 Crear Directorio de Logs
```bash
sudo mkdir -p /var/log/litagents
sudo chown litagents:litagents /var/log/litagents
```

### 4.3 Iniciar Aplicación
```bash
cd /var/www/litagents
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Seguir instrucciones para auto-inicio
```

### 4.4 Comandos Útiles PM2
```bash
pm2 status          # Ver estado
pm2 logs litagents  # Ver logs en tiempo real
pm2 restart litagents  # Reiniciar
pm2 stop litagents     # Detener
pm2 delete litagents   # Eliminar del gestor
```

---

## 5. Configurar Nginx (Reverse Proxy + SSL)

### 5.1 Crear Configuración del Sitio
```bash
sudo nano /etc/nginx/sites-available/litagents
```

Contenido:
```nginx
server {
    listen 80;
    server_name tu-dominio.com www.tu-dominio.com;

    # Redirigir HTTP a HTTPS (después de configurar SSL)
    # return 301 https://$server_name$request_uri;

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
        
        # Timeouts largos para operaciones de AI
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

    # SSE (Server-Sent Events) - Importante para el dashboard
    location /api/projects/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
    }
}
```

### 5.2 Activar el Sitio
```bash
sudo ln -s /etc/nginx/sites-available/litagents /etc/nginx/sites-enabled/
sudo nginx -t  # Verificar sintaxis
sudo systemctl reload nginx
```

### 5.3 Configurar SSL con Let's Encrypt
```bash
sudo certbot --nginx -d tu-dominio.com -d www.tu-dominio.com
```

Certbot modificará automáticamente la configuración de Nginx para HTTPS.

---

## 6. Firewall (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 7. Mantenimiento

### 7.1 Actualizar Aplicación
```bash
sudo su - litagents
cd /var/www/litagents
git pull origin main  # o rsync nuevos archivos
npm install
npm run build
pm2 restart litagents
```

### 7.2 Backup de Base de Datos
```bash
# Crear backup
pg_dump -U litagents -h localhost litagents_db > backup_$(date +%Y%m%d).sql

# Restaurar backup
psql -U litagents -h localhost litagents_db < backup_20240115.sql
```

### 7.3 Renovar Certificados SSL
```bash
# Certbot renueva automáticamente, pero puedes forzar:
sudo certbot renew --dry-run  # Test
sudo certbot renew            # Renovar
```

### 7.4 Monitorear Logs
```bash
# Logs de la aplicación
pm2 logs litagents --lines 100

# Logs de Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Logs de PostgreSQL
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

---

## 8. Script de Despliegue Automatizado

Crear script `/var/www/litagents/deploy.sh`:
```bash
#!/bin/bash
set -e

echo "=== Iniciando despliegue de LitAgents ==="

cd /var/www/litagents

echo "1. Obteniendo últimos cambios..."
git pull origin main

echo "2. Instalando dependencias..."
npm install

echo "3. Ejecutando migraciones..."
npm run db:push

echo "4. Compilando aplicación..."
npm run build

echo "5. Reiniciando servidor..."
pm2 restart litagents

echo "=== Despliegue completado ==="
pm2 status
```

Hacer ejecutable:
```bash
chmod +x /var/www/litagents/deploy.sh
```

Uso:
```bash
./deploy.sh
```

---

## 9. Solución de Problemas

### Error: EACCES permission denied
```bash
sudo chown -R litagents:litagents /var/www/litagents
```

### Error: Puerto 5000 en uso
```bash
sudo lsof -i :5000  # Ver qué proceso usa el puerto
pm2 delete all      # Limpiar procesos PM2
```

### Error: Cannot connect to PostgreSQL
```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "SELECT 1"  # Verificar conexión
```

### Error: SSL Certificate expired
```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Memoria insuficiente
```bash
# Crear swap si no existe
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 10. Checklist de Verificación

- [ ] Node.js 20.x instalado
- [ ] PostgreSQL funcionando y base de datos creada
- [ ] Variables de entorno configuradas en `.env`
- [ ] Migraciones ejecutadas (`npm run db:push`)
- [ ] Aplicación compilada (`npm run build`)
- [ ] PM2 ejecutando la aplicación
- [ ] Nginx configurado como reverse proxy
- [ ] SSL activo con Certbot
- [ ] Firewall configurado (UFW)
- [ ] Dominio apuntando al servidor

---

## Estructura de Archivos en el Servidor

```
/var/www/litagents/
├── .env                    # Variables de entorno (NO commitear)
├── ecosystem.config.js     # Configuración PM2
├── deploy.sh              # Script de despliegue
├── dist/                  # Código compilado (producción)
├── node_modules/          # Dependencias
├── package.json
└── ...

/etc/nginx/sites-available/
└── litagents              # Configuración Nginx

/var/log/litagents/
├── error.log              # Errores de la aplicación
└── out.log                # Salida estándar
```

---

## Notas para Replicar en Otros Proyectos

1. **Cambiar nombres**: Reemplazar "litagents" por el nombre de tu proyecto
2. **Ajustar puertos**: Si tienes múltiples apps, usar puertos diferentes (5001, 5002...)
3. **Variables de entorno**: Cada proyecto tiene sus propias API keys
4. **Base de datos**: Crear una base de datos separada para cada proyecto
5. **Nginx**: Crear un archivo de configuración por cada dominio/proyecto
