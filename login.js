const form = document.querySelector('#loginForm');
const toggle = document.querySelector('#toggleMode');
const button = document.querySelector('#submitLogin');
const status = document.querySelector('#loginStatus');
const showPassword = document.querySelector('#showPassword');
let register = false;
function setStatus(message = '') {
  status.textContent = message;
  status.hidden = !message;
}
toggle.addEventListener('click', () => {
  register = !register;
  const title = document.querySelector('#formTitle');
  title.textContent = register ? 'Criar sua conta' : 'Entrar na sua conta';
  title.classList.toggle('visually-hidden', !register);
  button.textContent = register ? 'Criar conta' : 'Entrar';
  form.elements.password.autocomplete = register ? 'new-password' : 'current-password';
  form.elements.password.minLength = register ? 12 : 1;
  form.elements.password.placeholder = register ? 'Pelo menos 12 caracteres' : '••••••••';
  setStatus();
  toggle.textContent = register ? 'Já tenho conta' : 'Cadastrar conta';
});
showPassword.addEventListener('click', () => {
  const visible = form.elements.password.type === 'password';
  form.elements.password.type = visible ? 'text' : 'password';
  showPassword.setAttribute('aria-pressed', String(visible));
  showPassword.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
});
document.querySelector('#recoverPassword').addEventListener('click', () => {
  document.querySelector('#recoveryDialog').showModal();
});
form.addEventListener('input', () => setStatus());
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  toggle.disabled = true;
  button.textContent = register ? 'Criando conta…' : 'Entrando…';
  setStatus();
  try {
    const response = await fetch(register ? '/auth/register' : '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.elements.email.value, password: form.elements.password.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error === 'Origem não autorizada.' ? 'O endereço de acesso não corresponde à configuração do servidor. Solicite ao administrador a correção do domínio de acesso.' : data.error || 'Não foi possível entrar.');
    location.replace('/');
  } catch (error) {
    setStatus(error instanceof TypeError ? 'Sem conexão. Tente novamente.' : error.message);
  } finally {
    button.disabled = false;
    toggle.disabled = false;
    button.textContent = register ? 'Criar conta' : 'Entrar';
  }
});
