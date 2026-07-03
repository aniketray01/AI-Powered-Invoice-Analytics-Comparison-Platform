import React from 'react';
import { motion } from 'framer-motion';
import { 
    User, 
    Mail, 
    Shield, 
    Calendar, 
    Database, 
    Activity, 
    Settings, 
    LogOut,
    CheckCircle2,
    Clock,
    Zap,
    CreditCard
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getActivities } from '../utils/logger';
import { useState, useEffect } from 'react';

const Profile = ({ onBack }) => {
    const { currentUser, logout } = useAuth();
    const [activities, setActivities] = useState([]);
    const [loadingActivities, setLoadingActivities] = useState(true);

    useEffect(() => {
        async function fetchActivities() {
            setLoadingActivities(true);
            const data = await getActivities(currentUser.uid);
            setActivities(data);
            setLoadingActivities(false);
        }
        fetchActivities();
    }, [currentUser.uid]);

    const handleLogout = async () => {
        try {
            await logout();
        } catch (err) {
            console.error("Logout failed", err);
        }
    };

    // Formatted date for Last Login
    const lastLogin = new Date(currentUser.metadata.lastSignInTime).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Formatted date for Member Since
    const memberSince = new Date(currentUser.metadata.creationTime).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    const formatTimestamp = (date) => {
        const now = new Date();
        const diff = now - date;
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);

        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    };

    const getIcon = (type) => {
        switch(type) {
            case 'Success': return <CheckCircle2 size={16} />;
            case 'Completed': return <Clock size={16} />;
            case 'System': return <Zap size={16} />;
            case 'Export': return <Database size={16} />;
            default: return <Activity size={16} />;
        }
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="profile-container"
            style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px 20px' }}
        >
            {/* Profile Header */}
            <div className="glass-panel profile-header" style={{ position: 'relative', overflow: 'hidden', padding: '60px 40px', marginBottom: '32px' }}>
                <div style={{ position: 'absolute', top: '-10%', right: '-5%', width: '300px', height: '300px', background: 'var(--primary)', filter: 'blur(100px)', opacity: 0.1, pointerEvents: 'none' }}></div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '32px', position: 'relative', zIndex: 1 }}>
                    <div style={{ position: 'relative' }}>
                        <div style={{ width: '120px', height: '120px', borderRadius: '32px', background: 'rgba(99, 102, 241, 0.1)', border: '2px solid rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                            <User size={64} />
                        </div>
                        <div style={{ position: 'absolute', bottom: '-5px', right: '-5px', background: '#10b981', border: '4px solid #0f172a', width: '24px', height: '24px', borderRadius: '50%', boxShadow: '0 0 15px rgba(16, 185, 129, 0.5)' }}></div>
                    </div>
                    
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <h1 style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '-1.5px' }}>{currentUser.email?.split('@')[0]}</h1>
                            <div style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)', padding: '4px 12px', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                                Forensic Specialist
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#94a3b8' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Mail size={16} /> {currentUser.email}</div>
                            <div style={{ width: '4px', height: '4px', background: '#475569', borderRadius: '50%' }}></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Shield size={16} /> ID: {currentUser.uid.slice(0, 8)}...</div>
                        </div>
                    </div>

                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px' }}>
                        <button onClick={handleLogout} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
                            <LogOut size={18} /> Sign Out
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '32px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    
                    {/* Activity Timeline */}
                    <div className="glass-panel" style={{ padding: '32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                            <Activity size={20} className="text-primary" />
                            <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Audit Activity Journal</h3>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {loadingActivities ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Clock className="animate-spin" /></div>
                            ) : activities.length > 0 ? (
                                activities.map((item, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '16px', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                                            {getIcon(item.type)}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{item.title}</span>
                                                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{formatTimestamp(item.timestamp)}</span>
                                            </div>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>{item.type}</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                                    <Database size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
                                    <p>No activity recorded yet.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    
                    {/* Account Stats */}
                    <div className="glass-panel" style={{ padding: '32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                            <Settings size={20} className="text-primary" />
                            <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Account Health</h3>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.1)' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', marginBottom: '4px' }}>Security Status</div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>Standard Protection</div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Last Login:</span>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{lastLogin}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Member Since:</span>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{memberSince}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Analytic Tokens:</span>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)' }}>∞ Unmetered</span>
                                </div>
                            </div>

                            <button className="btn-primary" style={{ marginTop: '12px', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}>
                                <CreditCard size={18} /> Upgrade Plan
                            </button>
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '24px', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, transparent 100%)' }}>
                        <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>
                            Need to update your professional credentials or change your security protocol? Contact the <strong>Audit Administration</strong>.
                        </p>
                    </div>
                </div>
            </div>

            <style>{`
                .profile-header {
                    background: linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(30, 41, 59, 0.6) 100%);
                }
                .profile-container {
                    animation: fadeIn 0.5s ease-out;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </motion.div>
    );
};

export default Profile;
