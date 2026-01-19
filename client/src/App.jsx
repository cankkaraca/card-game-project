import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { motion } from 'framer-motion';
import Confetti from 'react-confetti';
import { User, Users, Trophy, Play, Plus, Check, FastForward, Clock, Volume2, VolumeX, Settings, X, Trash2, Crown, Bot } from 'lucide-react';
import './App.css';

// ŞİMDİLİK LOCALHOST, İLERİDE BURAYA LİNK YAPIŞTIRACAĞIZ:
const SERVER_URL = "http://localhost:3001"; 

const socket = io.connect(SERVER_URL);


const AVATARS = [
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Felix",
  "https://api.dicebear.com/7.x/fun-emoji/svg?seed=Midnight",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Scooter",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Ginger",
  "https://api.dicebear.com/7.x/big-ears/svg?seed=Bandit",
  "https://api.dicebear.com/7.x/micah/svg?seed=Cookie",
  "https://api.dicebear.com/7.x/pixel-art/svg?seed=Milo",
  "https://api.dicebear.com/7.x/lorelei/svg?seed=Sasha",
  "https://api.dicebear.com/7.x/notionists/svg?seed=Leo",
  "https://api.dicebear.com/7.x/open-peeps/svg?seed=Sam"
];

const getFontSize = (text) => {
    if (!text) return '1rem';
    const length = text.length;
    if (length < 10) return '1.4rem';
    if (length < 30) return '1rem';
    if (length < 50) return '0.85rem';
    return '0.7rem';
};

const playSound = (soundName) => {
    if (soundName === 'tick') return; 
    const audio = new Audio(`/sounds/${soundName}.mp3`);
    audio.volume = 0.5;
    audio.play().catch(e => console.log(e));
};

const Whistle = ({ size = 24, color = "currentColor" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 3a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2Z"/>
        <path d="M15 7h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v3h-2v-3h-2v-6Z"/>
        <path d="M5 15h6v4H5z"/>
    </svg>
);

// --- AYARLAR MODALI ---
const SettingsModal = ({ onClose, room, userList, currentMaxScore, currentDuration }) => {
    const [score, setScore] = useState(currentMaxScore || 5);
    const [duration, setDuration] = useState((currentDuration || 30000) / 1000);

    const handleSave = () => {
        socket.emit("update_settings", { room, settings: { maxScore: Number(score), roundDuration: Number(duration) * 1000 } });
        onClose();
    };

    const handleKick = (targetUsername) => {
        if (confirm(`${targetUsername} adlı oyuncuyu atmak istediğine emin misin?`)) {
            socket.emit("kick_player", { room, targetUsername });
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>OYUN AYARLARI</h2>
                    <button className="close-icon" onClick={onClose}><X size={24}/></button>
                </div>
                
                <div className="setting-row">
                    <label>Hedef Puan:</label>
                    <input type="number" value={score} onChange={e => setScore(e.target.value)} min="1" max="20" />
                </div>
                
                <div className="setting-row">
                    <label>Süre (Saniye):</label>
                    <input type="number" value={duration} onChange={e => setDuration(e.target.value)} min="10" max="120" />
                </div>

                <h3>OYUNCULAR ({userList.length})</h3>
                <div className="player-list-manage">
                    {userList.map(p => (
                        <div key={p.username} className="manage-item">
                            <span style={{display: 'flex', alignItems: 'center', gap: 5}}>
                                {p.username}
                                {p.isAdmin && <Crown size={14} color="red" fill="red" />}
                                {p.isBot && <Bot size={14} color="#60a5fa" />}
                            </span>
                            {!p.isAdmin && (
                                <button className="kick-btn" onClick={() => handleKick(p.username)}>
                                    <Trash2 size={16} /> AT
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                <button className="action-btn btn-primary" onClick={handleSave} style={{marginTop: 20}}>KAYDET</button>
            </div>
        </div>
    );
};

// --- AKILLI SAYAÇ ---
const TimerDisplay = ({ timerEnd, soundEnabled }) => {
    const [timeLeft, setTimeLeft] = useState(0);
    const lastTickRef = useRef(0);
    const tickAudioRef = useRef(new Audio('/sounds/tick.mp3'));

    useEffect(() => {
        if (!timerEnd) { 
            setTimeLeft(0); 
            tickAudioRef.current.pause(); 
            return; 
        }

        const interval = setInterval(() => {
            const now = Date.now();
            const diff = Math.max(0, Math.ceil((timerEnd - now) / 1000));
            
            if (diff <= 10 && diff > 0 && diff !== lastTickRef.current) {
                if (soundEnabled) {
                    tickAudioRef.current.currentTime = 0; 
                    tickAudioRef.current.volume = 0.4;
                    tickAudioRef.current.play().catch(() => {}); 
                }
                lastTickRef.current = diff;
            }

            if (diff <= 0) {
                tickAudioRef.current.pause();
                tickAudioRef.current.currentTime = 0;
                clearInterval(interval);
            }

            setTimeLeft(diff);
        }, 500);

        return () => {
            clearInterval(interval);
            tickAudioRef.current.pause();
            tickAudioRef.current.currentTime = 0;
        };
    }, [timerEnd, soundEnabled]);

    if (!timerEnd || timeLeft <= 0) return null;
    const color = timeLeft <= 10 ? '#ef4444' : '#fcd34d';
    
    return (
        <motion.div animate={timeLeft <= 10 ? { scale: [1, 1.1, 1] } : {}} transition={{ repeat: Infinity, duration: 1 }} className="timer-box" style={{ borderColor: color }}>
            <Clock size={20} color={color} />
            <span style={{ color: color, fontSize: '1.2rem', fontWeight: 'bold' }}>{timeLeft} sn</span>
        </motion.div>
    );
};

const GameTable = ({ players, myUsername, tableCards, gameState, onPickWinner, onRevealCard, amICzar, mySocketId, playSoundFunc }) => {
  const TABLE_SIZE = 600; const RADIUS = 240; const CENTER = TABLE_SIZE / 2;

  return (
    <div className="table-wrapper">
      <svg width={TABLE_SIZE} height={TABLE_SIZE} viewBox={`0 0 ${TABLE_SIZE} ${TABLE_SIZE}`} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="woodGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#5D4037" /><stop offset="30%" stopColor="#8D6E63" /><stop offset="70%" stopColor="#4E342E" /><stop offset="100%" stopColor="#3E2723" /></linearGradient>
          <radialGradient id="feltGradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%"><stop offset="0%" stopColor="#2E7D32" /><stop offset="100%" stopColor="#1B5E20" /></radialGradient>
          <filter id="tableShadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="10" /><feOffset dx="0" dy="10" result="offsetblur" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <g filter="url(#tableShadow)">{players.length >= 3 ? (<polygon points={players.map((_, i) => { const angle = (i * (360 / players.length)) - 90; const radian = (angle * Math.PI) / 180; return `${CENTER + RADIUS * Math.cos(radian)},${CENTER + RADIUS * Math.sin(radian)}`; }).join(" ")} fill="url(#feltGradient)" stroke="url(#woodGradient)" strokeWidth="24" strokeLinejoin="round"/>) : (<circle cx={CENTER} cy={CENTER} r={RADIUS} fill="url(#feltGradient)" stroke="url(#woodGradient)" strokeWidth="24"/>)}</g>
      </svg>

      {players.map((player, index) => {
        const pos = { x: CENTER + RADIUS * Math.cos(((index * (360 / players.length)) - 90) * Math.PI / 180), y: CENTER + RADIUS * Math.sin(((index * (360 / players.length)) - 90) * Math.PI / 180) };
        const isMe = player.username === myUsername;
        return (
          <motion.div key={index} initial={{ scale: 0 }} animate={{ scale: 1 }} className="player-seat" style={{ left: pos.x, top: pos.y }}>
            <div className={`avatar-frame ${isMe ? 'me' : ''} ${player.isCzar ? 'czar-frame' : ''}`}><img src={player.avatar || AVATARS[0]} alt="avatar" />{player.hasPlayed && gameState === 'PLAYING' && <div className="ready-indicator"><Check size={16} /></div>}{player.isCzar && <div className="whistle-indicator"><Whistle size={28} color="#FFD700" /></div>}</div>
            <div className={`player-nametag ${isMe ? 'me' : ''}`}>{player.username}{gameState === 'PLAYING' && !player.isCzar && !player.hasPlayed && player.playedCardsTemp?.length > 0 && (<span style={{marginLeft: 5, color: '#fcd34d', fontSize: '0.8em'}}>({player.playedCardsTemp.length}..)</span>)}</div>
          </motion.div>
        );
      })}

      <div className="table-center-area">
         <div className="played-cards-grid">
            {tableCards.map((group, index) => {
                const cards = group.cards || [];
                const isRevealed = group.revealed;

                return (
                    <motion.div 
                        key={index}
                        initial={{ scale: 0, y: 50 }}
                        animate={{ scale: 1, y: 0 }}
                        className={`card-group-container ${gameState === 'JUDGING' && amICzar ? 'czar-selectable' : ''}`}
                        onClick={() => {
                            if (gameState === 'JUDGING' && amICzar) {
                                if (!isRevealed) {
                                    playSoundFunc('card'); 
                                    onRevealCard(index); 
                                } else {
                                    playSoundFunc('pop');
                                    onPickWinner(index);
                                }
                            }
                        }}
                    >
                        {(isRevealed ? cards : ["HIDDEN"]).map((cardText, i) => (
                            <div 
                                key={i}
                                className={`played-card-mini ${isRevealed ? 'revealed' : 'hidden'}`}
                                style={{ marginTop: i > 0 ? '-60px' : '0', marginLeft: i > 0 ? '10px' : '0', zIndex: i }}
                            >
                                <div className="card-back"></div>
                                <div className="card-front">
                                    <span style={{ fontSize: getFontSize(cardText) }}>{cardText}</span>
                                </div>
                            </div>
                        ))}
                        {group.ownerId === mySocketId && gameState === 'JUDGING' && <div className="owner-badge">Senin</div>}
                    </motion.div>
                );
            })}
         </div>
      </div>
    </div>
  );
};

const ScoreBoard = ({ players, currentRound, maxScore }) => {
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    return (
        <motion.div initial={{ x: 100 }} animate={{ x: 0 }} className="scoreboard">
            <div className="scoreboard-header">
                <div style={{display: 'flex', alignItems: 'center', gap: 5}}><Trophy size={20} color="#fcd34d" /><span>SKOR</span></div>
                <span style={{fontSize: '0.8rem', color: '#94a3b8'}}>HEDEF: {maxScore}</span>
            </div>
            <ul className="score-list">
                {sortedPlayers.map((p, i) => (
                    <li key={i} className="score-item">
                        <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                            <span style={{color: i === 0 ? '#fcd34d' : '#94a3b8', fontWeight: 'bold'}}>{i + 1}.</span>
                            <span className="score-name">{p.username}</span>
                            {p.isCzar && <Whistle size={16} color="#FFD700" />}
                            {p.isAdmin && <Crown size={14} color="red" fill="red" style={{marginLeft: 5}} />}
                            {p.isBot && <Bot size={14} color="#60a5fa" style={{marginLeft: 5}} />}
                        </div>
                        <span className="score-points">{p.score || 0} P</span>
                    </li>
                ))}
            </ul>
        </motion.div>
    );
};

// --- OYUN SONU EKRANI (ADMİNE LOBİYE DÖN BUTONU) ---
const GameOverScreen = ({ players, isAdmin, onReturnToLobby }) => {
    const winner = [...players].sort((a, b) => b.score - a.score)[0];
    useEffect(() => { playSound('win'); }, []);
    
    // Normal oyuncu için çıkış/tekrar yükle
    const handleLogout = () => {
        localStorage.removeItem('game_session');
        window.location.reload(); 
    };

    return (
        <div className="game-over-overlay"><Confetti />
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="game-over-box">
                <Trophy size={80} color="#fcd34d" style={{marginBottom: 20}} />
                <h1>OYUN BİTTİ!</h1>
                <p>Ve kazanan...</p>
                <div className="winner-display">
                    <img src={winner.avatar} alt="Winner" />
                    <h2>{winner.username}</h2>
                    <div className="winner-score">{winner.score} Puan</div>
                </div>
                
                {/* ADMİNSE LOBİYE DÖN, DEĞİLSE BEKLE */}
                {isAdmin ? (
                    <button onClick={onReturnToLobby} className="action-btn btn-primary" style={{marginTop: 30}}>
                        LOBİYE DÖN (YENİ OYUN)
                    </button>
                ) : (
                    <div style={{marginTop: 30, color: '#cbd5e1', fontSize: '0.9rem'}}>
                        Adminin lobiye dönmesi bekleniyor...
                    </div>
                )}

                <button onClick={handleLogout} className="exit-btn" style={{position:'relative', bottom: 'auto', right: 'auto', marginTop: 20}}>
                    ÇIKIŞ YAP
                </button>
            </motion.div>
        </div>
    );
};

function App() {
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [isJoined, setIsJoined] = useState(false);
  
  const [userList, setUserList] = useState([]);
  const [gameState, setGameState] = useState('LOBBY');
  const [currentRound, setCurrentRound] = useState(1);
  const [maxScore, setMaxScore] = useState(5);
  const [timerEnd, setTimerEnd] = useState(null);
  const [myHand, setMyHand] = useState([]);
  const [blackCard, setBlackCard] = useState({ text: "", pick: 1 });
  const [tableCards, setTableCards] = useState([]);
  
  const [czarId, setCzarId] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const prevUserListLength = useRef(0);
  const prevHandLength = useRef(0);

  const safePlaySound = (name) => { if (soundEnabled) playSound(name); };

  useEffect(() => {
      const savedSession = localStorage.getItem('game_session');
      if (savedSession) {
          const { username: savedUser, room: savedRoom, avatar: savedAvatar, password: savedPass } = JSON.parse(savedSession);
          if (savedUser && savedRoom) {
              setUsername(savedUser); setRoom(savedRoom); setAvatar(savedAvatar); setPassword(savedPass);
              socket.emit("join_room", { username: savedUser, room: savedRoom, avatar: savedAvatar, password: savedPass });
              setIsJoined(true);
          }
      }
  }, []);

  useEffect(() => {
    socket.on("user_list", (data) => {
        if (data.length > prevUserListLength.current && isJoined) safePlaySound('join');
        prevUserListLength.current = data.length;
        setUserList(data);
    });
    socket.on("game_info", (data) => {
        setGameState(data.state); setCurrentRound(data.round); setMaxScore(data.maxScore || 5); setTimerEnd(data.timerEnd); setCzarId(data.czarId);
    });
    socket.on("new_black_card", (card) => { setBlackCard(card); if(isJoined) safePlaySound('card'); });
    socket.on("your_hand", (hand) => {
        if (hand.length > prevHandLength.current && isJoined) safePlaySound('card');
        prevHandLength.current = hand.length;
        setMyHand(hand);
    });
    socket.on("table_update", (cards) => setTableCards(cards));
    socket.on("kicked", () => { alert("Odadan atıldınız!"); localStorage.removeItem('game_session'); window.location.reload(); });
  }, [socket, isJoined, soundEnabled]);

  const joinRoom = () => {
    if (username && room && password) {
        localStorage.setItem('game_session', JSON.stringify({ username, room, avatar, password }));
        socket.emit("join_room", { username, room, avatar, password });
        setIsJoined(true);
    } else { alert("Lütfen tüm alanları doldurun!"); }
  };

  const handleSettingsClick = () => { const myPlayer = userList.find(p => p.username === username); if (myPlayer?.isAdmin) { setShowSettings(true); } else { alert("Sadece oda yöneticisi (Admin) ayarları değiştirebilir!"); } };
  const startGame = () => socket.emit("start_game", room);
  const addBot = () => socket.emit("add_bot", room); 
  const playCard = (cardText) => { safePlaySound('card'); socket.emit("play_card", { room, cardText }); };
  const pickWinner = (index) => { socket.emit("pick_winner", { room, cardIndex: index }); };
  const revealCard = (index) => { socket.emit("reveal_card", { room, cardIndex: index }); };
  const drawCard = () => { safePlaySound('card'); socket.emit("draw_card", room); };
  const forceFinishVoting = () => socket.emit("force_finish_voting", room);
  const handleUsernameChange = (e) => { if(e.target.value.length <= 15) setUsername(e.target.value); };
  const handlePasswordChange = (e) => { const val = e.target.value.replace(/\D/g, ''); if(val.length <= 5) setPassword(val); };

  const myPlayer = userList.find(p => p.username === username);
  const isAdmin = myPlayer?.isAdmin;
  const myDrawRights = myPlayer ? myPlayer.drawRights : 0;
  const iHavePlayed = myPlayer ? myPlayer.hasPlayed : false;
  const amICzar = (czarId === socket.id);
  const pickCount = blackCard?.pick || 1;
  const myTempCards = myPlayer?.playedCardsTemp || [];

  return (
    <div className="scene-container">
      <div className="spotlight"></div>
      
      {/* ÜST KONTROLLER */}
      <div className="top-controls">
          {isJoined && (<div className={`icon-btn ${!isAdmin ? 'disabled-icon' : ''}`} onClick={handleSettingsClick} title="Oyun Ayarları"><Settings size={24} /></div>)}
          <div className="icon-btn" onClick={() => setSoundEnabled(!soundEnabled)}>{soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}</div>
      </div>

      {showSettings && (<SettingsModal onClose={() => setShowSettings(false)} room={room} userList={userList} currentMaxScore={maxScore} currentDuration={30000} />)}

      {/* --- OYUN SONU EKRANI GÜNCEL --- */}
      {gameState === 'GAME_OVER' ? (
          <GameOverScreen 
              players={userList} 
              isAdmin={isAdmin} 
              onReturnToLobby={() => socket.emit("return_to_lobby", room)} 
          />
      ) : (!isJoined ? (
            <div className="login-screen">
            <h1 className="login-title">CARDS AGAINST HUMANITY</h1>
            <div className="input-group"><label>Avatarını Seç</label><div className="avatar-grid">{AVATARS.map((img, index) => (<div key={index} className={`avatar-option ${avatar === img ? "selected" : ""}`} onClick={() => setAvatar(img)}><img src={img} alt="avatar" /></div>))}</div></div>
            <div className="input-group"><label>Oyuncu Adın</label><input type="text" value={username} onChange={handleUsernameChange} placeholder="Örn: KomikÇocuk" /></div>
            <div className="split-inputs"><div className="input-group"><label>Oda No</label><input type="text" onChange={e => setRoom(e.target.value)} /></div><div className="input-group"><label>Şifre</label><input type="text" value={password} onChange={handlePasswordChange} placeholder="12345" /></div></div>
            <button onClick={joinRoom} className="action-btn btn-primary">MASAYA OTUR</button>
            </div>
        ) : (
            <div className="game-layout">
                {gameState === 'PLAYING' && (<div style={{position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 100}}><TimerDisplay timerEnd={timerEnd} soundEnabled={soundEnabled} /></div>)}
                <div className="room-info"><h2>Oda: {room}</h2><span><Users size={14}/> {userList.length}</span></div>
                
                {/* LOBİ BUTONLARI */}
                {gameState === 'LOBBY' && isAdmin && (
                    <div style={{
                        position: 'absolute', 
                        top: '50%', 
                        left: '50%', 
                        transform: 'translate(-50%, -50%)', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 15, 
                        zIndex: 40
                    }}>
                        <button className="start-game-btn" onClick={startGame}>OYUNU BAŞLAT <Play size={16}/></button>
                        <button className="start-game-btn" style={{background: '#3b82f6', boxShadow: '0 0 30px rgba(59, 130, 246, 0.4)'}} onClick={addBot}>BOT EKLE <Bot size={16}/></button>
                    </div>
                )}
                
                {gameState === 'LOBBY' && !isAdmin && (<div className="game-status-msg">Adminin başlatması bekleniyor...</div>)}
                {gameState === 'VOTING' && isAdmin && (<button className="finish-vote-btn" onClick={forceFinishVoting}>OYLAMAYI BİTİR <FastForward size={16}/></button>)}
                {gameState !== 'LOBBY' && blackCard && (<div className="black-card-display"><h3>{blackCard.text}</h3>{blackCard.pick > 1 && <span className="pick-badge">PICK {blackCard.pick}</span>}</div>)}
                
                <div className="table-container">
                    <GameTable 
                        players={userList} 
                        myUsername={username} 
                        tableCards={tableCards} 
                        gameState={gameState} 
                        onPickWinner={pickWinner} 
                        amICzar={amICzar} 
                        mySocketId={socket.id} 
                        playSoundFunc={safePlaySound}
                        onRevealCard={revealCard} 
                    />
                </div>

                <ScoreBoard players={userList} currentRound={currentRound} maxScore={maxScore} />

                {gameState === 'PLAYING' && !amICzar && (
                    <div className="hand-wrapper">
                        {!iHavePlayed && (<button className="draw-card-btn" onClick={drawCard} disabled={myDrawRights <= 0}><Plus size={16} /> Kart Çek ({myDrawRights})</button>)}
                        <div className="my-hand-container">
                            {myHand.map((card, i) => (
                                <motion.div 
                                    key={i} 
                                    whileHover={!iHavePlayed ? { y: -20 } : {}} 
                                    className={`hand-card ${iHavePlayed ? 'disabled' : ''}`} 
                                    onClick={() => !iHavePlayed && playCard(card)}
                                >
                                    <span style={{ fontSize: getFontSize(card) }}>{card}</span>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                )}
                
                {gameState === 'LOBBY' && userList.length < 3 && <div className="game-status-msg">En az 3 kişi bekleniyor...</div>}
                {gameState === 'PLAYING' && amICzar && <div className="game-status-msg" style={{color: '#fcd34d'}}>HAKEMSİN! Oyuncuların kart atmasını bekle...</div>}
                {gameState === 'PLAYING' && !amICzar && !iHavePlayed && (<div className="game-status-msg">{pickCount > 1 ? `Bu tur ${pickCount} kart seçmelisin! (${myTempCards.length}/${pickCount})` : "En komik kartı seç ve at!"}</div>)}
                {gameState === 'JUDGING' && amICzar && <div className="game-status-msg" style={{color: '#4ade80'}}>KARTLARA TIKLA VE AÇ! Sonra kazananı seç.</div>}
                {gameState === 'JUDGING' && !amICzar && <div className="game-status-msg">Hakem kartları inceliyor...</div>}
                {gameState === 'RESULT' && <div className="game-status-msg" style={{color: '#fcd34d'}}>Sonuçlar Açıklanıyor!</div>}
                <button onClick={() => { localStorage.removeItem('game_session'); window.location.reload(); }} className="exit-btn">ÇIKIŞ YAP</button>
            </div>
        )
      )}
    </div>
  );
}

export default App;