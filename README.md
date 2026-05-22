# Bot de Padel — KUMAN SANTO TOME en ATC Sports

Bot de automatización para reservar canchas de padel en [atcsports.io](https://atcsports.io).  
Monitorea disponibilidad los **martes a domingos** y reserva automáticamente el primer turno disponible de los **lunes**.

---

## Índice

1. [Requisitos previos](#1-requisitos-previos)
2. [Instalación](#2-instalación)
3. [Configuración paso a paso](#3-configuración-paso-a-paso)
   - [Crear bot de Telegram](#31-crear-bot-de-telegram)
   - [Generar App Password de Gmail](#32-generar-app-password-de-gmail)
   - [Encontrar la URL del venue en ATC Sports](#33-encontrar-la-url-del-venue-en-atc-sports)
   - [Completar el archivo .env](#34-completar-el-archivo-env)
4. [Ejecución](#4-ejecución)
5. [Comandos de Telegram](#5-comandos-de-telegram)
6. [Logs](#6-logs)
7. [Hosting gratuito (Oracle Cloud)](#7-hosting-gratuito-oracle-cloud)
8. [Troubleshooting](#8-troubleshooting)
9. [Arquitectura del proyecto](#9-arquitectura-del-proyecto)

---

## 1. Requisitos previos

- **Node.js 18 o superior**: [nodejs.org](https://nodejs.org/en/download/)
- **Cuenta en ATC Sports** con el email que usás normalmente
- **Cuenta Gmail** con verificación en dos pasos activada (para App Password)
- **Cuenta Telegram** para recibir notificaciones

---

## 2. Instalación

```bash
# Clonar o descargar el proyecto
cd "Bot Padel"

# Instalar dependencias
npm install

# Instalar el browser Chromium de Playwright
npm run setup
```

El último comando descarga ~150 MB (Chromium). Solo se hace una vez.

---

## 3. Configuración paso a paso

### 3.1. Crear bot de Telegram

1. Abrí Telegram y buscá **@BotFather**
2. Enviá `/newbot`
3. Elegí un nombre (ej: `Mi Bot de Padel`)
4. Elegí un username (debe terminar en `bot`, ej: `kuman_padel_bot`)
5. BotFather te dará un **token** que se ve así: `1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ`
   → Guardalo, va en `TELEGRAM_BOT_TOKEN`

6. Para obtener tu **Chat ID**:
   - Buscá **@userinfobot** en Telegram
   - Enviá `/start`
   - Te responde con tu ID numérico (ej: `123456789`)
   → Guardalo, va en `TELEGRAM_CHAT_ID`

7. Iniciá una conversación con **tu nuevo bot** enviándole `/start`
   (importante: el bot solo responde si ya le mandaste un mensaje primero)

---

### 3.2. Generar App Password de Gmail

> **¿Por qué?** El bot lee tu Gmail para encontrar el "magic link" de ATC Sports.  
> Gmail no permite usar tu contraseña normal para esto — necesitás una contraseña de aplicación.

**Pasos:**

1. Ir a [myaccount.google.com](https://myaccount.google.com)
2. **Seguridad** → **Verificación en 2 pasos** (activarla si no está activa)
3. Volver a **Seguridad** → **Contraseñas de aplicaciones**
4. Seleccionar: App = `Otra (nombre personalizado)` → Escribir `Bot Padel`
5. Hacer clic en **Generar**
6. Aparece una contraseña de 16 caracteres como: `abcd efgh ijkl mnop`
   → Guardarla **sin espacios**: `abcdefghijklmnop`
   → Va en `GMAIL_APP_PASSWORD` y en `SMTP_PASS`

---

### 3.3. Encontrar la URL del venue en ATC Sports

> **¿Por qué?** Necesitamos el `placeId` exacto del local en ATC Sports.  
> El valor por defecto (`69y7kgphj`) puede ser el correcto para KUMAN SANTO TOME, pero **verificalo** así:

1. Ir a [atcsports.io](https://atcsports.io)
2. Buscar `KUMAN SANTO TOME` en el buscador
3. Hacer clic en el local
4. Fijarse en la URL del navegador, que se verá así:
   ```
   https://atcsports.io/venues/kuman-ALGO?sportIds=17&placeId=XXXXXXXX&...
   ```
5. Copiar:
   - La parte después de `/venues/` y antes de `?` → `VENUE_SLUG`
   - El valor de `placeId=` → `VENUE_PLACE_ID`
6. Actualizar el `.env` con esos valores

---

### 3.4. Completar el archivo .env

```bash
# Copiar el template
copy .env.example .env
```

Abrir `.env` con cualquier editor de texto y completar **todos** los campos:

```env
ATC_EMAIL=tu_email_de_atcsports@gmail.com
GMAIL_APP_PASSWORD=abcdefghijklmnop
SMTP_USER=tu_email@gmail.com
SMTP_PASS=abcdefghijklmnop
NOTIFY_EMAIL=donde_quieras_recibir@gmail.com
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=123456789
VENUE_SLUG=kuman-caba
VENUE_PLACE_ID=69y7kgphj
```

> Los campos que no completés van a usar los valores por defecto definidos en `.env.example`.

---

## 4. Ejecución

```bash
# Iniciar el bot
npm start
```

**Primera vez:** el bot va a pedir el magic link para hacer login.  
Vas a ver en la consola: `Magic link solicitado para: tu@email.com`.  
El bot leerá automáticamente tu Gmail y activará la sesión. No necesitás hacer nada.

**Las veces siguientes:** usa la sesión guardada en `data/session.json`. No pide login.

### Mantenerlo corriendo con PM2 (opcional, recomendado)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar con PM2
pm2 start src/index.js --name "bot-padel"

# Ver logs en tiempo real
pm2 logs bot-padel

# Que arranque automático al reiniciar Windows
pm2 startup
pm2 save
```

---

## 5. Comandos de Telegram

Una vez iniciado el bot, podés controlarlo desde Telegram:

| Comando | Acción |
|---------|--------|
| `/start` | Ver mensaje de bienvenida |
| `/ayuda` | Ver lista de comandos |
| `/estado` | Ver estado actual del bot (activo/pausado, última verificación, etc.) |
| `/reiniciar` | Reanudar el monitoreo después de una reserva exitosa |
| `/pausar` | Pausar el monitoreo temporalmente |

**Flujo típico:**
1. Bot inicia → monitorea martes a domingos
2. Encuentra disponibilidad → reserva automáticamente
3. Envía notificación por Telegram y email
4. Se pausa esperando tu comando
5. Enviás `/reiniciar` → empieza a buscar para el próximo lunes

---

## 6. Logs

Los logs se guardan en la carpeta `logs/`:

```
logs/
├── bot-YYYY-MM-DD.log     # Log completo (rotación diaria, 14 días)
└── error-YYYY-MM-DD.log   # Solo errores (rotación diaria, 30 días)
```

Los screenshots de debug se guardan en `screenshots/`.

---

## 7. Hosting gratuito (Oracle Cloud)

La opción **más estable y gratuita** es Oracle Cloud Free Tier:

1. Crear cuenta gratuita en [cloud.oracle.com](https://cloud.oracle.com) (no requiere pago)
2. Crear una VM **Always Free** (ARM, Ubuntu 22.04)
3. Conectarte por SSH y seguir los pasos de instalación:

```bash
# Instalar Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Dependencias de Playwright en Linux
sudo apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2

# Subir el proyecto (con scp o git)
git clone tu-repo
cd Bot\ Padel
npm install
npm run setup
cp .env.example .env
nano .env  # completar las variables

# Correr en background
npm install -g pm2
pm2 start src/index.js --name "bot-padel"
pm2 startup
pm2 save
```

---

## 8. Troubleshooting

### "Variables de entorno faltantes"
Verificá que el archivo `.env` existe (no `.env.example`) y que todos los campos requeridos están completados.

### "No se encontró campo de email en login"
La UI de ATC Sports puede haber cambiado. Revisá los screenshots en `/screenshots/login-error-*.png`.  
Abrí un [issue](https://github.com/) o modificá los selectores en [src/auth/login.js](src/auth/login.js).

### "Timeout: el magic link no llegó en 2 minutos"
- Verificar que `ATC_EMAIL` y `GMAIL_APP_PASSWORD` sean correctos
- Verificar que IMAP esté habilitado en Gmail: [Configuración Gmail → Ver todos → Reenvío e IMAP](https://mail.google.com/mail/u/0/#settings/fwdandpop)
- Revisar si el email de ATC Sports llegó al spam

### "Sesión expirada" repetidamente
Borrar `data/session.json` y reiniciar el bot para forzar un login fresco.

### "No se encontró botón de confirmación"
La UI de reserva de ATC Sports puede haber cambiado. Revisar screenshots en `/screenshots/reserve-error-*.png`.  
Modificar los selectores en [src/booking/reserve.js](src/booking/reserve.js).

### CAPTCHA detectado
ATC Sports puede implementar CAPTCHA en el futuro. Si aparece, el bot fallará silenciosamente.  
En ese caso, contactar al desarrollador para integrar un servicio de resolución de CAPTCHA (2captcha, Anti-Captcha).

### Rate limit (muchas solicitudes)
El bot espera automáticamente 15 minutos después de 10 errores consecutivos.  
Si el problema persiste, aumentar `CHECK_INTERVAL_MS` en `.env` (ej: `600000` = 10 minutos).

---

## 9. Arquitectura del proyecto

```
Bot Padel/
├── src/
│   ├── index.js                   # Punto de entrada principal
│   ├── config.js                  # Carga y valida variables de entorno
│   ├── logger.js                  # Winston: logs a consola + archivos rotativos
│   ├── utils.js                   # Helpers: delays, fechas, retry
│   ├── auth/
│   │   ├── login.js               # Login ATC Sports: magic link + sesión persistente
│   │   └── gmailImap.js           # Lee Gmail via IMAP para extraer el magic link
│   ├── booking/
│   │   ├── availability.js        # Navega al venue y detecta slots disponibles
│   │   ├── reserve.js             # Ejecuta el flujo de reserva (clic + confirmación)
│   │   └── monitor.js             # Bucle de monitoreo, gestión de estado
│   └── notifications/
│       ├── email.js               # Envía correo via Gmail SMTP (nodemailer)
│       └── telegram.js            # Bot Telegram: notificaciones + comandos de control
├── data/
│   └── session.json               # Cookies de sesión (generado automáticamente)
├── logs/                          # Logs rotativos (generado automáticamente)
├── screenshots/                   # Screenshots de debug (generado automáticamente)
├── .env                           # Variables de entorno (NO subir a git)
├── .env.example                   # Template de configuración
├── .gitignore
└── package.json
```

### Flujo de ejecución

```
Inicio
  │
  ├─ Validar .env
  ├─ Iniciar bot Telegram (polling)
  ├─ Lanzar Chromium (headless)
  │
  └─ Login
       ├─ ¿Hay sesión guardada? ──Sí──► ¿Es válida? ──Sí──► Usar sesión
       │                                               └──No──► Re-login
       └─ No ────────────────────────────────────────────────► Login nuevo
                                                                  │
                                                          Ingresar email
                                                          Solicitar magic link
                                                          Leer Gmail (IMAP)
                                                          Activar magic link
                                                          Guardar sesión

  Loop (martes a domingos, cada 5 min):
    │
    ├─ Calcular próximo lunes
    ├─ Navegar a KUMAN SANTO TOME
    ├─ Seleccionar duración (90 min)
    ├─ Buscar slots: 18:00 / 18:30 / 19:00 / 19:30
    │
    ├─ Sin disponibilidad ──► Esperar 5 min ──► Repetir
    │
    └─ Con disponibilidad
         ├─ Ordenar: techadas primero, luego por horario
         ├─ Intentar reservar el primero
         ├─ Confirmar en modal
         ├─ Verificar éxito
         │
         ├─ Éxito ──► Enviar email + Telegram ──► Pausar ──► Esperar /reiniciar
         └─ Error ──► Log + Telegram ──► Reintentar en 5 min
```
