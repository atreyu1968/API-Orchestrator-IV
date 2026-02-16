# Instrucciones para Subir LitAgents a GitHub

## Opción 1: Desde tu computadora local

### Paso 1: Descargar el proyecto desde Replit

1. En Replit, haz clic en los tres puntos (...) en el panel de archivos
2. Selecciona "Download as zip"
3. Extrae el archivo ZIP en tu computadora

### Paso 2: Preparar el repositorio local

```bash
# Navegar a la carpeta extraída
cd ruta/a/la/carpeta/extraida

# Eliminar archivos innecesarios
rm -rf node_modules dist .cache attached_assets

# Inicializar git (si no existe)
git init

# Agregar el remote de GitHub
git remote add origin https://github.com/atreyu1968/API-Orchestrator-IV.git

# Agregar todos los archivos
git add .

# Crear commit
git commit -m "LitAgents 2.1 - Sistema de Orquestación de Agentes Literarios IA"

# Subir a GitHub (puede pedirte autenticación)
git push -u origin main
```

### Si el repositorio ya tiene contenido:

```bash
# Forzar push (CUIDADO: sobrescribe todo)
git push -u origin main --force
```

---

## Opción 2: Usando GitHub CLI

```bash
# Instalar GitHub CLI si no lo tienes
# macOS: brew install gh
# Ubuntu: sudo apt install gh

# Autenticarse
gh auth login

# Clonar, copiar archivos y subir
gh repo clone atreyu1968/API-Orchestrator-IV
# Copiar archivos del proyecto aquí
cd API-Orchestrator-IV
git add .
git commit -m "LitAgents 2.1"
git push
```

---

## Opción 3: Subida directa desde la web de GitHub

1. Ve a https://github.com/atreyu1968/API-Orchestrator-IV
2. Haz clic en "Add file" > "Upload files"
3. Arrastra los archivos del proyecto
4. Haz commit

**Nota:** Esta opción tiene límite de 100 archivos por vez.

---

## Verificar la subida

Después de subir, verifica que estos archivos existan:

- `install.sh` - Script de instalación automática
- `README.md` - Documentación con instrucciones
- `package.json` - Dependencias del proyecto
- `server/` - Código del backend
- `client/` - Código del frontend
- `shared/` - Esquemas compartidos

---

## Instalación en Ubuntu después de subir

Una vez el código esté en GitHub:

```bash
# En tu servidor Ubuntu
git clone https://github.com/atreyu1968/API-Orchestrator-IV.git
cd API-Orchestrator-IV
sudo bash install.sh
```

El instalador se encargará de:
- Instalar Node.js 20.x
- Instalar y configurar PostgreSQL
- Crear la base de datos
- Configurar Nginx
- Crear el servicio systemd
- (Opcional) Configurar Cloudflare Tunnel
