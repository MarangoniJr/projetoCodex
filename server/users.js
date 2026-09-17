import { emitKeypressEvents } from 'node:readline';
import { openStorage } from './storage.js';
import { initAuth, setPassword } from './auth.js';
const [command, email] = process.argv.slice(2);
if (!['create', 'password'].includes(command) || !email) {
  console.error('Uso: node server/users.js create|password email@dominio.com'); process.exit(1);
}
async function secret(prompt) {
  if (!process.stdin.isTTY) throw new Error('Use um terminal interativo (docker compose exec, sem -T).');
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) { process.stdin.off('keypress', keypress); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolve(value); }
    function keypress(text, key) {
      if (key?.ctrl && key.name === 'c') return finish(new Error('Cancelado.'));
      if (key?.name === 'return') return finish();
      if (key?.name === 'backspace') value = value.slice(0, -1);
      else if (text && !key?.ctrl && !key?.meta) value += text;
    }
    process.stdin.on('keypress', keypress);
  });
}
try {
  const password = await secret('Senha (mínimo 12 caracteres; não será exibida): ');
  if (password !== await secret('Confirme a senha: ')) throw new Error('As senhas não coincidem.');
  const { database } = openStorage(process.env.DATA_DIR || '.vps-data');
  try { initAuth(database); await setPassword(database, email, password, command === 'create'); }
  finally { database.close(); }
  console.log(command === 'create' ? 'Conta criada.' : 'Senha alterada e sessões anteriores encerradas.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
