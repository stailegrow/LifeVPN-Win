'use strict';

const { identityKey } = require('./models');

/**
 * Приводит серверы подписки к тому, что пришло с панели.
 *
 * Уцелевшим серверам сохраняем id: иначе при каждом обновлении слетал бы
 * выбор в списке, а активное соединение указывало бы на сервер, которого
 * больше нет. Остальные поля обновляем — переименование и смена ключей на
 * панели должны доезжать до клиента.
 */
function merge(existing, fetched, subscriptionID) {
  const mine = existing.filter((s) => s.subscriptionID === subscriptionID);
  const others = existing.filter((s) => s.subscriptionID !== subscriptionID);

  const byKey = new Map();
  for (const server of mine) byKey.set(identityKey(server), server);

  const rebuilt = [];
  const matched = new Set();
  let added = 0;
  let kept = 0;

  for (const original of fetched) {
    const incoming = { ...original, subscriptionID };
    const key = identityKey(incoming);
    const old = byKey.get(key);
    if (old) {
      incoming.id = old.id;
      matched.add(key);
      kept += 1;
    } else {
      added += 1;
    }
    rebuilt.push(incoming);
  }

  const removed = mine.filter((s) => !matched.has(identityKey(s))).length;
  return { servers: others.concat(rebuilt), added, removed, kept };
}

module.exports = { merge };
