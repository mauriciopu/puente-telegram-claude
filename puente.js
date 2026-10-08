// puente.js — Telegram <-> Claude Code (headless)
// Un solo archivo, sin dependencias de npm.
// Arrancar:  pm2 start puente.js --name puente-claude

const { spawn } = require('child_process');
const https  = require('https');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const AQUI        = __dirname;
const CFG         = JSON.parse(fs.readFileSync(path.join(AQUI, 'telegram.json'), 'utf8'));
const REPO        = path.resolve(AQUI, CFG.repo || '..');
const ESTADO      = path.join(AQUI, 'estado.json');
const A_OPUS      = path.join(AQUI, 'a-opus.py');
const TRANSCRIBIR = path.join(AQUI, 'transcribir.py');
const TZ          = CFG.tz || 'America/Caracas';
const PY          = CFG.python || 'python';   // el instalador detecta cuál sirve
const WIN         = process.platform === 'win32';

// ───── Candado opcional ──────────────────────────────────────────
// Por defecto está apagado y no hace falta. El filtro por chat_id ya impide
// que otra persona use el bot desde su propio Telegram. El candado cubre otra
// cosa distinta: que alguien que agarre tu teléfono ya desbloqueado tampoco
// pueda entrar. Si manejas cosas sensibles, enciéndelo; si no, déjalo así.
const AUTH = CFG.auth || { enabled: false };

function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, '').replace(/\s+/g, ' ').trim();
}

// Solo se guarda el hash de la frase, nunca la frase. Se normaliza antes para
// que no importen mayúsculas, tildes ni signos al escribirla desde el teléfono.
function esFraseClave(s) {
  if (!AUTH.passhash) return false;
  return crypto.createHash('sha256').update(normalizar(s)).digest('hex') === AUTH.passhash;
}

function sesionVencida() {
  const mins = AUTH.lock_minutes == null ? 30 : AUTH.lock_minutes;
  if (!mins) return false;                       // 0 = no caduca nunca
  return (Date.now() - (estado.actividad || 0)) > mins * 60000;
}

let estado = { offset: 0, sesion: null, hablar: CFG.hablar !== false,
               abierta: false, actividad: 0 };
try { Object.assign(estado, JSON.parse(fs.readFileSync(ESTADO, 'utf8'))); } catch (e) {}
const guardar = () => fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 2));

// ───── Telegram, llamada normal ──────────────────────────────────
function tg(metodo, cuerpo) {
  return new Promise((resolver, rechazar) => {
    const datos = Buffer.from(JSON.stringify(cuerpo), 'utf8');
    const pet = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${CFG.token}/${metodo}`,
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

// ───── Telegram, subir un archivo (multipart a mano, sin librerías) ─
function tgArchivo(metodo, campos, campo, ruta, tipo) {
  return new Promise((resolver, rechazar) => {
    const lim = '----puente' + crypto.randomBytes(8).toString('hex');
    const partes = [];
    for (const clave of Object.keys(campos)) {
      partes.push(Buffer.from(
        `--${lim}\r\nContent-Disposition: form-data; name="${clave}"\r\n\r\n${campos[clave]}\r\n`,
        'utf8'));
    }
    partes.push(Buffer.from(
      `--${lim}\r\nContent-Disposition: form-data; name="${campo}";` +
      ` filename="${path.basename(ruta)}"\r\nContent-Type: ${tipo}\r\n\r\n`, 'utf8'));
    partes.push(fs.readFileSync(ruta));
    partes.push(Buffer.from(`\r\n--${lim}--\r\n`, 'utf8'));
    const cuerpo = Buffer.concat(partes);

    const pet = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${CFG.token}/${metodo}`,
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

// ───── Bajar un archivo ──────────────────────────────────────────
function bajar(url, destino) {
  return new Promise((resolver, rechazar) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return rechazar(new Error('HTTP ' + res.statusCode)); }
      const f = fs.createWriteStream(destino);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolver()));
      f.on('error', rechazar);
    }).on('error', rechazar);
  });
}

// ───── Correr un programa y devolver su salida ───────────────────
function correr(cmd, args) {
  return new Promise((resolver, rechazar) => {
    const h = spawn(cmd, args, { windowsHide: true });
    let salida = '', error = '';
    h.stdout.on('data', (d) => salida += d);
    h.stderr.on('data', (d) => error  += d);
    h.on('error', rechazar);
    h.on('close', (c) => c === 0 ? resolver(salida)
                                 : rechazar(new Error(error.trim() || cmd + ' salió ' + c)));
  });
}

// ───── El sello de hora: encabeza CADA mensaje ───────────────────
// Sin esto, al reanudar con --resume Claude cree que sigue siendo el día en
// que nació la sesión, y te da los buenos días a las nueve de la noche.
function sello() {
  const d = new Date();
  const fecha = d.toLocaleString('es', { timeZone: TZ, weekday: 'long',
                  day: 'numeric', month: 'long', year: 'numeric' });
  const hora  = d.toLocaleString('es', { timeZone: TZ, hour: 'numeric',
                  minute: '2-digit', hour12: true });
  return `[AHORA MISMO: ${fecha}, ${hora}. Esta línea es la única hora válida: `
       + `ignora cualquier otra referencia temporal de tu contexto.]`;
}

// ───── Preguntarle a Claude ──────────────────────────────────────
function preguntar(texto) {
  return new Promise((resolver) => {
    const prompt = CFG.prompt || '';
    const args = [
      '-p', '--output-format', 'json',
      '--model', CFG.modelo || 'sonnet',
      '--allowedTools', CFG.tools || 'Read,Grep,Glob',
      // En Windows hay que ir por el shell (claude es un .cmd) y el prompt
      // necesita sus comillas; fuera de Windows va crudo.
      '--append-system-prompt', WIN ? JSON.stringify(prompt) : prompt
    ];
    if (estado.sesion) args.push('--resume', estado.sesion);

    const hijo = spawn('claude', args, { cwd: REPO, shell: WIN, windowsHide: true });
    let salida = '', error = '';
    const reloj = setTimeout(() => { try { hijo.kill(); } catch (e) {} }, 300000);

    hijo.stdout.on('data', (d) => salida += d);
    hijo.stderr.on('data', (d) => error  += d);
    hijo.on('close', () => {
      clearTimeout(reloj);
      try {
        const j = JSON.parse(salida);
        if (j.session_id) { estado.sesion = j.session_id; guardar(); }
        resolver(j.result || '(respuesta vacía)');
      } catch (e) {
        if (estado.sesion) {              // la sesión guardada ya no existe
          estado.sesion = null; guardar();
          return preguntar(texto).then(resolver);
        }
        console.error('claude falló:', error || salida);
        resolver('Se me trancó el procesador. Intenta de nuevo.');
      }
    });

    hijo.stdin.write(`${sello()}\n\n${texto}`, 'utf8');
    hijo.stdin.end();
  });
}

// ───── Quitar markdown antes de leerlo en voz alta ───────────────
function paraLeer(t) {
  return t.replace(/```[\s\S]*?```/g, ' ')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/[#*_`>|]/g, '')
          .trim();
}

// ───── Mandar la respuesta como NOTA DE VOZ ──────────────────────
// sendVoice, nunca sendAudio: con sendAudio Telegram lo trata como pista de
// música y al terminar sigue solo con las anteriores del chat.
async function enviarVoz(chatId, texto) {
  const base = path.join(os.tmpdir(), 'nota_' + crypto.randomUUID());
  const txt = base + '.txt', mp3 = base + '.mp3', ogg = base + '.ogg';
  try {
    const limpio = paraLeer(texto);
    if (!limpio) return;
    fs.writeFileSync(txt, limpio, 'utf8');
    // El texto va por --file: con --text se rompen los acentos en Windows.
    await correr(PY, ['-m', 'edge_tts',
      '--voice', CFG.voz || 'es-VE-SebastianNeural',
      `--rate=${CFG.velocidad || '+12%'}`, '--volume=+20%',
      '--file', txt, '--write-media', mp3]);
    const dur = (await correr(PY, [A_OPUS, mp3, ogg])).trim();
    await tgArchivo('sendVoice', { chat_id: chatId, duration: dur },
                    'voice', ogg, 'audio/ogg');
  } catch (e) {
    console.error('nota de voz:', e.message);   // el texto ya salió, no pasa nada
  } finally {
    for (const f of [txt, mp3, ogg]) { try { fs.unlinkSync(f); } catch (e) {} }
  }
}

// ───── Telegram corta en 4096 caracteres ─────────────────────────
function trozos(t, max = 3500) {
  const partes = [];
  while (t.length > max) {
    let corte = t.lastIndexOf('\n', max);
    if (corte < max * 0.5) corte = max;
    partes.push(t.slice(0, corte));
    t = t.slice(corte);
  }
  partes.push(t);
  return partes;
}

// ───── Atender un mensaje ────────────────────────────────────────
async function atender(msg) {
  const chatId = String(msg.chat.id);
  if (chatId !== String(CFG.chat_id)) return;        // nadie más entra
  let texto = (msg.text || msg.caption || '').trim();

  // Nota de voz entrante (solo si transcribir: true)
  const nota = msg.voice || msg.audio;
  if (nota && CFG.transcribir) {
    const r = await tg('getFile', { file_id: nota.file_id });
    if (r && r.ok) {
      const entrada = path.join(os.tmpdir(), 'in_' + crypto.randomUUID() + '.oga');
      try {
        await bajar(`https://api.telegram.org/file/bot${CFG.token}/${r.result.file_path}`, entrada);
        texto = (await correr(PY, [TRANSCRIBIR, entrada])).trim();
      } catch (e) { console.error('transcribir:', e.message); }
      finally { try { fs.unlinkSync(entrada); } catch (e) {} }
    }
  }
  if (!texto) return;

  // ───── Candado, si está encendido ─────
  if (AUTH.enabled) {
    if (estado.abierta && sesionVencida()) { estado.abierta = false; guardar(); }

    if (!estado.abierta) {
      if (esFraseClave(texto)) {
        estado.abierta = true; estado.actividad = Date.now(); guardar();
        // La frase no puede quedar escrita en el chat.
        tg('deleteMessage', { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
        return void tg('sendMessage', { chat_id: chatId, text: 'Abierto.' });
      }
      // Respuesta neutra: al que no pasa no se le dice que hay un candado.
      return void tg('sendMessage', { chat_id: chatId,
        text: AUTH.respuesta || '⚙️ Servicio no disponible por ahora.' });
    }

    estado.actividad = Date.now(); guardar();

    if (texto === '/cerrar') {
      estado.abierta = false; guardar();
      return void tg('sendMessage', { chat_id: chatId, text: 'Cerrado.' });
    }
  }

  if (texto === '/nueva') {
    estado.sesion = null; guardar();
    return void tg('sendMessage', { chat_id: chatId, text: 'Conversación nueva.' });
  }
  if (texto === '/voz') {
    estado.hablar = !estado.hablar; guardar();
    return void tg('sendMessage', { chat_id: chatId,
      text: estado.hablar ? 'Notas de voz: prendidas.' : 'Notas de voz: apagadas.' });
  }
  if (texto === '/ping') {
    return void tg('sendMessage', { chat_id: chatId,
      text: `Vivo. Modelo ${CFG.modelo || 'sonnet'}.`
          + ` Sesión ${estado.sesion ? 'activa' : 'nueva'}.`
          + ` Voz ${estado.hablar ? 'prendida' : 'apagada'}.`
          + (AUTH.enabled
              ? ` Candado puesto, cierra a los ${AUTH.lock_minutes == null ? 30 : AUTH.lock_minutes} min sin uso.`
              : ' Sin candado.') });
  }

  // El "escribiendo..." caduca a los 5 s: hay que refrescarlo.
  const escribiendo = setInterval(() =>
    tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}), 5000);
  tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  try {
    const respuesta = await preguntar(texto);
    for (const parte of trozos(respuesta)) {
      await tg('sendMessage', { chat_id: chatId, text: parte });
    }
    if (estado.hablar) await enviarVoz(chatId, respuesta);
  } catch (e) {
    console.error('atender:', e.message);
  } finally {
    clearInterval(escribiendo);
  }
}

// ───── Bucle de long polling ─────────────────────────────────────
async function bucle() {
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset: estado.offset + 1, timeout: 50 });
      for (const u of (r.result || [])) {
        estado.offset = u.update_id; guardar();
        if (u.message) await atender(u.message);
      }
    } catch (e) {
      console.error('bucle:', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

console.log('Puente arriba. Carpeta de trabajo:', REPO);
bucle();
