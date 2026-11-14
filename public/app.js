(() => {
'use strict';

const DD = 'https://ddragon.leagueoflegends.com';
const TAGS = [
  ['Fighter', 'Kämpfer'], ['Tank', 'Tank'], ['Mage', 'Magier'],
  ['Assassin', 'Assassine'], ['Marksman', 'Schütze'], ['Support', 'Unterstützer'],
];
const TAG_DE = Object.fromEntries(TAGS);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const splashUrl = id => `${DD}/cdn/img/champion/splash/${id}_0.jpg`;
const iconUrl = (v, id) => `${DD}/cdn/${v}/img/champion/${id}.png`;
const qWord = n => (n === 1 ? 'Frage' : 'Fragen');
const poolLabel = tags => (tags.length ? tags.map(t => TAG_DE[t] || t).join(' / ') : 'Alle Champions');

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- Session ---------- */
let sessionId = store.get('wbi.sid');
if (!sessionId) { sessionId = uuid(); store.set('wbi.sid', sessionId); }

let currentCode = null;
let view = null;
let champList = [];
let ddVersion = null;
let lastOwnChamp = null; // für Aufdeck-Animation
let lastRound = 0;
let lastQ = {};

/* ---------- Toast ---------- */
let toastT;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = 'toast'; }, 2600);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link kopiert – ab damit in den Discord!', 'good'); }
  catch { prompt('Link kopieren:', text); }
}

/* ---------- Views ---------- */
function show(id) {
  ['home', 'lobby', 'game'].forEach(v => $('#' + v).classList.toggle('hidden', v !== id));
  $('#logo').classList.toggle('compact', id === 'game');
}

function goHome(prefillCode) {
  currentCode = null;
  view = null;
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  $('#nameIn').value = store.get('wbi.name') || '';
  if (prefillCode) $('#codeIn').value = prefillCode;
  const last = store.get('wbi.lastRoom');
  const rb = $('#rejoinBtn');
  if (last && last !== prefillCode) { rb.textContent = `↩ Zurück zu Raum ${last}`; rb.dataset.code = last; rb.classList.remove('hidden'); }
  else rb.classList.add('hidden');
  show('home');
}

/* ---------- Socket ---------- */
const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  $('#offline').classList.add('hidden');
  if (currentCode) joinRoom(currentCode, { silent: true });
});
socket.on('disconnect', () => $('#offline').classList.remove('hidden'));
socket.on('state', v => { view = v; render(); });
socket.on('kicked', () => {
  store.del('wbi.lastRoom');
  toast('Du wurdest vom Host aus dem Raum entfernt.', 'err');
  goHome();
});

function handleJoined(res) {
  currentCode = res.code;
  champList = res.champList || [];
  ddVersion = res.version;
  store.set('wbi.lastRoom', res.code);
  const path = '/room/' + res.code;
  if (location.pathname !== path) history.replaceState(null, '', path);
}

function joinRoom(code, { silent = false } = {}) {
  code = String(code || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{4,5}$/.test(code)) { toast('Der Raumcode hat 4–5 Zeichen.', 'err'); return; }
  const name = $('#nameIn').value.trim() || store.get('wbi.name') || '';
  socket.emit('join', { code, name, sessionId }, res => {
    if (res && res.ok) return handleJoined(res);
    if (res && res.notFound) store.del('wbi.lastRoom');
    if (res && res.needName) {
      goHome(code);
      if (!silent) toast('Gib deinen Namen ein und tippe auf „Beitreten“.');
      $('#nameIn').focus();
      return;
    }
    goHome(code);
    toast((res && res.error) || 'Beitreten fehlgeschlagen.', 'err');
  });
}

/* ---------- Home ---------- */
function readName() {
  const n = $('#nameIn').value.trim();
  if (!n) { toast('Bitte zuerst deinen Namen eingeben.', 'err'); $('#nameIn').focus(); return null; }
  store.set('wbi.name', n);
  return n;
}
$('#createBtn').onclick = () => {
  const name = readName(); if (!name) return;
  socket.emit('create', { name, sessionId }, res => {
    if (res && res.ok) handleJoined(res);
    else toast((res && res.error) || 'Raum konnte nicht erstellt werden.', 'err');
  });
};
$('#joinBtn').onclick = () => { if (readName()) joinRoom($('#codeIn').value); };
$('#codeIn').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
$('#nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') ($('#codeIn').value ? $('#joinBtn') : $('#createBtn')).click(); });
$('#rejoinBtn').onclick = e => { $('#codeIn').value = e.currentTarget.dataset.code; $('#joinBtn').click(); };

/* ---------- Common buttons ---------- */
document.addEventListener('click', e => {
  if (e.target.closest('[data-copy-link]') && currentCode) copy(`${location.origin}/room/${currentCode}`);
  if (e.target.closest('[data-leave]')) {
    if (!confirm('Raum wirklich verlassen?')) return;
    socket.emit('leave', null, () => {});
    store.del('wbi.lastRoom');
    goHome();
  }
});

/* ---------- Render ---------- */
const isHost = () => view && view.youPid === view.hostPid;
const me = () => view && view.players.find(p => p.pid === view.youPid);
const byPid = pid => view.players.find(p => p.pid === pid);

function render() {
  if (!view || !currentCode) return;
  if (view.state === 'lobby') { show('lobby'); renderLobby(); }
  else { show('game'); renderGame(); }
}

function renderLobby() {
  $('#lCode').textContent = view.code;
  $('#lCount').textContent = `(${view.players.length}/${view.maxPlayers})`;
  const host = isHost();
  const rows = view.players.map(p => `
    <li class="${p.pid === view.youPid ? 'you' : ''}">
      <span class="dot ${p.connected ? '' : 'off'}" title="${p.connected ? 'online' : 'offline'}"></span>
      <span class="nm">${esc(p.name)}</span>
      ${p.pid === view.hostPid ? '<span class="badge">👑 Host</span>' : ''}
      ${p.pid === view.youPid ? '<span class="badge du">Du</span>' : ''}
      ${host && p.pid !== view.youPid ? `<button class="btn small danger" type="button" data-kick="${p.pid}" aria-label="${esc(p.name)} entfernen">✕</button>` : ''}
    </li>`);
  for (let i = view.players.length; i < view.maxPlayers; i++) rows.push('<li class="empty">Freier Platz …</li>');
  $('#lPlayers').innerHTML = rows.join('');

  $('#lChips').innerHTML =
    `<button type="button" class="chip ${view.tags.length ? '' : 'on'}" data-tag="" ${host ? '' : 'disabled'}>Alle</button>` +
    TAGS.map(([k, de]) => `<button type="button" class="chip ${view.tags.includes(k) ? 'on' : ''}" data-tag="${k}" ${host ? '' : 'disabled'}>${de}</button>`).join('');
  const enough = view.poolSize >= view.players.length;
  $('#lPool').innerHTML = `<b>${view.poolSize}</b> Champions im Pool` + (host ? '' : ' · nur der Host kann das ändern') +
    (enough ? '' : ' · <span style="color:var(--bad)">zu wenige für alle Spieler</span>');

  $('#startBtn').classList.toggle('hidden', !host);
  $('#lWait').classList.toggle('hidden', host);
  const canStart = view.players.length >= view.minPlayers && enough && view.poolSize > 0;
  $('#startBtn').disabled = !canStart;
  $('#startBtn').textContent = view.players.length < view.minPlayers
    ? `Warte auf Mitspieler (mind. ${view.minPlayers})`
    : (view.round > 0 ? `Runde ${view.round + 1} starten` : 'Spiel starten');
}

$('#lChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b || b.disabled || !isHost()) return;
  const t = b.dataset.tag;
  let tags = view.tags.slice();
  if (!t) tags = [];
  else tags = tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t];
  socket.emit('settings', { tags });
});
$('#lPlayers').addEventListener('click', e => {
  const b = e.target.closest('[data-kick]'); if (!b) return;
  const p = byPid(b.dataset.kick);
  if (p && confirm(`${p.name} aus dem Raum entfernen?`)) socket.emit('kick', { pid: p.pid });
});
$('#startBtn').onclick = () => socket.emit('start', null, res => { if (!res.ok) toast(res.error || 'Start fehlgeschlagen.', 'err'); });

function renderGame() {
  const host = isHost();
  const self = me();
  const playing = view.state === 'playing';
  const v = view.version || ddVersion;

  $('#gCode').textContent = view.code;
  $('#gRound').textContent = view.round;
  $('#gPool').textContent = poolLabel(view.tags);
  $('#toLobbyBtn').classList.toggle('hidden', !host);

  // Animation des eigenen Aufdeckens erkennen
  if (view.round !== lastRound) { lastOwnChamp = null; lastQ = {}; lastRound = view.round; }
  const ownChamp = self && self.champ ? self.champ.id : null;
  const animateOwn = ownChamp && !lastOwnChamp;
  lastOwnChamp = ownChamp;

  // Zug-Anzeige
  const tb = $('#turnBar');
  const turn = view.turnPid && byPid(view.turnPid);
  if (!playing) {
    tb.className = 'turnbar fin';
    tb.innerHTML = '<span class="t">🏁 <b>Runde beendet</b> – alle haben ihren Champion erraten.</span>';
  } else if (turn) {
    const mine = turn.pid === view.youPid;
    tb.className = 'turnbar' + (mine ? ' mine' : '');
    tb.innerHTML = `<span class="t">${mine ? '🎯 <b>Du bist dran!</b> Stell deine Ja/Nein-Frage.' : `⏳ Am Zug: <b>${esc(turn.name)}</b>`}</span>
      ${mine ? '<button class="btn small primary" type="button" data-act="next">Zug beenden ▶</button>'
             : host ? '<button class="btn small" type="button" data-act="next">Nächster ▶</button>' : ''}`;
  } else {
    tb.className = 'turnbar'; tb.innerHTML = '';
  }

  // Karten
  const grid = $('#grid');
  grid.className = `grid n${view.players.length}`;
  grid.innerHTML = view.players.map(p => {
    const isMe = p.pid === view.youPid;
    const isTurn = playing && p.pid === view.turnPid;
    const c = p.champ;
    const front = c
      ? `<img src="${splashUrl(c.id)}" alt="${esc(c.name)}" data-fb="${iconUrl(v, c.id)}"><div class="cname">${esc(c.name)}<small>${esc(c.title)}</small></div>`
      : '';
    let art;
    if (isMe) {
      art = `<div class="flip ${c && !animateOwn ? 'revealed' : ''}" ${animateOwn ? 'data-anim' : ''}>
        <div class="face mystery"><div class="ring">?</div><div class="lbl">Dein Champion</div></div>
        ${c ? `<div class="face rot">${front}</div>` : ''}
      </div>`;
    } else {
      art = `<div class="face">${front || '<div class="face mystery"><div class="ring">?</div></div>'}</div>`;
    }
    const ribbon = p.done ? `<div class="ribbon done">✓ Fertig · ${p.q} ${qWord(p.q)}</div>`
      : isTurn ? '<div class="ribbon turn">Am Zug</div>' : '';
    const bump = lastQ[p.pid] !== undefined && lastQ[p.pid] !== p.q;
    lastQ[p.pid] = p.q;
    let action = '';
    if (isMe && playing && !p.done) action = `<button class="btn primary" type="button" data-act="guess">Ich hab's erraten!</button>`;
    else if (p.done) action = `<div class="fin-note">✓ Erraten mit ${p.q} ${qWord(p.q)}</div>`;
    return `
      <article class="card ${isMe ? 'me' : ''} ${isTurn ? 'turn' : ''} ${p.done ? 'done' : ''} ${p.connected ? '' : 'is-offline'}">
        ${ribbon}
        ${p.connected ? '' : '<div class="ribbon off">offline</div>'}
        <div class="art">${art}</div>
        <div class="body">
          <div class="pname"><span class="n" title="${esc(p.name)}">${esc(p.name)}</span>
            ${p.pid === view.hostPid ? '<span title="Host">👑</span>' : ''}${isMe ? '<span class="badge du">Du</span>' : ''}</div>
          <div class="counter ${bump ? 'bump' : ''}">
            <button class="minus" type="button" data-act="q" data-d="-1" data-pid="${p.pid}" aria-label="Frage abziehen" ${!playing || p.done || p.q === 0 ? 'disabled' : ''}>−</button>
            <div class="val"><b>${p.q}</b><small>${qWord(p.q)}</small></div>
            <button class="plus" type="button" data-act="q" data-d="1" data-pid="${p.pid}" aria-label="Frage hinzufügen" ${!playing || p.done ? 'disabled' : ''}>+1</button>
          </div>
          ${p.penalties ? `<div class="pen">davon ${p.penalties}× falsch getippt</div>` : ''}
          <div class="btns">${action}</div>
        </div>
      </article>`;
  }).join('');

  grid.querySelectorAll('img[data-fb]').forEach(im => {
    im.addEventListener('error', function onErr() {
      im.removeEventListener('error', onErr);
      im.src = im.dataset.fb; im.classList.add('icon');
    });
  });
  const anim = grid.querySelector('.flip[data-anim]');
  if (anim) requestAnimationFrame(() => requestAnimationFrame(() => anim.classList.add('revealed')));

  renderRanking(host);
  $('#log').innerHTML = view.log.slice().reverse().map(l => {
    const d = new Date(l.t);
    return `<li><time>${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</time>${esc(l.text)}</li>`;
  }).join('');
}

function renderRanking(host) {
  const el = $('#rank');
  const done = view.players.filter(p => p.done).sort((a, b) => a.q - b.q || a.doneOrder - b.doneOrder);
  if (!done.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const finished = view.state === 'finished';
  const open = view.players.filter(p => !p.done);
  const medals = ['🥇', '🥈', '🥉'];
  let place = 0, prevQ = null;
  const rows = done.map((p, k) => {
    if (p.q !== prevQ) { place = k + 1; prevQ = p.q; }
    return `<li class="${place === 1 ? 'first' : ''}">
      <span class="place">${medals[place - 1] || place + '.'}</span>
      <span class="who"><b>${esc(p.name)}</b>${p.pid === view.youPid ? ' (du)' : ''}<small>${esc(p.champ ? p.champ.name : '')}${p.penalties ? ` · ${p.penalties}× falsch` : ''}</small></span>
      <span class="qs">${p.q} ${qWord(p.q)}</span></li>`;
  }).concat(open.map(p => `<li class="open">
      <span class="place">–</span>
      <span class="who"><b>${esc(p.name)}</b>${p.pid === view.youPid ? ' (du)' : ''}<small>rät noch …</small></span>
      <span class="qs">${p.q} bisher</span></li>`));
  const actions = finished
    ? (host
        ? `<div class="actions"><button class="btn primary" type="button" data-act="newround">↻ Neue Runde</button>
           <button class="btn" type="button" data-act="lobby">↩ Zur Lobby (Einstellungen)</button></div>`
        : '<p class="help">Warte, bis der Host eine neue Runde startet …</p>')
    : '';
  el.innerHTML = `<h2><span>🏆 ${finished ? 'Rangliste' : 'Zwischenstand'} · Runde ${view.round}</span>${finished ? '<span class="done-l">Runde beendet</span>' : ''}</h2><ol>${rows.join('')}</ol>${actions}`;
}

$('#game').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act;
  const fail = res => { if (res && !res.ok && res.error) toast(res.error, 'err'); };
  if (act === 'q') socket.emit('question', { pid: b.dataset.pid, delta: +b.dataset.d }, fail);
  else if (act === 'next') socket.emit('nextTurn', null, fail);
  else if (act === 'guess') openGuess();
  else if (act === 'newround') socket.emit('start', null, fail);
  else if (act === 'lobby') socket.emit('toLobby', null, fail);
});
$('#toLobbyBtn').onclick = () => {
  if (view.state === 'playing' && !confirm('Laufende Runde abbrechen und zurück in die Lobby?')) return;
  socket.emit('toLobby', null, () => {});
};

/* ---------- Guess-Modal mit Autocomplete ---------- */
let suggIdx = -1;
let suggItems = [];
let sending = false;

function openGuess() {
  $('#guessIn').value = '';
  $('#sugg').innerHTML = '';
  suggItems = []; suggIdx = -1;
  $('#modal').classList.remove('hidden');
  setTimeout(() => $('#guessIn').focus(), 30);
}
function closeGuess() { $('#modal').classList.add('hidden'); }

function updateSugg() {
  const q = norm($('#guessIn').value);
  if (!q) { suggItems = []; $('#sugg').innerHTML = ''; return; }
  const starts = [], incl = [];
  for (const c of champList) {
    const n = norm(c.name), id = norm(c.id);
    if (n.startsWith(q) || id.startsWith(q)) starts.push(c);
    else if (n.includes(q)) incl.push(c);
  }
  suggItems = starts.concat(incl).slice(0, 8);
  suggIdx = suggItems.length ? 0 : -1;
  drawSugg();
}
function drawSugg() {
  const v = view?.version || ddVersion;
  $('#sugg').innerHTML = suggItems.map((c, i) =>
    `<li role="option" data-i="${i}" class="${i === suggIdx ? 'act' : ''}" aria-selected="${i === suggIdx}">
      <img src="${iconUrl(v, c.id)}" alt="" loading="lazy">${esc(c.name)}</li>`).join('');
}
function pick(i) {
  const c = suggItems[i]; if (!c) return;
  $('#guessIn').value = c.name;
  suggItems = []; $('#sugg').innerHTML = '';
  $('#guessIn').focus();
}
function submitGuess() {
  const guess = $('#guessIn').value.trim();
  if (!guess) { toast('Bitte einen Champion eingeben.', 'err'); return; }
  if (sending) return;
  sending = true;
  $('#mSubmit').disabled = true;
  socket.emit('guess', { guess }, res => {
    sending = false;
    $('#mSubmit').disabled = false;
    if (!res || !res.ok) { toast((res && res.error) || 'Fehler beim Tippen.', 'err'); return; }
    if (res.correct) {
      closeGuess();
      toast(`🎉 Richtig! Du bist ${res.champ.name}!`, 'good');
    } else {
      closeGuess();
      toast(`❌ Leider falsch – du bist nicht ${guess}. +1 Frage, der Nächste ist dran.`, 'err');
    }
  });
}

$('#guessIn').addEventListener('input', updateSugg);
$('#guessIn').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' && suggItems.length) { e.preventDefault(); suggIdx = (suggIdx + 1) % suggItems.length; drawSugg(); }
  else if (e.key === 'ArrowUp' && suggItems.length) { e.preventDefault(); suggIdx = (suggIdx - 1 + suggItems.length) % suggItems.length; drawSugg(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (suggItems.length && suggIdx >= 0 && norm(suggItems[suggIdx].name) !== norm($('#guessIn').value)) pick(suggIdx);
    else submitGuess();
  } else if (e.key === 'Escape') closeGuess();
});
$('#sugg').addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
$('#mSubmit').onclick = submitGuess;
$('#mCancel').onclick = closeGuess;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeGuess(); });

/* ---------- Boot ---------- */
const m = location.pathname.match(/^\/room\/([A-Za-z0-9]{4,5})\/?$/);
if (m) {
  const code = m[1].toUpperCase();
  currentCode = code; // connect-Handler tritt automatisch bei
  $('#nameIn').value = store.get('wbi.name') || '';
  if (socket.connected) joinRoom(code, { silent: true });
} else {
  goHome();
}
})();
