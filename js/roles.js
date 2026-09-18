// ============================================================
// roles.js — role presets + the deck builder
//
// A role = { id, name, emoji, count, desc, filler }
// Exactly one role may be `filler: true`. The filler soaks up whatever
// headcount is left over, so you only ever hand-tune the special roles.
// ============================================================

import { uid, shuffle } from './util.js';

export const PRESETS = {
  cheese: {
    label: '🧀 Cheese Thief',
    roles: [
      { name: '芝士小偷', emoji: '🐭', count: 1, desc: '偷芝士嗰個。唔好畀人捉到。', filler: false },
      { name: '偵探',     emoji: '🔍', count: 1, desc: '揾出邊個係小偷。',           filler: false },
      { name: '村民',     emoji: '🧑‍🌾', count: 0, desc: '無特殊能力，靠一張嘴。',     filler: true  },
    ],
  },
  cheeseGang: {
    label: '🧀 Cheese Thief（雙賊）',
    roles: [
      { name: '芝士小偷', emoji: '🐭', count: 2, desc: '兩個賊識得對方，夾埋做嘢。', filler: false },
      { name: '偵探',     emoji: '🔍', count: 1, desc: '揾出邊個係小偷。',           filler: false },
      { name: '守衛',     emoji: '🛡️', count: 1, desc: '每晚保護一個人。',           filler: false },
      { name: '村民',     emoji: '🧑‍🌾', count: 0, desc: '無特殊能力，靠一張嘴。',     filler: true  },
    ],
  },
  werewolf: {
    label: '🐺 狼人殺（基本）',
    roles: [
      { name: '狼人',   emoji: '🐺', count: 2, desc: '夜晚殺人，白天扮好人。', filler: false },
      { name: '預言家', emoji: '🔮', count: 1, desc: '每晚查一個人嘅身份。',   filler: false },
      { name: '女巫',   emoji: '🧪', count: 1, desc: '一瓶解藥、一瓶毒藥。',   filler: false },
      { name: '獵人',   emoji: '🏹', count: 1, desc: '死嗰陣可以帶走一個人。', filler: false },
      { name: '平民',   emoji: '🧑', count: 0, desc: '無能力，投票靠推理。',   filler: true  },
    ],
  },
  undercover: {
    label: '🕵️ 臥底',
    roles: [
      { name: '臥底', emoji: '🕵️', count: 1, desc: '你攞到嘅題目同大家唔同。', filler: false },
      { name: '白板', emoji: '⬜', count: 0, desc: '乜都無，靠聽人講去溝。',   filler: false },
      { name: '平民', emoji: '🧑', count: 0, desc: '大多數人。',               filler: true  },
    ],
  },
  blank: {
    label: '✏️ 自訂',
    roles: [
      { name: '角色 A', emoji: '🅰️', count: 1, desc: '', filler: false },
      { name: '平民',   emoji: '🧑', count: 0, desc: '', filler: true  },
    ],
  },
};

const PALETTE = ['🐭','🔍','🛡️','🐺','🔮','🧪','🏹','🧑','🕵️','⬜','👑','💣','🍕','🐱','🦊','🐸','🤖','👻'];

export function makeRole(patch = {}) {
  return {
    id: uid('r'),
    name: patch.name ?? '新角色',
    emoji: patch.emoji ?? PALETTE[Math.floor(Math.random() * PALETTE.length)],
    count: patch.count ?? 1,
    desc: patch.desc ?? '',
    filler: patch.filler ?? false,
  };
}

export function presetRoles(key) {
  const p = PRESETS[key] ?? PRESETS.cheese;
  return p.roles.map(makeRole);
}

/** Fixed (non-filler) seats. */
export function fixedCount(roles) {
  return roles.reduce((s, r) => s + (r.filler ? 0 : r.count), 0);
}

/**
 * Validate a role config against a headcount.
 * Returns { ok, total, filler, message }.
 */
export function validateRoles(roles, playerCount) {
  const fixed = fixedCount(roles);
  const filler = roles.find(r => r.filler);
  if (filler) {
    const left = playerCount - fixed;
    if (left < 0) {
      return { ok: false, total: fixed, filler: 0,
        message: `指定角色共 ${fixed} 個，多過 ${playerCount} 個玩家 — 減少啲。` };
    }
    return { ok: true, total: playerCount, filler: left,
      message: `${fixed} 個指定角色 + ${left} 個「${filler.name}」= ${playerCount} 人 ✓` };
  }
  const total = roles.reduce((s, r) => s + r.count, 0);
  if (total !== playerCount) {
    return { ok: false, total, filler: 0,
      message: `角色總數 ${total}，但有 ${playerCount} 個玩家 — 要啱數先開得。` };
  }
  return { ok: true, total, filler: 0, message: `角色總數 ${total} = ${playerCount} 人 ✓` };
}

/**
 * Expand the role config into one card per player, then shuffle.
 * Throws if the config does not match `playerCount`.
 */
export function buildDeck(roles, playerCount) {
  const v = validateRoles(roles, playerCount);
  if (!v.ok) throw new Error(v.message);

  const deck = [];
  for (const r of roles) {
    if (r.filler) continue;
    for (let i = 0; i < r.count; i++) deck.push(r.id);
  }
  const filler = roles.find(r => r.filler);
  if (filler) for (let i = 0; i < v.filler; i++) deck.push(filler.id);

  return shuffle(deck);
}
