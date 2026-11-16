// HUD: every DOM readout the player sees. The game loop calls update() once
// a frame with a plain snapshot; this module never reads game state itself,
// so the HUD can never disagree with the simulation by reading stale data.
const $ = (id) => document.getElementById(id);

export function initHud() {
  const el = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    scope: $('scope'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    vitals: $('vitals'),
    scoreboard: $('scoreboard'),
    healthNum: $('health-num'),
    healthBar: $('health-bar'),
    armorNum: $('armor-num'),
    money: $('money'),
    scoreAtk: $('score-atk'),
    scoreDef: $('score-def'),
    roundNum: $('round-num'),
    timer: $('timer'),
    feed: $('killfeed'),
    charge: $('charge-status'),
    progress: $('progress'),
    progressBar: $('progress-bar'),
    progressLabel: $('progress-label'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    spectate: $('spectate'),
    damage: $('damage'),
    buy: $('buymenu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    title: $('title'),
    roundEnd: $('roundend'),
    roundEndTitle: $('roundend-title'),
    roundEndSub: $('roundend-sub'),
    matchEnd: $('matchend'),
    matchEndTitle: $('matchend-title'),
    matchEndSub: $('matchend-sub'),
    hint: $('hint'),
  };
  let hitTimer = 0;
  let bannerTimer = 0;

  function show(node) { node.hidden = false; }
  function hide(node) { node.hidden = true; }

  return {
    el,
    update(snap, dt) {
      // The title screen is a clean backdrop: no in-game readouts.
      const inGame = snap.phase !== 'title';
      el.scoreboard.style.display = inGame ? '' : 'none';
      el.vitals.style.display = inGame ? '' : 'none';
      el.ammoBox.style.display = inGame ? '' : 'none';
      el.charge.style.display = inGame ? '' : 'none';
      el.feed.style.display = inGame ? '' : 'none';
      el.hint.style.display = inGame ? '' : 'none';
      // Vitals.
      el.healthNum.textContent = Math.ceil(snap.hp);
      el.healthBar.style.width = `${Math.max(0, snap.hp)}%`;
      el.healthBar.classList.toggle('low', snap.hp <= 30);
      el.armorNum.textContent = snap.armor > 0 ? `ARMOR ${Math.ceil(snap.armor)}` : '';
      el.money.textContent = `$${snap.money}`;
      // Ammo.
      el.ammoMag.textContent = snap.mag;
      el.ammoReserve.textContent = `/ ${snap.reserve}`;
      el.ammoBox.classList.toggle('empty', snap.mag === 0);
      el.ammoBox.classList.toggle('reloading', snap.reloading);
      // Score + timer.
      el.scoreAtk.textContent = snap.scoreAtk;
      el.scoreDef.textContent = snap.scoreDef;
      el.roundNum.textContent = `ROUND ${snap.round}`;
      const t = Math.max(0, Math.ceil(snap.timer));
      el.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      el.timer.classList.toggle('urgent', snap.timer <= 10 && snap.phase === 'round');
      // Crosshair spread: the four lines move apart with the cone.
      const gap = 4 + snap.spread * 1.6;
      el.crosshair.style.setProperty('--gap', `${gap}px`);
      el.crosshair.classList.toggle('hidden', snap.phase !== 'round' || !snap.alive || snap.scoped);
      el.scope.hidden = !snap.scoped;
      // Charge status line.
      let chargeText = '';
      if (snap.chargeState === 'carried') chargeText = snap.carrying ? 'YOU CARRY THE CHARGE — plant at A or B' : 'CHARGE CARRIED — protect the carrier';
      else if (snap.chargeState === 'planted') chargeText = `CHARGE PLANTED AT ${snap.chargeSite} — ${Math.ceil(snap.fuse)}s`;
      else if (snap.chargeState === 'defused') chargeText = 'CHARGE DEFUSED';
      else if (snap.chargeState === 'exploded') chargeText = 'CHARGE DETONATED';
      el.charge.textContent = chargeText;
      el.charge.classList.toggle('danger', snap.chargeState === 'planted');
      // Plant / defuse progress bar.
      if (snap.progress > 0) {
        show(el.progress);
        el.progressBar.style.width = `${Math.min(100, snap.progress * 100)}%`;
        el.progressLabel.textContent = snap.progressLabel;
      } else {
        hide(el.progress);
      }
      // Spectate line.
      el.spectate.hidden = !snap.spectating;
      if (snap.spectating) el.spectate.textContent = `SPECTATING ${snap.spectateName} — round continues`;
      // Hitmarker + banner fade.
      if (hitTimer > 0) {
        hitTimer -= dt;
        if (hitTimer <= 0) el.hitmarker.classList.remove('on');
      }
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) hide(el.banner);
      }
    },
    hitmarker(head) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('head', head);
      hitTimer = 0.12;
    },
    damageFlash() {
      el.damage.classList.remove('flash');
      void el.damage.offsetWidth; // restart the CSS animation
      el.damage.classList.add('flash');
    },
    banner(title, sub, ms = 2600) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub || '';
      show(el.banner);
      bannerTimer = ms / 1000;
    },
    feed(html, cls) {
      const div = document.createElement('div');
      div.className = `feed-row ${cls || ''}`;
      div.innerHTML = html;
      el.feed.prepend(div);
      while (el.feed.children.length > 6) el.feed.removeChild(el.feed.lastChild);
    },
  };
}

// ---- buy menu and full-screen overlays (appended to the HUD api) ----
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICE } from './config.js';

export function initBuyMenu(hud, onBuy) {
  const el = hud.el;
  const items = [
    { id: 'hail', key: '1', name: 'HAIL SMG', desc: 'Fast, close quarters. 900 RPM.', price: WEAPONS.hail.price },
    { id: 'scatter', key: '2', name: 'SCATTER-12', desc: 'Pump shotgun. Devastating up close.', price: WEAPONS.scatter.price },
    { id: 'vk47', key: '3', name: 'VK-47 RIFLE', desc: 'The all-rounder. Accurate, hard hitting.', price: WEAPONS.vk47.price },
    { id: 'longshot', key: '4', name: 'LONGSHOT', desc: 'Scoped marksman rifle. One shot, one kill.', price: WEAPONS.longshot.price },
    { id: 'armor', key: '5', name: 'VEST', desc: 'Absorbs half of incoming damage.', price: ARMOR_PRICE },
    { id: 'grenade', key: '6', name: 'POPPER GRENADE', desc: 'Fragmentation grenade. Throw with G.', price: GRENADE_PRICE },
  ];

  function render(money) {
    el.buyMoney.textContent = `$${money}`;
    el.buyItems.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row';
      row.disabled = money < item.price;
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
      row.addEventListener('click', () => onBuy(item.id));
      el.buyItems.appendChild(row);
    }
  }

  return {
    items,
    show(money) {
      render(money);
      el.buy.hidden = false;
    },
    hide() { el.buy.hidden = true; },
    refresh(money) { if (!el.buy.hidden) render(money); },
    buyByKey(key, money) {
      const item = items.find((i) => i.key === key);
      if (item && money >= item.price) onBuy(item.id);
      return !!item;
    },
  };
}

export function showTitle(hud) {
  hud.el.title.hidden = false;
  hud.el.roundEnd.hidden = true;
  hud.el.matchEnd.hidden = true;
  hud.el.buy.hidden = true;
}

export function hideTitle(hud) { hud.el.title.hidden = true; }

export function showRoundEnd(hud, won, reason, scoreAtk, scoreDef) {
  hud.el.roundEndTitle.textContent = won ? 'ROUND WON' : 'ROUND LOST';
  hud.el.roundEndTitle.className = won ? 'win' : 'lose';
  hud.el.roundEndSub.textContent = `${reason} — VANGUARD ${scoreAtk} : ${scoreDef} EMBER`;
  hud.el.roundEnd.hidden = false;
}

export function hideRoundEnd(hud) { hud.el.roundEnd.hidden = true; }

export function showMatchEnd(hud, result) {
  hud.el.matchEndTitle.textContent = result;
  hud.el.matchEnd.hidden = false;
}

export function hideMatchEnd(hud) { hud.el.matchEnd.hidden = true; }
