import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { apiPost } from '../../api/client';
import { t, getLang, setLang } from '../../i18n';
import MatrixRain from '../common/MatrixRain';
import Icon from '../common/Icon';
import { colors, font } from '../../theme/tokens';

export default function LoginPage() {
  const [username, setUsername] = useState(localStorage.getItem('webterm-rm-user') || '');
  const [password, setPassword] = useState(localStorage.getItem('webterm-rm-pwd') || '');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(!!localStorage.getItem('webterm-rm-user'));
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const data = await apiPost('/api/auth/login', { username, password });
      if (remember) {
        localStorage.setItem('webterm-rm-user', username);
        localStorage.setItem('webterm-rm-pwd', password);
      } else {
        localStorage.removeItem('webterm-rm-user');
        localStorage.removeItem('webterm-rm-pwd');
      }
      setAuth(data.user, data.token);
      navigate('/');
    } catch {
      setError(t('login_error'));
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: '11px 14px', border: '1px solid rgba(122,162,247,0.24)', height: 46,
    background: 'rgba(15,18,32,0.72)', color: colors.text, fontSize: font.xl,
    width: '100%', boxSizing: 'border-box', outline: 'none', borderRadius: 8,
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'radial-gradient(circle at 15% 10%, #29345d 0%, transparent 30%), radial-gradient(circle at 85% 85%, #282045 0%, transparent 32%), #111522', position: 'relative', overflow: 'hidden', cursor: 'default',
    }} onClick={() => setTick((n) => n + 1)}>
      <MatrixRain key={tick} fontSize={18} columns={18} opacity={0.45} radial />
      <div style={{ position: 'absolute', width: 460, height: 460, borderRadius: '50%', background: 'rgba(122,162,247,0.11)', filter: 'blur(70px)', top: '-180px', left: '-120px' }} />
      <div style={{ position: 'absolute', width: 360, height: 360, borderRadius: '50%', background: 'rgba(187,154,247,0.10)', filter: 'blur(70px)', right: '-100px', bottom: '-140px' }} />
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={{
        background: 'linear-gradient(145deg, rgba(39,46,75,0.91), rgba(20,24,42,0.94))', border: '1px solid rgba(122,162,247,0.28)', borderRadius: 18, backdropFilter: 'blur(18px)',
        padding: 36, width: 420, maxWidth: 'calc(100vw - 40px)',
        display: 'flex', flexDirection: 'column', gap: 18,
        boxShadow: '0 28px 80px rgba(0,0,0,0.46), inset 0 1px 0 rgba(255,255,255,0.06)',
        boxSizing: 'border-box', zIndex: 1,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: font.xl4, fontWeight: 700, color: colors.white, letterSpacing: 1, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #7aa2f7, #bb9af7)', boxShadow: '0 8px 20px rgba(122,162,247,0.28)' }}><Icon name="terminal" size={19} color={colors.bg} /></span>
              WebTerm
            </div>
            <div style={{ color: colors.textMuted2, fontSize: font.md, marginTop: 10 }}>{t('app_slogan')}</div>
          </div>
          <span onClick={() => { const lang = getLang() === 'zh' ? 'en' : 'zh'; setLang(lang); window.location.reload(); }}
            style={{ color: colors.textMuted2, fontSize: font.md, cursor: 'pointer', userSelect: 'none', padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(122,162,247,0.2)', background: 'rgba(15,18,32,0.5)' }}>
            {getLang() === 'zh' ? 'EN' : '中'}
          </span>
        </div>

        {error && (
          <div role="alert" style={{ color: colors.dangerBright, fontSize: font.md, padding: '10px 12px', background: colors.dangerSoft, border: '1px solid rgba(247,118,142,0.26)', borderRadius: 8 }}>
            {error}
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 7, color: colors.textMuted2, fontSize: font.md }}>
          {t('login_username')}
          <input style={inputStyle} placeholder={t('login_username')}
            value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 7, color: colors.textMuted2, fontSize: font.md }}>
          {t('login_password')}
          <span style={{ position: 'relative' }}>
            <input type={showPwd ? 'text' : 'password'}
              style={{ ...inputStyle, paddingRight: 46 }} autoComplete="current-password"
              placeholder={t('login_password')} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" aria-label={showPwd ? '隐藏密码' : '显示密码'} onClick={() => setShowPwd(!showPwd)}
              style={{ position: 'absolute', right: 8, top: 7, width: 32, height: 32, border: 0, borderRadius: 6, cursor: 'pointer', color: colors.textMuted2, background: 'transparent', display: 'grid', placeItems: 'center' }}>
              <Icon name={showPwd ? 'eye-off' : 'eye'} size={16} />
            </button>
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textMuted2, fontSize: font.md, cursor: 'pointer', marginTop: 2 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            style={{ accentColor: colors.accent }} />
          {t('login_remember')}
        </label>

        <button type="submit" style={{
          padding: '10px', border: 'none', borderRadius: 8, height: 46,
          background: 'linear-gradient(135deg, #7aa2f7, #a58bf5)', color: colors.bg, cursor: 'pointer', fontSize: font.xl,
          fontWeight: 700, letterSpacing: 0.5, boxSizing: 'border-box', boxShadow: '0 10px 24px rgba(122,162,247,0.25)', marginTop: 2,
        }}>
          {t('login_submit')}
        </button>
      </form>
    </div>
  );
}
