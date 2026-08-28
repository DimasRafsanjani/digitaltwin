// Jika pengguna sudah memiliki token aktif, lemparkan langsung ke Dasbor Utama
        if (localStorage.getItem('jwt_token')) {
            window.location.href = '/';
        }

        async function Login() {
            const u = document.getElementById('auth-username').value;
            const p = document.getElementById('auth-password').value;
            const errDiv = document.getElementById('login-error');
            const succDiv = document.getElementById('login-success');
            errDiv.style.display = 'none';
            succDiv.style.display = 'none';
            
            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: u, password: p })
                });
                const data = await res.json();
                if (res.ok) {
                    localStorage.setItem('jwt_token', data.token);
                    // Login berhasil, alihkan pengguna ke index.html
                    window.location.href = '/';
                } else {
                    errDiv.innerText = data.error || 'Login gagal';
                    errDiv.style.display = 'block';
                }
            } catch(e) {
                errDiv.innerText = 'Server error';
                errDiv.style.display = 'block';
            }
        }

        document.getElementById('btn-login').addEventListener('click', Login);

        async function Registrasi() {
            const u = document.getElementById('auth-username').value;
            const p = document.getElementById('auth-password').value;
            const errDiv = document.getElementById('login-error');
            const succDiv = document.getElementById('login-success');
            errDiv.style.display = 'none';
            succDiv.style.display = 'none';

            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: u, password: p })
                });
                const data = await res.json();
                if (res.ok) {
                    succDiv.innerText = data.message;
                    succDiv.style.display = 'block';
                } else {
                    errDiv.innerText = data.error || 'Registrasi gagal';
                    errDiv.style.display = 'block';
                }
            } catch(e) {
                errDiv.innerText = 'Server error';
                errDiv.style.display = 'block';
            }
        }

        document.getElementById('btn-register').addEventListener('click', Registrasi);