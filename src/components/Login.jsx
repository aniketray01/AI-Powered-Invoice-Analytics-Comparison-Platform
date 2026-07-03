import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, LogIn, Github, MailPlus, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Login = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login, signup, googleLogin } = useAuth();

    async function handleSubmit(e) {
        e.preventDefault();
        
        try {
            setError("");
            setLoading(true);
            if (isLogin) {
                await login(email, password);
            } else {
                await signup(email, password);
            }
        } catch (err) {
            setError(err.message || (isLogin ? "Failed to sign in." : "Failed to create an account."));
        }
        setLoading(false);
    }

    async function handleGoogleLogin() {
        try {
            setError("");
            setLoading(true);
            await googleLogin();
        } catch (err) {
            setError("Failed to sign in with Google.");
        }
        setLoading(false);
    }

    return (
        <div className="login-wrapper">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="login-card glass-panel"
            >
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div className="login-icon-container">
                        <ShieldCheck size={32} />
                    </div>
                    <h2 style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-1px', marginBottom: '8px' }}>
                        {isLogin ? "Access Audit Vault" : "Join the Audit Network"}
                    </h2>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem' }}>
                        {isLogin ? "Welcome back. Log in to continue your forensic audit." : "Create a secure account to begin your forensic analysis."}
                    </p>
                </div>

                {error && (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="error-alert"
                    >
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </motion.div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div className="input-group">
                        <label>Email Address</label>
                        <div className="input-wrapper">
                            <Mail size={18} className="input-icon" />
                            <input 
                                type="email" 
                                placeholder="name@company.com" 
                                required 
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="input-group">
                        <label>Secure Password</label>
                        <div className="input-wrapper">
                            <Lock size={18} className="input-icon" />
                            <input 
                                type="password" 
                                placeholder="••••••••" 
                                required 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        className="btn-primary" 
                        disabled={loading}
                        style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: '8px' }}
                    >
                        {loading ? <Loader2 className="animate-spin" /> : (
                            isLogin ? <><LogIn size={18} /> Authenticate Session</> : <><MailPlus size={18} /> Deploy Account</>
                        )}
                    </button>
                </form>

                <div className="divider">
                    <span>OR SECURE CONNECT</span>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button 
                        onClick={handleGoogleLogin} 
                        className="btn-secondary" 
                        disabled={loading}
                        style={{ flex: 1, justifyContent: 'center', height: '48px' }}
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Google Authorization
                    </button>
                    {/* Placeholder for others if needed */}
                </div>

                <div style={{ marginTop: '32px', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                    {isLogin ? "New to the platform?" : "Already have an account?"} 
                    <button 
                        onClick={() => setIsLogin(!isLogin)} 
                        style={{ marginLeft: '8px', color: 'var(--primary)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                        {isLogin ? "Initialize Account" : "Access Vault"}
                    </button>
                </div>
            </motion.div>

            <style>{`
                .login-wrapper {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 40px 20px;
                    background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.05), transparent),
                                radial-gradient(circle at bottom left, rgba(139, 92, 246, 0.05), transparent);
                }
                .login-card {
                    max-width: 480px;
                    width: 100%;
                    padding: 48px;
                    background: rgba(15, 23, 42, 0.6);
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                }
                .login-icon-container {
                    width: 64px;
                    height: 64px;
                    background: rgba(99, 102, 241, 0.1);
                    border: 1px solid rgba(99, 102, 241, 0.2);
                    border-radius: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 24px;
                    color: var(--primary);
                }
                .error-alert {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 16px;
                    background: rgba(239, 68, 68, 0.1);
                    border: 1px solid rgba(239, 68, 68, 0.2);
                    border-radius: 12px;
                    color: #f87171;
                    font-size: 0.9rem;
                    margin-bottom: 24px;
                }
                .input-group label {
                    display: block;
                    font-size: 0.85rem;
                    font-weight: 700;
                    color: #94a3b8;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .input-wrapper {
                    position: relative;
                }
                .input-icon {
                    position: absolute;
                    left: 16px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #64748b;
                }
                .input-wrapper input {
                    width: 100%;
                    background: rgba(0, 0, 0, 0.2);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    padding: 12px 16px 12px 48px;
                    border-radius: 12px;
                    color: white;
                    font-size: 1rem;
                    transition: all 0.2s;
                }
                .input-wrapper input:focus {
                    border-color: var(--primary);
                    background: rgba(0, 0, 0, 0.3);
                    outline: none;
                    box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
                }
                .divider {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    margin: 32px 0;
                    color: #475569;
                    font-size: 0.75rem;
                    font-weight: 800;
                    letter-spacing: 1px;
                }
                .divider::before, .divider::after {
                    content: '';
                    flex: 1;
                    height: 1px;
                    background: rgba(255, 255, 255, 0.05);
                }
                .btn-primary {
                    background: var(--primary);
                    color: white;
                    border: none;
                    border-radius: 12px;
                    font-weight: 800;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .btn-primary:hover {
                    filter: brightness(1.1);
                    transform: translateY(-2px);
                }
                .btn-primary:active {
                    transform: translateY(0);
                }
                .btn-secondary {
                    background: rgba(255, 255, 255, 0.05);
                    color: white;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.1);
                }
            `}</style>
        </div>
    );
};

export default Login;
