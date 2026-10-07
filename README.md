# Puente Telegram ↔ Claude Code

Un bot privado de Telegram donde escribes o mandas una nota de voz, y te contesta **Claude Code corriendo en tu propia máquina**, con tus archivos a la mano, en texto y en nota de voz.

Tres archivos, **cero dependencias de npm**, y lo tienes andando en media tarde.

```
telegram → node → claude -p → edge-tts → ogg/opus → sendVoice
```

**Importante:** usa el CLI de Claude Code, así que consume **tu suscripción**, no créditos de API.

| | |
|---|---|
| Archivos | 3 |
| Paquetes npm | 0 |
| `pip install` | 2 |
| Costo extra | $0 |
| Usuarios | 1 (tú) |

**Lo que no es:** no es un bot público ni multiusuario, no escala a un equipo, y no debe exponerse a nadie más. Un solo `chat_id` autorizado, el tuyo.

---

# La forma rápida

Hay un instalador que hace todo menos la única cosa que no se puede automatizar: crear el bot en BotFather, que es una conversación de Telegram y la tienes que tener tú.

```bash
cd mi-bóveda
git clone https://github.com/<usuario>/puente-telegram-claude.git puente
cd puente
node instalar.js
```

El instalador:

1. Comprueba Node, Python y Claude Code, y te dice exactamente qué falta si falta algo.
2. Te explica cómo sacar el token en BotFather y te lo pide.
3. Verifica el token contra Telegram y te dice qué bot es.
4. Te manda a abrir tu bot y **captura tu `chat_id` solo** en cuanto le escribas.
5. Te hace cuatro preguntas: carpeta, modelo, zona horaria y voz.
6. Instala `edge-tts` y `av`.
7. Escribe `telegram.json`.
8. **Prueba de punta a punta:** te manda un mensaje y una nota de voz de verdad a tu Telegram.
9. Instala pm2 si hace falta y lo deja corriendo.

Si todo sale bien, terminas con el bot andando y sin haber tocado un archivo de configuración.

**El resto de este README es el paso a paso a mano**, para entender qué hace cada pieza o para arreglar algo cuando se rompa.

---

# La forma a mano

## Antes de empezar

Tres comprobaciones. **Si alguna falla, no sigas.**

```bash
node -v
# tiene que decir v20 o más alto

python --version
# v3.10 o más alto  (si no responde, prueba con python3)

claude -p "responde solo: listo"
# tiene que contestar "listo"
```

> **Si el tercero falla, nada de lo demás va a funcionar.** Instala Claude Code y entra con tu cuenta hasta que ese comando conteste desde la terminal. El puente no es más que eso mismo, automatizado.

Y necesitas **una máquina que no apagues**: un servidor, un VPS o el PC de la casa. Si la apagas, el bot se cae.

---

## 1 · Crear el bot con BotFather

BotFather es un bot oficial de Telegram que sirve para fabricar otros bots. Se usa como cualquier chat: le escribes y te contesta.

**Paso a paso, sin saltarse nada:**

1. Abre Telegram, en el teléfono o en [web.telegram.org](https://web.telegram.org).
2. Toca la **lupa** de buscar (arriba del todo).
3. Escribe `BotFather`.
4. Van a salir varios resultados parecidos. **Elige el que se llama exactamente `BotFather` y tiene el check azul de verificado al lado del nombre.** Los demás son imitaciones.
5. Se abre el chat, vacío. Abajo, donde normalmente escribes, hay un **botón azul que dice INICIAR** (o START en inglés). Tócalo.
6. Te responde de una con un mensaje largo lleno de comandos. Ya estás dentro.
7. Ahora sí, escribe `/newbot` en la caja de texto de abajo y envía, como un mensaje normal.

A partir de ahí la conversación va así:

```
Tú          /newbot
BotFather   Alright, a new bot. How are we going to call it?
            Please choose a name for your bot.
Tú          Mi segundo cerebro
BotFather   Good. Now let's choose a username for your bot.
            It must end in `bot`.
Tú          mi_segundo_cerebro_bot
BotFather   Done! Congratulations on your new bot.
            Use this token to access the HTTP API:
            8123456789:AAH-xxxxxxxxxxxxxxx
            Keep your token secure and store it safely.
```

El **nombre** puede ser cualquiera, con espacios y acentos. El **username** tiene que ser único en todo Telegram y **terminar en `bot`**; si el que pides ya existe, BotFather te lo dice y pruebas otro. Lo que te devuelve al final es el **token**: esa línea larga con dos puntos en el medio. Cópiala a un bloc de notas.

Para abrir tu bot nuevo: toca el enlace `t.me/tu_bot` que BotFather te manda en ese mismo mensaje. Se abre el chat de tu bot, también con su botón azul **INICIAR**. **Tócalo y mándale un «hola»** — hace falta para el paso siguiente.

> ⚠️ **El token es la llave completa.** Quien lo tenga puede leer lo que le escribas al bot y mandar mensajes en su nombre. No lo subas a GitHub, no lo pegues en un grupo, no lo dejes dentro del código. Si se te escapa, `/revoke` en BotFather genera otro y el viejo muere.

Ya que estás, vuelve al chat de BotFather y deja los comandos puestos: manda `/setcommands`, te pregunta de cuál bot (tócalo en la lista que te muestra) y después pegas esto de un golpe, las tres líneas juntas:

```
nueva - Empieza una conversación nueva
ping - Ver si está vivo
voz - Prender o apagar las notas de voz
```

Eso es lo que hace que salga el menú de comandos cuando escribas `/` en el chat de tu bot.

---

## 2 · Averiguar tu `chat_id`

Es tu número de usuario en Telegram. El bot lo necesita para saber que **solo a ti** te contesta.

### La forma fácil

1. Busca `@userinfobot` en la lupa, igual que antes.
2. Ábrelo y toca **INICIAR**.
3. Te responde de una con tus datos. El número que dice **Id** es tu `chat_id`.

Apúntalo junto al token.

### La otra forma

Si prefieres no usar otro bot, pregúntaselo a la API. Para esto **ya tienes que haberle escrito «hola» a tu bot**; si no, la respuesta sale vacía.

```bash
# macOS / Linux
curl -s "https://api.telegram.org/bot<TU_TOKEN>/getUpdates"

# Windows PowerShell: curl.exe, con el .exe — el alias curl es otra cosa
curl.exe -s "https://api.telegram.org/bot<TU_TOKEN>/getUpdates"
```

Sale un chorro de texto. Busca dentro `"chat":{"id":123456789` — ese número es el tuyo.

---

## 3 · La carpeta

Clona este repo **dentro** del proyecto o la bóveda a la que quieres que Claude tenga acceso. El puente arranca a Claude con la carpeta de arriba como raíz de trabajo: lo que esté ahí es lo que puede leer, y nada más.

```
mi-bóveda/
├── notas/              ← lo que Claude va a poder leer
├── CONTEXTO.md
└── puente/             ← este repo
    ├── instalar.js     ← lo corres una vez
    ├── puente.js
    ├── a-opus.py
    ├── transcribir.py
    ├── telegram.json   ← lo creas tú (ya está en el .gitignore)
    └── estado.json     ← se crea solo, no lo toques
```

```bash
cd mi-bóveda
git clone https://github.com/<usuario>/puente-telegram-claude.git puente
cd puente
cp telegram.ejemplo.json telegram.json
```

Abre `telegram.json` y pon tu token y tu `chat_id`.

> **Dos detalles del JSON.** No metas **comillas dobles** dentro de `prompt`: ese texto se le pasa a Claude como argumento de línea de comandos y en Windows las comillas lo parten. Y `transcribir` déjalo en `false` por ahora.

---

## 4 · Las dos piezas de Python

Una genera la voz y la otra la convierte al formato que Telegram exige para las notas de voz. Gratis, sin cuenta ni API key.

```bash
pip install edge-tts av
```

- **edge-tts** usa las voces neuronales de Microsoft.
- **av** (PyAV) trae libopus incorporado, así que **no hace falta instalar ffmpeg**.

Pruébalas sueltas antes de seguir:

```bash
python -m edge_tts --voice es-VE-SebastianNeural \
  "--rate=+12%" "--volume=+20%" \
  --text "Hola, prueba de voz" --write-media prueba.mp3
```

Si suena, vas bien. ¿Otra voz? `es-CO-GonzaloNeural` es más neutra, `es-MX-JorgeNeural` y `es-ES-AlvaroNeural` también sirven. Lístalas todas con `python -m edge_tts --list-voices`.

> **Por qué `+12%`.** A velocidad normal estas voces suenan lentas y funerarias; subirlas un 12 % las deja en ritmo de conversación. El `+20%` de volumen es porque edge-tts entrega bajo y en la calle no se oye.

---

## 5 · Probarlo

```bash
node puente.js
```

Tiene que imprimir `Puente arriba`. Mándale `/ping` por Telegram: si contesta, el canal está bien. Después pregúntale algo que lo obligue a leer tus archivos. Vas a recibir el texto y, unos segundos después, la nota de voz.

**Si no pasa nada**, casi siempre es una de tres:

1. el `chat_id` no coincide con el tuyo,
2. `claude` no está en el PATH del proceso que arrancaste,
3. el token quedó mal pegado.

Mira la consola, que ahí sale. **Si llega el texto pero no la voz**, el problema está en Python: corre a mano los dos comandos del paso 4.

---

## 6 · Dejarlo corriendo

```bash
npm install -g pm2

pm2 start puente.js --name puente-claude
pm2 save

pm2 logs puente-claude        # ver qué está pasando
pm2 restart puente-claude     # cada vez que toques el código
pm2 stop puente-claude        # apagarlo
```

Para que reviva al reiniciar la máquina: en Linux o macOS, `pm2 startup` y sigue la línea que imprime. En Windows no existe `pm2 startup`; lo más simple es una tarea programada que al iniciar sesión ejecute `pm2 resurrect`.

---

## Opcional · Que te entienda hablando

Hasta aquí el bot te habla pero no te oye. La transcripción corre en tu máquina: **el audio no sale de ahí.**

```bash
pip install faster-whisper
```

Pon `"transcribir": true` en `telegram.json` y reinicia con `pm2 restart puente-claude`. Ya está: el puente usa `transcribir.py` solo.

> En CPU, el modelo `medium` con `int8` es el punto dulce de calidad contra tiempo; descarga alrededor de 1,5 GB la primera vez. Si tu máquina sufre, cambia a `small` (está en la última línea de `transcribir.py`). El `initial_prompt` con tu acento mejora bastante los nombres propios.

---

## Comandos del bot

| Comando | Qué hace |
|---|---|
| `/nueva` | Olvida la conversación y empieza de cero |
| `/ping` | Dice si está vivo, con qué modelo y si la voz está prendida |
| `/voz` | Prende o apaga las notas de voz (útil en reuniones) |

---

## Configuración

| Clave | Qué es |
|---|---|
| `token` | El de BotFather |
| `chat_id` | El tuyo. Es el único que el bot atiende |
| `repo` | Carpeta que Claude puede leer, relativa a esta. Por defecto `..` |
| `modelo` | `sonnet`, `opus`, `haiku`… |
| `tools` | Herramientas permitidas. **Déjalo en solo lectura** |
| `tz` | Tu zona horaria IANA, para el sello de hora |
| `python` | Con qué comando llamar a Python (`python`, `python3`, `py`) |
| `voz` | Voz de edge-tts |
| `velocidad` | `+12%` funciona bien |
| `hablar` | `true` para que mande nota de voz además del texto |
| `transcribir` | `true` para entender tus notas de voz |
| `prompt` | Se añade al system prompt de Claude en cada llamada |

---

## Los nueve tropiezos

Ninguno da un error claro. Todos están ya resueltos en el código; están aquí para que sepas por qué está escrito así y no lo «simplifiques» sin querer.

**1 · `sendAudio` encadena, `sendVoice` no.**
Con `sendAudio` Telegram lo trata como pista de música y su reproductor, al terminar una, sigue solo con las demás del chat: acabas oyendo las respuestas viejas en fila sin pedirlo. `sendVoice` se calla al terminar y permite 2×. A cambio exige OGG/Opus, y por eso existe `a-opus.py`.

**2 · El modelo hay que pasarlo siempre.**
Cada mensaje lanza un `claude -p` nuevo, así que un `/model` escrito dentro de una respuesta muere con el proceso. Peor: al hacer `--resume`, la sesión guardada arrastra el modelo con el que nació. `--model` explícito en cada llamada es lo único que manda.

**3 · Sin sello de hora vive en el pasado.**
La sesión reanudada conserva la fecha del día en que nació. A los dos días te da los buenos días a las nueve de la noche y calcula mal cualquier plazo. Por eso el sello encabeza cada mensaje y el prompt le dice que esa línea manda sobre su propio contexto.

**4 · El encoder se queda en estéreo.**
En la conversión a Opus, si solo remuestreas a mono pero no fijas `layout="mono"` en el *stream*, el encoder sigue en estéreo y duplica el peso del archivo sin decir nada.

**5 · edge-tts con `--file`, no con `--text`.**
Pasando el texto por la línea de comandos, los acentos y los signos se rompen al cruzar la shell en Windows. Y si envuelves esto en PowerShell, guarda el `.ps1` como **UTF-8 con BOM**: PowerShell 5.1 lee los `.ps1` sin BOM como ANSI y destroza las tildes.

**6 · Markdown leído en voz alta.**
El mejor TTS del mundo leyendo markdown dice los asteriscos y recita los encabezados. Se arregla en dos capas: la regla de formato en el prompt, que es la que más pesa, y la limpieza de símbolos antes de mandar el texto al TTS (`paraLeer()`).

**7 · Nombres de temporal fijos.**
Si dos respuestas salen casi juntas, la segunda pisa el audio de la primera. Por eso cada archivo lleva un UUID y se borra en el `finally`. Un leak aquí se nota semanas después, con el disco lleno de `nota_*.mp3`.

**8 · El límite de 4096 caracteres.**
`sendMessage` falla entero si te pasas, no recorta. Hay que partir, y partir por saltos de línea en vez de a lo bruto en mitad de una palabra.

**9 · La primera respuesta siempre tarda.**
Claude arranca de cero y, si le pediste leer archivos, los lee. Sin refrescar el `sendChatAction` cada 5 segundos el chat parece muerto, vuelves a escribir y disparas una segunda respuesta encima.

---

## Seguridad

1. **Un solo `chat_id`, comparado antes que nada.** Cualquiera puede encontrar tu bot por su username y escribirle; esa línea es lo único que lo separa de tus archivos.
2. **El token fuera del repo, desde el primer commit.** Ya está en el `.gitignore`. Si alguna vez lo subes, borrarlo del archivo no basta: queda en el historial. Revócalo en BotFather y genera otro.
3. **Herramientas de solo lectura.** `Read,Grep,Glob` y nada más. Un bot que puede correr `Bash` o escribir archivos, al que se le habla desde un teléfono, es mala idea aunque el chat sea solo tuyo. Y apunta `repo` a la carpeta concreta que quieres exponer, no a la raíz del disco.
4. **Lo que mande solo, que sea seguro en voz alta.** Si le pones mensajes programados, recuerda que pueden sonar con gente al lado.

---

## Checklist

- [ ] `node -v`, `python --version` y `claude -p` responden
- [ ] Bot creado en BotFather y token guardado
- [ ] Le escribí «hola» al bot y saqué mi `chat_id`
- [ ] Repo clonado dentro de la bóveda (o `node instalar.js` corrido)
- [ ] `telegram.json` creado a partir del ejemplo y lleno
- [ ] `pip install edge-tts av` hecho y la voz de prueba suena
- [ ] `/ping` contesta
- [ ] Me llegó una respuesta con su nota de voz
- [ ] Corriendo bajo pm2 con `pm2 save` hecho

---

## Hacia dónde crece

Nada de esto hace falta el primer día, pero es por donde sigue:

- **Agrupar los mensajes que llegan seguidos.** Si pegas tres capturas una detrás de otra, el bot contesta tres veces y cada respuesta ignora las otras dos. Se arregla con una bandeja y una ventana de silencio de unos segundos: todo lo que entra se acumula y sale una sola respuesta.
- **Un candado.** El filtro por `chat_id` no cubre que alguien agarre tu teléfono desbloqueado. Una frase clave guardada como hash SHA-256, que caduca por inactividad y que el bot borra del chat al validarla.
- **Limpiar el chat solo** pasado un rato sin movimiento, con `deleteMessages`.
- **Mensajes programados**, con cron o el programador de tareas, para que te busque él a ti.

---

## Licencia

MIT. Haz lo que quieras con esto.
