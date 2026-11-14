(() => {
'use strict';

const DD = 'https://ddragon.leagueoflegends.com';
const TAGS = [
  ['Fighter', 'Kämpfer'], ['Tank', 'Tank'], ['Mage', 'Magier'],
  ['Assassin', 'Assassine'], ['Marksman', 'Schütze'], ['Support', 'Unterstützer'],
];
const TAG_DE = Object.fromEntries(TAGS);
const ANS = {
  yes: { icon: '✅', label: 'Ja', cls: 'yes' },
  no: { icon: '❌', label: 'Nein', cls: 'no' },
  maybe: { icon: '🤷', label: 'Weiß nicht', cls: 'maybe' },
};
const IDEAS = [
  'Bin ich ein Yordle?', 'Bin ich weiblich?', 'Bin ich ein Mensch?', 'Spiele ich hauptsächlich Mid?',
  'Bin ich ein Fernkämpfer?', 'Benutze ich Mana?', 'Komme ich aus Noxus?', 'Komme ich aus Demacia?',
  'Komme ich aus Ionia?', 'Komme ich aus Piltover oder Zhaun?', 'Komme ich aus der Leere?',
  'Bin ich ein Tier oder tierähnlich?', 'Habe ich einen Begleiter (Pet, Reittier …)?', 'Bin ich ein Supporter?',
  'Bin ich ein Assassine?', 'Kämpfe ich mit einer Klinge?', 'Kann ich mich verwandeln?',
  'Hat meine Ulti globale Reichweite?', 'Bin ich älter als 100 Jahre?', 'Bin ich ein Jungler?',
  'Bin ich ein Tank?', 'Habe ich einen Dash?', 'Komme ich in Arcane vor?', 'Kann ich unsichtbar werden?',
  'Bin ich untot?', 'Bin ich ein Gott oder Aufgestiegener?', 'Komme ich von den Schatteninseln?',
  'Komme ich aus Freljord?', 'Komme ich aus Shurima?', 'Komme ich aus Bilgewasser?', 'Bin ich ein Toplaner?',
  'Spiele ich Botlane?', 'Habe ich mehr als zwei Beine?', 'Trage ich einen Helm oder eine Maske?',
];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const splashUrl = (id, num = 0) => `${DD}/cdn/img/champion/splash/${id}_${num}.jpg`;
// Bild + Fallbacks (Skin → Standard-Splash → Icon)
const artSrc = (c, v) => ({
  src: splashUrl(c.id, c.skin ? c.skin.num : 0),
  fb: [c.skin ? splashUrl(c.id) : null, iconUrl(v, c.id)].filter(Boolean).join('|'),
});
function bindFallbacks(root) {
  root.querySelectorAll('img[data-fb]').forEach(im => {
    im.addEventListener('error', function onErr() {
      const list = im.dataset.fb.split('|').filter(Boolean);
      const next = list.shift();
      if (!next) { im.removeEventListener('error', onErr); return; }
      im.dataset.fb = list.join('|');
      if (!list.length) im.classList.add('icon');
      im.src = next;
    });
  });
}
const iconUrl = (v, id) => `${DD}/cdn/${v}/img/champion/${id}.png`;
const qWord = n => (n === 1 ? 'Frage' : 'Fragen');
const poolLabel = tags => (tags.length ? tags.map(t => TAG_DE[t] || t).join(' / ') : 'Alle Champions');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BASE_TITLE = document.title;

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
let prevView = null;
let champList = [];
let ddVersion = null;
let lastOwnChamp = null;
let lastRound = 0;
let lastQ = {};
const openHist = new Set();
let muted = store.get('wbi.muted') === '1';

/* ---------- Sound ---------- */
let actx = null;
function audio() {
  if (muted) return null;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { return null; }
  return actx;
}
function tone(notes) {
  const a = audio(); if (!a) return;
  let t = a.currentTime + 0.01;
  for (const [f, d, type = 'sine', vol = 0.09] of notes) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + d + 0.05);
    t += d * 0.75;
  }
}
const SFX = {
  turn: () => tone([[523, .14], [659, .14], [784, .28]]),
  ask: () => tone([[880, .1], [1175, .2]]),
  yes: () => tone([[660, .12, 'triangle'], [990, .26, 'triangle']]),
  no: () => tone([[311, .16, 'square', .035], [208, .3, 'square', .035]]),
  maybe: () => tone([[440, .14], [415, .22]]),
  win: () => tone([[523, .1], [659, .1], [784, .1], [1047, .45]]),
  wrong: () => tone([[160, .35, 'sawtooth', .05]]),
};
document.addEventListener('pointerdown', () => audio(), { once: true });
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

/* ---------- Konfetti ---------- */
function confetti(big) {
  if (reduceMotion) return;
  const colors = ['#c8aa6e', '#f0e6d2', '#0ac8b9', '#cdfafa', '#785a28', '#3fd38a'];
  const n = big ? 160 : 70;
  for (let i = 0; i < n; i++) {
    const d = document.createElement('i');
    d.className = 'confetti';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = colors[i % colors.length];
    d.style.width = 6 + Math.random() * 6 + 'px';
    d.style.height = 8 + Math.random() * 10 + 'px';
    document.body.appendChild(d);
    const dx = (Math.random() - 0.5) * 300;
    d.animate([
      { transform: 'translate(0,-5vh) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px,105vh) rotate(${Math.random() * 900}deg)`, opacity: 0.9 },
    ], { duration: 1800 + Math.random() * 1600, delay: Math.random() * 300, easing: 'cubic-bezier(.25,.6,.45,1)' })
      .onfinish = () => d.remove();
  }
}

/* ---------- Toast ---------- */
let toastT;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = 'toast'; }, 2800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link kopiert – ab damit in den Discord!', 'good'); }
  catch { prompt('Link kopieren:', text); }
}

/* ---------- Views ---------- */
function show(id) {
  ['home', 'lobby', 'game'].forEach(v => $('#' + v).classList.toggle('hidden', v !== id));
  $('#logo').classList.toggle('compact', id === 'game');
  $('#reactBar').classList.toggle('hidden', id !== 'game');
  if (id !== 'game') $('#reveal').classList.add('hidden');
}

function goHome(prefillCode) {
  currentCode = null;
  view = prevView = null;
  document.title = BASE_TITLE;
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
socket.on('state', v => {
  prevView = view;
  view = v;
  try { handleEvents(prevView, view); } catch (e) { console.error(e); }
  render();
});
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
  const p = '/room/' + res.code;
  if (location.pathname !== p) history.replaceState(null, '', p);
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

/* ---------- Ereignisse (Sound, Konfetti, Vibration) ---------- */
function handleEvents(prev, cur) {
  if (!prev || !cur || prev.round !== cur.round || cur.state === 'lobby') return;
  const me = cur.youPid;
  if (cur.state === 'playing' && cur.turnPid === me && prev.turnPid !== me) {
    SFX.turn(); vibrate([120, 60, 120]);
  }
  if (cur.question && (!prev.question || prev.question.id !== cur.question.id) && cur.question.askerPid !== me) {
    setTimeout(SFX.ask, 250); vibrate(60);
  }
  if (cur.lastResult && (!prev.lastResult || prev.lastResult.id !== cur.lastResult.id)) {
    SFX[cur.lastResult.result]();
  }
  for (const p of cur.players) {
    const before = prev.players.find(x => x.pid === p.pid);
    if (before && !before.done && p.done) {
      if (!p.gaveUp) { confetti(p.pid === me); SFX.win(); }
      showReveal(p, p.pid === me, cur.version);
    }
    if (before && p.penalties > before.penalties && p.pid !== me) SFX.wrong();
  }
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
function updateMuteBtn() { $('#muteBtn').textContent = muted ? '🔇' : '🔊'; $('#muteBtn').title = muted ? 'Ton an' : 'Ton aus'; }
updateMuteBtn();
$('#muteBtn').onclick = () => {
  muted = !muted; store.set('wbi.muted', muted ? '1' : '0'); updateMuteBtn();
  if (!muted) SFX.yes();
};
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
const fail = res => { if (res && !res.ok && res.error) toast(res.error, 'err'); };

function render() {
  if (!view || !currentCode) return;
  if (view.state === 'lobby') { show('lobby'); renderLobby(); document.title = BASE_TITLE; }
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
      ${p.wins ? `<span class="badge" title="Siege">🏆 ${p.wins}</span>` : ''}
      ${p.pid === view.hostPid ? '<span class="badge">👑 Host</span>' : ''}
      ${p.pid === view.youPid ? '<span class="badge du">Du</span>' : ''}
      ${host && p.pid !== view.youPid ? `<button class="btn small danger" type="button" data-kick="${p.pid}" aria-label="${esc(p.name)} entfernen">✕</button>` : ''}
    </li>`);
  for (let i = view.players.length; i < view.maxPlayers; i++) rows.push('<li class="empty">Freier Platz …</li>');
  $('#lPlayers').innerHTML = rows.join('');

  const dis = host ? '' : 'disabled';
  $('#lChips').innerHTML =
    `<button type="button" class="chip ${view.tags.length ? '' : 'on'}" data-tag="" ${dis}>Alle</button>` +
    TAGS.map(([k, de]) => `<button type="button" class="chip ${view.tags.includes(k) ? 'on' : ''}" data-tag="${k}" ${dis}>${de}</button>`).join('');
  const enough = view.poolSize >= view.players.length;
  $('#lPool').innerHTML = `<b>${view.poolSize}</b> Champions im Pool` + (host ? '' : ' · nur der Host kann das ändern') +
    (enough ? '' : ' · <span style="color:var(--bad)">zu wenige für alle Spieler</span>');

  $('#lRules').innerHTML = `
    <button type="button" class="chip ${view.yesContinues ? 'on' : ''}" data-rule="yes" ${dis}>Bei „Ja“ weiterfragen</button>
    <button type="button" class="chip ${view.yesContinues ? '' : 'on'}" data-rule="one" ${dis}>Immer nur 1 Frage pro Zug</button>
    <button type="button" class="chip ${view.skins ? 'on' : ''}" data-rule="skins" ${dis}>✨ Zufällige Skins ${view.skins ? 'an' : 'aus'}</button>`;

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
$('#lRules').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b || b.disabled || !isHost()) return;
  if (b.dataset.rule === 'skins') socket.emit('settings', { skins: !view.skins });
  else socket.emit('settings', { yesContinues: b.dataset.rule === 'yes' });
});
$('#lPlayers').addEventListener('click', e => {
  const b = e.target.closest('[data-kick]'); if (!b) return;
  const p = byPid(b.dataset.kick);
  if (p && confirm(`${p.name} aus dem Raum entfernen?`)) socket.emit('kick', { pid: p.pid });
});
$('#startBtn').onclick = () => socket.emit('start', null, fail);

/* ---------- Frage-Panel ---------- */
function champMini(c, v) {
  return `<span class="mini"><img src="${iconUrl(v, c.id)}" alt="">${esc(c.name)}</span>`;
}
function voterChips(q) {
  return q.required.map(pid => {
    const p = byPid(pid); if (!p) return '';
    const ok = q.voted.includes(pid);
    return `<span class="vchip ${ok ? 'ok' : ''}">${ok ? '✓' : '…'} ${esc(p.name)}</span>`;
  }).join('');
}
function resultBox(r) {
  const asker = byPid(r.askerPid);
  const a = ANS[r.result];
  const who = Object.entries(r.votes || {}).map(([pid, ans]) => {
    const p = byPid(pid); return p ? `<span class="vchip ${ANS[ans].cls}">${ANS[ans].icon} ${esc(p.name)}</span>` : '';
  }).join('');
  return `<div class="result ${a.cls}">
    <div class="r-q"><b>${esc(asker ? asker.name : '?')}</b> fragte: „${esc(r.text)}“</div>
    <div class="r-a">${a.icon} ${a.label.toUpperCase()}</div>
    <div class="r-votes">${who}</div>
  </div>`;
}

function renderQPanel() {
  const el = $('#qPanel');
  const self = me();
  const host = isHost();
  const v = view.version || ddVersion;
  const keep = $('#askIn');
  const saved = keep ? { val: keep.value, focus: document.activeElement === keep } : null;

  if (view.state === 'finished') {
    el.className = 'qpanel fin';
    el.innerHTML = el._html = '<div class="q-head">🏁 <b>Runde beendet</b> – alle sind fertig.</div>';
    return;
  }
  const q = view.question;
  const turn = view.turnPid && byPid(view.turnPid);
  const myTurn = turn && turn.pid === view.youPid;
  let html = '';

  if (q) {
    const asker = byPid(q.askerPid);
    const iAsk = q.askerPid === view.youPid;
    html += `<div class="q-head">❓ <b>${esc(asker ? asker.name : '?')}</b> fragt:</div>
      <div class="q-text">„${esc(q.text)}“</div>`;
    if (iAsk) {
      html += `<p class="q-sub">Die anderen stimmen ab …</p>`;
    } else {
      const ac = asker && asker.champ;
      html += `<p class="q-sub">Antworte für ${ac ? champMini(ac, v) : '???'}</p>
        <div class="vote-btns">
          ${Object.entries(ANS).map(([k, a]) => `<button type="button" class="vbtn ${a.cls} ${q.myVote === k ? 'sel' : ''}" data-act="vote" data-a="${k}">${a.icon} ${a.label}</button>`).join('')}
        </div>`;
    }
    html += `<div class="vchips">${voterChips(q)}<span class="vcount">${q.voted.length}/${q.required.length} abgestimmt</span></div>`;
    if (iAsk || host) {
      html += `<div class="q-actions">
        <button type="button" class="btn small" data-act="resolve" ${q.voted.length ? '' : 'disabled'}>Jetzt auswerten</button>
        <button type="button" class="btn small ghost" data-act="withdraw">Frage zurückziehen</button>
      </div>`;
    }
  } else {
    if (view.lastResult) html += resultBox(view.lastResult);
    if (myTurn) {
      html += `<div class="q-head mine">🎯 <b>Du bist dran!</b> Stell eine Ja/Nein-Frage:</div>
        <div class="ask-row">
          <input id="askIn" type="text" maxlength="140" placeholder="z. B. Bin ich ein Yordle?" autocomplete="off">
          <button type="button" class="btn ghost idea" data-act="idea" title="Zufällige Frage-Idee">🎲</button>
          <button type="button" class="btn primary" data-act="ask">Fragen</button>
        </div>
        <p class="q-sub">${view.yesContinues ? 'Bei „Ja“ darfst du weiterfragen, sonst ist der Nächste dran.' : 'Nach jeder Frage ist der Nächste dran.'}
          Oder tippe direkt mit „Ich hab's erraten!“.</p>
        <div class="q-actions"><button type="button" class="btn small ghost" data-act="next">Zug beenden ▶</button></div>`;
    } else if (turn) {
      html += `<div class="q-head">⏳ <b>${esc(turn.name)}</b> ist dran und überlegt sich eine Frage …</div>
        ${host ? '<div class="q-actions"><button type="button" class="btn small" data-act="next">Nächster ▶</button></div>' : ''}`;
    }
  }
  el.className = 'qpanel' + (myTurn && !q ? ' mine' : '') + (q && q.askerPid !== view.youPid && !q.myVote ? ' need-vote' : '');
  if (el._html === html) return; // nichts geändert → Eingabefeld nicht neu bauen (Handy-Tastatur bleibt offen)
  el._html = html;
  el.innerHTML = html;

  const ai = $('#askIn');
  if (ai && saved) { ai.value = saved.val; if (saved.focus) { ai.focus(); ai.setSelectionRange(ai.value.length, ai.value.length); } }
  if (ai) ai.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAsk(); } });
}

function doAsk() {
  const ai = $('#askIn'); if (!ai) return;
  const text = ai.value.trim();
  if (text.length < 3) { toast('Bitte eine Frage eingeben.', 'err'); ai.focus(); return; }
  socket.emit('ask', { text }, res => { if (res && res.ok) { const x = $('#askIn'); if (x) x.value = ''; } else fail(res); });
}

/* ---------- Spielansicht ---------- */
function renderGame() {
  const host = isHost();
  const self = me();
  const playing = view.state === 'playing';
  const v = view.version || ddVersion;

  $('#gCode').textContent = view.code;
  $('#gRound').textContent = view.round;
  $('#gPool').textContent = poolLabel(view.tags);
  $('#toLobbyBtn').classList.toggle('hidden', !host);

  const myTurn = playing && view.turnPid === view.youPid;
  const needVote = view.question && view.question.askerPid !== view.youPid && !view.question.myVote;
  document.title = myTurn ? '🎯 Du bist dran! – Wer bin ich?' : needVote ? '🗳 Abstimmen! – Wer bin ich?' : BASE_TITLE;

  if (view.round !== lastRound) { lastOwnChamp = null; lastQ = {}; lastRound = view.round; openHist.clear(); }
  const ownChamp = self && self.champ ? self.champ.id : null;
  const animateOwn = ownChamp && !lastOwnChamp;
  lastOwnChamp = ownChamp;

  renderQPanel();

  const grid = $('#grid');
  grid.className = `grid n${view.players.length}`;
  grid.innerHTML = view.players.map(p => {
    const isMe = p.pid === view.youPid;
    const isTurn = playing && p.pid === view.turnPid;
    const c = p.champ;
    const img = c && artSrc(c, v);
    const front = c
      ? `<img src="${img.src}" alt="${esc(c.name)}" data-fb="${img.fb}"><div class="cname">${esc(c.name)}<small>${esc(c.skin ? '✨ ' + c.skin.name : c.title)}</small></div>`
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
    const ribbon = p.gaveUp ? '<div class="ribbon gave">🏳 Aufgegeben</div>'
      : p.done ? `<div class="ribbon done">✓ Fertig · ${p.q} ${qWord(p.q)}</div>`
      : isTurn ? '<div class="ribbon turn">Am Zug</div>' : '';
    const bump = lastQ[p.pid] !== undefined && lastQ[p.pid] !== p.q;
    lastQ[p.pid] = p.q;

    let action = '';
    if (isMe && playing && !p.done) {
      action = isTurn
        ? `<button class="btn primary" type="button" data-act="guess">Ich hab's erraten!</button>`
        : `<button class="btn primary" type="button" disabled title="Raten geht nur, wenn du am Zug bist">Raten, wenn du dran bist</button>`;
      action += `        <button class="btn small ghost" type="button" data-act="giveup">🏳 Aufgeben</button>`;
    } else if (p.gaveUp) action = `<div class="fin-note gave">Aufgegeben nach ${p.q} ${qWord(p.q)}</div>`;
    else if (p.done) action = `<div class="fin-note">✓ Erraten mit ${p.q} ${qWord(p.q)}</div>`;

    const hist = view.history.filter(h => h.askerPid === p.pid);
    const histHtml = hist.length ? `<details class="hist" data-pid="${p.pid}" ${openHist.has(p.pid) ? 'open' : ''}>
        <summary>Fragen-Verlauf (${hist.length})</summary>
        <ul>${hist.map(h => `<li class="${ANS[h.result].cls}"><span>${ANS[h.result].icon}</span>${esc(h.text)}</li>`).join('')}</ul>
      </details>` : '';

    return `
      <article class="card ${isMe ? 'me' : ''} ${isTurn ? 'turn' : ''} ${p.done ? 'done' : ''} ${p.gaveUp ? 'gaveup' : ''} ${p.connected ? '' : 'is-offline'}">
        ${ribbon}
        ${p.connected ? '' : '<div class="ribbon off">offline</div>'}
        <div class="art">${art}</div>
        <div class="body">
          <div class="pname"><span class="n" title="${esc(p.name)}">${esc(p.name)}</span>
            ${p.pid === view.hostPid ? '<span title="Host">👑</span>' : ''}${isMe ? '<span class="badge du">Du</span>' : ''}
            ${p.wins ? `<span class="wins" title="Siege">🏆${p.wins}</span>` : ''}</div>
          <div class="counter ${bump ? 'bump' : ''}">
            <button class="minus" type="button" data-act="q" data-d="-1" data-pid="${p.pid}" aria-label="Frage abziehen" ${!playing || p.done || p.q === 0 ? 'disabled' : ''}>−</button>
            <div class="val"><b>${p.q}</b><small>${qWord(p.q)}</small></div>
            <button class="plus" type="button" data-act="q" data-d="1" data-pid="${p.pid}" aria-label="Frage hinzufügen" ${!playing || p.done ? 'disabled' : ''}>+1</button>
          </div>
          ${p.penalties ? `<div class="pen">davon ${p.penalties}× falsch getippt</div>` : ''}
          ${histHtml}
          <div class="btns">${action}</div>
        </div>
      </article>`;
  }).join('');

  bindFallbacks(grid);
  const anim = grid.querySelector('.flip[data-anim]');
  if (anim) requestAnimationFrame(() => requestAnimationFrame(() => anim.classList.add('revealed')));

  renderRanking(host);
  $('#log').innerHTML = view.log.slice().reverse().map(l => {
    const d = new Date(l.t);
    return `<li><time>${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</time>${esc(l.text)}</li>`;
  }).join('');
}

$('#grid').addEventListener('toggle', e => {
  const d = e.target; if (!d.matches || !d.matches('details.hist')) return;
  if (d.open) openHist.add(d.dataset.pid); else openHist.delete(d.dataset.pid);
}, true);

function renderRanking(host) {
  const el = $('#rank');
  const done = view.players.filter(p => p.done)
    .sort((a, b) => (a.gaveUp - b.gaveUp) || a.q - b.q || a.doneOrder - b.doneOrder);
  if (!done.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const finished = view.state === 'finished';
  const open = view.players.filter(p => !p.done);
  const medals = ['🥇', '🥈', '🥉'];
  let place = 0, prevKey = null;
  const rows = done.map((p, k) => {
    const key = p.gaveUp ? 'g' : p.q;
    if (key !== prevKey) { place = k + 1; prevKey = key; }
    return `<li class="${place === 1 && !p.gaveUp ? 'first' : ''} ${p.gaveUp ? 'open' : ''}">
      <span class="place">${p.gaveUp ? '🏳' : medals[place - 1] || place + '.'}</span>
      <span class="who"><b>${esc(p.name)}</b>${p.pid === view.youPid ? ' (du)' : ''}<small>${esc(p.champ ? p.champ.name : '')}${p.penalties ? ` · ${p.penalties}× falsch` : ''}${p.gaveUp ? ' · aufgegeben' : ''}</small></span>
      <span class="qs">${p.q} ${qWord(p.q)}</span></li>`;
  }).concat(open.map(p => `<li class="open">
      <span class="place">–</span>
      <span class="who"><b>${esc(p.name)}</b>${p.pid === view.youPid ? ' (du)' : ''}<small>rät noch …</small></span>
      <span class="qs">${p.q} bisher</span></li>`));

  let total = '';
  if (finished && view.players.some(p => p.rounds > 0)) {
    const sb = view.players.slice().sort((a, b) => b.wins - a.wins || (a.totalQ / (a.rounds || 1)) - (b.totalQ / (b.rounds || 1)));
    total = `<h3 class="sub-h">Gesamtwertung</h3>
      <table class="score"><thead><tr><th>Spieler</th><th>🏆 Siege</th><th>Runden</th><th>Ø Fragen</th></tr></thead><tbody>
      ${sb.map(p => `<tr class="${p.pid === view.youPid ? 'you' : ''}"><td>${esc(p.name)}</td><td>${p.wins}</td><td>${p.rounds}</td><td>${p.rounds ? (p.totalQ / p.rounds).toFixed(1).replace('.', ',') : '–'}</td></tr>`).join('')}
      </tbody></table>`;
  }
  const actions = finished
    ? (host
        ? `<div class="actions"><button class="btn primary" type="button" data-act="newround">↻ Neue Runde</button>
           <button class="btn" type="button" data-act="lobby">↩ Zur Lobby (Einstellungen)</button>
           <button class="btn small ghost" type="button" data-act="resetscores">Wertung zurücksetzen</button></div>`
        : '<p class="help">Warte, bis der Host eine neue Runde startet …</p>')
    : '';
  el.innerHTML = `<h2><span>🏆 ${finished ? 'Rangliste' : 'Zwischenstand'} · Runde ${view.round}</span>${finished ? '<span class="done-l">Runde beendet</span>' : ''}</h2>
    <ol>${rows.join('')}</ol>${finished ? awardsHtml() : ''}${total}${actions}`;
}

$('#game').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act;
  switch (act) {
    case 'q': socket.emit('question', { pid: b.dataset.pid, delta: +b.dataset.d }, fail); break;
    case 'next': socket.emit('nextTurn', null, fail); break;
    case 'guess': openGuess(); break;    case 'giveup':
      if (confirm('Wirklich aufgeben? Dein Champion wird aufgedeckt und du landest am Ende der Rangliste.')) {
        socket.emit('giveUp', null, res => { if (res && res.ok) toast(`Du warst ${res.champ.name}.`); });
      }
      break;
    case 'ask': doAsk(); break;
    case 'idea': {
      const ai = $('#askIn');
      if (ai) { ai.value = IDEAS[Math.floor(Math.random() * IDEAS.length)]; ai.focus(); }
      break;
    }
    case 'vote': socket.emit('vote', { id: view.question && view.question.id, answer: b.dataset.a }, fail); break;
    case 'resolve': socket.emit('resolve', null, fail); break;
    case 'withdraw': if (confirm('Frage zurückziehen? Die Frage wird nicht gezählt.')) socket.emit('withdraw', null, fail); break;
    case 'newround': socket.emit('start', null, fail); break;
    case 'lobby': socket.emit('toLobby', null, fail); break;
    case 'resetscores': if (confirm('Gesamtwertung für alle zurücksetzen?')) socket.emit('resetScores', null, fail); break;
  }
});
$('#toLobbyBtn').onclick = () => {
  if (view.state === 'playing' && !confirm('Laufende Runde abbrechen und zurück in die Lobby?')) return;
  socket.emit('toLobby', null, () => {});
};

/* ---------- Auszeichnungen am Rundenende ---------- */
function awardsHtml() {
  const names = pids => pids.map(pid => byPid(pid)).filter(Boolean).map(p => esc(p.name)).join(' & ');
  const top = (scoreMap, min) => {
    const max = Math.max(0, ...Object.values(scoreMap));
    if (max < min) return null;
    return { pids: Object.keys(scoreMap).filter(k => scoreMap[k] === max), max };
  };
  const per = fn => Object.fromEntries(view.players.map(p => [p.pid, fn(p)]));
  const asked = per(p => view.history.filter(h => h.askerPid === p.pid).length);
  const yeses = per(p => view.history.filter(h => h.askerPid === p.pid && h.result === 'yes').length);
  const noStreak = per(p => {
    let best = 0, cur = 0;
    for (const h of view.history.filter(x => x.askerPid === p.pid)) { cur = h.result === 'no' ? cur + 1 : 0; best = Math.max(best, cur); }
    return best;
  });
  const shrugs = per(p => view.history.filter(h => h.votes && h.votes[p.pid] === 'maybe').length);
  const kamikaze = per(p => p.penalties);
  const solved = view.players.filter(p => p.done && !p.gaveUp).sort((a, b) => a.doneOrder - b.doneOrder);

  const list = [];
  if (solved.length) list.push({ i: '⚡', t: 'Blitzmerker', who: esc(solved[0].name), d: 'hat als Erstes richtig geraten' });
  let a;
  if ((a = top(asked, 1))) list.push({ i: '❓', t: 'Neugierigste Person', who: names(a.pids), d: `${a.max} ${qWord(a.max)} gestellt` });
  if ((a = top(yeses, 2))) list.push({ i: '🍀', t: 'Glückspilz', who: names(a.pids), d: `${a.max}× „Ja“ bekommen` });
  if ((a = top(noStreak, 3))) list.push({ i: '🧱', t: 'Nein-Mauer', who: names(a.pids), d: `${a.max}× „Nein“ am Stück` });
  if ((a = top(kamikaze, 1))) list.push({ i: '💥', t: 'Kamikaze', who: names(a.pids), d: `${a.max}× falsch getippt` });
  if ((a = top(shrugs, 2))) list.push({ i: '🤷', t: 'Ahnungslos', who: names(a.pids), d: `${a.max}× „Weiß nicht“ gestimmt` });
  if (!list.length) return '';
  return `<h3 class="sub-h">Auszeichnungen</h3><div class="awards">${list.map(x =>
    `<div class="award"><span class="ai">${x.i}</span><div><b>${x.t}</b><span>${x.who}</span><small>${x.d}</small></div></div>`).join('')}</div>`;
}

/* ---------- Aufdecken-Overlay ---------- */
let revealT;
function showReveal(p, isMe, v) {
  const c = p.champ; if (!c) return;
  const img = artSrc(c, v || ddVersion);
  const head = p.gaveUp
    ? `🏳 ${isMe ? 'Du gibst auf' : esc(p.name) + ' gibt auf'} – es war …`
    : `🎉 ${isMe ? 'Richtig! Du bist …' : esc(p.name) + ' hat es erraten!'}`;
  const blurb = c.blurb ? esc(c.blurb.length > 260 ? c.blurb.slice(0, 257).replace(/\s\S*$/, '') + ' …' : c.blurb) : '';
  const el = $('#reveal');
  el.innerHTML = `
    <div class="rv-bg"><img src="${img.src}" alt="" data-fb="${img.fb}"></div>
    <div class="rv-box">
      <div class="rv-head">${head}</div>
      <div class="rv-name">${esc(c.name)}</div>
      <div class="rv-title">${esc(c.title)}${c.skin ? ` · ✨ ${esc(c.skin.name)}` : ''}</div>
      ${blurb ? `<p class="rv-blurb">${blurb}</p>` : ''}
      <div class="rv-q">${p.q} ${qWord(p.q)}${p.penalties ? ` · ${p.penalties}× falsch getippt` : ''}</div>
      <div class="rv-hint">Tippen zum Schließen</div>
    </div>`;
  bindFallbacks(el);
  el.classList.remove('hidden');
  clearTimeout(revealT);
  revealT = setTimeout(hideReveal, 6500);
}
function hideReveal() { $('#reveal').classList.add('hidden'); }
$('#reveal').addEventListener('click', hideReveal);

/* ---------- Emoji-Reaktionen ---------- */
$('#reactToggle').onclick = () => $('#reactBar').classList.toggle('open');
$('#reactBar').addEventListener('click', e => {
  const b = e.target.closest('[data-emoji]'); if (!b) return;
  socket.emit('react', { emoji: b.dataset.emoji });
});
socket.on('reaction', ({ name, emoji }) => {
  const d = document.createElement('div');
  d.className = 'float-emoji';
  d.innerHTML = `<span>${esc(emoji)}</span><small>${esc(name)}</small>`;
  d.style.left = 8 + Math.random() * 78 + 'vw';
  document.body.appendChild(d);
  if (reduceMotion) { setTimeout(() => d.remove(), 1500); return; }
  d.animate([
    { transform: 'translateY(0) scale(.6)', opacity: 0 },
    { transform: 'translateY(-8vh) scale(1.1)', opacity: 1, offset: 0.15 },
    { transform: `translate(${(Math.random() - 0.5) * 80}px,-55vh) scale(1)`, opacity: 0 },
  ], { duration: 2600, easing: 'ease-out' }).onfinish = () => d.remove();
});

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
  const v = (view && view.version) || ddVersion;
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
    closeGuess();
    if (res.correct) {
      toast(`🎉 Richtig! Du bist ${res.champ.name}!`, 'good');
    } else {
      SFX.wrong(); vibrate(300);
      toast(`❌ Leider falsch – du bist nicht ${guess}. +1 Frage`, 'err');
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
  currentCode = m[1].toUpperCase();
  $('#nameIn').value = store.get('wbi.name') || '';
  if (socket.connected) joinRoom(currentCode, { silent: true });
} else {
  goHome();
}
})();
