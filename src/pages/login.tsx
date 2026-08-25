import type { FC } from 'hono/jsx';

export const LoginPage: FC<{ next?: string }> = ({ next }) => {
  return (
    <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div class="w-full max-w-sm">
        <div class="flex flex-col items-center mb-8">
          <div class="w-12 h-12 rounded-xl bg-blue-700 flex items-center justify-center text-white font-bold text-lg mb-3">
            PM
          </div>
          <h1 class="text-xl font-semibold text-slate-800">PM Hub</h1>
          <p class="text-sm text-slate-500 mt-1">Prima &amp; Meridian Apartments</p>
        </div>
        <div class="card p-6">
          <form id="login-form" class="space-y-4">
            <div>
              <label class="field-label">Email</label>
              <input type="email" id="login-email" class="field-input" placeholder="you@example.com" autocomplete="username" required />
            </div>
            <div>
              <label class="field-label">Password</label>
              <input type="password" id="login-password" class="field-input" placeholder="••••••••" autocomplete="current-password" required />
            </div>
            <div id="login-error" class="hidden text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2"></div>
            <button type="submit" id="login-submit" class="btn-primary w-full">
              Sign in
            </button>
          </form>
        </div>
        <p class="text-center text-xs text-slate-400 mt-6">
          Building operations platform for Prima &amp; Meridian Apartments
        </p>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
        document.getElementById('login-form').addEventListener('submit', async function (e) {
          e.preventDefault();
          const errorEl = document.getElementById('login-error');
          const submitBtn = document.getElementById('login-submit');
          errorEl.classList.add('hidden');
          submitBtn.disabled = true;
          submitBtn.textContent = 'Signing in…';
          try {
            const res = await PMHub.api('/login', {
              method: 'POST',
              body: {
                email: document.getElementById('login-email').value,
                password: document.getElementById('login-password').value,
              },
            });
            const home = {
              resident: '/resident', building_manager: '/bm', relief_building_manager: '/bm',
              strata_manager: '/strata', council_member: '/strata', system_administrator: '/strata',
              contractor: '/contractor',
            };
            window.location.href = ${JSON.stringify(next || '')} || home[res.role] || '/';
          } catch (err) {
            errorEl.textContent = err.message || 'Login failed.';
            errorEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign in';
          }
        });
      `,
        }}
      ></script>
    </div>
  );
};
