// No plaintext or password is persisted. All backups use the same encrypted envelope.
export const STORAGE_KEY = 'career-os.v1.vault';
const ITERATIONS = 600000;
const encoder = new TextEncoder();
const aad = encoder.encode('career-os:v1');
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export function validateEnvelope(value) {
  if (!value || value.format !== 'career-os' || value.version !== 1 || value.iterations !== ITERATIONS ||
      typeof value.salt !== 'string' || typeof value.iv !== 'string' || typeof value.data !== 'string' ||
      value.data.length > 14000000 || !/^[A-Za-z0-9+/]+=*$/.test(value.data) ||
      unb64(value.salt).length !== 16 || unb64(value.iv).length !== 12 || unb64(value.data).length < 16) {
    throw new Error('备份格式不正确或版本不受支持。');
  }
  return value;
}
export async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256'}, material,
    {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}
export function emptyData() { return {version: 1, tasks: [], jobs: [], knowledge: []}; }
export function validateData(data) {
  if (!data || data.version !== 1 || !['tasks', 'jobs', 'knowledge'].every(k => Array.isArray(data[k]) && data[k].length <= 10000)) throw new Error('记录结构无效。');
  for (const kind of ['tasks', 'jobs', 'knowledge']) {
    const ids = new Set();
    for (const record of data[kind]) {
      if (!record || typeof record !== 'object' || typeof record.id !== 'string' || ids.has(record.id) ||
          Object.values(record).some(v => typeof v !== 'string') || Object.values(record).some(v => v.length > 100000)) throw new Error('记录内容无效。');
      ids.add(record.id);
      if (typeof record.title !== 'string' || !record.title.trim()) throw new Error('记录缺少名称。');
      if (kind === 'jobs' && record.interviews) {
        const rounds = JSON.parse(record.interviews);
        if (!Array.isArray(rounds) || rounds.length > 100 || rounds.some(r => !r || typeof r !== 'object' ||
            Object.values(r).some(v => typeof v !== 'string' || v.length > 20000))) throw new Error('面试记录格式无效。');
      }
    }
  }
  return data;
}
export async function encrypt(data, key, salt) {
  validateData(data);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(data));
  if (plaintext.length > 5000000) throw new Error('记录总量超过 5 MB，请精简内容后保存。');
  const result = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad}, key, plaintext));
  // Chunk conversion avoids argument limits on large notes.
  let binary = '';
  for (let i = 0; i < result.length; i += 8192) binary += String.fromCharCode(...result.subarray(i, i + 8192));
  return {format: 'career-os', version: 1, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: btoa(binary)};
}
export async function createVault(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const data = emptyData();
  return {key, salt, data, envelope: await encrypt(data, key, salt)};
}
export async function openVault(envelope, password) {
  validateEnvelope(envelope);
  const salt = unb64(envelope.salt);
  const key = await deriveKey(password, salt);
  const result = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: aad}, key, unb64(envelope.data));
  const data = validateData(JSON.parse(new TextDecoder().decode(result)));
  return {key, salt, data};
}
