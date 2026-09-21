const test = require('node:test');
const assert = require('node:assert/strict');

const {
  idForRelativePath,
  relativePathForId,
  packageKind,
  multipartInfo,
  parseRange,
  sanitizeConfig,
  normalizeBaseUrl,
  createDirectInstallPayload,
} = require('../server');

test('package ids round-trip nested paths without exposing raw paths in URLs', () => {
  const relative = 'RPG collection/UP9000-CUSA12345-GAME.pkg';
  const id = idForRelativePath(relative);
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  assert.equal(relativePathForId(id), relative);
});

test('package path decoding rejects traversal', () => {
  const traversal = Buffer.from('../outside.pkg').toString('base64url');
  assert.throws(() => relativePathForId(traversal), /Invalid package path/);
});

test('package kind and title naming hints are stable', () => {
  assert.equal(packageKind('UP0001-CUSA12345-DLC.pkg'), 'DLC');
  assert.equal(packageKind('UP9000-CUSA12345-GAME_A0123.pkg'), 'Update');
  assert.equal(packageKind('CUSA12345-base.pkg'), 'Base');
});

test('split package names share a key and preserve numeric order', () => {
  assert.deepEqual(multipartInfo('Game/BASE_0.pkg'), { key: 'Game/base', index: 0 });
  assert.deepEqual(multipartInfo('Game/BASE_12.pkg'), { key: 'Game/base', index: 12 });
  assert.equal(multipartInfo('Game/update_A0100.pkg'), null);
});

test('range parser supports normal, suffix, and invalid ranges', () => {
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=95-200', 100), { start: 95, end: 99 });
  assert.deepEqual(parseRange('bytes=100-101', 100), { invalid: true });
  assert.equal(parseRange(undefined, 100), null);
});

test('direct install payload contains only the native RPI keys', () => {
  const payload = createDirectInstallPayload(['http://192.168.1.10:8080/pkg/game.pkg']);
  assert.deepEqual(payload, {
    type: 'direct',
    packages: ['http://192.168.1.10:8080/pkg/game.pkg'],
  });
  assert.deepEqual(Object.keys(payload).sort(), ['packages', 'type']);
  assert.throws(() => createDirectInstallPayload([]), /at least one package URL/i);
});

test('settings are clamped and public URLs are normalized', () => {
  const settings = sanitizeConfig({
    libraryPath: '/pkg',
    scanIntervalSec: 1,
    ps4Port: 99999,
    publicBaseUrl: 'http://192.168.1.10:8080/',
  });
  assert.equal(settings.scanIntervalSec, 5);
  assert.equal(settings.ps4Port, 65535);
  assert.equal(settings.publicBaseUrl, 'http://192.168.1.10:8080');
  assert.equal(normalizeBaseUrl('', true), '');
  assert.throws(() => normalizeBaseUrl('ftp://nas.local/pkg'), /http or https/);
});
