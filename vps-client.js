const signIn = document.querySelector('#signIn');
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (response.status === 401 && signIn) {
    signIn.hidden = false;
    // Let users sign in in another tab without losing unsaved expense fields.
    signIn.target = '_blank'; signIn.rel = 'noopener';
    signIn.textContent = 'Sessão encerrada · Entrar novamente';
  }
  return response;
};
if (signIn) { signIn.href = '/login'; signIn.textContent = 'Entrar com e-mail e senha'; }
const signOut = document.querySelector('#signOut');
if (signOut) {
  signOut.href = '/login';
  signOut.addEventListener('click', async event => {
    event.preventDefault();
    try {
      const response = await fetch('/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      location.replace('/login');
    } catch { alert('Não foi possível sair. Verifique a conexão e tente novamente.'); }
  });
}
// Refresh a restored page so a previous account is never shown from the back/forward cache.
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
