'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DD = 'https://ddragon.leagueoflegends.com';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const TAGS = ['Fighter', 'Tank', 'Mage', 'Assassin', 'Marksman', 'Support'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ANSWERS = ['yes', 'no', 'maybe'];
const ANSWER_DE = { yes: 'JA ✅', no: 'NEIN ❌', maybe: 'UNKLAR 🤷' };

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ================= Champion-Daten ================= */
let version = null;
let champions = []; // {id, name, title, tags}

async function loadChampions() {
  const vs = await (await fetch(`${DD}/api/versions.json`)).json();
  const v = vs.find(x => /^\d+\.\d+\.\d+$/.test(x));
  const cj = await (await fetch(`${DD}/cdn/${v}/data/de_DE/champion.json`)).json();
  const list = Object.values(cj.data)
    .map(c => ({
      id: c.id, name: c.name, title: c.title || '', tags: c.tags || [],
      blurb: String(c.blurb || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!list.length) throw new Error('Leere Championliste');
  champions = list;
  version = v;
  console.log(`[ddragon] Patch ${v} geladen, ${list.length} Champions`);
}

async function loadWithRetry() {
  try {
    await loadChampions();
  } catch (e) {
    console.error('[ddragon] Laden fehlgeschlagen:', e.message, '– neuer Versuch in 15 s');
    setTimeout(loadWithRetry, 15000);
  }
}
loadWithRetry();
setInterval(() => loadChampions().catch(e => console.error('[ddragon] Refresh:', e.message)), 6 * 3600 * 1000);

/* ---------- Skins (optional) ---------- */
const skinCache = new Map(); // `${version}:${id}` -> [{num, name}]
async function skinsFor(v, id) {
  const key = `${v}:${id}`;
  if (skinCache.has(key)) return skinCache.get(key);
  const j = await (await fetch(`${DD}/cdn/${v}/data/de_DE/champion/${id}.json`)).json();
  // keine Chromas (haben meist kein eigenes Splash-Bild)
  const skins = (j.data[id].skins || []).filter(s => s.num > 0 && s.parentSkin === undefined).map(s => ({ num: s.num, name: s.name }));
  skinCache.set(key, skins);
  return skins;
}
async function assignSkins(room) {
  const tasks = room.players.map(async p => {
    try {
      const skins = await skinsFor(room.version, p.champ.id);
      p.skin = skins.length ? skins[crypto.randomInt(skins.length)] : null;
    } catch { p.skin = null; }
  });
  // nicht länger als 3 s warten
  await Promise.race([Promise.all(tasks), new Promise(r => setTimeout(r, 3000))]);
}

const poolFor = tags => (tags.length ? champions.filter(c => c.tags.some(t => tags.includes(t))) : champions);
const normalize = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/* ================= Räume ================= */
const rooms = new Map();

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: newCode(),
    hostPid: null,
    players: [],
    state: 'lobby', // lobby | playing | finished
    tags: [],
    yesContinues: true, // bei „Ja“ darf man weiterfragen
    skins: false,       // zufällige Skins statt Standard-Splash
    round: 0,
    turnPid: null,
    doneCounter: 0,
    version: null,
    question: null, // {id, askerPid, text, votes:{pid:answer}}
    lastResult: null,
    history: [],
    qid: 0,
    log: [],
    lastActive: Date.now(),
    hostTimer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function newPlayer(sid, name) {
  return {
    pid: crypto.randomUUID(), sid, name, sockets: new Set(),
    q: 0, penalties: 0, done: false, gaveUp: false, doneOrder: 0, champ: null,
    wins: 0, rounds: 0, totalQ: 0,
  };
}

function resetRoundState(room) {
  room.question = null;
  room.lastResult = null;
  room.history = [];
  room.doneCounter = 0;
}

function addLog(room, text) {
  room.log.push({ t: Date.now(), text });
  if (room.log.length > 40) room.log.shift();
}

const isConnected = p => p.sockets.size > 0;
const byPid = (room, pid) => room.players.find(p => p.pid === pid);

function viewFor(room, sid) {
  const reveal = room.state === 'finished';
  const me = room.players.find(p => p.sid === sid);
  const q = room.question;
  return {
    code: room.code,
    state: room.state,
    round: room.round,
    tags: room.tags,
    yesContinues: room.yesContinues,
    skins: room.skins,
    poolSize: poolFor(room.tags).length,
    version: room.version || version,
    youPid: me ? me.pid : null,
    hostPid: room.hostPid,
    turnPid: room.turnPid,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    question: q && {
      id: q.id,
      askerPid: q.askerPid,
      text: q.text,
      voted: Object.keys(q.votes),
      required: requiredVoters(room, q).map(p => p.pid),
      myVote: me ? q.votes[me.pid] || null : null,
    },
    lastResult: room.lastResult,
    history: room.history.map(h => ({ id: h.id, askerPid: h.askerPid, text: h.text, result: h.result, counts: h.counts, votes: h.votes })),
    players: room.players.map(p => ({
      pid: p.pid,
      name: p.name,
      connected: isConnected(p),
      q: p.q,
      penalties: p.penalties,
      done: p.done,
      gaveUp: p.gaveUp,
      doneOrder: p.doneOrder,
      wins: p.wins,
      rounds: p.rounds,
      totalQ: p.totalQ,
      // Den eigenen Champion bekommt man erst, wenn man fertig ist.
      champ: p.champ && (p.sid !== sid || p.done || reveal) ? { ...p.champ, skin: p.skin || null } : null,
    })),
    log: room.log.slice(-15),
  };
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players) {
    if (!p.sockets.size) continue;
    const view = viewFor(room, p.sid);
    for (const sockId of p.sockets) io.to(sockId).emit('state', view);
  }
}

/* ---------- Zug-Logik ---------- */
function nextUndone(room, startIdx) {
  const n = room.players.length;
  for (let k = 0; k < n; k++) {
    const p = room.players[(((startIdx + k) % n) + n) % n];
    if (!p.done) return p.pid;
  }
  return null;
}

function passTurn(room) {
  room.question = null;
  const idx = room.players.findIndex(p => p.pid === room.turnPid);
  room.turnPid = nextUndone(room, idx + 1);
  const next = byPid(room, room.turnPid);
  if (next) addLog(room, `➡ ${next.name} ist dran.`);
}

function finishPlayer(room, me) {
  me.done = true;
  me.doneOrder = ++room.doneCounter;
  if (room.question && room.question.askerPid === me.pid) room.question = null;
  if (room.turnPid === me.pid) passTurn(room);
  checkFinished(room);
}

function checkFinished(room) {
  if (room.state !== 'playing' || !room.players.length || !room.players.every(p => p.done)) return;
  room.state = 'finished';
  room.turnPid = null;
  room.question = null;
  const solved = room.players.filter(p => !p.gaveUp);
  const best = solved.length ? Math.min(...solved.map(p => p.q)) : null;
  for (const p of room.players) {
    p.rounds += 1;
    p.totalQ += p.q;
    if (best !== null && !p.gaveUp && p.q === best) p.wins += 1;
  }
  addLog(room, `🏁 Runde ${room.round} beendet!`);
}

/* ---------- Fragen & Abstimmung ---------- */
function requiredVoters(room, q) {
  return room.players.filter(p => p.pid !== q.askerPid && isConnected(p));
}

function checkVotes(room) {
  const q = room.question;
  if (!q) return;
  const req = requiredVoters(room, q);
  if (req.length && req.every(p => q.votes[p.pid])) resolveQuestion(room);
}

function resolveQuestion(room) {
  const q = room.question;
  const counts = { yes: 0, no: 0, maybe: 0 };
  for (const a of Object.values(q.votes)) counts[a]++;
  const result = counts.yes > counts.no && counts.yes >= counts.maybe ? 'yes'
    : counts.no > counts.yes && counts.no >= counts.maybe ? 'no' : 'maybe';
  const asker = byPid(room, q.askerPid);
  const entry = { id: q.id, askerPid: q.askerPid, text: q.text, result, counts, votes: { ...q.votes }, t: Date.now() };
  room.history.push(entry);
  room.lastResult = entry;
  room.question = null;
  addLog(room, `${asker ? asker.name : '?'}: „${q.text}“ → ${ANSWER_DE[result]}`);
  if (!(result === 'yes' && room.yesContinues)) passTurn(room);
}

/* ---------- Spielstart ---------- */
function startRound(room) {
  if (!champions.length) return 'Championdaten sind noch nicht geladen – bitte kurz warten.';
  if (room.players.length < MIN_PLAYERS) return `Mindestens ${MIN_PLAYERS} Spieler nötig.`;
  const pool = poolFor(room.tags).slice();
  if (pool.length < room.players.length) return 'Zu wenige Champions für diese Klassenauswahl.';
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  room.round += 1;
  room.version = version;
  room.state = 'playing';
  resetRoundState(room);
  room.players.forEach((p, i) => {
    Object.assign(p, { champ: pool[i], skin: null, q: 0, penalties: 0, done: false, gaveUp: false, doneOrder: 0 });
  });
  room.turnPid = nextUndone(room, (room.round - 1) % room.players.length);
  addLog(room, `🎲 Runde ${room.round} gestartet – ${byPid(room, room.turnPid).name} beginnt.`);
  return null;
}

function pickNewHost(room) {
  const next = room.players.find(isConnected) || room.players[0];
  if (next && next.pid !== room.hostPid) {
    room.hostPid = next.pid;
    addLog(room, `👑 ${next.name} ist jetzt Host.`);
  }
}

function removePlayer(room, pid) {
  const idx = room.players.findIndex(p => p.pid === pid);
  if (idx < 0) return;
  const [p] = room.players.splice(idx, 1);
  for (const sockId of p.sockets) {
    const s = io.sockets.sockets.get(sockId);
    if (s) s.data.code = null;
  }
  if (!room.players.length) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostPid === pid) pickNewHost(room);
  if (room.question) {
    if (room.question.askerPid === pid) room.question = null;
    else delete room.question.votes[pid];
  }
  if (room.state === 'playing') {
    if (room.turnPid === pid) {
      room.question = null;
      room.turnPid = nextUndone(room, idx);
    }
    checkVotes(room);
    checkFinished(room);
  }
  broadcast(room);
}

setInterval(() => {
  const cutoff = Date.now() - 3 * 3600 * 1000;
  for (const [code, room] of rooms) {
    if (!room.players.some(isConnected) && room.lastActive < cutoff) rooms.delete(code);
  }
}, 10 * 60 * 1000);

/* ================= Socket.io ================= */
const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 20);
const cleanText = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 140);
const validSid = s => typeof s === 'string' && s.length >= 10 && s.length <= 100;
const safeAck = ack => (typeof ack === 'function' ? ack : () => {});

io.on('connection', socket => {
  const ctx = () => {
    const room = rooms.get(socket.data.code);
    const me = room && room.players.find(p => p.sid === socket.data.sid);
    return { room, me };
  };
  const isHost = (room, me) => room.hostPid === me.pid;

  function detach() {
    const { room, me } = ctx();
    socket.data.code = null;
    if (!me) return;
    me.sockets.delete(socket.id);
    if (!isConnected(me)) {
      if (room.hostPid === me.pid) {
        clearTimeout(room.hostTimer);
        room.hostTimer = setTimeout(() => {
          const host = byPid(room, room.hostPid);
          if (rooms.has(room.code) && host && !isConnected(host) && room.players.some(isConnected)) {
            pickNewHost(room);
            broadcast(room);
          }
        }, 45000);
      }
      if (room.state === 'playing') checkVotes(room);
      broadcast(room);
    }
  }

  function attach(room, player) {
    detach();
    socket.data.code = room.code;
    socket.data.sid = player.sid;
    player.sockets.add(socket.id);
  }

  const meta = () => ({ version, champList: champions.map(c => ({ id: c.id, name: c.name, tags: c.tags })) });

  socket.on('create', (data, ack) => {
    ack = safeAck(ack);
    const name = cleanName(data && data.name);
    const sid = data && data.sessionId;
    if (!name) return ack({ ok: false, error: 'Bitte gib einen Namen ein.' });
    if (!validSid(sid)) return ack({ ok: false, error: 'Ungültige Sitzung – Seite neu laden.' });
    const room = createRoom();
    const player = newPlayer(sid, name);
    room.players.push(player);
    room.hostPid = player.pid;
    addLog(room, `🏠 ${name} hat den Raum erstellt.`);
    attach(room, player);
    ack({ ok: true, code: room.code, ...meta() });
    broadcast(room);
  });

  socket.on('join', (data, ack) => {
    ack = safeAck(ack);
    const code = String((data && data.code) || '').toUpperCase().trim();
    const sid = data && data.sessionId;
    if (!validSid(sid)) return ack({ ok: false, error: 'Ungültige Sitzung – Seite neu laden.' });
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, notFound: true, error: `Raum „${code}“ gibt es nicht (mehr).` });

    let player = room.players.find(p => p.sid === sid);
    if (!player) {
      const name = cleanName(data && data.name);
      if (!name) return ack({ ok: false, needName: true, error: 'Bitte gib einen Namen ein.' });
      if (room.state !== 'lobby') return ack({ ok: false, error: 'Das Spiel läuft schon. Der Host kann zurück in die Lobby gehen, damit du beitreten kannst.' });
      if (room.players.length >= MAX_PLAYERS) return ack({ ok: false, error: `Der Raum ist voll (max. ${MAX_PLAYERS} Spieler).` });
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return ack({ ok: false, error: 'Dieser Name ist im Raum schon vergeben.' });
      player = newPlayer(sid, name);
      room.players.push(player);
      addLog(room, `👋 ${name} ist beigetreten.`);
    }
    attach(room, player);
    if (room.hostPid === player.pid) clearTimeout(room.hostTimer);
    ack({ ok: true, code: room.code, ...meta() });
    broadcast(room);
  });

  socket.on('leave', (_, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (room && me) {
      addLog(room, `🚪 ${me.name} hat den Raum verlassen.`);
      removePlayer(room, me.pid);
    }
    socket.data.code = null;
    ack({ ok: true });
  });

  socket.on('kick', (data, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || !isHost(room, me)) return ack({ ok: false, error: 'Nur der Host kann Spieler entfernen.' });
    const target = byPid(room, data && data.pid);
    if (!target || target.pid === me.pid) return ack({ ok: false });
    for (const sockId of target.sockets) io.to(sockId).emit('kicked');
    addLog(room, `❌ ${target.name} wurde entfernt.`);
    removePlayer(room, target.pid);
    ack({ ok: true });
  });

  socket.on('settings', (data, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || !isHost(room, me) || room.state !== 'lobby') return ack({ ok: false });
    if (data && Array.isArray(data.tags)) room.tags = TAGS.filter(t => data.tags.includes(t));
    if (data && typeof data.yesContinues === 'boolean') room.yesContinues = data.yesContinues;
    if (data && typeof data.skins === 'boolean') room.skins = data.skins;
    broadcast(room);
    ack({ ok: true });
  });

  socket.on('start', async (_, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || !isHost(room, me)) return ack({ ok: false, error: 'Nur der Host kann starten.' });
    if (room.state === 'playing' || room.starting) return ack({ ok: false, error: 'Die Runde läuft bereits.' });
    const err = startRound(room);
    if (err) return ack({ ok: false, error: err });
    if (room.skins) {
      room.starting = true;
      try { await assignSkins(room); } finally { room.starting = false; }
    }
    broadcast(room);
    ack({ ok: true });
  });

  // Emoji-Reaktionen (nicht gespeichert, nur weitergereicht)
  const REACTIONS = ['😂', '🔥', '💀', '🤔', '👀', '🧠', '😱', '👏'];
  let lastReact = 0;
  socket.on('react', data => {
    const { room, me } = ctx();
    const emoji = data && data.emoji;
    if (!room || !me || !REACTIONS.includes(emoji)) return;
    const now = Date.now();
    if (now - lastReact < 600) return;
    lastReact = now;
    for (const p of room.players) for (const sockId of p.sockets) io.to(sockId).emit('reaction', { name: me.name, emoji });
  });

  socket.on('toLobby', (_, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || !isHost(room, me)) return ack({ ok: false });
    room.state = 'lobby';
    room.turnPid = null;
    resetRoundState(room);
    room.players.forEach(p => Object.assign(p, { champ: null, done: false, gaveUp: false, q: 0, penalties: 0, doneOrder: 0 }));
    addLog(room, '↩ Zurück in der Lobby.');
    broadcast(room);
    ack({ ok: true });
  });

  socket.on('resetScores', (_, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || !isHost(room, me)) return ack({ ok: false });
    room.players.forEach(p => Object.assign(p, { wins: 0, rounds: 0, totalQ: 0 }));
    addLog(room, '🧹 Gesamtwertung zurückgesetzt.');
    broadcast(room);
    ack({ ok: true });
  });

  socket.on('question', (data, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || room.state !== 'playing') return ack({ ok: false });
    const target = byPid(room, data && data.pid);
    if (!target || target.done) return ack({ ok: false });
    target.q = Math.max(0, target.q + (data.delta === -1 ? -1 : 1));
    broadcast(room);
    ack({ ok: true });
  });

  // Spieler am Zug stellt eine Frage
  socket.on('ask', (data, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || room.state !== 'playing') return ack({ ok: false });
    if (room.turnPid !== me.pid) return ack({ ok: false, error: 'Du bist nicht dran.' });
    if (room.question) return ack({ ok: false, error: 'Es läuft schon eine Abstimmung.' });
    const text = cleanText(data && data.text);
    if (text.length < 3) return ack({ ok: false, error: 'Bitte eine Frage eingeben.' });
    room.question = { id: ++room.qid, askerPid: me.pid, text, votes: {} };
    me.q += 1;
    addLog(room, `❓ ${me.name} fragt: „${text}“`);
    broadcast(room);
    ack({ ok: true });
  });

  socket.on('vote', (data, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    const q = room && room.question;
    if (!q || !me || q.askerPid === me.pid) return ack({ ok: false });
    if (data && data.id !== q.id) return ack({ ok: false, error: 'Die Frage ist schon vorbei.' });
    const answer = data && data.answer;
    if (!ANSWERS.includes(answer)) return ack({ ok: false });
    q.votes[me.pid] = answer;
    checkVotes(room);
    broadcast(room);
    ack({ ok: true });
  });

  // Auswerten, bevor alle abgestimmt haben (Fragesteller oder Host)
  socket.on('resolve', (_, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    const q = room && room.question;
    if (!q || !me || (q.askerPid !== me.pid && !isHost(room, me))) return ack({ ok: false });
    if (!Object.keys(q.votes).length) return ack({ ok: false, error: 'Noch keine Stimme abgegeben.' });
    resolveQuestion(room);
    broadcast(room);
    ack({ ok: true });
  });

  socket.on('withdraw', (_, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    const q = room && room.question;
    if (!q || !me || (q.askerPid !== me.pid && !isHost(room, me))) return ack({ ok: false });
    const asker = byPid(room, q.askerPid);
    if (asker) asker.q = Math.max(0, asker.q - 1);
    room.question = null;
    addLog(room, `↶ Frage zurückgezogen.`);
    broadcast(room);
    ack({ ok: true });
  });

  socket.on('nextTurn', (_, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || room.state !== 'playing') return ack({ ok: false });
    if (!isHost(room, me) && room.turnPid !== me.pid) return ack({ ok: false, error: 'Du bist nicht dran.' });
    passTurn(room);
    broadcast(room);
    ack({ ok: true });
  });

  socket.on('guess', (data, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || room.state !== 'playing' || me.done || !me.champ) return ack({ ok: false, error: 'Gerade nicht möglich.' });
    const g = normalize(data && data.guess);
    if (!g) return ack({ ok: false, error: 'Bitte einen Champion eingeben.' });
    const known = champions.some(c => normalize(c.name) === g || normalize(c.id) === g);
    if (!known) return ack({ ok: false, error: 'Diesen Champion kenne ich nicht – bitte aus der Liste wählen.' });

    const correct = normalize(me.champ.name) === g || normalize(me.champ.id) === g;
    if (correct) {
      addLog(room, `🎉 ${me.name} hat ${me.champ.name} erraten – mit ${me.q} ${me.q === 1 ? 'Frage' : 'Fragen'}!`);
      finishPlayer(room, me);
    } else {
      me.q += 1;
      me.penalties += 1;
      addLog(room, `💥 ${me.name} tippt falsch: „${String(data.guess).slice(0, 30)}“ (+1 Frage)`);
      if (room.turnPid === me.pid) passTurn(room);
    }
    broadcast(room);
    ack({ ok: true, correct, champ: correct ? me.champ : null });
  });

  socket.on('giveUp', (_, ack) => {
    ack = safeAck(ack);
    const { room, me } = ctx();
    if (!room || !me || room.state !== 'playing' || me.done) return ack({ ok: false });
    me.gaveUp = true;
    addLog(room, `🏳 ${me.name} gibt auf – es war ${me.champ.name}.`);
    finishPlayer(room, me);
    broadcast(room);
    ack({ ok: true, champ: me.champ });
  });

  socket.on('disconnect', detach);
});

/* ================= HTTP ================= */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC));
app.get('/room/:code', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/healthz', (req, res) => res.json({ ok: true, version, champions: champions.length, rooms: rooms.size }));

server.listen(PORT, () => console.log(`Wer bin ich? läuft auf http://localhost:${PORT}`));

// Render (Free) schläft nach 15 min ohne HTTP-Anfragen ein. Solange jemand in einem
// Raum verbunden ist, ruft der Server sich deshalb alle 10 min selbst auf.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    const active = [...rooms.values()].some(r => r.players.some(isConnected));
    if (active) fetch(`${SELF_URL}/healthz`).catch(() => {});
  }, 10 * 60 * 1000);
}
