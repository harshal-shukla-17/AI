// Simple auth UI helper for navbar and logout
(async function initAuthUI(){
  const userArea = document.querySelector('.navbar .user-area');
  if (!userArea) return;
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw new Error('not auth');
    const me = await res.json();
    if (!me || !me.email) throw new Error('no user');
    const isProfile = location.pathname === '/profile.html';
    const displayName = me.name || me.email;
    userArea.innerHTML = `
      ${isProfile ? `<span class="nav-username">${displayName}</span>` : `<a href="/profile.html" class="nav-username">${displayName}</a>`}
    `;
  } catch (e) {
    userArea.innerHTML = `<a href="/login.html">Login</a>`;
  }
})();
