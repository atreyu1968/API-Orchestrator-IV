# LitAgents - Sistema de Orquestación de Agentes Literarios IA

Sistema autónomo de orquestación de agentes de IA para la escritura, edición y producción de novelas completas.

## Características Principales

- **Generador de Novelas (LitAgents 2.0)**: Pipeline basado en escenas con 6 agentes especializados
- **Re-editor de Manuscritos (LitEditors)**: Editor de desarrollo con auditoría forense de consistencia
- **Traductor de Novelas**: Sistema de traducción literaria preservando estilo y contexto
- **World Bible**: Base de datos de consistencia para personajes, ubicaciones y reglas del mundo
- **Seguimiento de Costos**: Tracking granular de uso de tokens por proyecto

### Agentes del Sistema

**Generador (LitAgents 2.0)**:
- Global Architect - Planificación de estructura narrativa
- Chapter Architect - Diseño de escenas por capítulo
- Ghostwriter V2 - Escritura creativa de escenas
- Smart Editor - Edición y refinamiento
- Summarizer - Generación de resúmenes
- Narrative Director - Control de coherencia narrativa

**Re-editor (LitEditors)**:
- Forensic Consistency Auditor - Detección de errores de consistencia
- Beta Reader - Análisis de viabilidad comercial
- Copyeditor - Corrección de estilo
- Final Reviewer - Evaluación final

## Requisitos del Sistema

- Ubuntu 22.04 / 24.04 LTS
- 4GB RAM mínimo (8GB recomendado)
- 20GB espacio en disco
- Conexión a internet

## Instalación Rápida

### 1. Descargar e instalar

```bash
# Clonar repositorio
git clone https://github.com/atreyu1968/API-Orchestrator-II.git
cd API-Orchestrator-II

# Ejecutar instalador
sudo bash install.sh
```

### 2. Durante la instalación

El instalador te pedirá (opcional):
- **DeepSeek API Key**: Para generación y análisis de texto
- **Gemini API Key**: Para funciones alternativas de IA
- **Cloudflare Tunnel Token**: Para acceso HTTPS externo

### 3. Acceder a la aplicación

```
http://TU_IP_SERVIDOR
```

## Configuración Manual de API Keys

Si omitiste las claves durante la instalación:

```bash
# Editar configuración
sudo nano /etc/litagents/env

# Agregar/modificar estas líneas:
DEEPSEEK_API_KEY=tu_clave_deepseek
GEMINI_API_KEY=tu_clave_gemini

# Reiniciar servicio
sudo systemctl restart litagents
```

## Obtener API Keys

### DeepSeek (Recomendado - Principal)
1. Visita https://platform.deepseek.com/
2. Crea una cuenta y agrega créditos
3. Genera una API key

### Google Gemini (Alternativo)
1. Visita https://aistudio.google.com/
2. Crea un proyecto y habilita la API
3. Genera una API key

## Comandos de Administración

```bash
# Ver estado del servicio
systemctl status litagents

# Ver logs en tiempo real
journalctl -u litagents -f

# Reiniciar servicio
sudo systemctl restart litagents

# Detener servicio
sudo systemctl stop litagents

# Iniciar servicio
sudo systemctl start litagents
```

## Actualización

Para actualizar a la última versión:

```bash
cd /var/www/litagents
sudo bash install.sh
```

El instalador detectará la instalación existente y preservará:
- Credenciales de base de datos
- API keys configuradas
- Proyectos existentes

## Estructura de Archivos

```
/var/www/litagents/     # Código de la aplicación
/etc/litagents/env      # Configuración y variables de entorno
/etc/systemd/system/litagents.service  # Servicio systemd
/etc/nginx/sites-available/litagents   # Configuración Nginx
```

## Acceso Externo con Cloudflare Tunnel

Si necesitas acceso externo con HTTPS:

1. Crea un túnel en https://one.dash.cloudflare.com/
2. Obtén el token del túnel
3. Ejecuta el instalador y proporciona el token
4. Configura el hostname del túnel apuntando a `http://localhost:5000`

## Solución de Problemas

### El servicio no inicia

```bash
# Ver logs de error
journalctl -u litagents -n 50

# Verificar configuración
cat /etc/litagents/env

# Verificar PostgreSQL
systemctl status postgresql
```

### Error de conexión a base de datos

```bash
# Verificar que PostgreSQL está corriendo
sudo systemctl start postgresql

# Probar conexión manual
sudo -u postgres psql -c "\l"
```

### Login no funciona

Si usas Cloudflare Tunnel, verifica que `SECURE_COOKIES=true` está configurado.
Sin HTTPS, debe ser `SECURE_COOKIES=false`.

### Permisos de archivos

```bash
# Reparar permisos
sudo chown -R litagents:litagents /var/www/litagents
```

## Variables de Entorno

| Variable | Descripción | Requerido |
|----------|-------------|-----------|
| `DATABASE_URL` | URL de conexión PostgreSQL | Sí (auto) |
| `SESSION_SECRET` | Secreto para sesiones | Sí (auto) |
| `DEEPSEEK_API_KEY` | API key de DeepSeek | Recomendado |
| `GEMINI_API_KEY` | API key de Google Gemini | Opcional |
| `SECURE_COOKIES` | true/false para cookies seguras | Sí (auto) |
| `PORT` | Puerto de la aplicación | Sí (auto: 5000) |

## Backup de Base de Datos

```bash
# Crear backup
sudo -u postgres pg_dump litagents > backup_$(date +%Y%m%d).sql

# Restaurar backup
sudo -u postgres psql litagents < backup_20240101.sql
```

## Desinstalación

```bash
# Detener y deshabilitar servicio
sudo systemctl stop litagents
sudo systemctl disable litagents

# Eliminar archivos
sudo rm -rf /var/www/litagents
sudo rm -rf /etc/litagents
sudo rm /etc/systemd/system/litagents.service
sudo rm /etc/nginx/sites-enabled/litagents
sudo rm /etc/nginx/sites-available/litagents

# Eliminar base de datos (opcional)
sudo -u postgres psql -c "DROP DATABASE litagents;"
sudo -u postgres psql -c "DROP USER litagents;"

# Recargar servicios
sudo systemctl daemon-reload
sudo systemctl restart nginx
```

## Licencia

MIT License

## Soporte

Para reportar problemas o solicitar funciones, abre un issue en el repositorio de GitHub.
