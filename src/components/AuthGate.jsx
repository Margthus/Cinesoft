import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, LogIn, ShieldCheck, UserRound } from 'lucide-react';
import '../styles/AuthGate.css';

const initialRegister = {
  username: '',
  password: '',
  recoveryPhrase: '',
  rememberMe: true,
};

const initialLogin = {
  username: '',
  password: '',
  rememberMe: true,
};

const initialReset = {
  username: '',
  recoveryPhrase: '',
  newPassword: '',
};

const AuthGate = ({ authState, onAuthSuccess, language = 'tr', onLanguageChange }) => {
  const [mode, setMode] = useState(authState?.hasAccount ? 'login' : 'register');
  const [registerForm, setRegisterForm] = useState({
    ...initialRegister,
    username: authState?.rememberedUsername || '',
  });
  const [loginForm, setLoginForm] = useState({
    ...initialLogin,
    username: authState?.rememberedUsername || '',
  });
  const [resetForm, setResetForm] = useState(initialReset);
  const [status, setStatus] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const t = {
    tr: {
      title: 'CineSoft hesabinla devam et',
      subtitle: 'Uygulamayi kullanmak icin yerel bir hesap gerekiyor.',
      login: 'Giris Yap',
      register: 'Kayit Ol',
      forgot: 'Sifremi Unuttum',
      username: 'Kullanici adi',
      password: 'Sifre',
      recovery: 'Kurtarma ifadesi',
      recoveryHint: 'Sifreni sifirlarken bunu kullanacagiz.',
      remember: 'Beni hatirla',
      continue: 'Devam Et',
      create: 'Hesabi Olustur',
      reset: 'Sifreyi Sifirla',
      back: 'Geri',
      invalid: 'Bilgiler dogrulanamadi.',
      accountCreated: 'Hesap olusturuldu.',
      passwordReset: 'Sifre yenilendi. Simdi giris yapabilirsin.',
    },
    en: {
      title: 'Continue with your CineSoft account',
      subtitle: 'A local account is required before using the app.',
      login: 'Sign In',
      register: 'Create Account',
      forgot: 'Forgot Password',
      username: 'Username',
      password: 'Password',
      recovery: 'Recovery phrase',
      recoveryHint: 'We will use this when you reset your password.',
      remember: 'Remember me',
      continue: 'Continue',
      create: 'Create Account',
      reset: 'Reset Password',
      back: 'Back',
      invalid: 'We could not verify those details.',
      accountCreated: 'Account created.',
      passwordReset: 'Password updated. You can sign in now.',
    },
  };

  const copy = t[language];

  const handleRegister = async (event) => {
    event.preventDefault();
    setStatus('loading');
    const result = await window.electronAPI.registerUser(registerForm);
    if (result?.ok) {
      setStatus(copy.accountCreated);
      onAuthSuccess(result.auth);
      return;
    }
    setStatus(copy.invalid);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setStatus('loading');
    const result = await window.electronAPI.loginUser(loginForm);
    if (result?.ok) {
      onAuthSuccess(result.auth);
      return;
    }
    setStatus(copy.invalid);
  };

  const handleReset = async (event) => {
    event.preventDefault();
    setStatus('loading');
    const result = await window.electronAPI.resetPassword(resetForm);
    if (result?.ok) {
      setMode('login');
      setLoginForm((current) => ({ ...current, username: resetForm.username }));
      setStatus(copy.passwordReset);
      return;
    }
    setStatus(copy.invalid);
  };

  return (
    <div className="auth-shell">
      <div className="auth-backdrop" />
      <section className="auth-panel">
        <div className="auth-brand">
          <span className="auth-logo">CINE<span>SOFT</span></span>
          <div className="auth-brand-tools">
            <div className="auth-language-switch">
              <button className={language === 'tr' ? 'active' : ''} onClick={() => onLanguageChange?.('tr')}>TR</button>
              <button className={language === 'en' ? 'active' : ''} onClick={() => onLanguageChange?.('en')}>EN</button>
            </div>
            <ShieldCheck size={20} />
          </div>
        </div>

        <div className="auth-copy">
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>{copy.login}</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>{copy.register}</button>
          <button className={mode === 'reset' ? 'active' : ''} onClick={() => setMode('reset')}>{copy.forgot}</button>
        </div>

        {mode === 'register' && (
          <form className="auth-form" onSubmit={handleRegister}>
            <Field icon={<UserRound size={18} />} value={registerForm.username} onChange={(value) => setRegisterForm({ ...registerForm, username: value })} placeholder={copy.username} />
            <PasswordField
              value={registerForm.password}
              onChange={(value) => setRegisterForm({ ...registerForm, password: value })}
              placeholder={copy.password}
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
            <Field icon={<KeyRound size={18} />} value={registerForm.recoveryPhrase} onChange={(value) => setRegisterForm({ ...registerForm, recoveryPhrase: value })} placeholder={copy.recovery} hint={copy.recoveryHint} />
            <CheckboxRow checked={registerForm.rememberMe} onChange={(checked) => setRegisterForm({ ...registerForm, rememberMe: checked })} label={copy.remember} />
            <button className="auth-submit" type="submit">{copy.create}</button>
          </form>
        )}

        {mode === 'login' && (
          <form className="auth-form" onSubmit={handleLogin}>
            <Field icon={<UserRound size={18} />} value={loginForm.username} onChange={(value) => setLoginForm({ ...loginForm, username: value })} placeholder={copy.username} />
            <PasswordField
              value={loginForm.password}
              onChange={(value) => setLoginForm({ ...loginForm, password: value })}
              placeholder={copy.password}
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
            <CheckboxRow checked={loginForm.rememberMe} onChange={(checked) => setLoginForm({ ...loginForm, rememberMe: checked })} label={copy.remember} />
            <button className="auth-submit" type="submit">{copy.continue}</button>
          </form>
        )}

        {mode === 'reset' && (
          <form className="auth-form" onSubmit={handleReset}>
            <Field icon={<UserRound size={18} />} value={resetForm.username} onChange={(value) => setResetForm({ ...resetForm, username: value })} placeholder={copy.username} />
            <Field icon={<KeyRound size={18} />} value={resetForm.recoveryPhrase} onChange={(value) => setResetForm({ ...resetForm, recoveryPhrase: value })} placeholder={copy.recovery} />
            <PasswordField
              value={resetForm.newPassword}
              onChange={(value) => setResetForm({ ...resetForm, newPassword: value })}
              placeholder={copy.password}
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
            <button className="auth-submit" type="submit">{copy.reset}</button>
          </form>
        )}

        {status && status !== 'loading' && <div className="auth-status">{status}</div>}
      </section>
    </div>
  );
};

const Field = ({ icon, value, onChange, placeholder, hint }) => (
  <label className="auth-field">
    <div className="auth-input-wrap">
      <span>{icon}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
    {hint && <small>{hint}</small>}
  </label>
);

const PasswordField = ({ value, onChange, placeholder, show, onToggle }) => (
  <label className="auth-field">
    <div className="auth-input-wrap">
      <span><Lock size={18} /></span>
      <input type={show ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <button type="button" className="auth-ghost-btn" onClick={onToggle}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  </label>
);

const CheckboxRow = ({ checked, onChange, label }) => (
  <label className="auth-check">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>
);

export default AuthGate;
