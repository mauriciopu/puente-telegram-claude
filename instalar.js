#!/usr/bin/env node
// instalar.js — Deja el puente listo para usar.
//
//   node instalar.js
//
// Hace todo menos lo único que no se puede automatizar: crear el bot en
// BotFather, que es una conversación de Telegram y la tienes que tener tú.
// Lo demás —comprobaciones, chat_id, dependencias, configuración y una
// prueba de punta a punta— corre solo.

const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const rl = require('node:readline/promises');

const AQUI = __dirname;
const CFG_PATH = path.join(AQUI, 'telegram.json');
const WIN = process.platform === 'win32';

// ───── Pintar la consola ─────────────────────────────────────────
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n, t) => color ? `\x1b[${n}m${t}\x1b[0m` : t;
const azul = (t) => c('36', t), verde = (t) => c('32', t);
const rojo = (t) => c('31', t), gris = (t) => c('90', t), fuerte = (t) => c('1', t);

const linea = () => console.log(gris('─'.repeat(58)));
const titulo = (t) => { console.log(''); linea(); console.log(fuerte(t)); linea(); };
const ok = (t) => console.log(`  ${verde('✓')} ${t}`);
const mal = (t) => console.log(`  ${rojo('✗')} ${t}`);
const nota = (t) => console.log(`  ${gris(t)}`);

// ───── Correr un programa ────────────────────────────────────────
function correr(cmd, args, opciones) {
  return new Promise((resolver, rechazar) => {
    const h = spawn(cmd, args, Object.assign({ windowsHide: true }, opciones));
    let salida = '', error = '';
    if (h.stdout) h.stdout.on('data', (d) => salida += d);
    if (h.stderr) h.stderr.on('data', (d) => error += d);
    h.on('error', rechazar);
    h.on('close', (code) => code === 0
      ? resolver((salida + error).trim())
      : rechazar(new Error(error.trim() || salida.trim() || `salió ${code}`)));
  });
}

function correrVisible(cmd, args, opciones) {
  return new Promise((resolver, rechazar) => {
    const h = spawn(cmd, args, Object.assign({ stdio: 'inherit', windowsHide: true }, opciones));
    h.on('error', rechazar);
    h.on('close', (code) => code === 0 ? resolver() : rechazar(new Error(`salió ${code}`)));
  });
}

// ───── Telegram ──────────────────────────────────────────────────
function tg(token, metodo, cuerpo) {
  return new Promise((resolver, rechazar) => {
    const datos = Buffer.from(JSON.stringify(cuerpo || {}), 'utf8');
    const pet = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${metodo}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': datos.length }
    }, (res) => {
      let s = ''; res.setEncoding('utf8');
      res.on('data', (d) => s += d);
      res.on('end', () => { try { resolver(JSON.parse(s)); } catch (e) { rechazar(e); } });
    });
    pet.on('error', rechazar);
    pet.end(datos);
  });
}

function tgArchivo(token, metodo, campos, campo, ruta, tipo) {
  return new Promise((resolver, rechazar) => {
    const lim = '----inst' + crypto.randomBytes(8).toString('hex');
    const partes = [];
    for (const clave of Object.keys(campos)) {
      partes.push(Buffer.from(
        `--${lim}\r\nContent-Disposition: form-data; name="${clave}"\r\n\r\n${campos[clave]}\r\n`, 'utf8'));
    }
    partes.push(Buffer.from(
      `--${lim}\r\nContent-Disposition: form-data; name="${campo}";` +
      ` filename="${path.basename(ruta)}"\r\nContent-Type: ${tipo}\r\n\r\n`, 'utf8'));
    partes.push(fs.readFileSync(ruta));
    partes.push(Buffer.from(`\r\n--${lim}--\r\n`, 'utf8'));
    const cuerpo = Buffer.concat(partes);
    const pet = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${metodo}`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${lim}`,
        'Content-Length': cuerpo.length
      }
    }, (res) => {
      let s = ''; res.setEncoding('utf8');
      res.on('data', (d) => s += d);
      res.on('end', () => { try { resolver(JSON.parse(s)); } catch (e) { rechazar(e); } });
    });
    pet.on('error', rechazar);
    pet.end(cuerpo);
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────
async function main() {
  const pregunta = rl.createInterface({ input: process.stdin, output: process.stdout });
  const si = async (t, pordefecto) => {
    const r = (await pregunta.question(`  ${t} ${gris(pordefecto ? '[S/n]' : '[s/N]')} `)).trim().toLowerCase();
    if (!r) return !!pordefecto;
    return r === 's' || r === 'si' || r === 'sí' || r === 'y';
  };
  const texto = async (t, pordefecto) => {
    const r = (await pregunta.question(`  ${t}${pordefecto ? gris(` [${pordefecto}]`) : ''} `)).trim();
    return r || pordefecto || '';
  };

  console.log('');
  console.log(fuerte(azul('  Puente Telegram ↔ Claude Code')));
  console.log(gris('  Instalador. Ctrl+C para salir en cualquier momento.'));

  // ── 1. Comprobaciones ──────────────────────────────────────────
  titulo('1 · Comprobando lo que hace falta');

  const nodo = process.versions.node;
  if (parseInt(nodo, 10) < 20) { mal(`Node ${nodo}. Hace falta v20 o más.`); process.exit(1); }
  ok(`Node ${nodo}`);

  let python = null;
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      const v = await correr(cmd, ['--version']);
      const n = (v.match(/(\d+)\.(\d+)/) || []).slice(1).map(Number);
      if (n[0] === 3 && n[1] >= 10) { python = cmd; ok(`${v}  (${cmd})`); break; }
    } catch (e) { /* probamos el siguiente */ }
  }
  if (!python) {
    mal('No encontré Python 3.10 o superior.');
    nota('Instálalo desde python.org y vuelve a correr esto.');
    nota('En Windows, marca "Add Python to PATH" en el instalador.');
    process.exit(1);
  }

  try {
    await correr('claude', ['--version'], { shell: WIN });
    ok('Claude Code instalado');
  } catch (e) {
    mal('No encontré el comando `claude`.');
    nota('Instala Claude Code y entra con tu cuenta.');
    nota('Pruébalo con:  claude -p "di hola"');
    process.exit(1);
  }

  // ── 2. El token ────────────────────────────────────────────────
  titulo('2 · El token de tu bot');
  console.log('  Si todavía no tienes bot, esto se hace a mano en Telegram:');
  console.log('');
  console.log(`  ${azul('1.')} Busca ${fuerte('BotFather')} en la lupa de Telegram.`);
  console.log(`  ${azul('2.')} Elige el que tiene el ${fuerte('check azul')}. Los otros son copias.`);
  console.log(`  ${azul('3.')} Dale al botón ${fuerte('INICIAR')} de abajo.`);
  console.log(`  ${azul('4.')} Escríbele ${fuerte('/newbot')} y sigue lo que te pida:`);
  console.log(`     un nombre cualquiera, y un usuario que ${fuerte('termine en bot')}.`);
  console.log(`  ${azul('5.')} Te devuelve el token: una línea larga con dos puntos.`);
  console.log('');

  let token = '', yo = null;
  for (;;) {
    token = (await pregunta.question('  Pega el token aquí: ')).trim();
    if (!token) continue;
    try {
      const r = await tg(token, 'getMe');
      if (r.ok) { yo = r.result; break; }
      mal('Telegram dice que ese token no sirve. Revísalo y pégalo otra vez.');
    } catch (e) {
      mal('No pude hablar con Telegram: ' + e.message);
      nota('¿Hay internet?');
    }
  }
  ok(`Es el bot ${fuerte('@' + yo.username)} ("${yo.first_name}")`);

  // ── 3. El chat_id, solo ────────────────────────────────────────
  titulo('3 · Enlazando tu chat');
  console.log(`  Abre tu bot: ${azul('https://t.me/' + yo.username)}`);
  console.log(`  Dale a ${fuerte('INICIAR')} y mándale cualquier cosa, un "hola".`);
  console.log('');
  process.stdout.write(gris('  Esperando tu mensaje'));

  let chatId = null, desde = 0;
  const limite = Date.now() + 180000;
  while (!chatId && Date.now() < limite) {
    try {
      const r = await tg(token, 'getUpdates', { offset: desde, timeout: 10 });
      for (const u of (r.result || [])) {
        desde = u.update_id + 1;
        if (u.message && u.message.chat) {
          chatId = String(u.message.chat.id);
          var quien = u.message.from || {};
        }
      }
    } catch (e) { /* reintenta */ }
    if (!chatId) { process.stdout.write(gris('.')); await dormir(1200); }
  }
  console.log('');
  if (!chatId) {
    mal('No llegó ningún mensaje en tres minutos.');
    nota('Vuelve a correr el instalador cuando le hayas escrito al bot.');
    process.exit(1);
  }
  ok(`Enlazado con ${fuerte(quien.first_name || 'tu cuenta')}  ${gris('· chat_id ' + chatId)}`);

  // ── 4. Preferencias ────────────────────────────────────────────
  let _n = 3;
  const sig = () => ++_n;

  titulo('4 · Cómo lo quieres');
  console.log(gris('  Entre corchetes va lo que te pongo si solo le das Enter.'));
  console.log(gris('  Nada de esto es para siempre: todo vive en telegram.json y se'));
  console.log(gris('  cambia editando ese archivo y reiniciando el bot.'));

  console.log('');
  console.log(fuerte('  La carpeta'));
  console.log(gris('  Lo que haya ahí dentro es lo que Claude podrá leer cuando le'));
  console.log(gris('  preguntes por tus cosas. Apunta a tu bóveda o a tu proyecto,'));
  console.log(gris('  nunca a la raíz del disco.'));
  const carpeta = await texto('¿Qué carpeta puede leer Claude?', '..');
  const abs = path.resolve(AQUI, carpeta);
  if (!fs.existsSync(abs)) { mal(`No existe: ${abs}`); process.exit(1); }
  nota(`→ ${abs}`);

  console.log('');
  console.log(fuerte('  El modelo'));
  console.log(gris('  sonnet  equilibrado, va bien para el uso diario'));
  console.log(gris('  opus    más capaz y más lento, para análisis largos'));
  console.log(gris('  haiku   el más rápido, para respuestas cortas'));
  const modelo = await texto('¿Cuál usamos?', 'sonnet');

  console.log('');
  console.log(fuerte('  La hora'));
  console.log(gris('  Con esto el bot sabe qué hora es cada vez que le escribes. Si'));
  console.log(gris('  queda mal, te va a dar los buenos días a las nueve de la noche.'));
  const tz = await texto('¿Tu zona horaria?',
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Caracas');

  console.log('');
  console.log(fuerte('  Las notas de voz'));
  console.log(gris('  Además del texto te manda la respuesta hablada. Es lo que más'));
  console.log(gris('  cambia el uso: la oyes manejando o caminando. Si dices que no,'));
  console.log(gris('  el bot funciona igual, solo que escribiendo.'));
  const hablar = await si('¿Te contesto también con nota de voz?', true);

  let voz = 'es-VE-SebastianNeural';
  if (hablar) {
    console.log(gris('    es-VE-SebastianNeural   venezolana'));
    console.log(gris('    es-CO-GonzaloNeural     colombiana, la más neutra'));
    console.log(gris('    es-MX-JorgeNeural       mexicana'));
    console.log(gris('    es-ES-AlvaroNeural      española'));
    console.log(gris('    (hay muchas más: python -m edge_tts --list-voices)'));
    voz = await texto('  ¿Cuál voz?', voz);
  }

  // ── Candado, opcional ──────────────────────────────────────────
  console.log('');
  console.log(fuerte('  El candado'));
  console.log(gris('  El bot ya solo te atiende a ti: nadie más puede escribirle.'));
  console.log(gris('  El candado cubre otra cosa: que alguien que agarre tu teléfono'));
  console.log(gris('  desbloqueado tampoco pueda entrar. Pide una frase para abrir y'));
  console.log(gris('  se cierra solo tras un rato sin usarlo.'));

  const auth = { enabled: false };
  if (await si('¿Le pongo candado?', false)) {
    console.log(gris('    Se guarda solo el hash de la frase, nunca la frase.'));
    console.log(gris('    No importan mayúsculas, tildes ni signos al escribirla.'));
    let frase = '';
    for (;;) {
      frase = await texto('  Frase para abrir:');
      const limpia = frase.toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, '')
        .replace(/\s+/g, ' ').trim();
      if (limpia.length >= 6) { frase = limpia; break; }
      mal('Muy corta. Usa algo de al menos seis letras, mejor varias palabras.');
    }
    auth.enabled = true;
    auth.passhash = crypto.createHash('sha256').update(frase).digest('hex');
    const mins = await texto('  ¿A los cuántos minutos sin usarlo se cierra? (0 = nunca)', '30');
    auth.lock_minutes = Math.max(0, parseInt(mins, 10) || 0);
    auth.respuesta = '⚙️ Servicio no disponible por ahora.';
    ok(`Candado puesto${auth.lock_minutes ? `, cierra a los ${auth.lock_minutes} min` : ', sin caducidad'}`);
    nota('Para abrir le escribes la frase. El bot la borra del chat al validarla.');
    nota('Para cerrar a mano: /cerrar');
  } else {
    nota('Sin candado. Lo puedes encender después en telegram.json.');
  }

  // ── Ajustes finos, para quien los quiera ───────────────────────
  const fino = {
    velocidad: '+12%', volumen: '+20%', tools: 'Read,Grep,Glob',
    transcribir: false, modelo_whisper: 'medium',
    timeout_ms: 300000, trozo_max: 3500, espera_telegram: 50,
    prompt: 'Eres mi asistente personal por Telegram. Antes de responder algo sobre '
          + 'mis cosas, lee los archivos del proyecto en vez de suponer. FORMATO '
          + 'OBLIGATORIO: respuestas CORTAS, maximo 150 palabras, en prosa hablada '
          + 'natural SIN markdown, sin listas, sin encabezados, sin emojis: tu texto '
          + 'se convierte en nota de voz. Como si hablaras por telefono.'
  };

  titulo(sig() + ' · Ajustes finos');
  console.log(gris('  Todo esto ya trae valores que funcionan. Si dices que no, se'));
  console.log(gris('  quedan así, y los puedes cambiar cuando quieras en el archivo.'));
  console.log('');

  if (await si('¿Quieres revisarlos uno por uno?', false)) {
    if (hablar) {
      console.log('');
      console.log(fuerte('  Velocidad y volumen de la voz'));
      console.log(gris('  A 0% estas voces suenan lentas y funerarias; +12% las deja'));
      console.log(gris('  en ritmo de conversación. El volumen sube porque edge-tts'));
      console.log(gris('  entrega bajo y en la calle no se oye.'));
      fino.velocidad = await texto('  Velocidad', fino.velocidad);
      fino.volumen   = await texto('  Volumen', fino.volumen);
    }

    console.log('');
    console.log(fuerte('  Qué puede hacer Claude'));
    console.log(gris('  Read,Grep,Glob = solo leer. Es lo recomendado, y de largo.'));
    console.log(gris('  Añadir Write o Bash le deja cambiar archivos y ejecutar'));
    console.log(gris('  comandos desde un chat de teléfono. Piénsalo dos veces.'));
    fino.tools = await texto('  Herramientas', fino.tools);
    if (/write|bash|edit/i.test(fino.tools)) {
      nota('Le acabas de dar permiso de escritura. Que sea a propósito.');
    }

    console.log('');
    console.log(fuerte('  Entender tus notas de voz'));
    console.log(gris('  Transcribe en tu máquina con faster-whisper; el audio no sale'));
    console.log(gris('  de ahí. La primera vez descarga el modelo: medium pesa ~1,5 GB'));
    console.log(gris('  y small ~500 MB, más rápido pero menos fino.'));
    fino.transcribir = await si('  ¿Lo activo?', false);
    if (fino.transcribir) {
      fino.modelo_whisper = await texto('  ¿Qué modelo? (medium / small / large-v3)', 'medium');
      nota('Falta instalarlo:  ' + python + ' -m pip install faster-whisper');
    }

    console.log('');
    console.log(fuerte('  Cómo le hablas a Claude'));
    console.log(gris('  Esta instrucción se le añade en cada mensaje. La regla de "sin'));
    console.log(gris('  markdown" es la que hace que la nota de voz suene bien: si la'));
    console.log(gris('  quitas, el TTS te lee los asteriscos en voz alta.'));
    if (await si('  ¿Quieres escribir la tuya?', false)) {
      console.log(gris('    En una sola línea. Las comillas dobles se cambian solas.'));
      const propio = await texto('  Instrucción:');
      if (propio) fino.prompt = propio.replace(/"/g, "'");
    }

    console.log('');
    console.log(fuerte('  Tiempos'));
    console.log(gris('  Cuánto espera una respuesta antes de rendirse, y cada cuántos'));
    console.log(gris('  caracteres parte los mensajes largos (Telegram corta en 4096).'));
    const seg = parseInt(await texto('  Segundos de espera por respuesta', '300'), 10);
    fino.timeout_ms = (seg > 0 ? seg : 300) * 1000;
    const tr = parseInt(await texto('  Partir mensajes cada N caracteres', '3500'), 10);
    fino.trozo_max = (tr > 0 && tr < 4096) ? tr : 3500;
  } else {
    nota('Listo, se quedan los recomendados.');
  }

  // ── 5. Dependencias de Python ──────────────────────────────────
  if (hablar) {
    titulo(sig() + ' · Instalando la voz');
    console.log(gris(`  ${python} -m pip install edge-tts av`));
    console.log('');
    try {
      await correrVisible(python, ['-m', 'pip', 'install', '--quiet', 'edge-tts', 'av']);
      ok('edge-tts y PyAV instalados');
    } catch (e) {
      mal('Falló la instalación: ' + e.message);
      nota(`Córrelo a mano:  ${python} -m pip install edge-tts av`);
      process.exit(1);
    }
  }

  // ── 6. Escribir la configuración ───────────────────────────────
  titulo(sig() + ' · Guardando la configuración');

  if (fs.existsSync(CFG_PATH)) {
    const copia = CFG_PATH + '.respaldo-' + Date.now();
    fs.copyFileSync(CFG_PATH, copia);
    nota(`Ya había un telegram.json; lo guardé como ${path.basename(copia)}`);
  }

  const cfg = {
    token, chat_id: chatId,
    repo: carpeta,
    modelo,
    tools: fino.tools,
    tz,
    python,
    voz,
    velocidad: fino.velocidad,
    volumen: fino.volumen,
    hablar,
    transcribir: fino.transcribir,
    modelo_whisper: fino.modelo_whisper,
    timeout_ms: fino.timeout_ms,
    trozo_max: fino.trozo_max,
    espera_telegram: fino.espera_telegram,
    auth,
    prompt: fino.prompt
  };
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  ok('telegram.json escrito');
  nota('Tiene tu token dentro. Ya está en el .gitignore: no lo subas a ningún lado.');

  // ── 7. Prueba de punta a punta ─────────────────────────────────
  titulo(sig() + ' · Probando');

  await tg(token, 'sendMessage', { chat_id: chatId, text: 'Prueba del instalador: el canal de texto funciona.' });
  ok('Mensaje de texto enviado — míralo en Telegram');

  if (hablar) {
    const base = path.join(os.tmpdir(), 'inst_' + crypto.randomUUID());
    const txt = base + '.txt', mp3 = base + '.mp3', ogg = base + '.ogg';
    try {
      fs.writeFileSync(txt, 'Listo. El puente quedó montado y te puedo hablar.', 'utf8');
      await correr(python, ['-m', 'edge_tts', '--voice', voz,
        '--rate=+12%', '--volume=+20%', '--file', txt, '--write-media', mp3]);
      const dur = (await correr(python, [path.join(AQUI, 'a-opus.py'), mp3, ogg])).trim();
      const r = await tgArchivo(token, 'sendVoice',
        { chat_id: chatId, duration: dur }, 'voice', ogg, 'audio/ogg');
      if (r.ok) ok('Nota de voz enviada — escúchala');
      else { mal('Telegram rechazó la nota de voz: ' + JSON.stringify(r)); }
    } catch (e) {
      mal('La cadena de voz falló: ' + e.message);
      nota('El texto sí funciona. Revisa la voz después; el puente arranca igual.');
    } finally {
      for (const f of [txt, mp3, ogg]) { try { fs.unlinkSync(f); } catch (e) {} }
    }
  }

  // ── 8. Arrancar ────────────────────────────────────────────────
  titulo(sig() + ' · Arrancar');

  let haypm2 = false;
  try { await correr('pm2', ['-v'], { shell: WIN }); haypm2 = true; } catch (e) {}

  if (!haypm2 && await si('No tienes pm2. ¿Lo instalo? (mantiene el bot vivo)', true)) {
    try {
      await correrVisible('npm', ['install', '-g', 'pm2'], { shell: WIN });
      haypm2 = true;
      ok('pm2 instalado');
    } catch (e) { mal('No se pudo instalar pm2: ' + e.message); }
  }

  if (haypm2 && await si('¿Arranco el puente ahora con pm2?', true)) {
    try {
      await correrVisible('pm2', ['start', path.join(AQUI, 'puente.js'), '--name', 'puente-claude'],
        { shell: WIN });
      await correr('pm2', ['save'], { shell: WIN });
      ok('Corriendo como ' + fuerte('puente-claude'));
    } catch (e) { mal('No arrancó: ' + e.message); }
  }

  // ── Cierre ─────────────────────────────────────────────────────
  console.log('');
  linea();
  console.log(fuerte(verde('  Listo.')) + ' Escríbele a tu bot en Telegram.');
  linea();
  console.log('');
  console.log('  Comandos del bot:   ' + gris('/ping  /nueva  /voz'));
  if (haypm2) {
    console.log('  Ver qué pasa:       ' + gris('pm2 logs puente-claude'));
    console.log('  Reiniciar:          ' + gris('pm2 restart puente-claude'));
  } else {
    console.log('  Arrancar a mano:    ' + gris('node puente.js'));
  }
  console.log('  Que te oiga hablar: ' + gris('mira la sección opcional del README'));
  console.log('');

  pregunta.close();
}

main().catch((e) => {
  console.error('');
  console.error(rojo('  Se rompió: ') + e.message);
  console.error(gris('  Si no sabes qué es, pega este error en el chat del grupo.'));
  process.exit(1);
});
